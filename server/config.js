module.exports = {
  server: {
    port: process.env.PORT || 10000,
  },

  timeouts: {
    REQUEST_TIMEOUT: parseInt(process.env.MCP_TOOL_TIMEOUT) || 180000, // 3 minutes
    SESSION_IDLE_TIMEOUT: parseInt(process.env.SESSION_IDLE_TIMEOUT) || 1800000, // 30 minutes
    SESSION_MAX_LIFETIME: parseInt(process.env.SESSION_MAX_LIFETIME) || 3600000, // 1 hour
    KEEPALIVE_INTERVAL: 15000,
    INITIALIZATION_TIMEOUT: 30000, // 30 seconds
    SESSION_CHECK_INTERVAL: 60000, // 1 minute
    PROGRESS_INTERVAL: 10000, // 10 seconds
  },

  openrouter: {
    // API key is now optional - users authenticate via OAuth and get their own keys
    // This is kept for backward compatibility or admin operations
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultModel:
      process.env.OPENROUTER_DEFAULT_MODEL ||
      "qwen/qwen2.5-vl-32b-instruct:free",
  },

  oauth: {
    // OAuth callback URL (can be overridden by request host)
    callbackPath: "/oauth/callback",
    // Token expiration (null = no expiration)
    tokenExpiration: process.env.OAUTH_TOKEN_EXPIRATION
      ? parseInt(process.env.OAUTH_TOKEN_EXPIRATION)
      : null,
  },

  cors: {
    origin: function (origin, callback) {
      // Allow all origins for MCP Inspector and development
      // In production, you might want to restrict this
      const allowedOrigins = [
        /^http:\/\/localhost:\d+$/, // MCP Inspector localhost ports
        /^https:\/\/.*\.railway\.app$/, // Railway domains
        process.env.ALLOWED_ORIGINS?.split(",") || [],
      ].flat();
      
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }
      
      // Check if origin matches any allowed pattern
      const isAllowed = allowedOrigins.some(allowed => {
        if (typeof allowed === "string") {
          return origin === allowed;
        }
        if (allowed instanceof RegExp) {
          return allowed.test(origin);
        }
        return false;
      });
      
      callback(null, true); // Allow all origins for MCP Inspector compatibility
    },
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Cache-Control",
      "Last-Event-ID",
      "User-Agent",
      "Origin",
      "Referer",
      "Mcp-Session-Id",
      "MCP-Protocol-Version",
      "X-Requested-With",
    ],
    exposedHeaders: ["Content-Type", "Mcp-Session-Id", "MCP-Protocol-Version"],
    credentials: true, // Allow credentials for OAuth
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400, // Cache preflight for 24 hours
  },

  mcp: {
    protocolVersion: "2024-11-05",
    mcpPath: require("path").join(__dirname, "../dist/index.js"),
  },
};
