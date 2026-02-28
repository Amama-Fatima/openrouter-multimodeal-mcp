// utils/tokenStorage.js
// In-memory token storage (can be replaced with Redis/database in production)

const tokenStore = new Map(); // access_token -> { apiKey, userId, clientId, scopes, expiresAt, createdAt, refreshToken }
const refreshTokenStore = new Map(); // refresh_token -> { userId, clientId, scopes, accessToken, createdAt }
const userTokenMap = new Map(); // userId -> Set of tokens
const authorizationCodes = new Map(); // code -> { userId, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, expiresAt }

// Enhanced logging
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

/**
 * Store an access token with associated user API key
 * @param {string} accessToken - Access token (JWT)
 * @param {string} refreshToken - Refresh token
 * @param {string} apiKey - User's OpenRouter API key
 * @param {string} userId - User ID from OpenRouter
 * @param {string} clientId - OAuth client ID
 * @param {string[]} scopes - Token scopes
 * @param {Date} expiresAt - Optional expiration date
 */
function storeAccessToken(accessToken, refreshToken, apiKey, userId, clientId, scopes = [], expiresAt = null) {
  const now = new Date();
  tokenStore.set(accessToken, {
    apiKey,
    userId,
    clientId,
    scopes,
    refreshToken,
    expiresAt,
    createdAt: now,
  });

  // Store refresh token mapping
  if (refreshToken) {
    refreshTokenStore.set(refreshToken, {
      userId,
      clientId,
      scopes,
      accessToken,
      createdAt: now,
    });
  }

  // Track tokens per user
  if (!userTokenMap.has(userId)) {
    userTokenMap.set(userId, new Set());
  }
  userTokenMap.get(userId).add(accessToken);

  log("INFO", "[TOKEN_STORAGE] Access token stored", {
    user_id: userId,
    client_id: clientId,
    scopes,
    has_refresh_token: !!refreshToken,
  });
}

/**
 * Store authorization code (for OAuth flow)
 * @param {string} code - Authorization code
 * @param {string} userId - User ID
 * @param {string} apiKey - User's OpenRouter API key
 * @param {string} clientId - Client ID
 * @param {string} redirectUri - Redirect URI
 * @param {string} codeChallenge - PKCE code challenge
 * @param {string} codeChallengeMethod - PKCE method (S256)
 * @param {string[]} scopes - Requested scopes
 * @param {number} expiresIn - Expiration in seconds (default: 10 minutes)
 */
function storeAuthorizationCode(code, userId, apiKey, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, expiresIn = 600) {
  const expiresAt = Date.now() + expiresIn * 1000;
  authorizationCodes.set(code, {
    userId,
    apiKey, // Store API key with authorization code
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scopes,
    expiresAt,
    createdAt: Date.now(),
  });
  
  log("INFO", "[TOKEN_STORAGE] Authorization code stored", {
    code: code.substring(0, 10) + "...",
    user_id: userId,
    client_id: clientId,
    expires_in: expiresIn,
  });
  
  // Clean up expired codes periodically
  setTimeout(() => {
    authorizationCodes.delete(code);
    log("INFO", "[TOKEN_STORAGE] Authorization code expired and cleaned up", {
      code: code.substring(0, 10) + "...",
    });
  }, expiresIn * 1000);
}

/**
 * Get and consume authorization code
 * @param {string} code - Authorization code
 * @param {string} codeVerifier - PKCE code verifier
 * @returns {Object|null} Code data or null if invalid
 */
function consumeAuthorizationCode(code, codeVerifier) {
  const codeData = authorizationCodes.get(code);
  if (!codeData) {
    return null;
  }

  // Check expiration
  if (Date.now() > codeData.expiresAt) {
    authorizationCodes.delete(code);
    return null;
  }

  // Verify PKCE
  if (codeData.codeChallengeMethod === "S256") {
    const crypto = require("crypto");
    const computedChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    
    if (computedChallenge !== codeData.codeChallenge) {
      console.log("PKCE verification failed");
      return null;
    }
  }

  // Consume code (delete it)
  authorizationCodes.delete(code);

  log("INFO", "[TOKEN_STORAGE] Authorization code consumed", {
    code: code.substring(0, 10) + "...",
    user_id: codeData.userId,
    client_id: codeData.clientId,
  });

  return codeData;
}

/**
 * Retrieve access token data
 * @param {string} token - Access token (JWT or opaque)
 * @returns {Object|null} { apiKey, userId, clientId, scopes, expiresAt, createdAt } or null
 */
function getAccessToken(token) {
  const tokenData = tokenStore.get(token);
  if (!tokenData) {
    return null;
  }

  // Check expiration
  if (tokenData.expiresAt && new Date() > tokenData.expiresAt) {
    console.log(`Token expired for user ${tokenData.userId}`);
    deleteToken(token);
    return null;
  }

  return tokenData;
}

/**
 * Get refresh token data
 * @param {string} refreshToken - Refresh token
 * @returns {Object|null} Refresh token data or null
 */
function getRefreshToken(refreshToken) {
  return refreshTokenStore.get(refreshToken) || null;
}

/**
 * Revoke refresh token and associated access token
 * @param {string} refreshToken - Refresh token
 */
function revokeRefreshToken(refreshToken) {
  const refreshData = refreshTokenStore.get(refreshToken);
  if (refreshData) {
    // Delete associated access token
    deleteToken(refreshData.accessToken);
    refreshTokenStore.delete(refreshToken);
  }
}

/**
 * Delete a token
 * @param {string} token - Bearer token
 */
function deleteToken(token) {
  const tokenData = tokenStore.get(token);
  if (tokenData) {
    tokenStore.delete(token);
    const userTokens = userTokenMap.get(tokenData.userId);
    if (userTokens) {
      userTokens.delete(token);
      if (userTokens.size === 0) {
        userTokenMap.delete(tokenData.userId);
      }
    }
  }
}

/**
 * Delete all tokens for a user
 * @param {string} userId - User ID
 */
function deleteUserTokens(userId) {
  const tokens = userTokenMap.get(userId);
  if (tokens) {
    tokens.forEach((token) => {
      tokenStore.delete(token);
    });
    userTokenMap.delete(userId);
  }
}

/**
 * Clean up expired tokens
 */
function cleanupExpiredTokens() {
  const now = new Date();
  const expiredTokens = [];

  tokenStore.forEach((data, token) => {
    if (data.expiresAt && now > data.expiresAt) {
      expiredTokens.push(token);
    }
  });

  expiredTokens.forEach((token) => deleteToken(token));

  if (expiredTokens.length > 0) {
    console.log(`Cleaned up ${expiredTokens.length} expired tokens`);
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredTokens, 5 * 60 * 1000);

/**
 * Get statistics about stored tokens
 * @returns {Object} Statistics
 */
function getStats() {
  return {
    totalTokens: tokenStore.size,
    uniqueUsers: userTokenMap.size,
  };
}

module.exports = {
  storeAccessToken,
  getAccessToken,
  storeAuthorizationCode,
  consumeAuthorizationCode,
  getRefreshToken,
  revokeRefreshToken,
  deleteToken,
  deleteUserTokens,
  cleanupExpiredTokens,
  getStats,
};
