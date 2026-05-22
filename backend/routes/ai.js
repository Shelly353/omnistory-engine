// backend/routes/ai.js
const express = require('express');
const router = express.Router();
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

router.post('/generate-chapter', async (req, res) => {
    const { title, synopsis, characters, hooks, currentText, qualityGuardrails, sceneCard, blockbusterContext } = req.body;

    try {
        // 1. 结构化上下文压缩 (Context Compression)
        const charContext = characters && characters.length > 0 
            ? characters.map(c => [
                `- ${c.name} (${c.role || '未知定位'}, 阵营: ${c.faction || '未定'})`,
                `  性格/MBTI: ${c.personality || '未知'}`,
                `  核心欲望: ${c.core_desire || '未知'} | 目标: ${c.goal || '未知'} | 动机: ${c.motivation || '未知'}`,
                `  缺陷: ${c.flaw || '未知'} | 恐惧: ${c.fear || '未知'} | 成长弧光: ${c.character_arc || '未知'}`,
                `  职业/能力: ${c.profession || '未知'} / ${c.skills || '未知'}`,
                `  背景/简介: ${c.background || ''} ${c.description || ''}`.trim()
            ].join('\n')).join('\n')
            : '本章暂无设定角色，请自由发挥或引入新角色。';
            
        const hookContext = hooks && hooks.length > 0 
            ? hooks.map(h => `- 【必须引爆的伏笔】: ${h.description}`).join('\n')
            : '无特殊伏笔需处理。';

        // 2. 铸造 AI 铁律 (System Prompt)
        const systemPrompt = `你是一位工业级小说主笔。你的任务是根据给定的【严格上下文】，撰写或续写本章的正文。
【铁律】：
1. 绝对不要偏离《本章任务梗概》的核心逻辑。
2. 只能使用《活跃角色情报》中提供的人物，绝不能虚构重要的新角色，且必须严格符合他们的性格/MBTI、欲望、目标、动机、缺陷、恐惧、成长弧线与阵营设定。
3. 如果有《待引爆伏笔》，请务必将其自然地融入到本章剧情中，完成闭环。
4. 《统一规则/专家资料》是世界规则与专家系统的合并结果。涉及职业、行业或学科时，必须遵守其中的流程、术语、权限边界、常见误区和真实感细节；资料不足时不要装懂，不要编造确定专业结论。
5. 历史专家为内置后台能力。涉及历史剧、古代、朝代、官职、科举、礼法、战争时，必须检查朝代/年代、官职称谓、礼法礼仪、服饰器物、交通通讯、军队调动、审案/科举/婚嫁/朝会流程，以及现代价值观误套问题；史实不确定时不要写成确定事实。
6. 写作时内置监督系统：检查因果链、信息来源、人物动机、救猫咪类型契合度、专业真实感、伏笔闭环，避免不合逻辑、强行巧合、人物降智。
7. 救猫咪类型如果出现在《统一规则/专家资料与正文监督标准》中，必须作为本章叙事承诺执行；每个主要场景都要服务该类型的读者期待。
8. MBTI/性格不是标签，必须影响人物的措辞、风险偏好、回避策略、冲突处理和关键选择；除非有明确压力和转折，否则不要写出与性格相反的行为。
9. 好莱坞级叙事要求：每个场景都必须有明确目标、阻力、情绪变化、信息释放或反转；必须有场面记忆点和结尾钩子，避免流水账。
10. 如果提供了《本章场景卡》，必须按场景卡顺序写作；可以润色合并，但不能丢掉场景目标、冲突、升级点和结尾钩子。
11. 如果《好莱坞大片蓝图/阻力/长篇状态》中包含篇幅规划、节拍表、连续性账本、章节看板、强制验收或人物/反派弧光表，正文必须服务这些全书生产约束。
12. 如果《好莱坞大片蓝图/阻力/长篇状态》中包含角色声音、对白专项、动作/场面导演、情感/关系线、主题与母题追踪，正文必须执行：人物说话要可区分，场面要有空间和代价，关系变化要由选择触发，主题要通过意象和行动呈现。
13. 涉及历史、法律、医疗、行业流程、现实资料时，必须优先依据《统一规则/专家资料与正文监督标准》或本地资料片段；资料不足时写得谨慎，不要伪造来源或确定事实。
14. 语言风格要符合当前作品调性，文字要有画面感和张力。
15. 直接输出正文内容，绝不要输出任何解释性废话（如“好的，我这就开始写”）。`;

        // 3. 组装发给 AI 的弹药
        const userContent = `
【本章标题】: ${title}
【本章任务梗概】: ${synopsis}

【活跃角色情报】(切勿崩坏):
${charContext}

【局部时空雷达】(伏笔):
${hookContext}

【好莱坞大片蓝图/阻力/长篇状态】:
${blockbusterContext || '暂无额外大片蓝图；请按本章大纲建立目标、阻力、代价、反转和结尾钩子。'}

【本章场景卡】:
${sceneCard || '暂无独立场景卡；请自行按目标-阻力-转折-情绪变化-结尾钩子组织场景。'}

【统一规则/专家资料与正文监督标准】:
${qualityGuardrails || '暂无额外规则；请优先保持因果清楚、人物动机可信、专业细节谨慎。'}

${currentText ? `【前文已写内容，请顺着情节继续往下写】:\n${currentText}` : `【请从本章开头开始进行高质量的开篇创作】`}
`;

        // 4. 呼叫大模型
        const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
            body: JSON.stringify({
                model: "deepseek-v4-flash",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                temperature: 0.85 // 略微调高一点，增加文笔的文学创造力
            })
        });

        if (!dsResponse.ok) throw new Error("AI 续写请求失败");
        const data = await dsResponse.json();
        
        res.json({ success: true, text: data.choices[0].message.content });

    } catch (err) {
        console.error("AI 写作失败:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. 🌉 时空桥接器：计算插入章节的承上启下内容
router.post('/bridge-chapters', async (req, res) => {
    // 💥 接收 userDraft (用户写的草稿内容)
    const { prevChapter, nextChapter, newChapterTitle, userDraft } = req.body;

    try {
        const systemPrompt = `你是一位工业级剧情缝合专家。
作者在两章之间插入了一个新章节，并提供了一些【初始灵感/草稿】。
你的任务：结合前一章的结束、后一章的开始，以及作者提供的【草稿】，缝合成一段逻辑严密、文笔精彩的【章节梗概】。
【核心指令】：
1. 必须保留并扩充作者草稿中的核心信息。
2. 必须解释清楚剧情是如何从前一章演进到这段草稿，再如何过渡到后一章的。
3. 保持世界观的一致性，语气要干练。`;

        const userContent = `
【前一章：${prevChapter ? prevChapter.title : '无'}】
梗概：${prevChapter ? prevChapter.content : '无'}

【目标新章节标题】：${newChapterTitle}
【作者提供的初始灵感/草稿】：
"${userDraft || '作者未提供具体内容，请根据前后逻辑自由推演'}"

【后一章：${nextChapter ? nextChapter.title : '无'}】
梗概：${nextChapter ? nextChapter.content : '无'}

请生成一段约 200 字的“章节梗概”，作为该章节的写作指导。`;

        const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            body: JSON.stringify({
                model: "deepseek-v4-flash",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                temperature: 0.7
            })
        });

        const result = await dsResponse.json();
        res.json({ success: true, synopsis: result.choices[0].message.content });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ==========================================
// ⏱️ 时空侦测智能体 (自动扫描正文提取时间轴)
// ==========================================
router.post('/extract-timeline', async (req, res) => {
    const { chapterNumber, chapterTitle, chapterText } = req.body;

    try {
        const systemPrompt = `你是一位严谨的故事时间线整理专家。
你的任务是从作者提供的【章节正文】中，提取出 1 到 3 个对主线有重大影响的核心事件，并整理成严格的 JSON 数组格式。
要求：
1. 提取的事件必须是真实的“物理发生”，忽略人物的纯内心戏。
2. 尽量找出文本中隐含的时间标度（如“第二天清晨”、“三天后”）。如果没有，请根据章节推断一个合理的时间标签。
3. 必须返回纯净的 JSON 数组，绝对不要任何多余的 Markdown 标记（如 \`\`\`json ）！
格式范例：
[
  { "time_label": "第三天深夜", "description": "主角在废弃仓库发现了打火机。" },
  { "time_label": "第四天清晨", "description": "副队长身份暴露遭到吞噬。" }
]`;

        const userContent = `【当前章节】：第 ${chapterNumber} 章 - ${chapterTitle}\n【章节正文】：\n${chapterText || "（暂无正文）"}\n\n请立即提取本章核心事件并返回 JSON 数组：`;

        const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` 
            },
            body: JSON.stringify({
                model: "deepseek-v4-flash",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                temperature: 0.1 // 低温度确保 JSON 结构稳定
            })
        });

        const result = await dsResponse.json();
        if (result.error) throw new Error(result.error.message);

        // 清洗 AI 返回的字符串
        let jsonStr = result.choices[0].message.content.trim();
        if (jsonStr.startsWith("```json")) {
            jsonStr = jsonStr.replace(/^```json/, "").replace(/```$/, "").trim();
        }

        const events = JSON.parse(jsonStr);
        res.json({ success: true, events });

    } catch (err) {
        console.error("AI 提取时间线故障:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
module.exports = router;
