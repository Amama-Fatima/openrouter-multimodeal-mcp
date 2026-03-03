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
const { setState, getState, deleteState } = require("../utils/stateStore");

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
router.get("/authorize", async (req, res) => {
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

  log("INFO", "[AUTH_FLOW] Step: authorize_start", {
    flow_phase: "auth_flow",
    step: "authorize",
    client_id,
    redirect_uri: redirect_uri ? redirect_uri.substring(0, 60) + (redirect_uri.length > 60 ? "..." : "") : null,
    response_type,
    scope,
    has_code_challenge: !!code_challenge,
    code_challenge_method,
    has_state: !!state,
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

  // Store OpenRouter OAuth state (Redis when REDIS_URL set, so callback works on any replica)
  const stateData = {
    codeVerifier,
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method || "S256",
    scopes,
    state,
  };
  try {
    await setState(orState, stateData);
    log("INFO", "[AUTH_FLOW] Step: authorize_state_stored", {
      flow_phase: "auth_flow",
      step: "authorize_state_stored",
      or_state_preview: orState.substring(0, 12) + "...",
      client_id: client_id,
    });
  } catch (err) {
    logError("OAUTH_AUTHORIZE", err, {
      flow_phase: "auth_flow",
      step: "authorize_state_store_failed",
      or_state_preview: orState.substring(0, 12) + "...",
    });
    return res.status(503).json({
      error: "server_error",
      error_description: "Failed to store OAuth state",
    });
  }

  const baseUrl = req.protocol + "://" + req.get("host");
  const callbackUrl = `${baseUrl}/oauth/openrouter-callback`;
  const openRouterAuthUrl = buildAuthorizationUrl(callbackUrl, orCodeChallenge);
  const openRouterAuthUrlWithState = `${openRouterAuthUrl}&state=${orState}`;

  log("INFO", "[AUTH_FLOW] Step: authorize_redirect_to_openrouter", {
    flow_phase: "auth_flow",
    step: "authorize_redirect",
    client_id,
    callback_url: callbackUrl,
    or_state_preview: orState.substring(0, 12) + "...",
  });

  res.redirect(openRouterAuthUrlWithState);
});

/**
 * GET /oauth/openrouter-callback
 * Callback from OpenRouter OAuth - then issues our authorization code
 */
router.get("/openrouter-callback", async (req, res) => {
  logRequest(req, "OAUTH_OPENROUTER_CALLBACK");

  const { code: orCode, state: orState, error } = req.query;

  log("INFO", "[AUTH_FLOW] Step: callback_received", {
    flow_phase: "auth_flow",
    step: "openrouter_callback",
    has_code: !!orCode,
    has_state: !!orState,
    state_preview: orState ? orState.substring(0, 12) + "..." : null,
    error: error || null,
  });

  // Handle errors from OpenRouter
  if (error) {
    logError("OAUTH_OPENROUTER_CALLBACK", new Error(`OpenRouter OAuth error: ${error}`), {
      error,
      state: orState,
    });
    const authData = await getState(orState);
    if (authData) {
      await deleteState(orState);
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

  log("INFO", "[AUTH_FLOW] Step: callback_state_lookup", {
    flow_phase: "auth_flow",
    step: "callback_lookup_state",
    state_preview: orState ? orState.substring(0, 12) + "..." : null,
  });

  const authData = await getState(orState);
  if (!authData) {
    log("WARN", "[AUTH_FLOW] Step: callback_state_missing", {
      flow_phase: "auth_flow",
      step: "callback_state_not_found",
      state_preview: orState ? orState.substring(0, 12) + "..." : null,
      hint: process.env.REDIS_URL ? "Check Redis connectivity" : "With multiple replicas, set REDIS_URL for shared state",
    });
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Invalid or expired state. If using multiple server replicas, configure REDIS_URL for shared OAuth state.",
    });
  }

  log("INFO", "[AUTH_FLOW] Step: callback_state_found", {
    flow_phase: "auth_flow",
    step: "callback_state_ok",
    client_id: authData.clientId,
    redirect_uri_preview: authData.redirectUri ? authData.redirectUri.substring(0, 50) + "..." : null,
  });

  await deleteState(orState);

  try {
    const baseUrl = req.protocol + "://" + req.get("host");
    const callbackUrl = `${baseUrl}/oauth/openrouter-callback`;

    log("INFO", "[AUTH_FLOW] Step: callback_exchange_openrouter_code", {
      flow_phase: "auth_flow",
      step: "callback_exchange_code",
      callback_url: callbackUrl,
      has_code_verifier: !!authData.codeVerifier,
    });

    const { apiKey, userId } = await exchangeCodeForApiKey(
      orCode,
      authData.codeVerifier,
      callbackUrl
    );

    log("INFO", "[AUTH_FLOW] Step: callback_openrouter_success", {
      flow_phase: "auth_flow",
      step: "callback_openrouter_done",
      user_id: userId,
      has_api_key: !!apiKey,
    });

    const authCode = generateSessionToken();

    log("INFO", "[AUTH_FLOW] Step: callback_issue_auth_code", {
      flow_phase: "auth_flow",
      step: "callback_issue_code",
      auth_code_preview: authCode.substring(0, 10) + "...",
      client_id: authData.clientId,
    });

    await storeAuthorizationCode(
      authCode,
      userId,
      apiKey,
      authData.clientId,
      authData.redirectUri,
      authData.codeChallenge,
      authData.codeChallengeMethod,
      authData.scopes
    );

    const redirectUri = `${authData.redirectUri}?code=${authCode}&state=${authData.state || ""}`;
    log("INFO", "[AUTH_FLOW] Step: callback_redirect_to_client", {
      flow_phase: "auth_flow",
      step: "callback_redirect",
      redirect_uri_preview: redirectUri.substring(0, 80) + "...",
      has_code: true,
      has_state: !!authData.state,
    });

    res.redirect(redirectUri);

  } catch (error) {
    logError("OAUTH_OPENROUTER_CALLBACK", error, {
      flow_phase: "auth_flow",
      step: "callback_error",
      state_preview: orState ? orState.substring(0, 12) + "..." : null,
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
router.post("/token", express.urlencoded({ extended: true }), express.json(), async (req, res) => {
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

  log("INFO", "[AUTH_FLOW] Step: token_request", {
    flow_phase: "auth_flow",
    step: "token_request",
    grant_type,
    has_code: !!code,
    code_preview: code ? code.substring(0, 10) + "..." : null,
    has_refresh_token: !!refresh_token,
    has_code_verifier: !!code_verifier,
    has_client_id: !!client_id,
    redirect_uri: redirect_uri ? redirect_uri.substring(0, 50) + "..." : null,
  });

  try {
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

      if (client_id && client_secret) {
        const isValid = verifyClient(client_id, client_secret);
        log("INFO", "[OAUTH_TOKEN] Client verification", { client_id, is_valid: isValid });
        if (!isValid) {
          log("WARN", "[OAUTH_TOKEN] Invalid client credentials", { client_id });
          return res.status(401).json({
            error: "invalid_client",
            error_description: "Invalid client credentials",
          });
        }
      }

      log("INFO", "[AUTH_FLOW] Step: token_consume_code", {
        flow_phase: "auth_flow",
        step: "token_consume_code",
        code_preview: code.substring(0, 10) + "...",
      });

      const codeData = await consumeAuthorizationCode(code, code_verifier);
      if (!codeData) {
        log("WARN", "[AUTH_FLOW] Step: token_code_invalid", {
          flow_phase: "auth_flow",
          step: "token_code_consume_failed",
          code_preview: code.substring(0, 10) + "...",
          reason: "invalid_or_expired_or_pkce_failed",
        });
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired authorization code",
        });
      }

      log("INFO", "[AUTH_FLOW] Step: token_code_validated", {
        flow_phase: "auth_flow",
        step: "token_code_ok",
        user_id: codeData.userId,
        client_id: codeData.clientId,
      });

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

      log("INFO", "[AUTH_FLOW] Step: token_issue_tokens", {
        flow_phase: "auth_flow",
        step: "token_generate",
        user_id: codeData.userId,
        client_id: codeData.clientId,
      });

      const accessToken = generateAccessToken(
        codeData.userId,
        codeData.clientId,
        codeData.scopes
      );
      const refreshToken = generateRefreshToken();

      await storeAccessToken(
        accessToken,
        refreshToken,
        codeData.apiKey,
        codeData.userId,
        codeData.clientId,
        codeData.scopes
      );

      log("INFO", "[AUTH_FLOW] Step: token_issued_success", {
        flow_phase: "auth_flow",
        step: "token_issued",
        user_id: codeData.userId,
        client_id: codeData.clientId,
        access_token_preview: accessToken.substring(0, 16) + "...",
      });

      return res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: codeData.scopes.join(" "),
      });
    }

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

      const refreshData = await getRefreshToken(refresh_token);
      if (!refreshData) {
        log("WARN", "[AUTH_FLOW] Step: token_refresh_invalid", {
          flow_phase: "auth_flow",
          step: "token_refresh_lookup_failed",
          refresh_token_preview: refresh_token ? refresh_token.substring(0, 10) + "..." : null,
        });
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired refresh token",
        });
      }

      log("INFO", "[OAUTH_TOKEN] Refresh token validated", {
        user_id: refreshData.userId,
        client_id: refreshData.clientId,
      });

      const oldTokenData = await getAccessToken(refreshData.accessToken);
      if (!oldTokenData) {
        log("WARN", "[AUTH_FLOW] Step: token_refresh_old_token_missing", {
          flow_phase: "auth_flow",
          step: "token_refresh_access_token_not_found",
          user_id: refreshData.userId,
        });
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Associated access token not found",
        });
      }

      const newAccessToken = generateAccessToken(
        refreshData.userId,
        refreshData.clientId,
        refreshData.scopes
      );
      const newRefreshToken = generateRefreshToken();

      await storeAccessToken(
        newAccessToken,
        newRefreshToken,
        oldTokenData.apiKey,
        refreshData.userId,
        refreshData.clientId,
        refreshData.scopes
      );
      await revokeRefreshToken(refresh_token);

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
  } catch (err) {
    logError("OAUTH_TOKEN", err, {
      flow_phase: "auth_flow",
      step: "token_error",
      grant_type: req.body?.grant_type,
    });
    return res.status(500).json({
      error: "server_error",
      error_description: "Token request failed",
    });
  }
});

/**
 * POST /oauth/introspect
 * Token Introspection (RFC 7662)
 */
router.post("/introspect", express.urlencoded({ extended: true }), express.json(), async (req, res) => {
  const { token, token_type_hint } = req.body;

  log("INFO", "[AUTH_FLOW] Step: introspect_request", {
    flow_phase: "auth_flow",
    step: "introspect",
    has_token: !!token,
  });

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
  const tokenData = await getAccessToken(token);
  if (tokenData) {
    return res.json({
      active: true,
      client_id: tokenData.clientId,
      username: tokenData.userId,
      scope: tokenData.scopes.join(" "),
      exp: tokenData.expiresAt ? Math.floor(tokenData.expiresAt.getTime() / 1000) : null,
    });
  }

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
  log("INFO", "[AUTH_FLOW] Step: status_ok", {
    flow_phase: "auth_flow",
    step: "oauth_status",
    user_id: req.user.userId,
    client_id: req.user.clientId,
  });
  res.json({
    authenticated: true,
    user_id: req.user.userId,
    client_id: req.user.clientId,
    scopes: req.user.scopes,
  });
});

module.exports = router;
