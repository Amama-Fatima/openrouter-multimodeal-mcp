// utils/oauth.js
const crypto = require("crypto");
const axios = require("axios");

/**
 * Generate PKCE code verifier and challenge
 * @returns {Object} { codeVerifier, codeChallenge }
 */
function generatePKCE() {
  // Generate a random code verifier (43-128 characters)
  const codeVerifier = crypto
    .randomBytes(32)
    .toString("base64url")
    .slice(0, 43);

  // Generate code challenge using SHA-256
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return {
    codeVerifier,
    codeChallenge,
  };
}

/**
 * Exchange authorization code for user API key
 * @param {string} code - Authorization code from OpenRouter
 * @param {string} codeVerifier - PKCE code verifier
 * @param {string} callbackUrl - Original callback URL
 * @returns {Promise<Object>} { apiKey, userId, expiresAt }
 */
async function exchangeCodeForApiKey(code, codeVerifier, callbackUrl) {
  const log = (level, message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ timestamp, level, message, ...data }));
  };

  log("INFO", "[OPENROUTER_API] Exchanging code for API key", {
    callback_url: callbackUrl,
    has_code: !!code,
    has_code_verifier: !!codeVerifier,
  });

  try {
    const requestData = {
      code,
      code_verifier: codeVerifier,
      code_challenge_method: "S256", // OpenRouter requires this parameter
      callback_url: callbackUrl,
    };

    log("INFO", "[OPENROUTER_API] Sending request to OpenRouter", {
      url: "https://openrouter.ai/api/v1/auth/keys",
      has_code: !!code,
      code_challenge_method: "S256",
    });

    const response = await axios.post(
      "https://openrouter.ai/api/v1/auth/keys",
      requestData,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    log("INFO", "[OPENROUTER_API] OpenRouter response received", {
      status: response.status,
      has_key: !!response.data?.key,
      has_user_id: !!(response.data?.user_id || response.data?.id),
    });

    const result = {
      apiKey: response.data.key,
      userId: response.data.user_id || response.data.id,
      expiresAt: response.data.expires_at
        ? new Date(response.data.expires_at)
        : null,
    };

    log("INFO", "[OPENROUTER_API] Code exchange successful", {
      user_id: result.userId,
      has_api_key: !!result.apiKey,
    });

    return result;
  } catch (error) {
    log("ERROR", "[OPENROUTER_API] Error exchanging code for API key", {
      error: error.message,
      status: error.response?.status,
      status_text: error.response?.statusText,
      response_data: error.response?.data,
      stack: error.stack,
    });
    
    // Extract error message more clearly
    const errorMessage = error.response?.data?.error?.message 
      || error.response?.data?.error 
      || error.message;
    
    throw new Error(
      `Failed to exchange authorization code: ${errorMessage}`
    );
  }
}

/**
 * Build OpenRouter OAuth authorization URL
 * @param {string} callbackUrl - Callback URL after authorization
 * @param {string} codeChallenge - PKCE code challenge
 * @returns {string} Authorization URL
 */
function buildAuthorizationUrl(callbackUrl, codeChallenge) {
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://openrouter.ai/auth?${params.toString()}`;
}

/**
 * Generate a secure session token
 * @returns {string} Session token
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = {
  generatePKCE,
  exchangeCodeForApiKey,
  buildAuthorizationUrl,
  generateSessionToken,
};
