// sessionManager.js
const { spawn } = require("child_process");
const config = require("./config");

// Store active MCP processes and their state per session
const activeSessions = new Map();

function createMcpProcess() {
  console.log("Creating new OpenRouter MCP process...");
  console.log(`MCP Path: ${config.mcp.mcpPath}`);

  const mcpProcess = spawn("node", [config.mcp.mcpPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENROUTER_API_KEY: config.openrouter.apiKey,
      OPENROUTER_DEFAULT_MODEL: config.openrouter.defaultModel,
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
      MCP_TIMEOUT: config.timeouts.REQUEST_TIMEOUT.toString(),
      MCP_TOOL_TIMEOUT: config.timeouts.REQUEST_TIMEOUT.toString(),
    },
  });

  mcpProcess.on("error", (error) => {
    console.error("MCP process error:", error);
  });

  mcpProcess.on("exit", (code) => {
    console.log(`MCP process exited with code ${code}`);
  });

  return mcpProcess;
}

// Clean up a specific session
function cleanupSession(sessionId, reason = "timeout") {
  const sessionData = activeSessions.get(sessionId);
  if (!sessionData) return;

  console.log(`Cleaning up session ${sessionId} (reason: ${reason})`);

  // Clear all timers
  if (sessionData.idleTimer) clearTimeout(sessionData.idleTimer);
  if (sessionData.lifetimeTimer) clearTimeout(sessionData.lifetimeTimer);
  if (sessionData.keepAliveInterval)
    clearInterval(sessionData.keepAliveInterval);

  // Clear pending request timeouts AND progress intervals
  sessionData.pendingRequests.forEach((request) => {
    if (request.timeout) clearTimeout(request.timeout);
    if (request.progressInterval) clearInterval(request.progressInterval);
    if (!request.res.headersSent) {
      request.res.status(408).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: `Session terminated: ${reason}`,
        },
      });
    }
  });
  sessionData.pendingRequests.clear();

  // Close SSE connection
  if (sessionData.sseRes && !sessionData.sseRes.writableEnded) {
    sessionData.sseRes.end();
  }

  // Kill process
  if (sessionData.process && !sessionData.process.killed) {
    sessionData.process.kill();
  }

  activeSessions.delete(sessionId);
}

// Reset idle timer for a session
function resetSessionIdleTimer(sessionData, sessionId) {
  if (sessionData.idleTimer) {
    clearTimeout(sessionData.idleTimer);
  }

  sessionData.lastActivity = Date.now();
  sessionData.idleTimer = setTimeout(() => {
    cleanupSession(sessionId, "idle timeout");
  }, config.timeouts.SESSION_IDLE_TIMEOUT);
}

// Generate consistent session ID
function generateSessionId(req) {
  const headerSessionId = req.get("Mcp-Session-Id");
  if (headerSessionId) return headerSessionId;

  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const userAgent = req.get("user-agent") || "unknown";
  return Buffer.from(ip + userAgent)
    .toString("base64")
    .slice(0, 16);
}

// Get or create session
function getOrCreateSession(sessionId) {
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId);
    resetSessionIdleTimer(session, sessionId);
    return session;
  }

  console.log(`Creating new session: ${sessionId}`);
  const mcpProcess = createMcpProcess();
  const now = Date.now();

  const sessionData = {
    process: mcpProcess,
    initialized: false,
    initializing: false,
    pendingRequests: new Map(),
    responseBuffer: "",
    listenersSetup: false,
    lastActivity: now,
    createdAt: now,
    sseRes: null,
    idleTimer: null,
    lifetimeTimer: null,
    keepAliveInterval: null,
  };

  // Set up session timers
  resetSessionIdleTimer(sessionData, sessionId);

  sessionData.lifetimeTimer = setTimeout(() => {
    cleanupSession(sessionId, "max lifetime reached");
  }, config.timeouts.SESSION_MAX_LIFETIME);

  activeSessions.set(sessionId, sessionData);
  return sessionData;
}

// Periodic cleanup of stale sessions
function startSessionCleanup() {
  setInterval(() => {
    const now = Date.now();
    activeSessions.forEach((sessionData, sessionId) => {
      // Check if session exceeded max lifetime
      if (now - sessionData.createdAt > config.timeouts.SESSION_MAX_LIFETIME) {
        cleanupSession(sessionId, "max lifetime exceeded");
        return;
      }

      // Check if process is dead
      if (sessionData.process && sessionData.process.killed) {
        cleanupSession(sessionId, "process died");
        return;
      }

      // Check if session is idle too long
      if (
        now - sessionData.lastActivity >
        config.timeouts.SESSION_IDLE_TIMEOUT
      ) {
        cleanupSession(sessionId, "idle too long");
      }
    });
  }, config.timeouts.SESSION_CHECK_INTERVAL);
}

// Clean up all sessions
function cleanupAllSessions(reason = "shutdown") {
  activeSessions.forEach((sessionData, sessionId) => {
    cleanupSession(sessionId, reason);
  });
}

// Get all active sessions info
function getSessionsInfo() {
  const sessions = {};
  const now = Date.now();

  activeSessions.forEach((sessionData, sessionId) => {
    sessions[sessionId] = {
      initialized: sessionData.initialized,
      initializing: sessionData.initializing,
      processAlive: sessionData.process && !sessionData.process.killed,
      pendingRequests: Array.from(sessionData.pendingRequests.entries()).map(
        ([id, req]) => ({
          id,
          method: req.method,
          age: now - req.timestamp,
        })
      ),
      lastActivity: new Date(sessionData.lastActivity).toISOString(),
      createdAt: new Date(sessionData.createdAt).toISOString(),
      age: now - sessionData.createdAt,
      idleTime: now - sessionData.lastActivity,
      hasSseConnection: sessionData.sseRes && !sessionData.sseRes.writableEnded,
    };
  });

  return {
    totalSessions: activeSessions.size,
    sessions,
  };
}

module.exports = {
  createMcpProcess,
  cleanupSession,
  resetSessionIdleTimer,
  generateSessionId,
  getOrCreateSession,
  startSessionCleanup,
  cleanupAllSessions,
  getSessionsInfo,
  activeSessions,
};
