function requireAccessToken(req, res, next) {
  const expected = process.env.APP_ACCESS_TOKEN;
  if (!expected || expected === 'change-me') return next();
  const provided = req.headers['x-novel-token'];
  if (provided === expected) return next();
  return res.status(401).json({ success: false, error: '访问口令错误' });
}

module.exports = { requireAccessToken };
