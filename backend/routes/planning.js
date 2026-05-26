const express = require('express');
const router = express.Router({ mergeParams: true });
const { insert, insertMany } = require('../lib/db');
const { getProject, listByProject, upsertChapter } = require('../lib/repositories');
const { callAi } = require('../lib/aiClient');
const { demoBeats, demoEvents, demoChapterContracts } = require('../lib/fallbacks');
const { matchCharacterForEvent } = require('../lib/characterMatcher');
const { cleanText } = require('../lib/normalize');

router.post('/beats/generate', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const bible = (await listByProject('story_bibles', project.id))[0]?.payload || {};
    const fallback = { beats: demoBeats() };
    const ai = await callAi({
      json: true,
      fallback,
      system: '你是好莱坞商业叙事架构师。只输出 JSON 六节点，不写正文。',
      user: `项目：${project.title}
故事圣经：
${JSON.stringify(bible)}

请输出 JSON：{"beats":[{"beat":"opening|first_turn|midpoint_false_victory|opposition_rises|dark_night|finale","title":"","summary":"","function":"","state_changes":[]}]}.`
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
      system: '你是长篇小说事件图规划师。事件必须来自角色选择，并造成状态变化。新具名人物必须有至少两个未来复用点。',
      user: `项目概念：${project.concept}
已有角色：
${JSON.stringify(characters)}
六节点：
${JSON.stringify(existingEvents)}

请输出 JSON：{"events":[{"event_order":1,"title":"","summary":"","trigger":"","actor_name":"","conflict_target":"","result":"","state_changes":[],"event_need":"","new_character_candidate":null}]}.`
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
        state_changes: event.state_changes || [],
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
      system: '你是章节契约规划师。每章必须规定允许人物、禁止事实、预期章前和章后状态。只输出 JSON。',
      user: `项目：${project.title}
目标字数：${project.target_words}
角色：
${JSON.stringify(characters)}
事件链：
${JSON.stringify(events)}

请生成前 ${count} 章契约，JSON：{"chapters":[{"chapter_number":1,"title":"","summary":"","required_events":[],"allowed_characters":[],"forbidden_facts":[],"secret_permissions":{},"expected_start_state":{},"expected_end_state":{},"style_requirements":""}]}`
    });
    const contracts = (ai.parsed?.chapters || fallback.chapters).map(item => ({
      project_id: project.id,
      chapter_number: item.chapter_number,
      title: cleanText(item.title, `第${item.chapter_number || index + 1}章`),
      summary: item.summary || '',
      required_events: item.required_events || [],
      allowed_characters: item.allowed_characters?.length ? item.allowed_characters : characters.map(char => char.id),
      forbidden_facts: item.forbidden_facts || ['不得提前揭露 hidden 秘密', '不得改写 Canon'],
      secret_permissions: item.secret_permissions || { hidden_mode: 'audience_view_only' },
      expected_start_state: item.expected_start_state || {},
      expected_end_state: item.expected_end_state || {},
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
