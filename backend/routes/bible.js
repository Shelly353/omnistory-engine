const express = require('express');
const router = express.Router({ mergeParams: true });
const { insert, insertMany, deleteByProject, supabase, memory } = require('../lib/db');
const { getProject } = require('../lib/repositories');
const { callAi } = require('../lib/aiClient');
const { demoBible } = require('../lib/fallbacks');
const { createCanonFromBible } = require('../lib/canonService');

router.post('/generate', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    if (!project) return res.status(404).json({ success: false, error: '项目不存在' });
    const fallback = demoBible(project);
    const ai = await callAi({
      json: true,
      fallback,
      system: '你是长篇小说架构师。只输出 JSON 故事圣经，不写正文。硬事实、人物弧线、核心秘密必须清楚。',
      user: `项目：${project.title}
目标字数：${project.target_words}
风格：${project.style_profile}
概念故事：
${project.concept}

请输出 JSON，包含 genre, theme, worldview, protagonist_arc, antagonist_arc, main_characters, core_secrets, rules, style。`
    });
    const payload = ai.parsed || fallback;
    const bible = await insert('story_bibles', { project_id: project.id, payload, version: 1, approved: false });
    await insert('generation_runs', {
      project_id: project.id,
      operation: 'bible.generate',
      input_payload: { concept: project.concept },
      output_payload: payload,
      model: ai.model,
      status: 'success'
    });
    res.json({ success: true, bible });
  } catch (err) {
    next(err);
  }
});

router.put('/approve', async (req, res, next) => {
  try {
    const { payload } = req.body;
    const project = await getProject(req.params.projectId);
    if (!project) return res.status(404).json({ success: false, error: '项目不存在' });

    let bible;
    if (supabase) {
      const { data: existing } = await supabase.from('story_bibles').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const source = payload || existing?.payload || demoBible(project);
      const { data, error } = await supabase
        .from('story_bibles')
        .upsert({ id: existing?.id, project_id: project.id, payload: source, approved: true, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      bible = data;
    } else {
      bible = memory.story_bibles.find(item => item.project_id === project.id);
      if (!bible) bible = await insert('story_bibles', { project_id: project.id, payload: payload || demoBible(project), version: 1, approved: true });
      bible.payload = payload || bible.payload;
      bible.approved = true;
    }

    const source = bible.payload || payload || demoBible(project);
    await Promise.all([
      deleteByProject('characters', project.id),
      deleteByProject('secrets', project.id),
      deleteByProject('canon_facts', project.id)
    ]);
    const characters = await insertMany('characters', (source.main_characters || []).map(char => ({
      project_id: project.id,
      name: char.name,
      role: char.role || '',
      faction: char.faction || '',
      identity: char.identity || '',
      personality: char.personality || '',
      core_desire: char.core_desire || '',
      goal: char.goal || '',
      motivation: char.motivation || '',
      flaw: char.flaw || '',
      fear: char.fear || '',
      skills: char.skills || '',
      limits: char.limits || '',
      voice_rules: char.voice_rules || '',
      reuse_plan: char.reuse_plan || [],
      status: 'active'
    })));
    const secrets = await insertMany('secrets', (source.core_secrets || []).map(secret => ({
      project_id: project.id,
      title: secret.title,
      audience_view: secret.audience_view || '',
      god_view: secret.god_view || '',
      status: secret.status || 'hidden',
      reveal_chapter: secret.reveal_chapter || null
    })));
    const canon = await createCanonFromBible(project.id, source);
    res.json({ success: true, bible, characters, secrets, canon });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('story_bibles').select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return res.json({ success: true, bible: data || null });
    }
    res.json({ success: true, bible: memory.story_bibles.find(item => item.project_id === req.params.projectId) || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
