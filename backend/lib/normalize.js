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

  normalized.pacing_map = source.pacing_map || fallback.pacing_map || {
    act_1: '建立旧秩序、诱因和不可逆选择。',
    act_2a: '主角用旧方法推进，得到带代价的小胜。',
    midpoint: '中点改变信息格局，虚假胜利或虚假失败。',
    act_2b: '反派逼近，旧方法失效。',
    dark_night: '外部失败击穿内部缺陷。',
    act_3: '主角用新选择完成终局。'
  };

  normalized.protagonist_arc = normalized.protagonist_arc || fallback.protagonist_arc || {};
  if (!Array.isArray(normalized.protagonist_arc.growth_ladder)) {
    normalized.protagonist_arc.growth_ladder = fallback.protagonist_arc?.growth_ladder || [
      { stage: '旧我', function: '暴露缺陷' },
      { stage: '被迫选择', function: '越过安全边界' },
      { stage: '虚假进步', function: '带代价的小胜' },
      { stage: '崩塌', function: '旧方法失败' },
      { stage: '新选择', function: '完成终局弧线' }
    ];
  }

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
