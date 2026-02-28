// utils/tokenStorageDB.js
// SQLite-based persistent token storage for production
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// Database file path (can be configured via environment variable)
const DB_PATH = process.env.TOKEN_DB_PATH || path.join(__dirname, "../data/tokens.db");
const DB_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Enhanced logging
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

// Initialize database connection
let db = null;

function getDB() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        log("ERROR", "[TOKEN_DB] Database connection error", {
          error: err.message,
          path: DB_PATH,
        });
        throw err;
      }
      log("INFO", "[TOKEN_DB] Database connected", { path: DB_PATH });
    });
    
    // Initialize tables
    initializeTables();
  }
  return db;
}

// Initialize database tables
function initializeTables() {
  const db = getDB();
  
  // Access tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS access_tokens (
      token TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scopes TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      log("ERROR", "[TOKEN_DB] Error creating access_tokens table", {
        error: err.message,
      });
    } else {
      log("INFO", "[TOKEN_DB] access_tokens table ready");
    }
  });
  
  // Refresh tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      refresh_token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scopes TEXT,
      access_token TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      log("ERROR", "[TOKEN_DB] Error creating refresh_tokens table", {
        error: err.message,
      });
    } else {
      log("INFO", "[TOKEN_DB] refresh_tokens table ready");
    }
  });
  
  // Authorization codes table
  db.run(`
    CREATE TABLE IF NOT EXISTS authorization_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      api_key TEXT NOT NULL,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      scopes TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      log("ERROR", "[TOKEN_DB] Error creating authorization_codes table", {
        error: err.message,
      });
    } else {
      log("INFO", "[TOKEN_DB] authorization_codes table ready");
    }
  });
  
  // Create indexes for better performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_access_tokens_user_id ON access_tokens(user_id)`, () => {});
  db.run(`CREATE INDEX IF NOT EXISTS idx_access_tokens_expires_at ON access_tokens(expires_at)`, () => {});
  db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)`, () => {});
  db.run(`CREATE INDEX IF NOT EXISTS idx_authorization_codes_expires_at ON authorization_codes(expires_at)`, () => {});
}

// Helper to promisify database operations
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Store an access token with associated user API key
 */
async function storeAccessToken(accessToken, refreshToken, apiKey, userId, clientId, scopes = [], expiresAt = null) {
  try {
    const now = Date.now();
    const scopesStr = JSON.stringify(scopes);
    const expiresAtMs = expiresAt ? expiresAt.getTime() : null;
    
    await dbRun(
      `INSERT OR REPLACE INTO access_tokens 
       (token, api_key, user_id, client_id, scopes, refresh_token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [accessToken, apiKey, userId, clientId, scopesStr, refreshToken, expiresAtMs, now]
    );
    
    // Store refresh token mapping if provided
    if (refreshToken) {
      await dbRun(
        `INSERT OR REPLACE INTO refresh_tokens
         (refresh_token, user_id, client_id, scopes, access_token, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [refreshToken, userId, clientId, scopesStr, accessToken, now]
      );
    }
    
    log("INFO", "[TOKEN_DB] Access token stored", {
      user_id: userId,
      client_id: clientId,
      scopes,
      has_refresh_token: !!refreshToken,
    });
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error storing access token", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Store authorization code (for OAuth flow)
 */
async function storeAuthorizationCode(code, userId, apiKey, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, expiresIn = 600) {
  try {
    const expiresAt = Date.now() + expiresIn * 1000;
    const scopesStr = JSON.stringify(scopes);
    
    await dbRun(
      `INSERT OR REPLACE INTO authorization_codes
       (code, user_id, api_key, client_id, redirect_uri, code_challenge, code_challenge_method, scopes, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, userId, apiKey, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopesStr, expiresAt, Date.now()]
    );
    
    log("INFO", "[TOKEN_DB] Authorization code stored", {
      code: code.substring(0, 10) + "...",
      user_id: userId,
      client_id: clientId,
      expires_in: expiresIn,
    });
    
    // Clean up expired codes periodically (async, don't wait)
    setTimeout(async () => {
      try {
        await dbRun(`DELETE FROM authorization_codes WHERE code = ?`, [code]);
        log("INFO", "[TOKEN_DB] Authorization code expired and cleaned up", {
          code: code.substring(0, 10) + "...",
        });
      } catch (err) {
        log("ERROR", "[TOKEN_DB] Error cleaning up authorization code", {
          error: err.message,
        });
      }
    }, expiresIn * 1000);
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error storing authorization code", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Get and consume authorization code
 */
async function consumeAuthorizationCode(code, codeVerifier) {
  try {
    const codeData = await dbGet(
      `SELECT * FROM authorization_codes WHERE code = ?`,
      [code]
    );
    
    if (!codeData) {
      return null;
    }
    
    // Check expiration
    if (Date.now() > codeData.expires_at) {
      await dbRun(`DELETE FROM authorization_codes WHERE code = ?`, [code]);
      return null;
    }
    
    // Verify PKCE
    if (codeData.code_challenge_method === "S256") {
      const crypto = require("crypto");
      const computedChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      
      if (computedChallenge !== codeData.code_challenge) {
        log("WARN", "[TOKEN_DB] PKCE verification failed", {
          code: code.substring(0, 10) + "...",
        });
        return null;
      }
    }
    
    // Consume code (delete it)
    await dbRun(`DELETE FROM authorization_codes WHERE code = ?`, [code]);
    
    log("INFO", "[TOKEN_DB] Authorization code consumed", {
      code: code.substring(0, 10) + "...",
      user_id: codeData.user_id,
      client_id: codeData.client_id,
    });
    
    // Parse scopes
    const scopes = codeData.scopes ? JSON.parse(codeData.scopes) : [];
    
    return {
      userId: codeData.user_id,
      apiKey: codeData.api_key,
      clientId: codeData.client_id,
      redirectUri: codeData.redirect_uri,
      codeChallenge: codeData.code_challenge,
      codeChallengeMethod: codeData.code_challenge_method,
      scopes,
    };
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error consuming authorization code", {
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Retrieve access token data
 */
async function getAccessToken(token) {
  try {
    const row = await dbGet(
      `SELECT * FROM access_tokens WHERE token = ?`,
      [token]
    );
    
    if (!row) {
      return null;
    }
    
    // Check expiration
    if (row.expires_at && Date.now() > row.expires_at) {
      log("INFO", "[TOKEN_DB] Token expired", {
        user_id: row.user_id,
      });
      await deleteToken(token);
      return null;
    }
    
    // Parse scopes
    const scopes = row.scopes ? JSON.parse(row.scopes) : [];
    
    return {
      apiKey: row.api_key,
      userId: row.user_id,
      clientId: row.client_id,
      scopes,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      createdAt: new Date(row.created_at),
    };
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error getting access token", {
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Get refresh token data
 */
async function getRefreshToken(refreshToken) {
  try {
    const row = await dbGet(
      `SELECT * FROM refresh_tokens WHERE refresh_token = ?`,
      [refreshToken]
    );
    
    if (!row) {
      return null;
    }
    
    const scopes = row.scopes ? JSON.parse(row.scopes) : [];
    
    return {
      userId: row.user_id,
      clientId: row.client_id,
      scopes,
      accessToken: row.access_token,
      createdAt: new Date(row.created_at),
    };
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error getting refresh token", {
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Revoke refresh token and associated access token
 */
async function revokeRefreshToken(refreshToken) {
  try {
    const refreshData = await getRefreshToken(refreshToken);
    if (refreshData) {
      await deleteToken(refreshData.accessToken);
      await dbRun(`DELETE FROM refresh_tokens WHERE refresh_token = ?`, [refreshToken]);
      log("INFO", "[TOKEN_DB] Refresh token revoked", {
        user_id: refreshData.userId,
      });
    }
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error revoking refresh token", {
      error: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Delete a token
 */
async function deleteToken(token) {
  try {
    const tokenData = await getAccessToken(token);
    if (tokenData) {
      await dbRun(`DELETE FROM access_tokens WHERE token = ?`, [token]);
      if (tokenData.refreshToken) {
        await dbRun(`DELETE FROM refresh_tokens WHERE refresh_token = ?`, [tokenData.refreshToken]);
      }
      log("INFO", "[TOKEN_DB] Token deleted", {
        user_id: tokenData.userId,
      });
    }
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error deleting token", {
      error: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Delete all tokens for a user
 */
async function deleteUserTokens(userId) {
  try {
    // Get all tokens for user
    const tokens = await dbAll(
      `SELECT token FROM access_tokens WHERE user_id = ?`,
      [userId]
    );
    
    // Delete refresh tokens
    await dbRun(`DELETE FROM refresh_tokens WHERE user_id = ?`, [userId]);
    
    // Delete access tokens
    await dbRun(`DELETE FROM access_tokens WHERE user_id = ?`, [userId]);
    
    log("INFO", "[TOKEN_DB] All tokens deleted for user", {
      user_id: userId,
      token_count: tokens.length,
    });
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error deleting user tokens", {
      error: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Clean up expired tokens
 */
async function cleanupExpiredTokens() {
  try {
    const now = Date.now();
    
    // Delete expired access tokens
    const result = await dbRun(
      `DELETE FROM access_tokens WHERE expires_at IS NOT NULL AND expires_at < ?`,
      [now]
    );
    
    if (result.changes > 0) {
      log("INFO", "[TOKEN_DB] Cleaned up expired tokens", {
        count: result.changes,
      });
    }
    
    // Clean up orphaned refresh tokens (where access token was deleted)
    await dbRun(
      `DELETE FROM refresh_tokens 
       WHERE access_token NOT IN (SELECT token FROM access_tokens)`
    );
    
    // Clean up expired authorization codes
    await dbRun(
      `DELETE FROM authorization_codes WHERE expires_at < ?`,
      [now]
    );
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error cleaning up expired tokens", {
      error: error.message,
      stack: error.stack,
    });
  }
}

// Run cleanup every 5 minutes
setInterval(() => {
  cleanupExpiredTokens().catch(err => {
    log("ERROR", "[TOKEN_DB] Cleanup interval error", {
      error: err.message,
    });
  });
}, 5 * 60 * 1000);

/**
 * Get statistics about stored tokens
 */
async function getStats() {
  try {
    const totalTokens = await dbGet(`SELECT COUNT(*) as count FROM access_tokens`);
    const uniqueUsers = await dbGet(`SELECT COUNT(DISTINCT user_id) as count FROM access_tokens`);
    
    return {
      totalTokens: totalTokens?.count || 0,
      uniqueUsers: uniqueUsers?.count || 0,
    };
  } catch (error) {
    log("ERROR", "[TOKEN_DB] Error getting stats", {
      error: error.message,
    });
    return {
      totalTokens: 0,
      uniqueUsers: 0,
    };
  }
}

/**
 * Close database connection (for graceful shutdown)
 */
function closeDB() {
  if (db) {
    db.close((err) => {
      if (err) {
        log("ERROR", "[TOKEN_DB] Error closing database", {
          error: err.message,
        });
      } else {
        log("INFO", "[TOKEN_DB] Database connection closed");
      }
    });
    db = null;
  }
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
  closeDB,
};
