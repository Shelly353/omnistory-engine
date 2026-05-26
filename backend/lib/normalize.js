function cleanText(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function cleanArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBiblePayload(payload = {}, fallback = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const normalized = {
    ...fallback,
    ...source,
    main_characters: cleanArray(source.main_characters || source.characters || fallback.main_characters),
    core_secrets: cleanArray(source.core_secrets || source.secrets || fallback.core_secrets),
    rules: cleanArray(source.rules || fallback.rules)
  };

  normalized.main_characters = normalized.main_characters.map((char = {}, index) => ({
    ...char,
    name: cleanText(char.name, index === 0 ? '主角' : `角色${index + 1}`),
    role: cleanText(char.role, index === 0 ? '主角' : '配角'),
    identity: cleanText(char.identity || char.profession || char.description, cleanText(char.role, '未定身份')),
    reuse_plan: cleanArray(char.reuse_plan)
  }));

  normalized.core_secrets = normalized.core_secrets.map((secret = {}, index) => ({
    ...secret,
    title: cleanText(secret.title || secret.name, `未命名秘密${index + 1}`),
    audience_view: cleanText(secret.audience_view || secret.public_view, '读者暂时只知道这件事存在异常。'),
    god_view: cleanText(secret.god_view || secret.truth || secret.description, '真实情况待用户确认。'),
    status: cleanText(secret.status, 'hidden')
  }));

  return normalized;
}

module.exports = { cleanText, cleanArray, normalizeBiblePayload };
