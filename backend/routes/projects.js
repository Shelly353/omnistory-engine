const express = require('express');
const router = express.Router();
const { insert, supabase, memory } = require('../lib/db');
const { getProject, listByProject } = require('../lib/repositories');

router.post('/', async (req, res, next) => {
  try {
    const { title, concept, target_words, genre, style_profile } = req.body;
    if (!title || !concept) return res.status(400).json({ success: false, error: '缺少 title 或 concept' });
    const project = await insert('projects', {
      title,
      concept,
      target_words: Number(target_words || 200000),
      genre: genre || '',
      style_profile: style_profile || '默认商业网文',
      status: 'concept'
    });
    res.json({ success: true, project });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ success: true, projects: data || [] });
    }
    res.json({ success: true, projects: memory.projects.slice().reverse() });
  } catch (err) {
    next(err);
  }
});

router.get('/:projectId', async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    if (!project) return res.status(404).json({ success: false, error: '项目不存在' });
    const [bibles, canon, characters, events, contracts, chapters, findings] = await Promise.all([
      listByProject('story_bibles', project.id),
      listByProject('canon_facts', project.id),
      listByProject('characters', project.id),
      listByProject('story_events', project.id, 'event_order'),
      listByProject('chapter_contracts', project.id, 'chapter_number'),
      listByProject('chapters', project.id, 'chapter_number'),
      listByProject('audit_findings', project.id)
    ]);
    res.json({ success: true, project, bible: bibles[0] || null, canon, characters, events, contracts, chapters, findings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
