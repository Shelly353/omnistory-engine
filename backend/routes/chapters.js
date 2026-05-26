const express = require('express');
const router = express.Router();
const { listByProject, getChapter } = require('../lib/repositories');
const { compileChapterStartState } = require('../lib/stateCompiler');
const { generateDraft, reviewDraft, approveDraft } = require('../lib/generationPipeline');

router.get('/project/:projectId', async (req, res, next) => {
  try {
    res.json({ success: true, chapters: await listByProject('chapters', req.params.projectId, 'chapter_number') });
  } catch (err) {
    next(err);
  }
});

router.get('/:chapterId', async (req, res, next) => {
  try {
    const chapter = await getChapter(req.params.chapterId);
    if (!chapter) return res.status(404).json({ success: false, error: '章节不存在' });
    res.json({ success: true, chapter });
  } catch (err) {
    next(err);
  }
});

router.get('/:chapterId/state', async (req, res, next) => {
  try {
    const chapter = await getChapter(req.params.chapterId);
    if (!chapter) return res.status(404).json({ success: false, error: '章节不存在' });
    res.json({ success: true, state: await compileChapterStartState(chapter.project_id, chapter.chapter_number) });
  } catch (err) {
    next(err);
  }
});

router.post('/:chapterId/generate', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await generateDraft(req.params.chapterId)) });
  } catch (err) {
    next(err);
  }
});

router.post('/:chapterId/review', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await reviewDraft(req.params.chapterId)) });
  } catch (err) {
    next(err);
  }
});

router.post('/:chapterId/approve', async (req, res, next) => {
  try {
    res.json({ success: true, chapter: await approveDraft(req.params.chapterId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
