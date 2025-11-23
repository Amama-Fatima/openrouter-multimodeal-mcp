// routes/debug.js
const express = require("express");
const router = express.Router();
const config = require("../config");
const {
  createMcpProcess,
  generateSessionId,
  getSessionsInfo,
  activeSessions,
} = require("../sessionManager");

// Debug endpoint to test MCP process directly
router.get("/mcp", async (req, res) => {
  const mcpProcess = createMcpProcess();

  if (!mcpProcess) {
    return res.json({ error: "MCP process not available" });
  }

  const initMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: config.mcp.protocolVersion,
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };

  const toolsMessage = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  };

  let output = [];
  const dataHandler = (data) => {
    output.push(data.toString());
  };

  mcpProcess.stdout.on("data", dataHandler);
  mcpProcess.stderr.on("data", dataHandler);

  mcpProcess.stdin.write(JSON.stringify(initMessage) + "\n");

  setTimeout(() => {
    mcpProcess.stdin.write(JSON.stringify(toolsMessage) + "\n");
  }, 1000);

  setTimeout(() => {
    mcpProcess.stdout.removeListener("data", dataHandler);
    mcpProcess.stderr.removeListener("data", dataHandler);

    if (!mcpProcess.killed) {
      mcpProcess.kill();
    }

    res.json({
      sentMessages: [initMessage, toolsMessage],
      receivedOutput: output,
      processStatus: mcpProcess.killed ? "dead" : "alive",
    });
  }, 5000);
});

// Debug endpoint to test tools list on existing session
router.post("/tools", async (req, res) => {
  const sessionId = generateSessionId(req);
  console.log(`Manual tools list request for session: ${sessionId}`);

  const sessionData = activeSessions.get(sessionId);
  if (!sessionData) {
    return res.json({
      error: "No active session found. Connect to /mcp first.",
    });
  }

  if (!sessionData.initialized) {
    return res.json({ error: "Session not initialized yet." });
  }

  const toolsMessage = {
    jsonrpc: "2.0",
    id: 999,
    method: "tools/list",
    params: {},
  };

  try {
    const messageStr = JSON.stringify(toolsMessage) + "\n";
    console.log("Manually sending tools/list:", messageStr.trim());
    sessionData.process.stdin.write(messageStr);

    res.json({
      success: true,
      message: "tools/list sent to MCP process, check logs for response",
      sessionInfo: {
        initialized: sessionData.initialized,
        processAlive: !sessionData.process.killed,
        pendingRequests: sessionData.pendingRequests.size,
        age: Date.now() - sessionData.createdAt,
        idleSince: Date.now() - sessionData.lastActivity,
      },
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

router.get("/sessions", (req, res) => {
  const sessionsInfo = getSessionsInfo();
  res.json({
    ...sessionsInfo,
    config: config.timeouts,
  });
});

module.exports = router;
