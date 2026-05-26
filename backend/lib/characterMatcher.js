function characterMatchesNeed(character, need = '') {
  const haystack = [
    character.name,
    character.role,
    character.identity,
    character.faction,
    character.skills,
    character.core_desire,
    character.goal,
    character.motivation,
    JSON.stringify(character.reuse_plan || [])
  ].join('\n');
  return String(need).split(/[，,、\s]+/).filter(Boolean).some(token => haystack.includes(token));
}

function matchCharacterForEvent(eventNeed, characters = []) {
  const matched = characters.filter(character => characterMatchesNeed(character, eventNeed));
  return {
    matched_existing: matched,
    recommended: matched[0] || null,
    create_new_allowed: matched.length === 0,
    new_character_requirements: {
      future_uses_min: 2,
      must_have_reuse_plan: true,
      default_action: '如果无法提供至少 2 个未来复用点，降级为无名功能人物。'
    }
  };
}

module.exports = { matchCharacterForEvent };
