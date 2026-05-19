// backend/routes/crystallize.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// 💥 修改前可能是：const supabaseKey = SUPABASE_KEY; 或者是裸写的别的
// 💥 统一修改为：
// 1. 严格使用 process.env 读取，并确保这里的全大写字母与你 Render 后台配置的 Key 完全一致！
// 如果你 Render 后台填的是 SUPABASE_ANON_KEY，请把下面这行的 SUPABASE_KEY 改掉。
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// 2. 增加防弹检测，如果没拿到，让它在控制台说人话，而不是直接崩溃
if (!supabaseUrl || !supabaseKey) {
    console.error("🚨 致命错误：crystallize.js 未能读取到 Supabase 环境变量！请检查拼写。");
}

// 3. 初始化客户端
const supabase = createClient(supabaseUrl, supabaseKey);

function stripExistingNarrativeNote(rules = '') {
    return String(rules || '').replace(/\n*【叙事逻辑】[\s\S]*$/g, '').trim();
}

function buildNarrativeNote(narrativeLogic = {}) {
    if (!narrativeLogic || (!narrativeLogic.mode && !narrativeLogic.description && !Array.isArray(narrativeLogic.presentation_order))) return '';

    const orderLines = (narrativeLogic.presentation_order || [])
        .slice()
        .sort((a, b) => (parseFloat(a.order) || 0) - (parseFloat(b.order) || 0))
        .map(item => {
            const order = parseFloat(item.order) || 1;
            const source = parseFloat(item.source_chapter_number || item.chapter_number) || order;
            const title = item.title ? `《${item.title}》` : '';
            const purpose = item.purpose ? ` - ${item.purpose}` : '';
            const transition = item.transition ? `；衔接：${item.transition}` : '';
            return `${order}. 取自时间线第 ${source} 章${title}${purpose}${transition}`;
        });

    return [
        '【叙事逻辑】',
        `结构：${narrativeLogic.mode || '顺叙'}`,
        narrativeLogic.description ? `原则：${narrativeLogic.description}` : '',
        orderLines.length > 0 ? `阅读顺序：\n${orderLines.join('\n')}` : ''
    ].filter(Boolean).join('\n');
}

function getOrderedChapters(bible = {}) {
    const chapters = Array.isArray(bible.chapters) ? bible.chapters : [];
    const presentationOrder = Array.isArray(bible.narrative_logic?.presentation_order)
        ? bible.narrative_logic.presentation_order
        : [];

    if (presentationOrder.length === 0) return chapters;

    const used = new Set();
    const ordered = presentationOrder
        .slice()
        .sort((a, b) => (parseFloat(a.order) || 0) - (parseFloat(b.order) || 0))
        .map(item => {
            const sourceNumber = parseFloat(item.source_chapter_number || item.chapter_number);
            const sourceChapter = chapters.find(ch => parseFloat(ch.chapter_number) === sourceNumber)
                || chapters.find(ch => ch.title && item.title && ch.title === item.title);

            if (sourceChapter) {
                used.add(sourceChapter);
                return {
                    ...sourceChapter,
                    title: item.title || sourceChapter.title,
                    narrative_purpose: item.purpose || '',
                    narrative_transition: item.transition || ''
                };
            }

            if (!item.title) return null;
            return {
                chapter_number: sourceNumber || item.order || 1,
                title: item.title,
                content: item.purpose || '',
                narrative_purpose: item.purpose || '',
                narrative_transition: item.transition || ''
            };
        })
        .filter(Boolean);

    const remaining = chapters
        .filter(ch => !used.has(ch))
        .sort((a, b) => (parseFloat(a.chapter_number) || 0) - (parseFloat(b.chapter_number) || 0));

    return [...ordered, ...remaining];
}

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
                messages: [{ role: "system", content: "你是一个严格的JSON提取器。请提取对话中的设定，必须包含 genre、worldview、rules、characters、relations、timeline、narrative_logic、chapters；narrative_logic 需要包含 mode、description、presentation_order。" }, { role: "user", content: userContent }],
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

        // 1. 更新主设定，并把叙事结构写进 SOP 可读取的全局规则
        const narrativeNote = buildNarrativeNote(bible.narrative_logic);
        const projectRules = [stripExistingNarrativeNote(bible.rules), narrativeNote].filter(Boolean).join('\n\n');
        await supabase.from('projects').update({ genre: bible.genre, worldview: bible.worldview, rules: projectRules }).eq('id', projectId);

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

        // 5. 插入章节大纲：按 narrative_logic.presentation_order 重新编号，供 SOP 以读者顺序推进
        if (bible.chapters && bible.chapters.length > 0) {
            const orderedChapters = getOrderedChapters(bible);
            const chapPayload = orderedChapters.map((c, index) => {
                const narrativeMeta = [
                    c.narrative_purpose ? `叙事作用：${c.narrative_purpose}` : '',
                    c.narrative_transition ? `衔接方式：${c.narrative_transition}` : ''
                ].filter(Boolean).join('\n');
                const content = [c.content || '', narrativeMeta].filter(Boolean).join('\n\n');

                return {
                    project_id: projectId,
                    chapter_number: index + 1,
                    title: c.title || '未命名',
                    content,
                    plot_type: 'main'
                };
            });
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
