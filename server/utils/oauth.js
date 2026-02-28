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
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/auth/keys",
      {
        code,
        code_verifier: codeVerifier,
        callback_url: callbackUrl,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    return {
      apiKey: response.data.key,
      userId: response.data.user_id || response.data.id,
      expiresAt: response.data.expires_at
        ? new Date(response.data.expires_at)
        : null,
    };
  } catch (error) {
    console.error("Error exchanging code for API key:", error.response?.data || error.message);
    throw new Error(
      `Failed to exchange authorization code: ${
        error.response?.data?.error || error.message
      }`
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
