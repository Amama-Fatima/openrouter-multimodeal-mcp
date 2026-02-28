// routes/mcp.js
const express = require("express");
const router = express.Router();
const config = require("../config");
const { verifyBearerToken } = require("../middleware/auth");
const {
  generateSessionId,
  getOrCreateSession,
  cleanupSession,
} = require("../sessionManager");
const {
  setupMcpListeners,
  handleNotification,
  getTimeoutForMethod,
  setupProgressInterval,
} = require("../mcpHandler");

// Enhanced logging
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

// SSE listener endpoint for server-to-client messages
// Requires authentication via Bearer token
router.get("/mcp", verifyBearerToken, (req, res) => {
  let sessionId;
  let sessionData;
  
  try {
    sessionId = generateSessionId(req);
    log("INFO", "[MCP_SSE] Setting up SSE connection", {
      session_id: sessionId,
      user_id: req.user.userId,
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": config.mcp.protocolVersion,
    });

    res.write(`: Connected to session ${sessionId}\n\n`);

    sessionData = getOrCreateSession(sessionId, req);
    sessionData.sseRes = res;
    
    log("INFO", "[MCP_SSE] SSE connection established", {
      session_id: sessionId,
      user_id: req.user.userId,
    });
  } catch (error) {
    log("ERROR", "[MCP_SSE] Error setting up SSE connection", {
      error: error.message,
      stack: error.stack,
    });
    if (!res.headersSent) {
      res.status(401).json({
        error: "Authentication required",
        message: error.message,
      });
    }
    return;
  }

  // Keep-alive pings
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: ping ${Date.now()}\n\n`);
    } else {
      clearInterval(keepAlive);
    }
  }, config.timeouts.KEEPALIVE_INTERVAL);

  if (sessionData) {
    sessionData.keepAliveInterval = keepAlive;
  }

  req.on("close", () => {
    clearInterval(keepAlive);
    if (sessionData) {
      sessionData.sseRes = null;
    }
    log("INFO", "[MCP_SSE] SSE stream closed", {
      session_id: sessionId,
    });
  });
});

// Main MCP endpoint (POST)
// Requires authentication via Bearer token
router.post("/mcp", verifyBearerToken, async (req, res) => {
  const message = req.body;
  let sessionId;

  try {
    sessionId = generateSessionId(req);
  } catch (error) {
    log("WARN", "[MCP_ENDPOINT] Session ID generation failed", {
      error: error.message,
      has_user: !!req.user,
    });
    return res.status(401).json({
      jsonrpc: "2.0",
      id: message.id || null,
      error: {
        code: -32000,
        message: "Authentication required",
        data: error.message,
      },
    });
  }

  log("INFO", "[MCP_ENDPOINT] Received MCP request", {
    session_id: sessionId,
    user_id: req.user.userId,
    method: message.method,
    message_id: message.id,
    has_params: !!message.params,
  });

  res.setHeader("Mcp-Session-Id", sessionId);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Mcp-Session-Id, MCP-Protocol-Version"
  );
  res.setHeader("MCP-Protocol-Version", config.mcp.protocolVersion);

  // Validate JSON-RPC message
  if (!message.jsonrpc || !message.method) {
    log("WARN", "[MCP_ENDPOINT] Invalid JSON-RPC message", {
      has_jsonrpc: !!message.jsonrpc,
      has_method: !!message.method,
      message_id: message.id,
    });
    return res.status(400).json({
      jsonrpc: "2.0",
      id: message.id || null,
      error: {
        code: -32600,
        message: "Invalid Request",
      },
    });
  }

  // Get or create session (requires req.user from auth middleware)
  let sessionData;
  try {
    sessionData = getOrCreateSession(sessionId, req);
    log("INFO", "[MCP_ENDPOINT] Session retrieved/created", {
      session_id: sessionId,
      user_id: req.user.userId,
      initialized: sessionData.initialized,
    });
  } catch (error) {
    log("ERROR", "[MCP_ENDPOINT] Error getting/creating session", {
      error: error.message,
      stack: error.stack,
      session_id: sessionId,
    });
    return res.status(401).json({
      jsonrpc: "2.0",
      id: message.id || null,
      error: {
        code: -32000,
        message: "Authentication required",
        data: error.message,
      },
    });
  }

  const mcpProcess = sessionData.process;

  if (!mcpProcess || mcpProcess.killed) {
    log("ERROR", "[MCP_ENDPOINT] MCP process not available or killed", {
      session_id: sessionId,
      process_killed: mcpProcess?.killed,
      has_process: !!mcpProcess,
    });
    cleanupSession(sessionId, "process unavailable");
    return res.status(500).json({
      jsonrpc: "2.0",
      id: message.id || null,
      error: {
        code: -32603,
        message: "Internal error: MCP process not available",
      },
    });
  }

  // Handle initialize method specially
  if (message.method === "initialize") {
    if (sessionData.initialized) {
      log("INFO", "[MCP_ENDPOINT] Session already initialized, reinitializing", {
        session_id: sessionId,
      });
      sessionData.initialized = false;
    }
    sessionData.initializing = true;
    log("INFO", "[MCP_ENDPOINT] Initializing session", {
      session_id: sessionId,
      user_id: req.user.userId,
    });
  }

  try {
    // Handle notifications (no response expected)
    if (message.method.startsWith("notifications/")) {
      return handleNotification(message, sessionData, res);
    }

    // Set up listeners if not already set up
    setupMcpListeners(sessionData, sessionId);

    // Determine timeout and set up progress interval
    const timeoutDuration = getTimeoutForMethod(message.method);
    const progressInterval = setupProgressInterval(message, sessionData);

    // Set up response handler for regular requests
    const responseTimeout = setTimeout(() => {
      log("WARN", "[MCP_ENDPOINT] Request timeout", {
        timeout_duration: timeoutDuration,
        message_id: message.id,
        method: message.method,
        session_id: sessionId,
      });

      if (progressInterval) {
        clearInterval(progressInterval);
      }

      if (
        message.id !== undefined &&
        sessionData.pendingRequests.has(message.id)
      ) {
        const request = sessionData.pendingRequests.get(message.id);
        sessionData.pendingRequests.delete(message.id);

        if (!request.res.headersSent) {
          request.res.status(408).json({
            jsonrpc: "2.0",
            id: message.id || null,
            error: {
              code: -32001,
              message: `Request timed out after ${timeoutDuration}ms`,
              data: {
                timeout: timeoutDuration,
                method: message.method,
              },
            },
          });
        }
      }
    }, timeoutDuration);

    // Store pending request only if there's an ID
    if (message.id !== undefined) {
      sessionData.pendingRequests.set(message.id, {
        res,
        timeout: responseTimeout,
        method: message.method,
        timestamp: Date.now(),
        progressInterval,
      });
    }

    // Send message to MCP process
    const messageStr = JSON.stringify(message) + "\n";
    log("INFO", "[MCP_ENDPOINT] Sending message to MCP process", {
      message_id: message.id,
      method: message.method,
      session_id: sessionId,
    });

    if (!mcpProcess.stdin.writable) {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      throw new Error("MCP process stdin is not writable");
    }

    mcpProcess.stdin.write(messageStr);
  } catch (error) {
    log("ERROR", "[MCP_ENDPOINT] Error processing MCP request", {
      error: error.message,
      stack: error.stack,
      message_id: message.id,
      method: message.method,
      session_id: sessionId,
    });

    if (
      message.id !== undefined &&
      sessionData.pendingRequests.has(message.id)
    ) {
      const request = sessionData.pendingRequests.get(message.id);

      if (request.progressInterval) {
        clearInterval(request.progressInterval);
      }

      clearTimeout(request.timeout);
      sessionData.pendingRequests.delete(message.id);
    }

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        id: message.id || null,
        error: {
          code: -32603,
          message: "Internal error",
          data: error.message,
        },
      });
    }
  }
});

// Legacy SSE endpoint for backward compatibility
router.get("/sse", (req, res) => {
  log("WARN", "[MCP_SSE] Legacy SSE endpoint accessed", {
    path: req.path,
    ip: req.ip,
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
  });

  res.write(
    `event: error\ndata: ${JSON.stringify({
      error:
        "This server uses Streamable HTTP transport. Please use POST /mcp endpoint instead.",
    })}\n\n`
  );

  setTimeout(() => {
    res.end();
  }, 1000);
});

module.exports = router;
