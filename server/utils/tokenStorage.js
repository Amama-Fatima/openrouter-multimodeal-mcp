// utils/tokenStorage.js
// In-memory token storage, or Redis when REDIS_URL is set (for multi-replica deployments)

const { getRedisClient, isRedisEnabled } = require("./redisClient");

const CODE_TTL_SEC = 600;
const ACCESS_TOKEN_TTL_SEC = 3600;
const REFRESH_TOKEN_TTL_SEC = 86400 * 30;
const KEY_CODE = "oauth:code:";
const KEY_TOKEN = "oauth:token:";
const KEY_REFRESH = "oauth:refresh:";
const KEY_USER_TOKENS = "oauth:user_tokens:";

const tokenStore = new Map();
const refreshTokenStore = new Map();
const userTokenMap = new Map();
const authorizationCodes = new Map();

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

function serializeTokenData(data) {
  const o = { ...data };
  if (o.expiresAt) o.expiresAt = o.expiresAt instanceof Date ? o.expiresAt.toISOString() : o.expiresAt;
  if (o.createdAt) o.createdAt = o.createdAt instanceof Date ? o.createdAt.toISOString() : o.createdAt;
  return JSON.stringify(o);
}

function deserializeTokenData(json) {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (o.expiresAt) o.expiresAt = new Date(o.expiresAt);
    if (o.createdAt) o.createdAt = new Date(o.createdAt);
    return o;
  } catch {
    return null;
  }
}

// ---------- Redis implementations ----------
async function redisStoreAccessToken(accessToken, refreshToken, apiKey, userId, clientId, scopes, expiresAt) {
  const redis = await getRedisClient();
  if (!redis) return;
  const now = new Date();
  const data = { apiKey, userId, clientId, scopes, refreshToken, expiresAt, createdAt: now };
  await redis.set(KEY_TOKEN + accessToken, serializeTokenData(data), { EX: ACCESS_TOKEN_TTL_SEC });
  if (refreshToken) {
    await redis.set(
      KEY_REFRESH + refreshToken,
      JSON.stringify({ userId, clientId, scopes, accessToken, createdAt: now }),
      { EX: REFRESH_TOKEN_TTL_SEC }
    );
  }
  await redis.sAdd(KEY_USER_TOKENS + userId, accessToken);
  log("INFO", "[TOKEN_STORAGE] Access token stored (Redis)", { user_id: userId, client_id: clientId });
}

async function redisStoreAuthorizationCode(code, userId, apiKey, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, expiresIn) {
  const redis = await getRedisClient();
  if (!redis) return;
  const expiresAt = Date.now() + expiresIn * 1000;
  const data = { userId, apiKey, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, expiresAt, createdAt: Date.now() };
  await redis.set(KEY_CODE + code, JSON.stringify(data), { EX: expiresIn });
  log("INFO", "[TOKEN_STORAGE] Authorization code stored (Redis)", { code: code.substring(0, 10) + "...", user_id: userId });
}

async function redisConsumeAuthorizationCode(code, codeVerifier) {
  const redis = await getRedisClient();
  if (!redis) return null;
  const raw = await redis.get(KEY_CODE + code);
  if (!raw) return null;
  let codeData;
  try {
    codeData = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Date.now() > codeData.expiresAt) {
    await redis.del(KEY_CODE + code);
    return null;
  }
  if (codeData.codeChallengeMethod === "S256") {
    const crypto = require("crypto");
    const computed = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    if (computed !== codeData.codeChallenge) return null;
  }
  await redis.del(KEY_CODE + code);
  log("INFO", "[TOKEN_STORAGE] Authorization code consumed (Redis)", { code: code.substring(0, 10) + "..." });
  return codeData;
}

async function redisGetAccessToken(token) {
  const redis = await getRedisClient();
  if (!redis) return null;
  const raw = await redis.get(KEY_TOKEN + token);
  const tokenData = deserializeTokenData(raw);
  if (!tokenData) return null;
  if (tokenData.expiresAt && new Date() > tokenData.expiresAt) {
    await redisDeleteToken(token);
    return null;
  }
  return tokenData;
}

async function redisGetRefreshToken(refreshToken) {
  const redis = await getRedisClient();
  if (!redis) return null;
  const raw = await redis.get(KEY_REFRESH + refreshToken);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o.createdAt) o.createdAt = new Date(o.createdAt);
    return o;
  } catch {
    return null;
  }
}

async function redisRevokeRefreshToken(refreshToken) {
  const refreshData = await redisGetRefreshToken(refreshToken);
  if (refreshData) {
    await redisDeleteToken(refreshData.accessToken);
    const redis = await getRedisClient();
    if (redis) await redis.del(KEY_REFRESH + refreshToken);
  }
}

async function redisDeleteToken(token) {
  const redis = await getRedisClient();
  if (!redis) return;
  const raw = await redis.get(KEY_TOKEN + token);
  const tokenData = deserializeTokenData(raw);
  if (tokenData) {
    await redis.del(KEY_TOKEN + token);
    await redis.sRem(KEY_USER_TOKENS + tokenData.userId, token);
  }
}

// ---------- Public API (always return Promises when Redis enabled) ----------
function storeAccessToken(accessToken, refreshToken, apiKey, userId, clientId, scopes = [], expiresAt = null) {
  const now = new Date();
  if (isRedisEnabled()) {
    return redisStoreAccessToken(accessToken, refreshToken, apiKey, userId, clientId, scopes, expiresAt);
  }
  tokenStore.set(accessToken, { apiKey, userId, clientId, scopes, refreshToken, expiresAt, createdAt: now });
  if (refreshToken) {
    refreshTokenStore.set(refreshToken, { userId, clientId, scopes, accessToken, createdAt: now });
  }
  if (!userTokenMap.has(userId)) userTokenMap.set(userId, new Set());
  userTokenMap.get(userId).add(accessToken);
  log("INFO", "[TOKEN_STORAGE] Access token stored", { user_id: userId, client_id: clientId });
  return Promise.resolve();
}

function storeAuthorizationCode(code, userId, apiKey, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, expiresIn = 600) {
  if (isRedisEnabled()) {
    return redisStoreAuthorizationCode(code, userId, apiKey, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, expiresIn);
  }
  const expiresAt = Date.now() + expiresIn * 1000;
  authorizationCodes.set(code, {
    userId, apiKey, clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, expiresAt, createdAt: Date.now(),
  });
  log("INFO", "[TOKEN_STORAGE] Authorization code stored", { code: code.substring(0, 10) + "...", user_id: userId });
  setTimeout(() => {
    authorizationCodes.delete(code);
    log("INFO", "[TOKEN_STORAGE] Authorization code expired and cleaned up", { code: code.substring(0, 10) + "..." });
  }, expiresIn * 1000);
  return Promise.resolve();
}

function consumeAuthorizationCode(code, codeVerifier) {
  if (isRedisEnabled()) {
    return redisConsumeAuthorizationCode(code, codeVerifier);
  }
  const codeData = authorizationCodes.get(code);
  if (!codeData) return Promise.resolve(null);
  if (Date.now() > codeData.expiresAt) {
    authorizationCodes.delete(code);
    return Promise.resolve(null);
  }
  if (codeData.codeChallengeMethod === "S256") {
    const crypto = require("crypto");
    const computed = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    if (computed !== codeData.codeChallenge) return Promise.resolve(null);
  }
  authorizationCodes.delete(code);
  log("INFO", "[TOKEN_STORAGE] Authorization code consumed", { code: code.substring(0, 10) + "..." });
  return Promise.resolve(codeData);
}

function getAccessToken(token) {
  if (isRedisEnabled()) {
    return redisGetAccessToken(token);
  }
  const tokenData = tokenStore.get(token);
  if (!tokenData) return Promise.resolve(null);
  if (tokenData.expiresAt && new Date() > tokenData.expiresAt) {
    deleteToken(token);
    return Promise.resolve(null);
  }
  return Promise.resolve(tokenData);
}

function getRefreshToken(refreshToken) {
  if (isRedisEnabled()) {
    return redisGetRefreshToken(refreshToken);
  }
  return Promise.resolve(refreshTokenStore.get(refreshToken) || null);
}

function revokeRefreshToken(refreshToken) {
  if (isRedisEnabled()) {
    return redisRevokeRefreshToken(refreshToken);
  }
  const refreshData = refreshTokenStore.get(refreshToken);
  if (refreshData) {
    deleteToken(refreshData.accessToken);
    refreshTokenStore.delete(refreshToken);
  }
  return Promise.resolve();
}

function deleteToken(token) {
  if (isRedisEnabled()) {
    return redisDeleteToken(token);
  }
  const tokenData = tokenStore.get(token);
  if (tokenData) {
    tokenStore.delete(token);
    const userTokens = userTokenMap.get(tokenData.userId);
    if (userTokens) {
      userTokens.delete(token);
      if (userTokens.size === 0) userTokenMap.delete(tokenData.userId);
    }
  }
  return Promise.resolve();
}

function deleteUserTokens(userId) {
  if (isRedisEnabled()) {
    return Promise.resolve(); // Optional: implement Redis SREM all for user
  }
  const tokens = userTokenMap.get(userId);
  if (tokens) {
    tokens.forEach((t) => tokenStore.delete(t));
    userTokenMap.delete(userId);
  }
  return Promise.resolve();
}

function cleanupExpiredTokens() {
  if (isRedisEnabled()) return Promise.resolve();
  const now = new Date();
  const expired = [];
  tokenStore.forEach((data, token) => {
    if (data.expiresAt && now > data.expiresAt) expired.push(token);
  });
  expired.forEach((t) => deleteToken(t));
  if (expired.length > 0) console.log(`Cleaned up ${expired.length} expired tokens`);
  return Promise.resolve();
}

setInterval(() => cleanupExpiredTokens(), 5 * 60 * 1000);

function getStats() {
  if (isRedisEnabled()) return Promise.resolve({ totalTokens: 0, uniqueUsers: 0 });
  return Promise.resolve({ totalTokens: tokenStore.size, uniqueUsers: userTokenMap.size });
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
};
