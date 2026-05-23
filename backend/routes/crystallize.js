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
    return String(rules || '')
        .replace(/\n*【叙事逻辑】[\s\S]*?(?=\n【上帝视角信息】|$)/g, '')
        .replace(/\n*【上帝视角信息】[\s\S]*$/g, '')
        .trim();
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

function buildSecretsNote(secrets = []) {
    if (!Array.isArray(secrets) || secrets.length === 0) return '';
    const lines = secrets.map(secret => {
        const status = secret.status === 'revealed' ? '已揭露' : (secret.status === 'partial' ? '部分揭露' : '隐藏');
        return [
            `【${status}秘密：${secret.title || '未命名'}】`,
            `观众视角：${secret.audience_view || '暂无'}`,
            `上帝视角：${secret.god_view || '暂无'}`,
            secret.reveal_event ? `揭露事件：${secret.reveal_event}` : '',
            Array.isArray(secret.related_characters) && secret.related_characters.length ? `关联人物：${secret.related_characters.join('、')}` : '',
            Array.isArray(secret.related_events) && secret.related_events.length ? `关联事件：${secret.related_events.join('、')}` : '',
            `调用规则：${secret.status === 'revealed' ? '可作为公开事实调用。' : '揭露前只能用观众视角推进；上帝视角只供后台校验，不可提前泄露。'}`
        ].filter(Boolean).join('\n');
    }).join('\n\n');
    return `【上帝视角信息】\n${lines}`;
}

function appendCharacterRulesToBackground(character = {}) {
    const rules = String(character.character_rules || '').trim();
    const background = String(character.background || '').trim();
    if (!rules) return background;
    return [background, `【人物规则】\n${rules}`].filter(Boolean).join('\n\n');
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

function normalizeRelationName(value = '') {
    return String(value || '').trim();
}

function relationNamesFromRows(rows = [], characters = []) {
    const charMap = new Map((characters || []).map(c => [c.id, c.name]));
    return (rows || []).map(rel => ({
        from_name: normalizeRelationName(charMap.get(rel.from_char_id)),
        to_name: normalizeRelationName(charMap.get(rel.to_char_id)),
        label: rel.label || '羁绊'
    })).filter(rel => rel.from_name && rel.to_name);
}

function normalizeIncomingRelations(relations = []) {
    if (!Array.isArray(relations)) return [];
    return relations.map(rel => ({
        from_name: normalizeRelationName(rel.from_name || rel.from || rel.source),
        to_name: normalizeRelationName(rel.to_name || rel.to || rel.target),
        label: rel.label || rel.relation || '羁绊'
    })).filter(rel => rel.from_name && rel.to_name);
}

// 🔍 阶段一：预览提取
router.get('/snapshot/:projectId', async (req, res) => {
    const { projectId } = req.params;
    try {
        const { data: project, error: pErr } = await supabase.from('projects').select('*').eq('id', projectId).single();
        if (pErr) throw pErr;

        const { data: characters } = await supabase.from('characters').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
        const { data: relations } = await supabase.from('character_relations').select('*').eq('project_id', projectId);
        const { data: timeline } = await supabase.from('timeline_events').select('*').eq('project_id', projectId).order('chapter_number', { ascending: true });
        const { data: chapters } = await supabase.from('chapters').select('chapter_number, title, content').eq('project_id', projectId).order('chapter_number', { ascending: true });

        const bible = {
            genre: project.genre || '',
            worldview: project.worldview || '',
            rules: project.rules || '',
            characters: characters || [],
            relations: relationNamesFromRows(relations, characters),
            timeline: (timeline || []).map(item => ({
                time_label: item.time_label || '',
                chapter_number: item.chapter_number || 1,
                description: item.description || ''
            })),
            narrative_logic: {},
            chapters: (chapters || []).map(ch => ({
                chapter_number: ch.chapter_number || 1,
                title: ch.title || '',
                content: ch.content || ''
            }))
        };

        res.json({ success: true, bible });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/preview', async (req, res) => {
    const { conversation } = req.body;
    try {
        // 这里直接将前端拼好的会话扔给大模型
        const userContent = "【对话记录】：\n" + conversation.map(msg => `${msg.role}: ${msg.content}`).join('\n') + "\n\n请严格按照要求输出包含所有章节和设定的完整JSON：";

        const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            body: JSON.stringify({
                model: "deepseek-v4-flash",
                // 提示词已由前端 prompts.js 在对话开头注入，这里只需极简系统音
                messages: [{ role: "system", content: "你是一个严格的JSON提取器。请提取对话中的设定，必须包含 genre、worldview、rules、characters、relations、timeline、narrative_logic、secrets、chapters；narrative_logic 需要包含 mode、description、presentation_order。事件、人物、规则/专家、上帝视角四个模块互相影响；规则/世界观/专家资料权限最高。不符合规则、专业流程或人物逻辑的事件，要把警报和整改约束写入 rules。人物应尽量绑定到具体 timeline/chapters；参与事件少于三个的人物，要在人物简介或弧光中保留后续复用提示，避免一次性人物。与人物有关的疾病、职业权限、身份限制、能力代价、心理触发点必须写入对应 characters[].character_rules；全局专家资料写入 rules。观众不知道但作者必须知道的真实情况、真正坏人、真实动机、隐藏误导写入 secrets；secrets 每项包含 title、status(hidden/partial/revealed)、audience_view、god_view、reveal_event、related_characters、related_events。未揭露或部分揭露时，角色/观众只能基于 audience_view 推理，god_view 只用于后台因果校验，不能提前泄露。用户修正记录的优先级高于 AI 早期方案；凡是用户说“不是、不对、改成、不要、应该、必须、设定为”的内容，都视为最新事实。当前面板数据中的 characters 详细字段、character_rules、relations 人物羁绊、timeline 细密时间轴、secrets 上帝视角信息是稳定资产；除非最近对话明确要求删除某一项，否则必须完整保留，不允许用摘要版、空数组或字段缺失版覆盖。如果当前面板的 relations 或 timeline 为空，必须从全量用户修正记录和沙盒对话尾迹中重建，不允许留空。律师、医生、警察、金融、政治、文化、种族、技能、历史、古代、朝代、官职、科举、礼法、战争等专业关键词对应的专家资料也按上述规则归档。历史专家为后台内置能力：遇到历史剧/古代背景时，必须检查朝代、年代、官职称谓、礼法礼仪、服饰器物、交通通讯、军队调动、审案/科举/婚嫁/朝会流程，以及现代价值观误套问题；史实不确定时必须标注不确定，不能编成确定事实。" }, { role: "user", content: userContent }],
                temperature: 0.1 
            })
        });

        const result = await dsResponse.json();
        if (result.error) throw new Error(result.error.message);

        let jsonStr = result.choices[0].message.content.trim();
        const fencedMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fencedMatch) {
            jsonStr = fencedMatch[1].trim();
        } else {
            const start = jsonStr.indexOf('{');
            const end = jsonStr.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) jsonStr = jsonStr.slice(start, end + 1);
        }
        
        const bible = JSON.parse(jsonStr);
        res.json({ success: true, bible });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 💥 阶段二：带模糊匹配与降级保护的正式写入
router.post('/confirm', async (req, res) => {
    const { projectId, bible } = req.body;
    try {
        console.log("📥 开始执行数据库写入...");
        const incomingRelations = normalizeIncomingRelations(bible?.relations);
        let relationsToWrite = incomingRelations;

        if (relationsToWrite.length === 0) {
            const { data: existingCharacters } = await supabase.from('characters').select('id, name').eq('project_id', projectId);
            const { data: existingRelations } = await supabase.from('character_relations').select('*').eq('project_id', projectId);
            relationsToWrite = relationNamesFromRows(existingRelations, existingCharacters);
            if (relationsToWrite.length > 0) {
                console.log(`🧷 新圣经未携带人物关系，已继承 ${relationsToWrite.length} 条旧关系。`);
            }
        }
        
        // 0. 清理旧数据
        await supabase.from('character_relations').delete().eq('project_id', projectId);
        await supabase.from('timeline_events').delete().eq('project_id', projectId);
        await supabase.from('characters').delete().eq('project_id', projectId);
        await supabase.from('chapters').delete().eq('project_id', projectId).is('content_text', null);

        // 1. 更新主设定，并把叙事结构写进 SOP 可读取的全局规则
        const narrativeNote = buildNarrativeNote(bible.narrative_logic);
        const secretsNote = buildSecretsNote(bible.secrets);
        const projectRules = [stripExistingNarrativeNote(bible.rules), narrativeNote, secretsNote].filter(Boolean).join('\n\n');
        await supabase.from('projects').update({ genre: bible.genre, worldview: bible.worldview, rules: projectRules }).eq('id', projectId);

        // 2. 插入人物卡 (全息维度版)
        if (bible.characters && bible.characters.length > 0) {
            const charPayload = bible.characters.map(c => ({ 
                project_id: projectId, 
                name: c.name || '未知', role: c.role || '', faction: c.faction || '', description: c.description || '',
                age: c.age || '', appearance: c.appearance || '', profession: c.profession || '', personality: c.personality || '',
                core_desire: c.core_desire || '', goal: c.goal || '', motivation: c.motivation || '', flaw: c.flaw || '',
                fear: c.fear || '', skills: c.skills || '', background: appendCharacterRulesToBackground(c), character_arc: c.character_arc || ''
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
        if (relationsToWrite.length > 0 && allChars && allChars.length > 0) {
            const relPayload = relationsToWrite.map(rel => {
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
