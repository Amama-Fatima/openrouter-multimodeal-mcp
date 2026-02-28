// utils/clientRegistry.js
// Client registration and management for OAuth

const crypto = require("crypto");

// In-memory client storage (use database in production)
const clients = new Map(); // client_id -> { client_secret, redirect_uris, scopes, etc. }

/**
 * Register a new OAuth client (Dynamic Client Registration - RFC 7591)
 * @param {Object} clientMetadata - Client metadata
 * @returns {Object} Client registration response
 */
function registerClient(clientMetadata) {
  const clientId = crypto.randomBytes(16).toString("hex");
  const clientSecret = crypto.randomBytes(32).toString("hex");

  const client = {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: clientMetadata.redirect_uris || [],
    grant_types: clientMetadata.grant_types || ["authorization_code"],
    response_types: clientMetadata.response_types || ["code"],
    scope: clientMetadata.scope || "mcp:read mcp:write",
    token_endpoint_auth_method: clientMetadata.token_endpoint_auth_method || "client_secret_basic",
    application_type: clientMetadata.application_type || "web",
    ...clientMetadata,
  };

  clients.set(clientId, client);

  console.log(`Registered new OAuth client: ${clientId}`);

  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: client.client_id_issued_at,
    redirect_uris: client.redirect_uris,
    grant_types: client.grant_types,
    response_types: client.response_types,
    scope: client.scope,
    token_endpoint_auth_method: client.token_endpoint_auth_method,
  };
}

/**
 * Get client by ID
 * @param {string} clientId - Client ID
 * @returns {Object|null} Client data or null
 */
function getClient(clientId) {
  return clients.get(clientId) || null;
}

/**
 * Verify client credentials
 * @param {string} clientId - Client ID
 * @param {string} clientSecret - Client secret
 * @returns {boolean} True if valid
 */
function verifyClient(clientId, clientSecret) {
  const client = getClient(clientId);
  if (!client) return false;
  return client.client_secret === clientSecret;
}

/**
 * Pre-register a client (for Claude Desktop, MCP Inspector, etc.)
 * @param {string} clientId - Pre-configured client ID
 * @param {string} clientSecret - Pre-configured client secret
 * @param {Object} metadata - Additional client metadata
 */
function preRegisterClient(clientId, clientSecret, metadata = {}) {
  const client = {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: metadata.redirect_uris || ["http://localhost:*", "https://*"],
    grant_types: metadata.grant_types || ["authorization_code"],
    response_types: metadata.response_types || ["code"],
    scope: metadata.scope || "mcp:read mcp:write",
    token_endpoint_auth_method: metadata.token_endpoint_auth_method || "client_secret_basic",
    application_type: metadata.application_type || "web",
    ...metadata,
  };

  clients.set(clientId, client);
  console.log(`Pre-registered OAuth client: ${clientId}`);
}

/**
 * Get all registered clients (for debugging)
 * @returns {Array} List of client IDs
 */
function getAllClients() {
  return Array.from(clients.keys());
}

// Pre-register default clients for common tools
if (process.env.MCP_CLIENT_ID && process.env.MCP_CLIENT_SECRET) {
  preRegisterClient(
    process.env.MCP_CLIENT_ID,
    process.env.MCP_CLIENT_SECRET,
    {
      redirect_uris: ["http://localhost:*", "https://*"],
      scope: "mcp:read mcp:write",
    }
  );
}

module.exports = {
  registerClient,
  getClient,
  verifyClient,
  preRegisterClient,
  getAllClients,
};
