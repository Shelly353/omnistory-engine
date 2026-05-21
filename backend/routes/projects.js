// backend/routes/projects.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 1. 获取所有项目列表 (大厅主页)
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, projects: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 2. 创建新项目 (开启新纪元)
router.post('/create', async (req, res) => {
    const { title } = req.body;
    try {
        const { data, error } = await supabase.from('projects').insert([{ title }]).select().single();
        if (error) throw error;
        res.json({ success: true, id: data.id });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 3. 💥 核弹级彻底删除 (级联抹除所有宇宙数据)
router.delete('/:projectId', async (req, res) => {
    const { projectId } = req.params;
    try {
        // 先手动清除该宇宙下的所有衍生数据，防止外键冲突
        await supabase.from('chapters').delete().eq('project_id', projectId);
        await supabase.from('characters').delete().eq('project_id', projectId);
        await supabase.from('foreshadowing_hooks').delete().eq('project_id', projectId);
        await supabase.from('workspace_cloud_state').delete().eq('project_id', projectId);
        
        // 最后删除宇宙主控记录
        const { error } = await supabase.from('projects').delete().eq('id', projectId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 4. 📦 宇宙结晶导出 (提取全书内容)
router.get('/export/:projectId', async (req, res) => {
    const { projectId } = req.params;
    const { format } = req.query; // 支持 'txt' 或 'md'
    
    try {
        // 抓取宇宙名称
        const { data: project } = await supabase.from('projects').select('title').eq('id', projectId).single();
        if (!project) throw new Error("未找到该宇宙");

        // 提取所有章节，严格按浮点数时空顺序排列！
        const { data: chapters, error } = await supabase.from('chapters')
            .select('chapter_number, title, content_text')
            .eq('project_id', projectId)
            .order('chapter_number', { ascending: true });

        if (error) throw error;

        let exportContent = "";
        
        // 智能拼接引擎
        if (format === 'md') {
            exportContent += `# ${project.title}\n\n`;
            chapters.forEach(chap => {
                exportContent += `## 第 ${chap.chapter_number} 章：${chap.title}\n\n`;
                exportContent += `${chap.content_text || '（本章纪元尚未录入内容）'}\n\n`;
                exportContent += `---\n\n`;
            });
        } else { // txt
            exportContent += `《${project.title}》\n\n`;
            chapters.forEach(chap => {
                exportContent += `第 ${chap.chapter_number} 章：${chap.title}\n\n`;
                exportContent += `${chap.content_text || '（本章纪元尚未录入内容）'}\n\n\n`;
            });
        }

        res.json({ success: true, title: project.title, content: exportContent });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 5. 📖 获取单一宇宙的基础圣经设定 (类型、世界观、规则)
router.get('/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('projects').select('*').eq('id', req.params.projectId).single();
        if (error) throw error;
        res.json({ success: true, project: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.put('/:projectId', async (req, res) => {
    const { genre, worldview, rules } = req.body;
    try {
        const { error } = await supabase
            .from('projects')
            .update({ genre, worldview, rules })
            .eq('id', req.params.projectId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
