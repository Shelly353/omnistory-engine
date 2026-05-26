const { extractJson } = require('./jsonRepair');

async function callAi({ system, user, json = false, fallback }) {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'deepseek-chat';

  if (!apiKey || !baseUrl) return { model: 'local-fallback', content: fallback, parsed: fallback };

  const response = await fetch(`${baseUrl}/chat/completions`, {
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
