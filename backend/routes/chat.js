// backend/routes/chat.js
const express = require('express');
const router = express.Router();

// 我们暂时使用环境变量里的 KEY，如果你没在 .env 写，就暂时填明文
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

router.post('/deduce', async (req, res) => {
    const { conversation = [], memorySummary = '', currentBible = null, requirePanelJson = false, localReferenceSnippets = '' } = req.body;
    
    // 我们给 AI 的超级系统指令 (System Prompt)
    const systemPrompt = `你是一位顶级的网文主编和世界观架构师。用户正在使用一个名为 OmniStory 的推演沙盒。
你的任务是通过对话，引导作者一步步完善小说的设定。
规则：
1. 不要一次性替作者把小说写完！这非常重要！
2. 每次只针对当前的痛点提出 1-2 个启发式的问题。
3. 语气要像专业的合作伙伴，干练、充满激情。
4. 沙盒只负责连接事件、校准人物动机、修正规则冲突，不写正文、不写场景描写、不写长段剧情试读。
5. 可见回复控制在 180 字以内，最多 3 个短要点加 1 个问题；只谈事件因果、人物选择、规则约束和待确认项。
6. 例如：如果用户说“两个家族反目”，你要问“导火索是什么？是利益分配不均，还是年轻一代的情感纠葛？”让用户来选择或补充。`;

    const messages = [
        { role: "system", content: systemPrompt },
        currentBible ? { role: "system", content: `【最高优先级：当前实时面板快照】\n这是用户当前确认/手动修改后的结构化设定，优先级高于旧聊天记录、长期记忆摘要和你之前提出过的方案。后续推演必须在此基础上增量更新，不要丢失已确认的人物、关系、时间线、叙事逻辑和章节。若旧聊天记录与本快照冲突，必须以本快照为准，并主动承认“以用户最新修改为准”。\n${JSON.stringify(currentBible)}` } : null,
        memorySummary ? { role: "system", content: `【长期记忆摘要】\n以下是较早对话中需要继续遵守的关键上下文。但如果它与【当前实时面板快照】冲突，必须服从当前实时面板快照。不要逐字复述，只在推演时保持一致：\n${memorySummary}` } : null,
        localReferenceSnippets ? { role: "system", content: `【本地资料库按需检索片段】\n以下资料来自用户电脑本地资料库，仅为本次问题按关键词检索出的相关片段。不要声称已读取完整资料；如果片段不足，请说明需要调用更多资料或让作者补充关键词。\n${localReferenceSnippets}` } : null,
        requirePanelJson ? { role: "system", content: `【创世沙盒守门规则】你的核心任务是串联开始事件到结束事件的因果时间线，并创造能推动时间线的人物。任何建议都必须来自【当前实时面板快照】中的最新设定，尤其是人物 MBTI/性格、欲望、目标、动机、缺陷、恐惧。genre 是救猫咪类型，不是展示标签；每个关键事件都必须说明它承担当前类型的什么功能。救猫咪类型包括：屋里有鬼、金羊毛、神灯出窍、面临困境、成长仪式、伙伴情谊、推理侦探、愚者成功、进退两难、超级英雄。目标是好莱坞级商业叙事：强目标、强阻力、强代价、强转折、强场面记忆点和结尾钩子。提出事件前先说明当前缺口；提出事件时必须说明触发原因、行动人物、类型功能、行为来源、对抗/阻力、胜利代价、不可逆后果、推向终局的作用，并做反傻瓜测试。禁止低智商反派、明显骗局、无理由背叛、靠巧合推进、角色为了剧情突然变笨。如果用户通过面板或对话修改了旧设定，禁止继续沿用旧设定，除非用户明确要求回滚。创世收束前必须确认叙事逻辑：区分真实时间线 timeline 与读者阅读顺序 narrative_logic.presentation_order，说明顺叙/倒叙/双线/多视角等选择如何服务人物弧线、悬念和信息释放。可见回复必须短，只给设定判断、事件连接方案、人物动机校准和下一步问题；严禁输出小说正文式段落。` } : null,
        requirePanelJson ? { role: "system", content: `【实时灵感可视化面板更新协议】每次回复末尾必须追加一个 json 代码块，包含当前已确认的 genre、worldview、rules、characters、relations、timeline、narrative_logic、chapters。字段不存在时使用空字符串、空对象或空数组。聊天正文可以简洁，但 json 代码块必须是合法 JSON。narrative_logic 必须包含 mode、description、presentation_order；presentation_order 的每项包含 order、source_chapter_number、title、purpose、transition。` } : null,
        ...conversation
    ].filter(Boolean);

    try {
        const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${DEEPSEEK_KEY}` 
            },
            body: JSON.stringify({
                model: "deepseek-v4-flash",
                messages: messages,
                temperature: 0.7,
                max_tokens: 3500
            })
        });

        if (!dsResponse.ok) throw new Error(`DeepSeek 报错: ${dsResponse.status}`);
        const result = await dsResponse.json();
        
        // 简单返回 AI 的对话，暂时模拟提取
        res.json({ 
            success: true, 
            reply: result.choices[0].message.content,
            extractedInfo: { characters: ["检测中...待结晶化提取"] } 
        });

    } catch (error) {
        console.error("推演失败:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
