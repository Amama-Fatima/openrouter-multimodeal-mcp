// routes/oauth.js
// OAuth 2.1 Authorization Server implementation
const express = require("express");
const router = express.Router();
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
 * POST /oauth/register
 * Dynamic Client Registration (RFC 7591)
 */
router.post("/register", (req, res) => {
  try {
    const clientMetadata = req.body;
    const clientInfo = registerClient(clientMetadata);
    
    res.status(201).json({
      ...clientInfo,
      client_secret_expires_at: 0, // Never expires
    });
  } catch (error) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: error.message,
    });
  }
});

/**
 * GET /oauth/authorize
 * OAuth 2.1 Authorization Endpoint
 * Query params: client_id, redirect_uri, response_type, scope, code_challenge, code_challenge_method, state
 */
router.get("/authorize", (req, res) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    code_challenge,
    code_challenge_method,
    state,
  } = req.query;

  // Validate required parameters
  if (!client_id || !redirect_uri || !response_type || !code_challenge) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing required parameters",
    });
  }

  // Validate response type
  if (response_type !== "code") {
    return res.status(400).json({
      error: "unsupported_response_type",
      error_description: "Only 'code' response type is supported",
    });
  }

  // Validate code challenge method
  if (code_challenge_method && code_challenge_method !== "S256") {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Only S256 code challenge method is supported",
    });
  }

  // Get client
  const client = getClient(client_id);
  if (!client) {
    return res.status(400).json({
      error: "invalid_client",
      error_description: "Unknown client_id",
    });
  }

  // Validate redirect URI
  if (client.redirect_uris && !client.redirect_uris.includes(redirect_uri)) {
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

  console.log(`Initiating OpenRouter OAuth for client ${client_id}`);

  // Redirect to OpenRouter for user authentication
  res.redirect(openRouterAuthUrlWithState);
});

/**
 * GET /oauth/openrouter-callback
 * Callback from OpenRouter OAuth - then issues our authorization code
 */
router.get("/openrouter-callback", async (req, res) => {
  const { code: orCode, state: orState, error } = req.query;

  // Handle errors from OpenRouter
  if (error) {
    console.error("OpenRouter OAuth error:", error);
    const authData = openRouterAuths.get(orState);
    if (authData) {
      const errorUri = `${authData.redirectUri}?error=access_denied&error_description=${encodeURIComponent(error)}&state=${authData.state || ""}`;
      return res.redirect(errorUri);
    }
    return res.status(400).json({
      error: "access_denied",
      error_description: error,
    });
  }

  if (!orCode || !orState) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing code or state",
    });
  }

  // Retrieve OpenRouter auth data
  const authData = openRouterAuths.get(orState);
  if (!authData) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Invalid or expired state",
    });
  }

  // Clean up
  openRouterAuths.delete(orState);

  try {
    // Exchange OpenRouter code for user API key
    const baseUrl = req.protocol + "://" + req.get("host");
    const callbackUrl = `${baseUrl}/oauth/openrouter-callback`;

    const { apiKey, userId } = await exchangeCodeForApiKey(
      orCode,
      authData.codeVerifier,
      callbackUrl
    );

    console.log(`OpenRouter OAuth successful for user ${userId}`);

    // Generate authorization code for our OAuth flow
    const authCode = generateSessionToken();
    
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
    res.redirect(redirectUri);

  } catch (error) {
    console.error("Error in OpenRouter callback:", error);
    const errorUri = `${authData.redirectUri}?error=server_error&error_description=${encodeURIComponent(error.message)}&state=${authData.state || ""}`;
    res.redirect(errorUri);
  }
});

/**
 * POST /oauth/token
 * OAuth 2.1 Token Endpoint
 * Exchanges authorization code for access/refresh tokens
 */
router.post("/token", express.urlencoded({ extended: true }), express.json(), (req, res) => {
  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    code_verifier,
    refresh_token,
  } = req.body;

  // Handle authorization code grant
  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri || !code_verifier) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required parameters",
      });
    }

    // Verify client (if client_secret provided)
    if (client_id && client_secret) {
      if (!verifyClient(client_id, client_secret)) {
        return res.status(401).json({
          error: "invalid_client",
          error_description: "Invalid client credentials",
        });
      }
    }

    // Consume authorization code
    const codeData = consumeAuthorizationCode(code, code_verifier);
    if (!codeData) {
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Invalid or expired authorization code",
      });
    }

    // Verify redirect URI matches
    if (codeData.redirectUri !== redirect_uri) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Redirect URI mismatch",
      });
    }

    // Generate access and refresh tokens
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
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing refresh_token",
      });
    }

    const refreshData = getRefreshToken(refresh_token);
    if (!refreshData) {
      return res.status(400).json({
        error: "invalid_grant",
        error_description: "Invalid or expired refresh token",
      });
    }

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
