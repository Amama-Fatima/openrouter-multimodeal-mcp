// middleware/auth.js
const { getAccessToken } = require("../utils/tokenStorage");
const { verifyAccessToken } = require("../utils/jwt");

/**
 * Middleware to verify Bearer token
 * Extracts token from Authorization header and validates it
 */
function verifyBearerToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. Expected: Bearer <token>",
    });
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  
  // Try to verify as JWT first
  let tokenData = null;
  const decoded = verifyAccessToken(token);
  
  if (decoded) {
    // JWT token - get stored data
    tokenData = getAccessToken(token);
    if (!tokenData) {
      // JWT is valid but not in storage - this shouldn't happen, but handle gracefully
      return res.status(401).json({
        error: "Unauthorized",
        message: "Token not found in storage",
      });
    }
  } else {
    // Try as stored opaque token
    tokenData = getAccessToken(token);
  }

  if (!tokenData) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired token",
    });
  }

  // Attach user info to request
  req.user = {
    userId: tokenData.userId,
    apiKey: tokenData.apiKey,
    clientId: tokenData.clientId,
    scopes: tokenData.scopes || [],
    token: token,
  };

  next();
}

/**
 * Optional middleware - allows requests with or without auth
 * Useful for public endpoints that can work with or without auth
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);
    const tokenData = decoded ? getAccessToken(token) : getAccessToken(token);

    if (tokenData) {
      req.user = {
        userId: tokenData.userId,
        apiKey: tokenData.apiKey,
        clientId: tokenData.clientId,
        scopes: tokenData.scopes || [],
        token: token,
      };
    }
  }

  next();
}

module.exports = {
  verifyBearerToken,
  optionalAuth,
};
