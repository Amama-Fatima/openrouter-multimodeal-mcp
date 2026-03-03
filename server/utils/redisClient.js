// utils/redisClient.js
// Optional Redis client for shared state/token storage across replicas (e.g. Railway)

const { createClient } = require("redis");

let client = null;
let connectPromise = null;

/**
 * Get Redis client; connects lazily when REDIS_URL is set.
 * @returns {Promise<import("redis").RedisClient|null>} Redis client or null if REDIS_URL not set
 */
async function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (client) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const c = createClient({ url });
    c.on("error", (err) => console.error("Redis client error:", err.message));
    await c.connect();
    client = c;
    return client;
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
