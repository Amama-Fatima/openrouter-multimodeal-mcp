// utils/stateStore.js
// OAuth state storage - in-memory per process, or Redis when REDIS_URL is set.
// Redis is required when running multiple replicas (e.g. Railway) so the callback
// can find the state regardless of which replica handles the request.

const { getRedisClient, isRedisEnabled } = require("./redisClient");

const STATE_TTL_SEC = 600; // 10 minutes
const KEY_PREFIX = "oauth:state:";

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

/**
 * Store OAuth state (used when redirecting to OpenRouter).
 * @param {string} state - State parameter
 * @param {Object} data - { codeVerifier, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, state }
 * @param {number} [ttlSec] - TTL in seconds (default 600)
 * @returns {Promise<void>}
 */
async function setState(state, data, ttlSec = STATE_TTL_SEC) {
  const payload = { ...data, timestamp: Date.now() };
  if (isRedisEnabled()) {
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(KEY_PREFIX + state, JSON.stringify(payload), { EX: ttlSec });
      return;
    }
  }
  memoryStore.set(state, payload);
}

/**
 * Get OAuth state (used when OpenRouter redirects back).
 * @param {string} state - State parameter
 * @returns {Promise<Object|null>} Stored data or null
 */
async function getState(state) {
  if (isRedisEnabled()) {
    const redis = await getRedisClient();
    if (redis) {
      const raw = await redis.get(KEY_PREFIX + state);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
  }
  const entry = memoryStore.get(state);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > MEMORY_TTL_MS) {
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
  if (isRedisEnabled()) {
    const redis = await getRedisClient();
    if (redis) await redis.del(KEY_PREFIX + state);
    return;
  }
  memoryStore.delete(state);
}

module.exports = {
  setState,
  getState,
  deleteState,
  isRedisEnabled,
};
