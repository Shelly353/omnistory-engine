function demoBible(project = {}) {
  const title = project.title || '未命名长篇';
  return {
    genre: project.genre || '推理侦探',
    theme: '真相、代价与自我和解',
    worldview: '一个权力结构复杂的边境城市，专业机构、地方势力与旧案阴影彼此纠缠。',
    protagonist_arc: {
      want: '查清概念故事中的核心谜团',
      need: '学会把个人执念转化为可承担后果的选择',
      lie: '只要掌握真相，就能控制一切',
      fear: '再次因为判断错误失去重要的人',
      start: '谨慎、孤立、依赖个人判断',
      end: '愿意承担代价，并建立可信任的同盟',
      turning_points: ['第一转折被迫入局', '中点误判代价', '至暗时刻信念崩塌', '终局主动承担']
    },
    antagonist_arc: {
      want: '掩盖核心秘密并维持既得秩序',
      need: '面对自己制造的后果',
      lie: '只要控制信息，真相就不会伤害自己',
      fear: '真相公开导致身份和权力崩塌',
      start: '隐藏在秩序背后',
      end: '被主角用合法证据链和情感选择逼到公开处',
      turning_points: ['中点反制', '反派逼近升级', '终局失败闭环']
    },
    main_characters: [
      {
        name: '主角',
        role: '主角',
        identity: '由用户概念决定的核心行动者',
        personality: '谨慎、敏锐、控制欲强',
        core_desire: '追索真相并证明自己的判断',
        goal: '破解核心谜团',
        motivation: '旧伤、责任与未完成的承诺',
        flaw: '不信任他人，容易独自承担',
        fear: '重要线索或重要人物再次失去',
        skills: '观察、推理、专业判断',
        limits: '不能无证据跳结论，不能越过已建立的世界规则',
        voice_rules: '措辞克制，先观察后判断',
        reuse_plan: ['贯穿主线', '每个关键事件都测试其缺陷']
      },
      {
        name: '核心阻力',
        role: '反派/核心阻力',
        identity: '隐藏真相的权力或人物',
        personality: '冷静、善于操控信息',
        core_desire: '维持旧秩序',
        goal: '阻止主角接近真相',
        motivation: '保护自身利益或扭曲的信念',
        flaw: '相信信息控制可以解决一切',
        fear: '真相公开',
        skills: '资源调度、误导、施压',
        limits: '不能全知全能，反制必须有信息来源和成本',
        voice_rules: '少说结论，多用压力和暗示',
        reuse_plan: ['中点反制', '至暗时刻压迫', '终局闭环']
      }
    ],
    core_secrets: [
      {
        title: '核心真相',
        audience_view: '读者前期只知道旧案或谜团存在明显异常。',
        god_view: project.concept || '核心真相由概念故事决定。',
        status: 'hidden',
        reveal_chapter: 42
      }
    ],
    rules: [
      '正文不得擅自改变角色身份、核心秘密、世界规则和事件结果。',
      '角色变化必须由事件触发，并写入状态迁移。',
      '未揭露秘密只能作为后台校验，不能写成公开旁白。'
    ],
    style: project.style_profile || '默认商业网文'
  };
}

function demoBeats() {
  return [
    { beat: 'opening', title: '旧秩序裂缝', summary: '主角在稳定但压抑的状态中发现异常线索。', function: '打破旧秩序' },
    { beat: 'first_turn', title: '不可逆入局', summary: '主角做出无法撤回的选择，正式进入冲突场。', function: '锁定主线目标' },
    { beat: 'midpoint_false_victory', title: '虚假胜利', summary: '主角看似获得关键证据，实际踩入反派布置的误导。', function: '改变局势并埋下代价' },
    { beat: 'opposition_rises', title: '反派逼近', summary: '核心阻力聪明反制，主角旧方法失效。', function: '压迫升级' },
    { beat: 'dark_night', title: '至暗时刻', summary: '主角因自身缺陷造成严重后果，信念被击穿。', function: '暴露内在缺陷' },
    { beat: 'finale', title: '终局选择', summary: '主角以新的选择面对真相和阻力，完成弧线。', function: '完成外部闭环和内在变化' }
  ];
}

function demoEvents(characters = []) {
  const protagonist = characters[0]?.id || null;
  return demoBeats().map((beat, index) => ({
    event_order: index + 1,
    title: beat.title,
    summary: beat.summary,
    trigger: index === 0 ? '概念故事中的异常事件浮出水面' : '前一事件留下的压力继续升级',
    actor_character_id: protagonist,
    conflict_target: index < 5 ? '核心阻力' : '最终真相',
    result: beat.function,
    state_changes: [
      {
        target: characters[0]?.name || '主角',
        change: `${beat.title}后，目标和认知发生阶段性变化`,
        source_event: beat.title
      }
    ],
    related_character_ids: characters.map(char => char.id).filter(Boolean),
    status: 'planned'
  }));
}

function demoChapterContracts(events = [], characters = [], count = 10) {
  return Array.from({ length: count }, (_, index) => {
    const event = events[index % Math.max(events.length, 1)] || {};
    return {
      chapter_number: index + 1,
      title: `第${index + 1}章：${event.title || '线索推进'}`,
      summary: event.summary || '围绕主线线索推进冲突，并留下下一章钩子。',
      required_events: event.id ? [event.id] : [],
      allowed_characters: characters.map(char => char.id).filter(Boolean),
      forbidden_facts: ['不得提前揭露 hidden 秘密的 god_view', '不得新增改变主线的具名角色'],
      secret_permissions: { hidden_mode: 'audience_view_only' },
      expected_start_state: { chapter: index + 1, note: '由上一章章后状态编译' },
      expected_end_state: { chapter: index + 1, required_change: event.result || '主线状态必须推进' },
      style_requirements: '遵循项目文风；风格只改变表达，不改变事实。',
      status: 'ready_to_draft'
    };
  });
}

module.exports = { demoBible, demoBeats, demoEvents, demoChapterContracts };
