const express = require('express');
const router = express.Router({ mergeParams: true });
const { insert, insertMany } = require('../lib/db');
const { getProject, getEvent, listByProject, upsertChapter, patchEvent, deleteEvent } = require('../lib/repositories');
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

async function assertProjectEvent(projectId, eventId) {
  const event = await getEvent(eventId);
  if (!event || event.project_id !== projectId) {
    const err = new Error('事件不存在或不属于当前项目');
    err.status = 404;
    throw err;
  }
  return event;
}

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
    const fallbackEvents = demoEvents(characters);
    const ai = await callAi({
      json: true,
      fallback: { events: fallbackEvents },
      system: '你是长篇小说事件图规划师。事件必须来自角色选择，并造成状态变化。每个事件必须记录节奏压力、人物弧线阶段、场景连续性约束。新具名人物必须有至少两个未来复用点。',
      user: `项目概念：${project.concept}
已有角色：
${JSON.stringify(characters)}
六节点：
${JSON.stringify(existingEvents)}

请输出 JSON：{"events":[{"event_order":1,"title":"","summary":"","trigger":"","actor_name":"","conflict_target":"","result":"","pressure":1,"arc_stage":"","scene_continuity":"","state_changes":[{"target_type":"character|relationship|scene_continuity","target":"","before":"","after":"","evidence":""}],"event_need":"","new_character_candidate":null}]}.`
    });
    const incoming = ai.parsed?.events || fallbackEvents;
    const warnings = [];
    const rows = incoming.map((event, index) => {
      const actor = characters.find(char => char.name === event.actor_name) || characters[0] || null;
      const match = matchCharacterForEvent(event.event_need || event.summary || '', characters);
      if (event.new_character_candidate) {
        const uses = event.new_character_candidate.future_uses || [];
        if (uses.length < 2) warnings.push(`新人物 ${event.new_character_candidate.name || '未命名'} 缺少至少 2 个未来复用点，建议合并或降级为无名功能人物。`);
      }
      return {
        project_id: project.id,
        event_order: event.event_order || index + 1,
        title: cleanText(event.title, `事件${index + 1}`),
        summary: event.summary || '',
        trigger: event.trigger || '',
        actor_character_id: actor?.id || match.recommended?.id || null,
        conflict_target: event.conflict_target || '',
        result: event.result || '',
        state_changes: Array.isArray(event.state_changes) && event.state_changes.length ? event.state_changes : [
          {
            target_type: 'scene_continuity',
            target: '主场景',
            before: '承接上一事件状态',
            after: event.scene_continuity || '本事件结束时必须明确地点、交通、姿态和动作状态',
            evidence: event.summary || ''
          }
        ],
        related_character_ids: actor?.id ? [actor.id] : characters.map(char => char.id).slice(0, 2),
        status: 'planned'
      };
    });
    const events = await insertMany('story_events', rows);
    res.json({ success: true, events, warnings });
  } catch (err) {
    next(err);
  }
});

router.post('/chapters/plan', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const [characters, events] = await Promise.all([
      listByProject('characters', project.id),
      listByProject('story_events', project.id, 'event_order')
    ]);
    const count = Math.min(Number(req.body.count || 10), 120);
    const fallback = { chapters: demoChapterContracts(events, characters, count) };
    const ai = await callAi({
      json: true,
      fallback,
      system: '你是章节契约规划师。每章必须规定允许人物、禁止事实、预期章前和章后状态；必须包含节奏压力、人物弧线阶段和场景连续性要求。只输出 JSON。',
      user: `项目：${project.title}
目标字数：${project.target_words}
角色：
${JSON.stringify(characters)}
事件链：
${JSON.stringify(events)}

请生成前 ${count} 章契约，JSON：{"chapters":[{"chapter_number":1,"title":"","summary":"","required_events":[],"allowed_characters":[],"forbidden_facts":[],"secret_permissions":{},"expected_start_state":{"scene_continuity":""},"expected_end_state":{"scene_continuity":"","character_arc_change":"","pressure":1},"style_requirements":""}]}`
    });
    const contracts = (ai.parsed?.chapters || fallback.chapters).map((item, index) => ({
      project_id: project.id,
      chapter_number: item.chapter_number,
      title: cleanText(item.title, `第${item.chapter_number || index + 1}章`),
      summary: item.summary || '',
      required_events: item.required_events || [],
      allowed_characters: item.allowed_characters?.length ? item.allowed_characters : characters.map(char => char.id),
      forbidden_facts: item.forbidden_facts || ['不得提前揭露 hidden 秘密', '不得改写 Canon'],
      secret_permissions: item.secret_permissions || { hidden_mode: 'audience_view_only' },
      expected_start_state: item.expected_start_state || { scene_continuity: '默认继承上一章结束地点、交通、姿态和动作。' },
      expected_end_state: item.expected_end_state || { scene_continuity: '必须输出本章结束地点、交通、姿态和动作。' },
      style_requirements: item.style_requirements || project.style_profile,
      status: 'ready_to_draft'
    }));
    const savedContracts = await insertMany('chapter_contracts', contracts);
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
