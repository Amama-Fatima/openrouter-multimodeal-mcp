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

// SSE listener endpoint for server-to-client messages
// Requires authentication via Bearer token
router.get("/mcp", verifyBearerToken, (req, res) => {
  try {
    const sessionId = generateSessionId(req);
    console.log(`SSE stream opened for session ${sessionId} (user: ${req.user.userId})`);

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

    const sessionData = getOrCreateSession(sessionId, req);
    sessionData.sseRes = res;
  } catch (error) {
    console.error("Error setting up SSE:", error);
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

  sessionData.keepAliveInterval = keepAlive;

  req.on("close", () => {
    clearInterval(keepAlive);
    sessionData.sseRes = null;
    console.log(`SSE stream closed for session ${sessionId}`);
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

  console.log("=== Received MCP request ===");
  console.log("Session:", sessionId);
  console.log("User:", req.user.userId);
  console.log("Method:", message.method);
  console.log("ID:", message.id);
  console.log("Params:", JSON.stringify(message.params, null, 2));
  console.log("============================");

  res.setHeader("Mcp-Session-Id", sessionId);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Mcp-Session-Id, MCP-Protocol-Version"
  );
  res.setHeader("MCP-Protocol-Version", config.mcp.protocolVersion);

  // Validate JSON-RPC message
  if (!message.jsonrpc || !message.method) {
    console.error("Invalid JSON-RPC message");
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
  } catch (error) {
    console.error("Error getting/creating session:", error);
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
    console.error("MCP process not available or killed");
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
      console.log("Session already initialized, reinitializing...");
      sessionData.initialized = false;
    }
    sessionData.initializing = true;
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
      console.log(
        `Timeout (${timeoutDuration}ms) waiting for response to message ID ${message.id}`
      );

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
    console.log("Sending to MCP process:", messageStr.trim());

    if (!mcpProcess.stdin.writable) {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      throw new Error("MCP process stdin is not writable");
    }

    mcpProcess.stdin.write(messageStr);
  } catch (error) {
    console.error("Error processing MCP request:", error);

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
  console.log("SSE connection attempted - redirecting to POST /mcp");

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
