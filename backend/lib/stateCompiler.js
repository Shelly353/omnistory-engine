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
  const lastSceneTransition = priorTransitions
    .filter(item => item.target_type === 'scene_continuity')
    .slice(-1)[0] || null;
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
    current_scene_state: lastSceneTransition ? {
      chapter_number: lastSceneTransition.chapter_number,
      target: lastSceneTransition.target_id,
      state: lastSceneTransition.after_state,
      evidence: lastSceneTransition.evidence
    } : {
      state: '暂无上一章场景状态。新章必须建立地点、交通方式、姿态和动作。'
    },
    recent_context,
    forbidden_content: [
      '不得把 hidden 或 partial 秘密的 god_view 写成公开事实。',
      '不得新增改变主线因果的具名角色。',
      '不得改写 Canon 硬事实。',
      '不得无过渡改变场景状态：上一章开车，下一章不能突然变成坐车；必须写出停车、换座、下车、上车或视角切换原因。'
    ]
  };
}

module.exports = { compileChapterStartState };
