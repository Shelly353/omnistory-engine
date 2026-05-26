const { listByProject } = require('./repositories');

async function compileChapterStartState(projectId, chapterNumber) {
  const [characters, canon, secrets, hooks, transitions, recentChapters] = await Promise.all([
    listByProject('characters', projectId),
    listByProject('canon_facts', projectId),
    listByProject('secrets', projectId),
    listByProject('foreshadowing_hooks', projectId),
    listByProject('state_transitions', projectId, 'chapter_number'),
    listByProject('chapters', projectId, 'chapter_number')
  ]);

  const priorTransitions = transitions.filter(item => Number(item.chapter_number) < Number(chapterNumber) && item.approved);
  const recent_context = recentChapters
    .filter(item => Number(item.chapter_number) < Number(chapterNumber))
    .slice(-3)
    .map(item => ({ chapter_number: item.chapter_number, title: item.title, summary: item.summary || item.outline || '' }));

  return {
    chapter_number: Number(chapterNumber),
    active_characters: characters,
    known_facts: canon.filter(fact => fact.status === 'active'),
    hidden_facts: secrets.filter(secret => secret.status !== 'revealed'),
    open_hooks: hooks.filter(hook => hook.status !== 'paid_off'),
    prior_state_changes: priorTransitions,
    recent_context,
    forbidden_content: [
      '不得把 hidden 或 partial 秘密的 god_view 写成公开事实。',
      '不得新增改变主线因果的具名角色。',
      '不得改写 Canon 硬事实。'
    ]
  };
}

module.exports = { compileChapterStartState };
