// routes/well-known.js
// MCP OAuth discovery endpoints (RFC 8414, RFC 9728)

const express = require("express");
const router = express.Router();
const config = require("../config");

// Enhanced logging
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

/**
 * GET /.well-known/oauth-protected-resource
 * OAuth Protected Resource Metadata (RFC 9728)
 * Allows MCP clients like Claude to auto-discover OAuth configuration
 */
router.get("/oauth-protected-resource", (req, res) => {
  // Force HTTPS in production (Railway uses X-Forwarded-Proto)
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  const baseUrl = `${protocol}://${req.get("host")}`;

  log("INFO", "[AUTH_FLOW] Step: discovery_protected_resource", {
    flow_phase: "discovery",
    step: "oauth_protected_resource",
    base_url: baseUrl,
    protocol: req.protocol,
    user_agent: req.get("user-agent") ? req.get("user-agent").substring(0, 60) + "..." : null,
  });

  res.json({
    resource: baseUrl,
    authorization_servers: [
      {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
      },
    ],
    jwks_uri: null, // We use symmetric JWT signing
    scopes_supported: ["mcp:read", "mcp:write"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${baseUrl}/`,
    resource_policy_uri: null,
    resource_tos_uri: null,
  });
});

// Handle incorrect discovery URLs (MCP Inspector sometimes appends the secret path)
router.get("/oauth-protected-resource/*", (req, res) => {
  log("WARN", "[WELL_KNOWN] Incorrect discovery URL with path suffix", {
    path: req.path,
    original_url: req.originalUrl,
  });
  // Redirect to correct endpoint
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  const baseUrl = `${protocol}://${req.get("host")}`;
  res.redirect(301, `${baseUrl}/.well-known/oauth-protected-resource`);
});

/**
 * GET /.well-known/oauth-authorization-server
 * OAuth Authorization Server Metadata (RFC 8414)
 * Provides OAuth server configuration
 */
router.get("/oauth-authorization-server", (req, res) => {
  // Force HTTPS in production (Railway uses X-Forwarded-Proto)
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  const baseUrl = `${protocol}://${req.get("host")}`;

  log("INFO", "[AUTH_FLOW] Step: discovery_authorization_server", {
    flow_phase: "discovery",
    step: "oauth_authorization_server",
    base_url: baseUrl,
    protocol: req.protocol,
  });

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    introspection_endpoint: `${baseUrl}/oauth/introspect`,
    scopes_supported: ["mcp:read", "mcp:write"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    service_documentation: `${baseUrl}/`,
  });
});

module.exports = router;
