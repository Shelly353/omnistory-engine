// backend/routes/crystallize.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// 💥 修改前可能是：const supabaseKey = SUPABASE_KEY; 或者是裸写的别的
// 💥 统一修改为：
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 🔍 阶段一：预览提取
router.post('/preview', async (req, res) => {
    const { conversation } = req.body;
    try {
        // 这里直接将前端拼好的会话扔给大模型
        const userContent = "【对话记录】：\n" + conversation.map(msg => `${msg.role}: ${msg.content}`).join('\n') + "\n\n请严格按照要求输出包含所有章节和设定的完整JSON：";

        const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            body: JSON.stringify({
                model: "deepseek-chat",
                // 提示词已由前端 prompts.js 在对话开头注入，这里只需极简系统音
                messages: [{ role: "system", content: "你是一个严格的JSON提取器。请提取对话中的设定。" }, { role: "user", content: userContent }],
                temperature: 0.1 
            })
        });

        const result = await dsResponse.json();
        if (result.error) throw new Error(result.error.message);

        let jsonStr = result.choices[0].message.content.trim();
        if (jsonStr.startsWith("```json")) jsonStr = jsonStr.replace(/^```json/, "").replace(/```$/, "").trim();
        
        const bible = JSON.parse(jsonStr);
        res.json({ success: true, bible });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 💥 阶段二：带模糊匹配与降级保护的正式写入
router.post('/confirm', async (req, res) => {
    const { projectId, bible } = req.body;
    try {
        console.log("📥 开始执行数据库写入...");
        
        // 0. 清理旧数据
        await supabase.from('character_relations').delete().eq('project_id', projectId);
        await supabase.from('timeline_events').delete().eq('project_id', projectId);
        await supabase.from('characters').delete().eq('project_id', projectId);
        await supabase.from('chapters').delete().eq('project_id', projectId).is('content_text', null);

        // 1. 更新主设定
        await supabase.from('projects').update({ genre: bible.genre, worldview: bible.worldview, rules: bible.rules }).eq('id', projectId);

        // 2. 插入人物卡 (全息维度版)
        if (bible.characters && bible.characters.length > 0) {
            const charPayload = bible.characters.map(c => ({ 
                project_id: projectId, 
                name: c.name || '未知', role: c.role || '', faction: c.faction || '', description: c.description || '',
                age: c.age || '', appearance: c.appearance || '', profession: c.profession || '', personality: c.personality || '',
                core_desire: c.core_desire || '', goal: c.goal || '', motivation: c.motivation || '', flaw: c.flaw || '',
                fear: c.fear || '', skills: c.skills || '', background: c.background || '', character_arc: c.character_arc || ''
            }));
            const { error: cErr } = await supabase.from('characters').insert(charPayload);
            if (cErr) {
                console.log("⚠️ 尝试降级插入...");
                const safePayload = bible.characters.map(c => ({ project_id: projectId, name: c.name || '未知', role: c.role || '', description: c.description || '' }));
                await supabase.from('characters').insert(safePayload);
            }
        }

        // 💥 3. 插入人物关系连线 (加入智能模糊匹配引擎) 💥
        const { data: allChars } = await supabase.from('characters').select('id, name').eq('project_id', projectId);
        if (bible.relations && bible.relations.length > 0 && allChars && allChars.length > 0) {
            const relPayload = bible.relations.map(rel => {
                const fromName = rel.from_name || '';
                const toName = rel.to_name || '';
                // 核心：只要名字互相包含，就认定是同一个人，强制牵线！
                const fromC = allChars.find(c => c.name === fromName || c.name.includes(fromName) || fromName.includes(c.name));
                const toC = allChars.find(c => c.name === toName || c.name.includes(toName) || toName.includes(c.name));
                if (fromC && toC) return { project_id: projectId, from_char_id: fromC.id, to_char_id: toC.id, label: rel.label || '羁绊' };
                return null;
            }).filter(Boolean);
            
            if (relPayload.length > 0) await supabase.from('character_relations').insert(relPayload);
        }

        // 4. 插入时间轴
        if (bible.timeline && bible.timeline.length > 0) {
            const tlPayload = bible.timeline.map(t => ({ project_id: projectId, time_label: t.time_label, chapter_number: parseFloat(t.chapter_number) || 0, description: t.description }));
            await supabase.from('timeline_events').insert(tlPayload);
        }

        // 5. 插入章节大纲
        if (bible.chapters && bible.chapters.length > 0) {
            const chapPayload = bible.chapters.map(c => ({ project_id: projectId, chapter_number: parseFloat(c.chapter_number) || 1, title: c.title || '未命名', content: c.content || '', plot_type: 'main' }));
            await supabase.from('chapters').insert(chapPayload);
        }

        console.log("✅ 数据库写入全部通关！");
        res.json({ success: true });
        
    } catch (err) {
        console.error("❌ 数据库执行崩溃:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
