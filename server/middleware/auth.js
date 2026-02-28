// middleware/auth.js
const { getAccessToken } = require("../utils/tokenStorage");
const { verifyAccessToken } = require("../utils/jwt");

// Enhanced logging
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

/**
 * Middleware to verify Bearer token
 * Extracts token from Authorization header and validates it
 */
async function verifyBearerToken(req, res, next) {
  const authHeader = req.headers.authorization;

  log("INFO", "[AUTH_MIDDLEWARE] Verifying Bearer token", {
    path: req.path,
    method: req.method,
    has_auth_header: !!authHeader,
    auth_header_preview: authHeader ? authHeader.substring(0, 20) + "..." : null,
  });

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log("WARN", "[AUTH_MIDDLEWARE] Missing or invalid Authorization header", {
      path: req.path,
      auth_header: authHeader ? "present but invalid format" : "missing",
    });
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. Expected: Bearer <token>",
    });
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  
  log("INFO", "[AUTH_MIDDLEWARE] Token extracted", {
    token_preview: token.substring(0, 20) + "...",
  });
  
  try {
    // Try to verify as JWT first
    let tokenData = null;
    const decoded = verifyAccessToken(token);
    
    log("INFO", "[AUTH_MIDDLEWARE] Token verification attempt", {
      is_jwt_valid: !!decoded,
    });
    
    if (decoded) {
      // JWT token - get stored data (may be async if using database)
      const tokenResult = getAccessToken(token);
      tokenData = tokenResult instanceof Promise ? await tokenResult : tokenResult;
      
      if (!tokenData) {
        log("WARN", "[AUTH_MIDDLEWARE] JWT valid but not found in storage", {
          decoded_user_id: decoded.sub,
          decoded_client_id: decoded.client_id,
        });
        // JWT is valid but not in storage - this shouldn't happen, but handle gracefully
        return res.status(401).json({
          error: "Unauthorized",
          message: "Token not found in storage",
        });
      }
      log("INFO", "[AUTH_MIDDLEWARE] JWT token validated", {
        user_id: tokenData.userId,
        client_id: tokenData.clientId,
      });
    } else {
      // Try as stored opaque token
      const tokenResult = getAccessToken(token);
      tokenData = tokenResult instanceof Promise ? await tokenResult : tokenResult;
      
      if (tokenData) {
        log("INFO", "[AUTH_MIDDLEWARE] Opaque token validated", {
          user_id: tokenData.userId,
          client_id: tokenData.clientId,
        });
      }
    }

    if (!tokenData) {
      log("WARN", "[AUTH_MIDDLEWARE] Token validation failed", {
        path: req.path,
      });
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

    log("INFO", "[AUTH_MIDDLEWARE] Authentication successful", {
      user_id: req.user.userId,
      client_id: req.user.clientId,
      path: req.path,
    });

    next();
  } catch (error) {
    log("ERROR", "[AUTH_MIDDLEWARE] Error during token verification", {
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Token verification failed",
    });
  }
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
