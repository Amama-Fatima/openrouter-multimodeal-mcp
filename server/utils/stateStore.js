// utils/stateStore.js
// OAuth state storage - in-memory per process, or Redis when REDIS_URL is set.
// Redis is required when running multiple replicas (e.g. Railway) so the callback
// can find the state regardless of which replica handles the request.

const { getRedisClient, isRedisEnabled } = require("./redisClient");

const STATE_TTL_SEC = 600; // 10 minutes
const KEY_PREFIX = "oauth:state:";

function authLog(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, flow_phase: "oauth_state", ...data }));
}

// In-memory fallback (per-replica)
const memoryStore = new Map();
const MEMORY_TTL_MS = STATE_TTL_SEC * 1000;

function cleanupMemoryStore() {
  const now = Date.now();
  for (const [state, entry] of memoryStore.entries()) {
    if (now - entry.timestamp > MEMORY_TTL_MS) memoryStore.delete(state);
  }
}
setInterval(cleanupMemoryStore, 5 * 60 * 1000);

function statePreview(s) {
  return s && s.length >= 12 ? s.substring(0, 12) + "..." : (s || "");
}

/**
 * Store OAuth state (used when redirecting to OpenRouter).
 * @param {string} state - State parameter
 * @param {Object} data - { codeVerifier, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, state }
 * @param {number} [ttlSec] - TTL in seconds (default 600)
 * @returns {Promise<void>}
 */
async function setState(state, data, ttlSec = STATE_TTL_SEC) {
  const payload = { ...data, timestamp: Date.now() };
  const preview = statePreview(state);
  if (isRedisEnabled()) {
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.set(KEY_PREFIX + state, JSON.stringify(payload), { EX: ttlSec });
        authLog("INFO", "[AUTH_FLOW] OAuth state stored (Redis)", {
          operation: "set",
          backend: "redis",
          state_preview: preview,
          client_id: data.clientId,
          ttl_sec: ttlSec,
        });
        return;
      }
    } catch (err) {
      authLog("ERROR", "[AUTH_FLOW] OAuth state set failed (Redis)", {
        operation: "set",
        backend: "redis",
        state_preview: preview,
        error: err.message,
      });
      throw err;
    }
  }
  memoryStore.set(state, payload);
  authLog("INFO", "[AUTH_FLOW] OAuth state stored (memory)", {
    operation: "set",
    backend: "memory",
    state_preview: preview,
    client_id: data.clientId,
    ttl_sec: ttlSec,
  });
}

/**
 * Get OAuth state (used when OpenRouter redirects back).
 * @param {string} state - State parameter
 * @returns {Promise<Object|null>} Stored data or null
 */
async function getState(state) {
  const preview = statePreview(state);
  if (isRedisEnabled()) {
    try {
      const redis = await getRedisClient();
      if (redis) {
        const raw = await redis.get(KEY_PREFIX + state);
        const found = !!raw;
        authLog("INFO", "[AUTH_FLOW] OAuth state lookup (Redis)", {
          operation: "get",
          backend: "redis",
          state_preview: preview,
          found,
        });
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          authLog("WARN", "[AUTH_FLOW] OAuth state parse failed (Redis)", {
            operation: "get",
            state_preview: preview,
            reason: "invalid_json",
          });
          return null;
        }
      }
    } catch (err) {
      authLog("ERROR", "[AUTH_FLOW] OAuth state get failed (Redis)", {
        operation: "get",
        backend: "redis",
        state_preview: preview,
        error: err.message,
      });
      throw err;
    }
  }
  const entry = memoryStore.get(state);
  const found = !!entry;
  const expired = entry && Date.now() - entry.timestamp > MEMORY_TTL_MS;
  authLog("INFO", "[AUTH_FLOW] OAuth state lookup (memory)", {
    operation: "get",
    backend: "memory",
    state_preview: preview,
    found: found && !expired,
    expired: !!expired,
  });
  if (!entry) return null;
  if (expired) {
    memoryStore.delete(state);
    return null;
  }
  return entry;
}

/**
 * Delete OAuth state (one-time use).
 * @param {string} state - State parameter
 * @returns {Promise<void>}
 */
async function deleteState(state) {
  const preview = statePreview(state);
  if (isRedisEnabled()) {
    const redis = await getRedisClient();
    if (redis) await redis.del(KEY_PREFIX + state);
    authLog("INFO", "[AUTH_FLOW] OAuth state deleted (Redis)", {
      operation: "delete",
      backend: "redis",
      state_preview: preview,
    });
    return;
  }
  memoryStore.delete(state);
  authLog("INFO", "[AUTH_FLOW] OAuth state deleted (memory)", {
    operation: "delete",
    backend: "memory",
    state_preview: preview,
  });
}

module.exports = {
  setState,
  getState,
  deleteState,
  isRedisEnabled,
};
