// server.js
const express = require("express");
const cors = require("cors");
const config = require("./config");
const { startSessionCleanup, cleanupAllSessions } = require("./sessionManager");

const healthRoutes = require("./routes/health");
const mcpRoutes = require("./routes/mcp");
const debugRoutes = require("./routes/debug");

const app = express();

const SECRET_PATH = process.env.MCP_SECRET_PATH;

app.use(cors(config.cors));
app.use(express.json());

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

app.use("/", healthRoutes);
app.use(`/${SECRET_PATH}/`, validateSecretPath, mcpRoutes);

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
      hasApiKey ? "✓ Configured" : "✗ Missing OPENROUTER_API_KEY"
    }`
  );
  console.log(`Default Model: ${config.openrouter.defaultModel}`);

  if (!hasApiKey) {
    console.error("\n⚠️  WARNING: Missing required environment variables");
    console.error("Set OPENROUTER_API_KEY");
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
