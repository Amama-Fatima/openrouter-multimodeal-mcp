// server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { startSessionCleanup, cleanupAllSessions } = require("./sessionManager");

const healthRoutes = require("./routes/health");
const mcpRoutes = require("./routes/mcp");
const debugRoutes = require("./routes/debug");
const oauthRoutes = require("./routes/oauth");
const wellKnownRoutes = require("./routes/well-known");

const app = express();

const SECRET_PATH = process.env.MCP_SECRET_PATH;

app.use(cors(config.cors));
app.use(express.json());
app.use(cookieParser());

const validateSecretPath = (req, res, next) => {
  if (!SECRET_PATH) {
    console.error("⚠️  MCP_SECRET_PATH not configured!");
    return res.status(503).json({
      error: "Service misconfigured",
      message: "MCP_SECRET_PATH environment variable is required",
    });
  }
  next();
};

// Public routes
app.use("/", healthRoutes);
app.use("/.well-known", wellKnownRoutes);
app.use("/oauth", oauthRoutes);

// Protected MCP routes (require authentication)
app.use(`/${SECRET_PATH}/`, validateSecretPath, mcpRoutes);

// Debug routes
app.use("/debug", debugRoutes);

startSessionCleanup();

app.listen(config.server.port, () => {
  console.log(`OpenRouter MCP Server running on port ${config.server.port}`);
  console.log(`Health check: http://localhost:${config.server.port}/health`);
  console.log(`MCP endpoint: POST http://localhost:${config.server.port}/mcp`);
  console.log(
    `Sessions debug: http://localhost:${config.server.port}/debug/sessions`
  );
  console.log("Using local MCP from /dist/index.js");

  console.log("\nTimeout Configuration:");
  console.log(`- Request Timeout: ${config.timeouts.REQUEST_TIMEOUT}ms`);
  console.log(
    `- Session Idle Timeout: ${config.timeouts.SESSION_IDLE_TIMEOUT}ms`
  );
  console.log(
    `- Session Max Lifetime: ${config.timeouts.SESSION_MAX_LIFETIME}ms`
  );
  console.log(
    `- Initialization Timeout: ${config.timeouts.INITIALIZATION_TIMEOUT}ms`
  );

  // Validate environment
  const hasApiKey = !!config.openrouter.apiKey;

  console.log("\nEnvironment Variables:");
  console.log(
    `OpenRouter API Key: ${
      hasApiKey ? "✓ Configured (optional - users authenticate via OAuth)" : "✗ Not set (OAuth required)"
    }`
  );
  console.log(`Default Model: ${config.openrouter.defaultModel}`);

  console.log("\nOAuth Configuration:");
  console.log(`✓ OAuth enabled - Users authenticate with OpenRouter`);
  console.log(`  Login: http://localhost:${config.server.port}/oauth/login`);
  console.log(`  Callback: http://localhost:${config.server.port}/oauth/callback`);
  console.log(`  Status: http://localhost:${config.server.port}/oauth/status`);
  console.log(`\nMCP Discovery:`);
  console.log(`  OAuth Metadata: http://localhost:${config.server.port}/.well-known/oauth-protected-resource`);

  if (!hasApiKey) {
    console.log("\nℹ️  INFO: OPENROUTER_API_KEY not set - this is OK");
    console.log("   Users will authenticate via OAuth and use their own API keys");
  }
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  cleanupAllSessions("server shutdown");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully...");
  cleanupAllSessions("server shutdown");
  process.exit(0);
});
