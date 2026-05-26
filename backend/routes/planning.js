const express = require('express');
const router = express.Router({ mergeParams: true });
const { insert, insertMany } = require('../lib/db');
const {
  getProject,
  getEvent,
  getCharacter,
  listByProject,
  upsertChapter,
  upsertContract,
  patchEvent,
  deleteEvent,
  patchCharacter,
  deleteCharacter
} = require('../lib/repositories');
const { callAi } = require('../lib/aiClient');
const { demoBeats, demoEvents, demoChapterContracts } = require('../lib/fallbacks');
const { matchCharacterForEvent } = require('../lib/characterMatcher');
const { cleanText } = require('../lib/normalize');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }
  return [];
}

function normalizeEventPayload(body, projectId, fallbackOrder = 1) {
  return {
    project_id: projectId,
    event_order: Number(body.event_order || fallbackOrder),
    title: cleanText(body.title, `事件${fallbackOrder}`),
    summary: body.summary || '',
    trigger: body.trigger || '',
    actor_character_id: body.actor_character_id || null,
    conflict_target: body.conflict_target || '',
    result: body.result || '',
    state_changes: asArray(body.state_changes),
    related_character_ids: asArray(body.related_character_ids),
    related_secret_ids: asArray(body.related_secret_ids),
    related_hook_ids: asArray(body.related_hook_ids),
    status: body.status || 'planned'
  };
}

function normalizeCharacterPayload(body, projectId, fallbackName = '新人物') {
  return {
    project_id: projectId,
    name: cleanText(body.name, fallbackName),
    role: body.role || '',
    faction: body.faction || '',
    identity: body.identity || '',
    personality: body.personality || '',
    core_desire: body.core_desire || '',
    goal: body.goal || '',
    motivation: body.motivation || '',
    flaw: body.flaw || '',
    fear: body.fear || '',
    skills: body.skills || '',
    limits: body.limits || '',
    voice_rules: body.voice_rules || '',
    reuse_plan: asArray(body.reuse_plan),
    status: body.status || 'active'
  };
}

function characterNeedsCompletion(character) {
  return ['identity', 'personality', 'core_desire', 'goal', 'motivation', 'flaw', 'fear', 'skills', 'limits', 'voice_rules']
    .some(field => !String(character[field] || '').trim()) || !asArray(character.reuse_plan).length;
}

function fallbackCompletedCharacter(character, project) {
  const role = character.role || '功能人物';
  return {
    id: character.id,
    name: character.name,
    role,
    faction: character.faction || '未定阵营',
    identity: character.identity || `${project.title || '本书'}中的${role}，其身份必须能影响至少一个主线事件。`,
    personality: character.personality || 'MBTI推断：INTJ。偏向结构化判断，压力下会收紧控制，错误时倾向独自承担。',
    core_desire: character.core_desire || '获得能证明自身选择正确的结果',
    goal: character.goal || '在当前主线阶段完成一个清晰、可行动、可失败的外部目标',
    motivation: character.motivation || '由旧伤、责任、利益或未完成承诺驱动，动机必须能解释其关键选择',
    flaw: character.flaw || '过度依赖自己的主要认知方式，导致关系或判断偏差',
    fear: character.fear || '失控、失败、被看穿真实需求或再次失去重要事物',
    skills: character.skills || '拥有与角色功能匹配的专业能力，但能力使用必须有成本',
    limits: character.limits || '不能全知全能；不能无成本解决冲突；不能突破世界规则和 Canon',
    voice_rules: character.voice_rules || '语言节奏、用词和回避点要体现其身份、MBTI压力反应和关系位置',
    reuse_plan: asArray(character.reuse_plan).length ? asArray(character.reuse_plan) : ['首次登场承担明确事件功能', '在后续桥段制造选择压力', '在六事件转折处体现人物变化'],
    status: character.status || 'active'
  };
}

function buildBridgeFallbackEvents(beats, characters) {
  const orderedBeats = beats.filter(event => event.status === 'beat').sort((a, b) => Number(a.event_order || 0) - Number(b.event_order || 0));
  const actor = characters[0] || null;
  const rows = [];
  for (let i = 0; i < orderedBeats.length - 1; i += 1) {
    const from = orderedBeats[i];
    const to = orderedBeats[i + 1];
    for (let step = 1; step <= 3; step += 1) {
      rows.push({
        event_order: Number(from.event_order) + step / 10,
        title: `${from.title} 到 ${to.title} 的过渡${step}`,
        summary: `承接“${from.title}”的结果，逐步制造人物选择压力，并把剧情推向“${to.title}”。`,
        trigger: step === 1 ? from.result || from.summary : '上一小事件留下的新压力继续升级',
        actor_name: actor?.name || '',
        actor_character_id: actor?.id || null,
        conflict_target: to.conflict_target || to.title,
        result: step === 3 ? `形成进入“${to.title}”的直接原因` : '人物关系、线索或局势发生阶段性变化',
        pressure: Math.min(10, 2 + i + step),
        arc_stage: to.conflict_target || '',
        scene_continuity: '明确本小事件结束时地点、交通、姿态和正在进行的动作。',
        state_changes: [
          {
            target_type: 'character',
            target: actor?.name || '主角',
            before: `处于“${from.title}”后的状态`,
            after: `更接近“${to.title}”所需的人物选择`,
            evidence: `桥段${step}`
          }
        ],
        status: 'bridge',
        bridge_from_event_id: from.id,
        bridge_to_event_id: to.id
      });
    }
  }
  return rows;
}

function eventBelongsToGap(event, fromBeat, toBeat) {
  return Number(event.event_order) > Number(fromBeat.event_order)
    && Number(event.event_order) < Number(toBeat.event_order);
}

function dedupeIncomingBridgeEvents(rows, existingBridgeEvents) {
  const seen = new Set(existingBridgeEvents.map(event => `${Number(event.event_order).toFixed(3)}:${event.title}`));
  return rows.filter(row => {
    const key = `${Number(row.event_order).toFixed(3)}:${row.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function keepRowsForIncompleteGaps(rows, beats, existingBridgeEvents, minPerGap = 3) {
  return rows.filter(row => {
    const gapIndex = beats.findIndex((beat, index) => eventBelongsToGap(row, beat, beats[index + 1] || {}));
    if (gapIndex < 0) return true;
    const fromBeat = beats[gapIndex];
    const toBeat = beats[gapIndex + 1];
    const existingCount = existingBridgeEvents.filter(event => eventBelongsToGap(event, fromBeat, toBeat)).length;
    return existingCount < minPerGap;
  });
}

function completeBridgeGaps(rows, beats, characters, existingBridgeEvents, minPerGap = 3) {
  const fallbackRows = buildBridgeFallbackEvents(beats, characters);
  const completed = [...rows];
  for (let index = 0; index < beats.length - 1; index += 1) {
    const fromBeat = beats[index];
    const toBeat = beats[index + 1];
    const current = [
      ...existingBridgeEvents.filter(event => eventBelongsToGap(event, fromBeat, toBeat)),
      ...completed.filter(event => eventBelongsToGap(event, fromBeat, toBeat))
    ];
    const usedOrders = new Set(current.map(event => Number(event.event_order).toFixed(3)));
    const candidates = fallbackRows.filter(event => eventBelongsToGap(event, fromBeat, toBeat));
    for (const candidate of candidates) {
      if (current.length >= minPerGap) break;
      const orderKey = Number(candidate.event_order).toFixed(3);
      if (usedOrders.has(orderKey)) continue;
      completed.push(candidate);
      current.push(candidate);
      usedOrders.add(orderKey);
    }
  }
  return completed;
}

function chapterSourceLimit(eventCount) {
  if (!eventCount) return 10;
  return Math.min(Math.max(eventCount * 3, eventCount, 10), 120);
}

async function assertProjectEvent(projectId, eventId) {
  const event = await getEvent(eventId);
  if (!event || event.project_id !== projectId) {
    const err = new Error('事件不存在或不属于当前项目');
    err.status = 404;
    throw err;
  }
  return event;
}

async function assertProjectCharacter(projectId, characterId) {
  const character = await getCharacter(characterId);
  if (!character || character.project_id !== projectId) {
    const err = new Error('人物不存在或不属于当前项目');
    err.status = 404;
    throw err;
  }
  return character;
}

router.get('/characters', async (req, res, next) => {
  try {
    await getProject(req.params.projectId);
    const characters = await listByProject('characters', req.params.projectId);
    res.json({ success: true, characters });
  } catch (err) {
    next(err);
  }
});

router.post('/characters', async (req, res, next) => {
  try {
    await getProject(req.params.projectId);
    const character = await insert('characters', normalizeCharacterPayload(req.body, req.params.projectId, '新人物'));
    res.json({ success: true, character });
  } catch (err) {
    next(err);
  }
});

router.put('/characters/:characterId', async (req, res, next) => {
  try {
    await assertProjectCharacter(req.params.projectId, req.params.characterId);
    const patch = normalizeCharacterPayload(req.body, req.params.projectId);
    delete patch.project_id;
    const character = await patchCharacter(req.params.characterId, patch);
    res.json({ success: true, character });
  } catch (err) {
    next(err);
  }
});

router.delete('/characters/:characterId', async (req, res, next) => {
  try {
    await assertProjectCharacter(req.params.projectId, req.params.characterId);
    await deleteCharacter(req.params.characterId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/characters/enrich-mbti', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const characters = await listByProject('characters', project.id);
    const fallback = { characters: characters.map(character => fallbackCompletedCharacter(character, project)) };
    const ai = await callAi({
      json: true,
      fallback,
      system: '你是人物心理建模编辑。补齐人物卡所有关键空字段；MBTI 只能作为推理工具，不要把人物写成标签。每个人物必须有外部目标、内在欲望、动机、缺陷、恐惧、能力、限制、声音规则和至少三个复用点。只输出 JSON。',
      user: `项目概念：${project.concept}
现有人物：
${JSON.stringify(characters)}

只补齐或强化空白/薄弱字段，不要抹掉用户已经写得具体的设定。请输出 JSON：{"characters":[{"id":"","name":"","role":"","faction":"","identity":"","personality":"包含MBTI推断和压力反应","core_desire":"","goal":"","motivation":"","flaw":"","fear":"","skills":"","limits":"","voice_rules":"","reuse_plan":["至少三个复用点"],"status":"active"}]}`
    });
    const updates = [];
    for (const item of ai.parsed?.characters || fallback.characters) {
      const existing = characters.find(character => character.id === item.id || character.name === item.name);
      if (!existing) continue;
      const completed = fallbackCompletedCharacter({ ...existing, ...item }, project);
      const patch = {};
      for (const field of ['role', 'faction', 'identity', 'personality', 'core_desire', 'goal', 'motivation', 'flaw', 'fear', 'skills', 'limits', 'voice_rules', 'status']) {
        patch[field] = String(existing[field] || '').trim() ? existing[field] : completed[field];
      }
      patch.reuse_plan = asArray(existing.reuse_plan).length >= 3 ? existing.reuse_plan : completed.reuse_plan;
      updates.push(await patchCharacter(existing.id, patch));
    }
    res.json({ success: true, characters: updates });
  } catch (err) {
    next(err);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    await getProject(req.params.projectId);
    const events = await listByProject('story_events', req.params.projectId, 'event_order');
    res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
});

router.post('/events', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const existing = await listByProject('story_events', project.id, 'event_order');
    const maxOrder = existing.reduce((max, event) => Math.max(max, Number(event.event_order || 0)), 0);
    const event = await insert('story_events', normalizeEventPayload(req.body, project.id, maxOrder + 1));
    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
});

router.put('/events/:eventId', async (req, res, next) => {
  try {
    await assertProjectEvent(req.params.projectId, req.params.eventId);
    const patch = normalizeEventPayload(req.body, req.params.projectId, req.body.event_order || 1);
    delete patch.project_id;
    const event = await patchEvent(req.params.eventId, patch);
    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
});

router.delete('/events/:eventId', async (req, res, next) => {
  try {
    await assertProjectEvent(req.params.projectId, req.params.eventId);
    await deleteEvent(req.params.eventId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/events/reorder', async (req, res, next) => {
  try {
    const projectId = req.params.projectId;
    const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : [];
    const events = await listByProject('story_events', projectId, 'event_order');
    const eventIds = new Set(events.map(event => event.id));
    const updates = [];
    for (const [index, eventId] of orderedIds.entries()) {
      if (eventIds.has(eventId)) updates.push(await patchEvent(eventId, { event_order: index + 1 }));
    }
    res.json({ success: true, events: updates });
  } catch (err) {
    next(err);
  }
});

router.post('/beats/generate', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const bible = (await listByProject('story_bibles', project.id))[0]?.payload || {};
    const fallback = { beats: demoBeats() };
    const ai = await callAi({
      json: true,
      fallback,
      system: '你是好莱坞商业叙事架构师。六节点必须体现三幕式节奏、压力曲线和人物成长弧线。只输出 JSON，不写正文。',
      user: `项目：${project.title}
故事圣经：
${JSON.stringify(bible)}

请输出 JSON：{"beats":[{"beat":"opening|first_turn|midpoint_false_victory|opposition_rises|dark_night|finale","title":"","summary":"","function":"","pressure":1,"arc_stage":"","state_changes":[]}]}.`
    });
    const beats = (ai.parsed?.beats || fallback.beats).map((beat, index) => ({
      project_id: project.id,
      event_order: index + 1,
      title: cleanText(beat.title, `关键节点${index + 1}`),
      summary: beat.summary || beat.content || '',
      trigger: beat.function || '',
      conflict_target: beat.beat || '',
      result: beat.function || '',
      state_changes: beat.state_changes || [],
      related_hook_ids: [],
      related_secret_ids: [],
      status: 'beat'
    }));
    const events = await insertMany('story_events', beats);
    res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
});

router.post('/events/generate', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const [characters, existingEvents] = await Promise.all([
      listByProject('characters', project.id),
      listByProject('story_events', project.id, 'event_order')
    ]);
    const beats = existingEvents.filter(event => event.status === 'beat').sort((a, b) => Number(a.event_order || 0) - Number(b.event_order || 0));
    if (beats.length < 2) {
      return res.status(400).json({ success: false, error: '请先生成或手动创建至少两个六事件，再扩展两个六事件之间的小事件。' });
    }
    const existingBridgeEvents = existingEvents.filter(event => event.status !== 'beat');
    const fallbackEvents = buildBridgeFallbackEvents(beats, characters);
    const ai = await callAi({
      json: true,
      fallback: { events: fallbackEvents },
      system: '你是长篇小说桥段事件规划师。六事件是一级骨架，不能改写、不能重复输出为小事件。你的任务是在每两个相邻六事件之间生成一组过渡小事件。AI 需要判断每个小事件由哪个人物推动、造成什么状态变化、如何把前一六事件推向后一六事件。新具名人物必须有至少两个未来复用点。只输出 JSON。',
      user: `项目概念：${project.concept}
已有角色：
${JSON.stringify(characters)}
六节点：
${JSON.stringify(beats)}
已有小事件，避免重复：
${JSON.stringify(existingBridgeEvents)}

请为每两个相邻六事件之间生成 3-6 个小事件。event_order 必须落在两个六事件序号之间，例如 1.1、1.2、1.3；status 必须是 "bridge"。请输出 JSON：{"events":[{"event_order":1.1,"title":"","summary":"","trigger":"","actor_name":"","conflict_target":"","result":"","pressure":1,"arc_stage":"","scene_continuity":"","bridge_from_event_id":"前一个六事件id","bridge_to_event_id":"后一个六事件id","state_changes":[{"target_type":"character|relationship|scene_continuity","target":"","before":"","after":"","evidence":""}],"event_need":"","new_character_candidate":null,"status":"bridge"}]}.`
    });
    const incoming = ai.parsed?.events || fallbackEvents;
    const warnings = [];
    let rows = incoming.map((event, index) => {
      const actor = characters.find(char => char.name === event.actor_name) || characters[0] || null;
      const match = matchCharacterForEvent(event.event_need || event.summary || '', characters);
      if (event.new_character_candidate) {
        const uses = event.new_character_candidate.future_uses || [];
        if (uses.length < 2) warnings.push(`新人物 ${event.new_character_candidate.name || '未命名'} 缺少至少 2 个未来复用点，建议合并或降级为无名功能人物。`);
      }
      const fromBeat = beats.find(beat => beat.id === event.bridge_from_event_id) || beats.find((beat, beatIndex) => Number(event.event_order) > Number(beat.event_order) && Number(event.event_order) < Number(beats[beatIndex + 1]?.event_order || Infinity)) || beats[0];
      const toBeat = beats.find(beat => beat.id === event.bridge_to_event_id) || beats[beats.indexOf(fromBeat) + 1] || beats[1];
      return {
        project_id: project.id,
        event_order: event.event_order || Number(fromBeat.event_order || 1) + ((index % 6) + 1) / 10,
        title: cleanText(event.title, `过渡事件${index + 1}`),
        summary: event.summary || '',
        trigger: event.trigger || '',
        actor_character_id: event.actor_character_id || actor?.id || match.recommended?.id || null,
        conflict_target: event.conflict_target || '',
        result: event.result || '',
        state_changes: Array.isArray(event.state_changes) && event.state_changes.length ? event.state_changes : [
          {
            target_type: 'scene_continuity',
            target: '主场景',
            before: `承接“${fromBeat.title}”后的状态`,
            after: event.scene_continuity || '本事件结束时必须明确地点、交通、姿态和动作状态',
            evidence: event.summary || ''
          }
        ],
        related_character_ids: actor?.id ? [actor.id] : characters.map(char => char.id).slice(0, 2),
        related_secret_ids: [],
        related_hook_ids: [fromBeat.id, toBeat.id].filter(Boolean),
        status: event.status && event.status !== 'beat' ? event.status : 'bridge'
      };
    });
    const minPerGap = Math.min(Math.max(Number(req.body.eventsPerGap || 3), 1), 8);
    rows = dedupeIncomingBridgeEvents(rows, existingBridgeEvents);
    rows = keepRowsForIncompleteGaps(rows, beats, existingBridgeEvents, minPerGap);
    rows = completeBridgeGaps(rows, beats, characters, existingBridgeEvents, minPerGap);
    const events = await insertMany('story_events', rows);
    res.json({ success: true, events, warnings });
  } catch (err) {
    next(err);
  }
});

router.post('/chapters/plan', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const [characters, events, existingChapters] = await Promise.all([
      listByProject('characters', project.id),
      listByProject('story_events', project.id, 'event_order'),
      listByProject('chapters', project.id, 'chapter_number')
    ]);
    const plannedEvents = events.filter(event => event.status !== 'beat' && event.status !== 'archived');
    const chapterSourceEvents = plannedEvents.length ? plannedEvents : events;
    const userChapterLimit = Number(req.body.count || 0);
    const chapterLimit = Math.min(Math.max(userChapterLimit || chapterSourceLimit(chapterSourceEvents.length), 1), 120);
    const maxChapter = existingChapters.reduce((max, chapter) => Math.max(max, Number(chapter.chapter_number || 0)), 0);
    const startChapter = Math.max(Number(req.body.startChapter || maxChapter + 1), 1);
    const fallback = { chapters: demoChapterContracts(chapterSourceEvents, characters, Math.max(chapterSourceEvents.length, 1)).map((chapter, index) => ({ ...chapter, chapter_number: startChapter + index })) };
    const ai = await callAi({
      json: true,
      fallback,
      system: '你是章节契约规划师。不要先判断全文总章数。你要逐个阅读事件链，判断每个事件需要几章才能讲清楚：简单过渡可 1 章，含关键冲突、人物转变、揭示或场景行动的事件可拆 2-5 章。每章必须规定允许人物、必需事件、禁止事实、预期章前和章后状态；allowed_characters 必须使用角色 id，不允许留空；只输出 JSON。',
      user: `项目：${project.title}
目标字数：${project.target_words}
本次起始章：${startChapter}
章节上限：${chapterLimit}
角色：
${JSON.stringify(characters)}
事件链：
${JSON.stringify(events)}
本次优先覆盖的小事件：
${JSON.stringify(chapterSourceEvents)}
已有章节：
${JSON.stringify(existingChapters)}

请按事件复杂度自行决定生成多少章，但不要超过 ${chapterLimit} 章。不要试图规划全文总章数，只把当前事件链拆成下一批可写章节。每个事件至少出现在一个 required_events 中；复杂事件可以连续多章绑定同一个事件。JSON：{"chapters":[{"chapter_number":${startChapter},"source_event_id":"事件id","split_reason":"为什么这个事件需要这一章/这些章","title":"","summary":"","required_events":["事件id"],"allowed_characters":["角色id"],"forbidden_facts":[],"secret_permissions":{},"expected_start_state":{"scene_continuity":"","character_status":{}},"expected_end_state":{"scene_continuity":"","character_arc_change":"","pressure":1},"style_requirements":""}]}`
    });
    const incomingChapters = (ai.parsed?.chapters?.length ? ai.parsed.chapters : fallback.chapters).slice(0, chapterLimit);
    const coveredEventIds = new Set(incomingChapters.flatMap(chapter => asArray(chapter.required_events).concat(chapter.source_event_id || [])).filter(Boolean));
    for (const event of chapterSourceEvents) {
      if (incomingChapters.length >= chapterLimit) break;
      if (coveredEventIds.has(event.id)) continue;
      incomingChapters.push({
        title: `${event.title}：事件章`,
        source_event_id: event.id,
        split_reason: 'AI 未覆盖该事件，系统补充一章以保证事件链不断档。',
        summary: event.summary || event.result || '围绕该事件完成一章叙事推进。',
        required_events: [event.id],
        allowed_characters: event.actor_character_id ? [event.actor_character_id] : characters.map(char => char.id),
        expected_start_state: { scene_continuity: '承接上一章章末状态。' },
        expected_end_state: { scene_continuity: event.result || '完成该事件后的状态变化。' }
      });
      coveredEventIds.add(event.id);
    }
    const contracts = incomingChapters.map((item, index) => ({
      project_id: project.id,
      chapter_number: startChapter + index,
      title: cleanText(item.title, `第${startChapter + index}章`),
      summary: [item.summary, item.split_reason ? `拆章理由：${item.split_reason}` : ''].filter(Boolean).join('\n'),
      required_events: asArray(item.required_events).length ? asArray(item.required_events) : (item.source_event_id ? [item.source_event_id] : []),
      allowed_characters: item.allowed_characters?.length ? item.allowed_characters : characters.map(char => char.id),
      forbidden_facts: item.forbidden_facts || ['不得提前揭露 hidden 秘密', '不得改写 Canon'],
      secret_permissions: item.secret_permissions || { hidden_mode: 'audience_view_only' },
      expected_start_state: item.expected_start_state || { scene_continuity: '默认继承上一章结束地点、交通、姿态和动作。' },
      expected_end_state: item.expected_end_state || { scene_continuity: '必须输出本章结束地点、交通、姿态和动作。' },
      style_requirements: item.style_requirements || project.style_profile,
      status: 'ready_to_draft'
    }));
    const savedContracts = [];
    for (const contract of contracts) {
      savedContracts.push(await upsertContract(contract));
    }
    const chapters = [];
    for (const contract of savedContracts) {
      chapters.push(await upsertChapter({
        project_id: project.id,
        chapter_number: contract.chapter_number,
        title: contract.title,
        outline: contract.summary,
        status: 'ready_to_draft'
      }));
    }
    res.json({ success: true, contracts: savedContracts, chapters });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
