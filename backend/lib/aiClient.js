const { extractJson } = require('./jsonRepair');

async function callAi({ system, user, json = false, fallback }) {
  const apiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

  if (!apiKey || !baseUrl) return { model: 'local-fallback', content: fallback, parsed: fallback };

  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: json ? 0.2 : 0.65,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    })
  });

  if (!response.ok) throw new Error(`AI request failed: HTTP ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return { model, content, parsed: json ? extractJson(content) : null };
}

module.exports = { callAi };
