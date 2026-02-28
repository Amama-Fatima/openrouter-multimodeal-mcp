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

// Request logging middleware (before routes to catch all requests)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({
    timestamp,
    level: "INFO",
    message: "[HTTP_REQUEST]",
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress,
    user_agent: req.get("user-agent"),
  }));
  next();
});

// CORS middleware - must be before routes
app.use(cors(config.cors));

// Handle preflight requests explicitly - must return 204, no redirects
app.options("*", (req, res) => {
  res.status(204).end();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const validateSecretPath = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({
    timestamp,
    level: "INFO",
    message: "[SECRET_PATH_VALIDATION]",
    path: req.path,
    secret_path: SECRET_PATH,
    path_segments: req.path.split("/"),
  }));
  
  if (!SECRET_PATH) {
    console.error(JSON.stringify({
      timestamp,
      level: "ERROR",
      message: "[SECRET_PATH_VALIDATION] MCP_SECRET_PATH not configured",
    }));
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

// Error handling middleware
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(JSON.stringify({
    timestamp,
    level: "ERROR",
    message: "[UNHANDLED_ERROR]",
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  }));
  
  res.status(err.status || 500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "production" 
      ? "An error occurred" 
      : err.message,
  });
});

app.listen(config.server.port, () => {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${config.server.port}`;
  
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    message: "[SERVER_START] OpenRouter MCP Server started",
    port: config.server.port,
    base_url: baseUrl,
  }));
  
  console.log(`OpenRouter MCP Server running on port ${config.server.port}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Health check: ${baseUrl}/health`);
  console.log(`MCP endpoint: POST ${baseUrl}/${process.env.MCP_SECRET_PATH || 'SECRET_PATH'}/mcp`);
  console.log(`OAuth authorize: ${baseUrl}/oauth/authorize`);
  console.log(`OAuth token: ${baseUrl}/oauth/token`);
  console.log(`OAuth discovery: ${baseUrl}/.well-known/oauth-authorization-server`);
  console.log(
    `Sessions debug: ${baseUrl}/debug/sessions`
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
