// server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { startSessionCleanup, cleanupAllSessions } = require("./sessionManager");

// Configure token storage (database or in-memory)
// Set TOKEN_STORAGE=db to use SQLite database, otherwise uses in-memory
const useDatabaseStorage = process.env.TOKEN_STORAGE === "db";

if (useDatabaseStorage) {
  console.log("Using SQLite database for token storage");
  // Replace in-memory storage with database storage
  const dbStorage = require("./utils/tokenStorageDB");
  const memoryStorage = require("./utils/tokenStorage");
  
  // Override all exported functions with async versions
  // Note: This requires all callers to handle async operations
  // For now, we'll use a wrapper to maintain compatibility
  const originalStoreAccessToken = memoryStorage.storeAccessToken;
  memoryStorage.storeAccessToken = async function(...args) {
    return await dbStorage.storeAccessToken(...args);
  };
  
  const originalGetAccessToken = memoryStorage.getAccessToken;
  memoryStorage.getAccessToken = async function(...args) {
    return await dbStorage.getAccessToken(...args);
  };
  
  const originalStoreAuthorizationCode = memoryStorage.storeAuthorizationCode;
  memoryStorage.storeAuthorizationCode = async function(...args) {
    return await dbStorage.storeAuthorizationCode(...args);
  };
  
  const originalConsumeAuthorizationCode = memoryStorage.consumeAuthorizationCode;
  memoryStorage.consumeAuthorizationCode = async function(...args) {
    return await dbStorage.consumeAuthorizationCode(...args);
  };
  
  const originalGetRefreshToken = memoryStorage.getRefreshToken;
  memoryStorage.getRefreshToken = async function(...args) {
    return await dbStorage.getRefreshToken(...args);
  };
  
  const originalRevokeRefreshToken = memoryStorage.revokeRefreshToken;
  memoryStorage.revokeRefreshToken = async function(...args) {
    return await dbStorage.revokeRefreshToken(...args);
  };
  
  const originalDeleteToken = memoryStorage.deleteToken;
  memoryStorage.deleteToken = async function(...args) {
    return await dbStorage.deleteToken(...args);
  };
  
  const originalDeleteUserTokens = memoryStorage.deleteUserTokens;
  memoryStorage.deleteUserTokens = async function(...args) {
    return await dbStorage.deleteUserTokens(...args);
  };
  
  const originalGetStats = memoryStorage.getStats;
  memoryStorage.getStats = async function(...args) {
    return await dbStorage.getStats(...args);
  };
} else {
  console.log("Using in-memory token storage (tokens will be lost on restart)");
}

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
  const logData = {
    timestamp,
    level: "INFO",
    message: "[HTTP_REQUEST]",
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    headers: {
      origin: req.get("origin"),
      referer: req.get("referer"),
      "content-type": req.get("content-type"),
      "user-agent": req.get("user-agent"),
    },
    ip: req.ip || req.connection.remoteAddress,
  };
  
  // Only log body for POST/PUT/PATCH and non-binary content
  if (["POST", "PUT", "PATCH"].includes(req.method) && req.get("content-type")?.includes("application/json")) {
    // Body will be available after express.json() middleware
    // We'll log it separately in the route handlers
  }
  
  console.log(JSON.stringify(logData));
  next();
});

// Trust proxy (for Railway/Heroku/etc)
app.set("trust proxy", true);

// CORS middleware - must be before routes
app.use(cors(config.cors));

// Helper function for logging
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

// Handle preflight requests explicitly - must return 204, no redirects
// This must come AFTER CORS middleware but handle OPTIONS before routes
app.options("*", (req, res) => {
  log("INFO", "[CORS_PREFLIGHT] Handling OPTIONS request", {
    path: req.path,
    origin: req.get("origin"),
  });
  // CORS middleware should have already set headers, just return 204
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
if (SECRET_PATH) {
  const mcpPath = `/${SECRET_PATH}/`;
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    message: "[ROUTE_SETUP] Registering MCP routes",
    mcp_path: mcpPath,
    secret_path: SECRET_PATH,
  }));
  app.use(mcpPath, validateSecretPath, mcpRoutes);
} else {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "[ROUTE_SETUP] MCP_SECRET_PATH not set - MCP routes not registered",
  }));
}

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

  console.log("\nEnvironment Variables:");
  console.log(`Default Model: ${config.openrouter.defaultModel}`);

  console.log("\nOAuth Configuration:");
  console.log(`✓ OAuth REQUIRED - All users must authenticate with OpenRouter`);
  console.log(`  Authorization: ${baseUrl}/oauth/authorize`);
  console.log(`  Token: ${baseUrl}/oauth/token`);
  console.log(`  Registration: ${baseUrl}/oauth/register`);
  console.log(`  Status: ${baseUrl}/oauth/status`);
  console.log(`\nMCP Discovery:`);
  console.log(`  OAuth Metadata: ${baseUrl}/.well-known/oauth-protected-resource`);
  console.log(`  OAuth Server: ${baseUrl}/.well-known/oauth-authorization-server`);

  console.log("\n⚠️  IMPORTANT: OAuth authentication is REQUIRED");
  console.log("   No shared API key is used - each user authenticates individually");
  console.log("   Users must complete OAuth flow before accessing MCP endpoints");
});

// Global error handlers for unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  const timestamp = new Date().toISOString();
  console.error(JSON.stringify({
    timestamp,
    level: "ERROR",
    message: "[UNHANDLED_REJECTION]",
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString(),
  }));
  
  // Don't exit in production - log and continue
  if (process.env.NODE_ENV === "development") {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
  }
});

process.on("uncaughtException", (error) => {
  const timestamp = new Date().toISOString();
  console.error(JSON.stringify({
    timestamp,
    level: "ERROR",
    message: "[UNCAUGHT_EXCEPTION]",
    error: error.message,
    stack: error.stack,
  }));
  
  // Clean up and exit for uncaught exceptions
  cleanupAllSessions("uncaught exception");
  process.exit(1);
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
