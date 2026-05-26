const WINDOW_MS = 60 * 1000;
const MAX_AI_REQUESTS_PER_WINDOW = Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20);
const requestBuckets = new Map();

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) return forwardedFor.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function aiRateLimit(req, res, next) {
  const now = Date.now();
  const ip = getClientIp(req);
  const bucket = requestBuckets.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  bucket.count += 1;
  requestBuckets.set(ip, bucket);
  if (bucket.count > MAX_AI_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ success: false, error: 'AI 请求过于频繁，请稍后再试。' });
  }
  next();
}

function requireAccessToken(req, res, next) {
  const expected = process.env.OMNISTORY_ACCESS_TOKEN || process.env.APP_ACCESS_TOKEN;
  if (!expected || expected === 'change-me') return next();
  const provided = req.headers['x-omnistory-token'] || req.headers['x-novel-token'];
  if (provided === expected) return next();
  return res.status(401).json({ success: false, error: '访问口令错误' });
}

function warnIfAccessTokenMissing() {
  if (!process.env.OMNISTORY_ACCESS_TOKEN && !process.env.APP_ACCESS_TOKEN) {
    console.warn('OMNISTORY_ACCESS_TOKEN 未配置：建议在 Render 环境变量中设置访问口令。');
  }
}

module.exports = { aiRateLimit, requireAccessToken, warnIfAccessTokenMissing };
