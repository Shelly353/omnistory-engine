// backend/routes/workspace.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseKey = process.env.DEEPSEEK_API_KEY; 
const supabase = createClient(supabaseUrl, supabaseKey);

// 1. 获取大纲树
router.get('/tree/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('chapters').select('id, chapter_number, title, plot_type, content').eq('project_id', req.params.projectId).order('chapter_number', { ascending: true });
        if (error) throw error;
        res.json({ success: true, chapters: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 2. 获取单章上下文 (含角色和伏笔)
router.post('/context', async (req, res) => {
    const { projectId, chapterId, chapterNumber } = req.body;
    try {
        const { data: chapter, error: chapErr } = await supabase.from('chapters').select('*').eq('id', chapterId).single();
        if (chapErr) throw chapErr;

        const { data: characters } = await supabase.from('characters').select('*').eq('project_id', projectId);
        const { data: hooks } = await supabase.from('foreshadowing_hooks').select('*').eq('project_id', projectId).eq('target_chapter', chapterNumber);

        res.json({ success: true, chapter, characters: characters || [], hooks: hooks || [] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 3. 保存单章正文
router.post('/save', async (req, res) => {
    const { chapterId, content_text } = req.body;
    try {
        const { error } = await supabase.from('chapters').update({ content_text }).eq('id', chapterId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 4. 新增章节
router.post('/chapter', async (req, res) => {
    const { projectId, chapterNumber, title, plotType, content, content_text } = req.body;
    try {
        const { error } = await supabase.from('chapters').insert([{
            project_id: projectId, chapter_number: chapterNumber, title, plot_type: plotType, content, content_text
        }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 5. 种植伏笔
router.post('/hook', async (req, res) => {
    const { projectId, description, target_chapter, annotation, source_chapter_id, source_chapter_number } = req.body;
    try {
        const { error } = await supabase.from('foreshadowing_hooks').insert([{
            project_id: projectId, description, target_chapter, annotation, source_chapter_id, source_chapter_number
        }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 6. 全局资产：获取角色
router.get('/characters/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('characters').select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: true });
        if (error) throw error;
        res.json({ success: true, characters: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 7. 全局资产：保存角色
router.post('/character', async (req, res) => {
    const { projectId, id, name, role, faction, description } = req.body;
    try {
        let error;
        if (id) {
            const { error: updateError } = await supabase.from('characters').update({ name, role, faction, description }).eq('id', id);
            error = updateError;
        } else {
            const { error: insertError } = await supabase.from('characters').insert([{ project_id: projectId, name, role, faction, description }]);
            error = insertError;
        }
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 8. 绝对时间轴：获取
router.get('/timeline/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('timeline_events').select('*').eq('project_id', req.params.projectId).order('chapter_number', { ascending: true });
        if (error) throw error;
        res.json({ success: true, events: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 8. 绝对时间轴：保存
router.post('/timeline', async (req, res) => {
    const { projectId, time_label, chapter_number, description } = req.body;
    try {
        const { error } = await supabase.from('timeline_events').insert([{ project_id: projectId, time_label, chapter_number: parseFloat(chapter_number), description }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 8. 绝对时间轴：删除
router.delete('/timeline/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('timeline_events').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 9. 物理关系网：获取
router.get('/relations/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('character_relations').select('*').eq('project_id', req.params.projectId);
        if (error) throw error;
        res.json({ success: true, relations: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 9. 物理关系网：保存
router.post('/relation', async (req, res) => {
    const { projectId, from_char_id, to_char_id, label } = req.body;
    try {
        const { error } = await supabase.from('character_relations').insert([{ project_id: projectId, from_char_id, to_char_id, label }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 9. 物理关系网：删除
router.delete('/relation/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('character_relations').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 10. 保存单章推演后的叙事大纲
router.post('/save-synopsis', async (req, res) => {
    const { chapterId, synopsis } = req.body;
    try {
        const { error } = await supabase.from('chapters').update({ content: synopsis }).eq('id', chapterId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
