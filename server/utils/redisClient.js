// utils/redisClient.js
// Optional Redis client for shared state/token storage across replicas (e.g. Railway)

const { createClient } = require("redis");

let client = null;
let connectPromise = null;

function authLog(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, flow_phase: "redis", ...data }));
}

/**
 * Get Redis client; connects lazily when REDIS_URL is set.
 * @returns {Promise<import("redis").RedisClient|null>} Redis client or null if REDIS_URL not set
 */
async function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (client) return client;
  if (connectPromise) return connectPromise;

  authLog("INFO", "[AUTH_FLOW] Redis connection starting", {
    has_redis_url: true,
    url_preview: url.replace(/:[^:@]+@/, ":****@").substring(0, 50) + "...",
  });

  connectPromise = (async () => {
    const c = createClient({ url });
    c.on("error", (err) => {
      authLog("ERROR", "[AUTH_FLOW] Redis client error", {
        error: err.message,
        code: err.code,
      });
    });
    try {
      await c.connect();
      authLog("INFO", "[AUTH_FLOW] Redis connected successfully", {});
      client = c;
      return client;
    } catch (err) {
      authLog("ERROR", "[AUTH_FLOW] Redis connection failed", {
        error: err.message,
        code: err.code,
      });
      connectPromise = null;
      throw err;
    }
  })();

  return connectPromise;
}

function isRedisEnabled() {
  return !!process.env.REDIS_URL;
}

module.exports = {
  getRedisClient,
  isRedisEnabled,
};
