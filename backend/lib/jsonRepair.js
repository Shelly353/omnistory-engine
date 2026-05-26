function extractJson(text) {
  if (!text) return null;
  const clean = String(text).trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(clean.slice(first, last + 1));
      } catch (innerErr) {}
    }
    return null;
  }
}

module.exports = { extractJson };
