// routes/health.js
const express = require("express");
const router = express.Router();
const config = require("../config");
const { getSessionsInfo } = require("../sessionManager");

// Health check endpoint
router.get("/health", (req, res) => {
  const hasApiKey = !!config.openrouter.apiKey;

  res.json({
    status: "healthy",
    service: "openrouter-mcp-server",
    timestamp: new Date().toISOString(),
    integrations: {
      openrouter: hasApiKey ? "configured" : "missing",
    },
    config: {
      requestTimeout: `${config.timeouts.REQUEST_TIMEOUT}ms`,
      sessionIdleTimeout: `${config.timeouts.SESSION_IDLE_TIMEOUT}ms`,
      sessionMaxLifetime: `${config.timeouts.SESSION_MAX_LIFETIME}ms`,
      defaultModel: config.openrouter.defaultModel,
    },
    sessions: {
      active: getSessionsInfo().totalSessions,
    },
  });
});

// Root endpoint info
router.get("/", (req, res) => {
  res.json({
    service: "OpenRouter MCP Server",
    version: "1.0.0",
    transport: "Streamable HTTP",
    endpoints: {
      health: "/health",
      mcp: "/mcp",
    },
    documentation: "Connect your MCP client to /mcp endpoint",
    tools: [
      "mcp_openrouter_chat_completion",
      "mcp_openrouter_analyze_image",
      "mcp_openrouter_multi_image_analysis",
      "mcp_openrouter_search_models",
      "mcp_openrouter_get_model_info",
      "mcp_openrouter_validate_model",
    ],
    features: [
      "Text chat with OpenRouter models",
      "Single and multi-image analysis",
      "Model search and validation",
      "Configurable timeouts",
      "Session management",
    ],
    timeouts: {
      requestTimeout: `${config.timeouts.REQUEST_TIMEOUT}ms`,
      sessionIdleTimeout: `${config.timeouts.SESSION_IDLE_TIMEOUT}ms`,
      sessionMaxLifetime: `${config.timeouts.SESSION_MAX_LIFETIME}ms`,
    },
  });
});

module.exports = router;
