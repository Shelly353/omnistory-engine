// backend/routes/chat.js
const express = require('express');
const router = express.Router();

// 我们暂时使用环境变量里的 KEY，如果你没在 .env 写，就暂时填明文
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanUpstreamError(status, responseText = '') {
    const text = String(responseText || '');
    const title = text.match(/<TITLE>([\s\S]*?)<\/TITLE>/i)?.[1]?.trim();
    const h1 = text.match(/<H1>([\s\S]*?)<\/H1>/i)?.[1]?.trim();
    const compact = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const message = h1 || title || compact || '无错误详情';
    if ([502, 503, 504].includes(status)) {
        return `DeepSeek 上游暂时不可用或超时（${status}）：${message.slice(0, 220)}。请稍后重试；系统已减少上下文并尝试恢复。`;
    }
    return `DeepSeek 报错 ${status}: ${message.slice(0, 500)}`;
}

async function callDeepSeek(messages, options = {}) {
    const maxTokens = options.maxTokens || 3000;
    const dsResponse = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_KEY}`
        },
        body: JSON.stringify({
            model: "deepseek-v4-flash",
            messages,
            temperature: 0.7,
            max_tokens: maxTokens
        })
    });
    const responseText = await dsResponse.text();
    if (!dsResponse.ok) {
        const error = new Error(cleanUpstreamError(dsResponse.status, responseText));
        error.status = dsResponse.status;
        throw error;
    }
    return JSON.parse(responseText);
}

router.post('/deduce', async (req, res) => {
    const { conversation = [], memorySummary = '', currentBible = null, requirePanelJson = false, localReferenceSnippets = '' } = req.body;
    if (!DEEPSEEK_KEY) {
        return res.status(500).json({ success: false, error: 'DEEPSEEK_API_KEY 未配置，后端无法调用 AI。' });
    }
    
    // 我们给 AI 的超级系统指令 (System Prompt)
    const systemPrompt = `你是一位顶级的网文主编和世界观架构师。用户正在使用一个名为 OmniStory 的推演沙盒。
你的任务是通过对话，引导作者一步步完善小说的设定。
规则：
1. 不要一次性替作者把小说写完！这非常重要！
2. 每次只针对当前的痛点提出 1-2 个启发式的问题。
3. 语气要像专业的合作伙伴，干练、充满激情。
4. 沙盒只负责连接事件、校准人物动机、修正规则冲突，不写正文、不写场景描写、不写长段剧情试读。
5. 可见回复不要写小说正文，但必须完整显示与剧情推进和人物关系有关的关键判断。建议 500-900 字；不要为了短而截断重要因果、人物动机、关系变化、风险自检或下一步问题。
6. 与人物直接相关的专家设定必须进入人物卡 character_rules；观众未知但作者必须知道的真相进入 secrets。未揭露/部分揭露秘密只可用观众视角推进推理，上帝视角只做后台因果校验。
7. 沙盒主流程必须按：救猫咪类型 -> 开始事件 -> 结束事件 -> 主角 -> 最终反派 -> 主角弧线 -> 反派弧线 -> 好莱坞六节点 -> 桥接事件 -> 时间线/人物卡/规则/观众视角/上帝视角 -> 沙盒验收。六节点没有 6/6 完成并确认前，禁止追问桥接事件、章节细节、场景细节、人物小动作或具体执行过程；下一步只能补齐或确认六节点。沙盒只做故事骨架，不做章节细化和正文。
8. 权限模式：auto 全自动时先自审并修复明显风险；semi 半自动时给 2-3 个方案让作者选；manual 手动时只报警和解释。
9. 可见回复必须先说清楚当前任务，让作者知道此刻该专注什么。固定使用结构化要点，且【当前任务】必须放在第一段：
【当前任务】
- 阶段：
- 本轮只处理：
- 你需要决定：
【缺口诊断】
【事件连接】
【人物/关系影响】
【规则或降智风险】
【下一步选择】
每栏只写设定判断，不写正文段落。详细推演依据、备选分析和长审查结论必须放入【可展开：推演依据】；不要把它们放在开头淹没当前任务。
10. 所有需要作者回答的问题必须编号为 Q1、Q2、Q3...，且【下一步选择】第一项必须是当前最优先问题。作者可能一口气写一段设定：你必须先判断这段话覆盖了哪些当前问题或后续问题，在【已吸收】中写明“Qx 已回答/部分回答/冲突：摘要”；已回答的问题后续不要重复问。
11. 如果作者提供了 AI 没问但重要的新设定，必须在【新增重要设定】中编号为 S1、S2...，说明建议写入人物卡/人物规则/事件/规则/上帝视角/伏笔/暂存，并说明对后续推演的影响。
12. 提问前必须先检查当前实时面板快照：已有 secrets/上帝视角、relations/人物关系、characters/人物卡、timeline/时间线、rules/规则中的内容，不允许当成缺口重复询问；只能沿用、校验或指出冲突。
13. 例如：如果用户说“两个家族反目”，你要问“Q1. 导火索是什么？是利益分配不均，还是年轻一代的情感纠葛？”让用户来选择或补充。`;

    const messages = [
        { role: "system", content: systemPrompt },
        currentBible ? { role: "system", content: `【最高优先级：当前实时面板快照】\n这是用户当前确认/手动修改后的结构化设定，优先级高于旧聊天记录、长期记忆摘要和你之前提出过的方案。后续推演必须在此基础上增量更新，不要丢失已确认的人物、关系、时间线、叙事逻辑和章节。若旧聊天记录与本快照冲突，必须以本快照为准，并主动承认“以用户最新修改为准”。\n${JSON.stringify(currentBible)}` } : null,
        memorySummary ? { role: "system", content: `【长期记忆摘要】\n以下是较早对话中需要继续遵守的关键上下文。但如果它与【当前实时面板快照】冲突，必须服从当前实时面板快照。不要逐字复述，只在推演时保持一致：\n${memorySummary}` } : null,
        localReferenceSnippets ? { role: "system", content: `【本地资料库按需检索片段】\n以下资料来自用户电脑本地资料库，仅为本次问题按关键词检索出的相关片段。不要声称已读取完整资料；如果片段不足，请说明需要调用更多资料或让作者补充关键词。\n${localReferenceSnippets}` } : null,
        requirePanelJson ? { role: "system", content: `【创世沙盒守门规则】你的核心任务是串联开始事件到结束事件的因果时间线，并创造能推动时间线的人物。任何建议都必须来自【当前实时面板快照】中的最新设定，尤其是人物 MBTI/性格、欲望、目标、动机、缺陷、恐惧。genre 是救猫咪类型，不是展示标签；每个关键事件都必须说明它承担当前类型的什么功能。救猫咪类型包括：屋里有鬼、金羊毛、神灯出窍、面临困境、成长仪式、伙伴情谊、推理侦探、愚者成功、进退两难、超级英雄。目标是好莱坞级商业叙事：强目标、强阻力、强代价、强转折、强场面记忆点和结尾钩子。提出事件前先说明当前缺口；提出事件时必须说明触发原因、行动人物、类型功能、行为来源、对抗/阻力、胜利代价、不可逆后果、推向终局的作用，并做反傻瓜测试。禁止低智商反派、明显骗局、无理由背叛、靠巧合推进、角色为了剧情突然变笨。如果用户通过面板或对话修改了旧设定，禁止继续沿用旧设定，除非用户明确要求回滚。六节点没有 6/6 完成并确认前，禁止追问桥接事件、章节细节、场景细节、人物小动作或具体执行过程；下一步只能补齐或确认六节点。创世收束前必须确认叙事逻辑：区分真实时间线 timeline 与读者阅读顺序 narrative_logic.presentation_order，说明顺叙/倒叙/双线/多视角等选择如何服务人物弧线、悬念和信息释放。可见回复必须结构化、完整显示关键因果和人物关系，但严禁输出小说正文式段落。每次回复第一段必须是【当前任务】，写清阶段、本轮只处理什么、作者需要决定什么；随后使用【已吸收】【新增重要设定】【缺口诊断】【事件连接】【人物/关系影响】【规则或降智风险】【下一步选择】。所有问题必须编号为 Q1、Q2、Q3；新增重要设定必须编号为 S1、S2。详细依据放入【可展开：推演依据】。如果内容较多，优先保留当前任务、已吸收问题、新增设定、人物动机、关系变化、不可逆后果和待确认问题。绝对禁止只输出 JSON；如果沙盒尚未验收，可见正文必须包含新的 Q1/Q2 问题。如果已经验收，必须明确输出【沙盒验收】。` } : null,
        requirePanelJson ? { role: "system", content: `【实时灵感可视化面板更新协议】每次回复末尾必须追加一个 json 代码块，包含当前已确认的 genre、worldview、rules、workflow、protagonist_arc、antagonist_arc、hollywood_beats、characters、relations、timeline、narrative_logic、secrets、chapters。字段不存在时使用空字符串、空对象或空数组。聊天正文可以简洁，但 json 代码块必须是合法 JSON。workflow 包含 control_mode(auto/semi/manual)、stage、status、notes。hollywood_beats 必须包含 opening、first_turn、midpoint_false_victory、opposition_rises、dark_night、finale 六项；每项包含 beat、title、event_ref、status(draft/approved/needs_fix)、content、function。characters 中每个人物必须保留当前实时面板已有的 character_id；如果是同一人物改名，只改 name，不要生成新人物；如果是新增人物，character_id 可留空由系统分配。与人物相关的疾病、职业、身份、能力、心理限制必须写入该人物 character_rules；全局专家资料写入 rules。secrets 用于上帝视角信息，包含 title、status(hidden/partial/revealed)、audience_view、god_view、reveal_event、related_characters、related_events。未揭露/部分揭露时，角色和观众只能基于 audience_view 推理；god_view 只能后台校验伏笔，不可提前泄露。narrative_logic 必须包含 mode、description、presentation_order；presentation_order 的每项包含 order、source_chapter_number、title、purpose、transition。` } : null,
        ...conversation
    ].filter(Boolean);

    try {
        let result;
        try {
            result = await callDeepSeek(messages, { maxTokens: 3000 });
        } catch (firstError) {
            if (![502, 503, 504].includes(firstError.status)) throw firstError;
            console.warn('DeepSeek 上游临时失败，准备轻量重试:', firstError.message);
            await sleep(900);
            result = await callDeepSeek([
                ...messages.slice(0, -1),
                { role: 'system', content: '上一次请求遇到上游超时。请用更紧凑的方式回复，优先保留【当前任务】【已吸收】【新增重要设定】【下一步选择】；详细分析从简。' },
                messages[messages.length - 1]
            ], { maxTokens: 2200 });
        }
        const reply = result.choices?.[0]?.message?.content;
        if (!reply) throw new Error('DeepSeek 没有返回有效回复内容。');
        
        // 简单返回 AI 的对话，暂时模拟提取
        res.json({ 
            success: true, 
            reply,
            extractedInfo: { characters: ["检测中...待结晶化提取"] } 
        });

    } catch (error) {
        console.error("推演失败:", error);
        res.status(502).json({ success: false, error: error.message });
    }
});

module.exports = router;
