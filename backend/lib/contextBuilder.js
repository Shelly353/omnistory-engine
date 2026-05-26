async function buildChapterContext({ project, contract, state }) {
  return {
    project: {
      title: project.title,
      target_words: project.target_words,
      style_profile: project.style_profile
    },
    contract,
    state,
    writing_rules: [
      '正文只负责表达章节契约，不能擅自创造重大事实。',
      '只允许使用 allowed_characters 中的人物；无名路人不能推动剧情结果。',
      '角色变化必须来自本章事件，并能写入状态迁移。',
      '风格只改变表达，不改变事实、身份、秘密、事件结果。',
      '输出纯正文，不输出解释。'
    ]
  };
}

module.exports = { buildChapterContext };
