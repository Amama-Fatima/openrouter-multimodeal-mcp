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
 * Extracts token from Authorization header and validates it (supports async storage e.g. Redis)
 */
function verifyBearerToken(req, res, next) {
  const authHeader = req.headers.authorization;

  log("INFO", "[AUTH_FLOW] Step: auth_middleware_verify", {
    flow_phase: "auth_middleware",
    step: "verify_start",
    path: req.path,
    method: req.method,
    has_auth_header: !!authHeader,
    auth_header_preview: authHeader ? authHeader.substring(0, 20) + "..." : null,
  });

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log("WARN", "[AUTH_FLOW] Step: auth_middleware_no_bearer", {
      flow_phase: "auth_middleware",
      step: "missing_or_invalid_header",
      path: req.path,
      auth_header: authHeader ? "present but invalid format" : "missing",
    });
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. Expected: Bearer <token>",
    });
  }

  const token = authHeader.substring(7);

  log("INFO", "[AUTH_FLOW] Step: auth_middleware_token_extracted", {
    flow_phase: "auth_middleware",
    step: "token_extracted",
    token_preview: token.substring(0, 20) + "...",
    path: req.path,
  });

  const decoded = verifyAccessToken(token);
  log("INFO", "[AUTH_FLOW] Step: auth_middleware_jwt_check", {
    flow_phase: "auth_middleware",
    step: "jwt_verify",
    is_jwt_valid: !!decoded,
    path: req.path,
  });

  (async () => {
    let tokenData = null;
    try {
      if (decoded) {
        tokenData = await getAccessToken(token);
        if (!tokenData) {
          log("WARN", "[AUTH_FLOW] Step: auth_middleware_rejected", {
            flow_phase: "auth_middleware",
            step: "jwt_valid_not_in_storage",
            decoded_user_id: decoded.sub,
            decoded_client_id: decoded.client_id,
            reason: "token_not_found_in_storage",
          });
          return res.status(401).json({
            error: "Unauthorized",
            message: "Token not found in storage",
          });
        }
        log("INFO", "[AUTH_FLOW] Step: auth_middleware_success", {
          flow_phase: "auth_middleware",
          step: "jwt_validated",
          user_id: tokenData.userId,
          client_id: tokenData.clientId,
          path: req.path,
        });
      } else {
        tokenData = await getAccessToken(token);
        if (tokenData) {
          log("INFO", "[AUTH_FLOW] Step: auth_middleware_success", {
            flow_phase: "auth_middleware",
            step: "opaque_token_validated",
            user_id: tokenData.userId,
            client_id: tokenData.clientId,
            path: req.path,
          });
        }
      }

      if (!tokenData) {
        log("WARN", "[AUTH_FLOW] Step: auth_middleware_rejected", {
          flow_phase: "auth_middleware",
          step: "token_invalid_or_expired",
          path: req.path,
          reason: "invalid_or_expired",
        });
        return res.status(401).json({
          error: "Unauthorized",
          message: "Invalid or expired token",
        });
      }

      req.user = {
        userId: tokenData.userId,
        apiKey: tokenData.apiKey,
        clientId: tokenData.clientId,
        scopes: tokenData.scopes || [],
        token: token,
      };

      log("INFO", "[AUTH_FLOW] Step: auth_middleware_done", {
        flow_phase: "auth_middleware",
        step: "authenticated",
        user_id: req.user.userId,
        client_id: req.user.clientId,
        path: req.path,
      });

      next();
    } catch (err) {
      log("ERROR", "[AUTH_FLOW] Step: auth_middleware_error", {
        flow_phase: "auth_middleware",
        step: "storage_error",
        path: req.path,
        error: err.message,
        stack: err.stack,
      });
      next(err);
    }
  })();
}

/**
 * Optional middleware - allows requests with or without auth
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

  const token = authHeader.substring(7);
  const decoded = verifyAccessToken(token);
  getAccessToken(token).then((tokenData) => {
    if (tokenData) {
      req.user = {
        userId: tokenData.userId,
        apiKey: tokenData.apiKey,
        clientId: tokenData.clientId,
        scopes: tokenData.scopes || [],
        token: token,
      };
    }
    next();
  }).catch(next);
}

module.exports = {
  verifyBearerToken,
  optionalAuth,
};
