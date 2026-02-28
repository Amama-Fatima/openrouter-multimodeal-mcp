// routes/well-known.js
// MCP OAuth discovery endpoints (RFC 8414, RFC 9728)

const express = require("express");
const router = express.Router();
const config = require("../config");

/**
 * GET /.well-known/oauth-protected-resource
 * OAuth Protected Resource Metadata (RFC 9728)
 * Allows MCP clients like Claude to auto-discover OAuth configuration
 */
router.get("/oauth-protected-resource", (req, res) => {
  const baseUrl = req.protocol + "://" + req.get("host");

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

/**
 * GET /.well-known/oauth-authorization-server
 * OAuth Authorization Server Metadata (RFC 8414)
 * Provides OAuth server configuration
 */
router.get("/oauth-authorization-server", (req, res) => {
  const baseUrl = req.protocol + "://" + req.get("host");

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
