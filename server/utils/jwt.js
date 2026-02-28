// utils/jwt.js
// JWT token generation and validation for OAuth tokens
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// In production, use a secure secret from environment
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex");
const JWT_ISSUER = process.env.JWT_ISSUER || "openrouter-mcp-server";
const ACCESS_TOKEN_EXPIRY = parseInt(process.env.ACCESS_TOKEN_EXPIRY) || 3600; // 1 hour
const REFRESH_TOKEN_EXPIRY = parseInt(process.env.REFRESH_TOKEN_EXPIRY) || 86400 * 30; // 30 days

/**
 * Generate access token (JWT)
 * @param {string} userId - User ID
 * @param {string} clientId - Client ID
 * @param {string[]} scopes - Token scopes
 * @returns {string} JWT access token
 */
function generateAccessToken(userId, clientId, scopes = ["mcp:read", "mcp:write"]) {
  const now = Math.floor(Date.now() / 1000);
  
  const payload = {
    sub: userId, // Subject (user ID)
    client_id: clientId,
    scope: scopes.join(" "),
    iat: now, // Issued at
    exp: now + ACCESS_TOKEN_EXPIRY, // Expiration
    iss: JWT_ISSUER, // Issuer
    aud: JWT_ISSUER, // Audience
  };

  return jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
  });
}

/**
 * Generate refresh token (opaque token, stored in database)
 * @returns {string} Refresh token
 */
function generateRefreshToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Verify and decode access token
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_ISSUER,
    });
    return decoded;
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      console.log("Token expired");
    } else if (error.name === "JsonWebTokenError") {
      console.log("Invalid token:", error.message);
    }
    return null;
  }
}

/**
 * Get token expiration time
 * @param {string} token - JWT token
 * @returns {Date|null} Expiration date or null
 */
function getTokenExpiration(token) {
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      return new Date(decoded.exp * 1000);
    }
  } catch (error) {
    // Invalid token
  }
  return null;
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  getTokenExpiration,
  JWT_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
};
