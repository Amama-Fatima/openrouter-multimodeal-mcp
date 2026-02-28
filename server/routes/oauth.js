// routes/oauth.js
// OAuth 2.1 Authorization Server implementation
const express = require("express");
const router = express.Router();

// Enhanced logging utility
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    level,
    message,
    ...data,
  };
  console.log(JSON.stringify(logData));
}

function logRequest(req, endpoint) {
  log("INFO", `[${endpoint}] Request received`, {
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    headers: {
      "user-agent": req.get("user-agent"),
      "content-type": req.get("content-type"),
      "authorization": req.get("authorization") ? "***" : undefined,
    },
    ip: req.ip || req.connection.remoteAddress,
  });
}

function logError(endpoint, error, context = {}) {
  log("ERROR", `[${endpoint}] Error occurred`, {
    error: error.message,
    stack: error.stack,
    ...context,
  });
}
const {
  generatePKCE,
  exchangeCodeForApiKey,
  buildAuthorizationUrl,
  generateSessionToken,
} = require("../utils/oauth");
const {
  storeAccessToken,
  storeAuthorizationCode,
  consumeAuthorizationCode,
  getRefreshToken,
  revokeRefreshToken,
} = require("../utils/tokenStorage");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
} = require("../utils/jwt");
const { registerClient, getClient, verifyClient } = require("../utils/clientRegistry");

// Store OpenRouter OAuth state temporarily
const openRouterAuths = new Map(); // state -> { codeVerifier, userId, clientId, redirectUri, scopes, timestamp }

// Clean up old OpenRouter auths (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  const tenMinutes = 10 * 60 * 1000;
  for (const [state, data] of openRouterAuths.entries()) {
    if (now - data.timestamp > tenMinutes) {
      openRouterAuths.delete(state);
    }
  }
}, 5 * 60 * 1000);

/**
 * OPTIONS /oauth/register
 * Handle CORS preflight for client registration
 */
router.options("/register", (req, res) => {
  log("INFO", "[OAUTH_REGISTER] CORS preflight request", {
    origin: req.get("origin"),
    method: req.method,
    path: req.path,
    headers: {
      "access-control-request-method": req.get("access-control-request-method"),
      "access-control-request-headers": req.get("access-control-request-headers"),
    },
  });
  
  // Set CORS headers explicitly
  res.header("Access-Control-Allow-Origin", req.get("origin") || "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Max-Age", "86400");
  
  res.status(204).end();
});

/**
 * POST /oauth/register
 * Dynamic Client Registration (RFC 7591)
 */
router.post("/register", (req, res) => {
  logRequest(req, "OAUTH_REGISTER");
  
  // Set CORS headers for the response
  const origin = req.get("origin");
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  
  try {
    const clientMetadata = req.body;
    log("INFO", "[OAUTH_REGISTER] Registering new client", { clientMetadata });
    
    const clientInfo = registerClient(clientMetadata);
    
    log("INFO", "[OAUTH_REGISTER] Client registered successfully", {
      client_id: clientInfo.client_id,
    });
    
    res.status(201).json({
      ...clientInfo,
      client_secret_expires_at: 0, // Never expires
    });
  } catch (error) {
    logError("OAUTH_REGISTER", error, { body: req.body });
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: error.message,
    });
  }
});

/**
 * OPTIONS /oauth/authorize
 * Handle CORS preflight
 */
router.options("/authorize", (req, res) => {
  res.status(204).end();
});

/**
 * GET /oauth/authorize
 * OAuth 2.1 Authorization Endpoint
 * Query params: client_id, redirect_uri, response_type, scope, code_challenge, code_challenge_method, state
 */
router.get("/authorize", (req, res) => {
  logRequest(req, "OAUTH_AUTHORIZE");
  
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    code_challenge,
    code_challenge_method,
    state,
  } = req.query;

  log("INFO", "[OAUTH_AUTHORIZE] Processing authorization request", {
    client_id,
    redirect_uri,
    response_type,
    scope,
    has_code_challenge: !!code_challenge,
    code_challenge_method,
    state,
  });

  // Validate required parameters
  if (!client_id || !redirect_uri || !response_type || !code_challenge) {
    log("WARN", "[OAUTH_AUTHORIZE] Missing required parameters", {
      has_client_id: !!client_id,
      has_redirect_uri: !!redirect_uri,
      has_response_type: !!response_type,
      has_code_challenge: !!code_challenge,
    });
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing required parameters",
    });
  }

  // Validate response type
  if (response_type !== "code") {
    log("WARN", "[OAUTH_AUTHORIZE] Unsupported response type", { response_type });
    return res.status(400).json({
      error: "unsupported_response_type",
      error_description: "Only 'code' response type is supported",
    });
  }

  // Validate code challenge method
  if (code_challenge_method && code_challenge_method !== "S256") {
    log("WARN", "[OAUTH_AUTHORIZE] Unsupported code challenge method", { code_challenge_method });
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Only S256 code challenge method is supported",
    });
  }

  // Get client
  const client = getClient(client_id);
  if (!client) {
    log("WARN", "[OAUTH_AUTHORIZE] Unknown client_id", { client_id });
    return res.status(400).json({
      error: "invalid_client",
      error_description: "Unknown client_id",
    });
  }

  log("INFO", "[OAUTH_AUTHORIZE] Client found", {
    client_id,
    redirect_uris: client.redirect_uris,
  });

  // Validate redirect URI
  if (client.redirect_uris && !client.redirect_uris.includes(redirect_uri)) {
    log("WARN", "[OAUTH_AUTHORIZE] Invalid redirect_uri", {
      redirect_uri,
      allowed_uris: client.redirect_uris,
    });
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Invalid redirect_uri",
    });
  }

  // Parse scopes
  const scopes = scope ? scope.split(" ").filter(s => s) : ["mcp:read", "mcp:write"];

  // Generate PKCE for OpenRouter OAuth
  const { codeVerifier, codeChallenge: orCodeChallenge } = generatePKCE();
  
  // Generate state for OpenRouter OAuth
  const orState = generateSessionToken();

  // Store OpenRouter OAuth state
  openRouterAuths.set(orState, {
    codeVerifier,
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge,
    codeChallengeMethod: code_challenge_method || "S256",
    scopes,
    state, // Original state from client
    timestamp: Date.now(),
  });

  // Build OpenRouter authorization URL
  const baseUrl = req.protocol + "://" + req.get("host");
  const callbackUrl = `${baseUrl}/oauth/openrouter-callback`;
  const openRouterAuthUrl = buildAuthorizationUrl(callbackUrl, orCodeChallenge);
  const openRouterAuthUrlWithState = `${openRouterAuthUrl}&state=${orState}`;

  log("INFO", "[OAUTH_AUTHORIZE] Redirecting to OpenRouter", {
    client_id,
    callback_url: callbackUrl,
    openrouter_auth_url: openRouterAuthUrlWithState.substring(0, 100) + "...",
  });

  // Redirect to OpenRouter for user authentication
  res.redirect(openRouterAuthUrlWithState);
});

/**
 * GET /oauth/openrouter-callback
 * Callback from OpenRouter OAuth - then issues our authorization code
 */
router.get("/openrouter-callback", async (req, res) => {
  logRequest(req, "OAUTH_OPENROUTER_CALLBACK");
  
  const { code: orCode, state: orState, error } = req.query;
  
  log("INFO", "[OAUTH_OPENROUTER_CALLBACK] Received callback from OpenRouter", {
    has_code: !!orCode,
    has_state: !!orState,
    error,
  });

  // Handle errors from OpenRouter
  if (error) {
    logError("OAUTH_OPENROUTER_CALLBACK", new Error(`OpenRouter OAuth error: ${error}`), {
      error,
      state: orState,
    });
    const authData = openRouterAuths.get(orState);
    if (authData) {
      log("INFO", "[OAUTH_OPENROUTER_CALLBACK] Redirecting to client with error", {
        redirect_uri: authData.redirectUri,
        error,
      });
      const errorUri = `${authData.redirectUri}?error=access_denied&error_description=${encodeURIComponent(error)}&state=${authData.state || ""}`;
      return res.redirect(errorUri);
    }
    return res.status(400).json({
      error: "access_denied",
      error_description: error,
    });
  }

  if (!orCode || !orState) {
    log("WARN", "[OAUTH_OPENROUTER_CALLBACK] Missing code or state", {
      has_code: !!orCode,
      has_state: !!orState,
    });
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing code or state",
    });
  }

  // Retrieve OpenRouter auth data
  const authData = openRouterAuths.get(orState);
  if (!authData) {
    log("WARN", "[OAUTH_OPENROUTER_CALLBACK] Invalid or expired state", {
      state: orState,
      available_states: Array.from(openRouterAuths.keys()),
    });
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Invalid or expired state",
    });
  }

  log("INFO", "[OAUTH_OPENROUTER_CALLBACK] Found auth data", {
    client_id: authData.clientId,
    redirect_uri: authData.redirectUri,
  });

  // Clean up
  openRouterAuths.delete(orState);

  try {
    // Exchange OpenRouter code for user API key
    const baseUrl = req.protocol + "://" + req.get("host");
    const callbackUrl = `${baseUrl}/oauth/openrouter-callback`;

    log("INFO", "[OAUTH_OPENROUTER_CALLBACK] Exchanging code for API key", {
      callback_url: callbackUrl,
      has_code_verifier: !!authData.codeVerifier,
    });

    const { apiKey, userId } = await exchangeCodeForApiKey(
      orCode,
      authData.codeVerifier,
      callbackUrl
    );

    log("INFO", "[OAUTH_OPENROUTER_CALLBACK] OpenRouter OAuth successful", {
      user_id: userId,
      has_api_key: !!apiKey,
    });

    // Generate authorization code for our OAuth flow
    const authCode = generateSessionToken();
    
    log("INFO", "[OAUTH_OPENROUTER_CALLBACK] Generating authorization code", {
      auth_code: authCode.substring(0, 10) + "...",
      client_id: authData.clientId,
    });
    
    // Store authorization code with user's API key
    storeAuthorizationCode(
      authCode,
      userId,
      apiKey, // Store API key with authorization code
      authData.clientId,
      authData.redirectUri,
      authData.codeChallenge,
      authData.codeChallengeMethod,
      authData.scopes
    );

    // Redirect back to client with authorization code
    const redirectUri = `${authData.redirectUri}?code=${authCode}&state=${authData.state || ""}`;
    log("INFO", "[OAUTH_OPENROUTER_CALLBACK] Redirecting to client", {
      redirect_uri: redirectUri.substring(0, 100) + "...",
      has_code: true,
      has_state: !!authData.state,
    });
    
    res.redirect(redirectUri);

  } catch (error) {
    logError("OAUTH_OPENROUTER_CALLBACK", error, {
      state: orState,
      has_auth_data: !!authData,
    });
    const errorUri = `${authData.redirectUri}?error=server_error&error_description=${encodeURIComponent(error.message)}&state=${authData.state || ""}`;
    log("INFO", "[OAUTH_OPENROUTER_CALLBACK] Redirecting to client with error", {
      error_uri: errorUri.substring(0, 100) + "...",
    });
    res.redirect(errorUri);
  }
});

/**
 * OPTIONS /oauth/token
 * Handle CORS preflight
 */
router.options("/token", (req, res) => {
  res.status(204).end();
});

/**
 * POST /oauth/token
 * OAuth 2.1 Token Endpoint
 * Exchanges authorization code for access/refresh tokens
 */
router.post("/token", express.urlencoded({ extended: true }), express.json(), (req, res) => {
  logRequest(req, "OAUTH_TOKEN");
  
  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    code_verifier,
    refresh_token,
  } = req.body;

  log("INFO", "[OAUTH_TOKEN] Processing token request", {
    grant_type,
    has_code: !!code,
    has_refresh_token: !!refresh_token,
    has_code_verifier: !!code_verifier,
    has_client_id: !!client_id,
    redirect_uri,
  });

  // Handle authorization code grant
  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri || !code_verifier) {
      log("WARN", "[OAUTH_TOKEN] Missing required parameters for authorization_code grant", {
        has_code: !!code,
        has_redirect_uri: !!redirect_uri,
        has_code_verifier: !!code_verifier,
      });
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required parameters",
      });
    }

    // Verify client (if client_secret provided)
    if (client_id && client_secret) {
      const isValid = verifyClient(client_id, client_secret);
      log("INFO", "[OAUTH_TOKEN] Client verification", {
        client_id,
        is_valid: isValid,
      });
      if (!isValid) {
        log("WARN", "[OAUTH_TOKEN] Invalid client credentials", { client_id });
        return res.status(401).json({
          error: "invalid_client",
          error_description: "Invalid client credentials",
        });
      }
    }

    // Consume authorization code
    log("INFO", "[OAUTH_TOKEN] Consuming authorization code", {
      code: code.substring(0, 10) + "...",
      has_code_verifier: !!code_verifier,
    });
    
    const codeData = consumeAuthorizationCode(code, code_verifier);
    if (!codeData) {
      log("WARN", "[OAUTH_TOKEN] Invalid or expired authorization code", {
        code: code.substring(0, 10) + "...",
      });
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Invalid or expired authorization code",
      });
    }

    log("INFO", "[OAUTH_TOKEN] Authorization code validated", {
      user_id: codeData.userId,
      client_id: codeData.clientId,
      redirect_uri: codeData.redirectUri,
    });

    // Verify redirect URI matches
    if (codeData.redirectUri !== redirect_uri) {
      log("WARN", "[OAUTH_TOKEN] Redirect URI mismatch", {
        expected: codeData.redirectUri,
        received: redirect_uri,
      });
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Redirect URI mismatch",
      });
    }

    // Generate access and refresh tokens
    log("INFO", "[OAUTH_TOKEN] Generating tokens", {
      user_id: codeData.userId,
      client_id: codeData.clientId,
      scopes: codeData.scopes,
    });
    
    const accessToken = generateAccessToken(
      codeData.userId,
      codeData.clientId,
      codeData.scopes
    );
    const refreshToken = generateRefreshToken();

    // Store tokens with user's OpenRouter API key
    storeAccessToken(
      accessToken,
      refreshToken,
      codeData.apiKey, // User's OpenRouter API key
      codeData.userId,
      codeData.clientId,
      codeData.scopes
    );

    log("INFO", "[OAUTH_TOKEN] Tokens issued successfully", {
      user_id: codeData.userId,
      client_id: codeData.clientId,
      access_token_preview: accessToken.substring(0, 20) + "...",
    });

    return res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: codeData.scopes.join(" "),
    });
  }

  // Handle refresh token grant
  if (grant_type === "refresh_token") {
    if (!refresh_token) {
      log("WARN", "[OAUTH_TOKEN] Missing refresh_token");
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing refresh_token",
      });
    }

    log("INFO", "[OAUTH_TOKEN] Processing refresh token grant", {
      refresh_token: refresh_token.substring(0, 10) + "...",
    });

    const refreshData = getRefreshToken(refresh_token);
    if (!refreshData) {
      log("WARN", "[OAUTH_TOKEN] Invalid or expired refresh token");
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Invalid or expired refresh token",
      });
    }

    log("INFO", "[OAUTH_TOKEN] Refresh token validated", {
      user_id: refreshData.userId,
      client_id: refreshData.clientId,
    });

    // Get stored access token data to retrieve API key
    const { getAccessToken } = require("../utils/tokenStorage");
    const oldTokenData = getAccessToken(refreshData.accessToken);
    if (!oldTokenData) {
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Associated access token not found",
      });
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken(
      refreshData.userId,
      refreshData.clientId,
      refreshData.scopes
    );
    const newRefreshToken = generateRefreshToken();

    // Store new tokens
    storeAccessToken(
      newAccessToken,
      newRefreshToken,
      oldTokenData.apiKey, // Use existing API key
      refreshData.userId,
      refreshData.clientId,
      refreshData.scopes
    );

    // Revoke old refresh token
    revokeRefreshToken(refresh_token);

    return res.json({
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: refreshData.scopes.join(" "),
    });
  }

    log("WARN", "[OAUTH_TOKEN] Unsupported grant type", { grant_type });
    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: `Grant type '${grant_type}' is not supported`,
    });
});

/**
 * POST /oauth/introspect
 * Token Introspection (RFC 7662)
 */
router.post("/introspect", express.urlencoded({ extended: true }), express.json(), (req, res) => {
  const { token, token_type_hint } = req.body;

  if (!token) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing token parameter",
    });
  }

  // Try to verify as JWT first
  const decoded = verifyAccessToken(token);
  if (decoded) {
    return res.json({
      active: true,
      client_id: decoded.client_id,
      username: decoded.sub,
      scope: decoded.scope,
      exp: decoded.exp,
      iat: decoded.iat,
      sub: decoded.sub,
    });
  }

  // Try as stored access token
  const { getAccessToken } = require("../utils/tokenStorage");
  const tokenData = getAccessToken(token);
  if (tokenData) {
    return res.json({
      active: true,
      client_id: tokenData.clientId,
      username: tokenData.userId,
      scope: tokenData.scopes.join(" "),
      exp: tokenData.expiresAt ? Math.floor(tokenData.expiresAt.getTime() / 1000) : null,
    });
  }

  // Token not found or invalid
  return res.json({
    active: false,
  });
});

/**
 * GET /oauth/status
 * Check authentication status (requires Bearer token)
 */
const { verifyBearerToken } = require("../middleware/auth");
router.get("/status", verifyBearerToken, (req, res) => {
  res.json({
    authenticated: true,
    user_id: req.user.userId,
    client_id: req.user.clientId,
    scopes: req.user.scopes,
  });
});

module.exports = router;
