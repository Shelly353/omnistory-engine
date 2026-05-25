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
                `- ${c.name} (唯一ID: ${c.id || c.name || '未定'}, ${c.role || '未知定位'}, 阵营: ${c.faction || '未定'})`,
                `  职业/职位/身份: ${[c.profession, c.position, c.occupation].filter(Boolean).join(' / ') || '未设定'}`,
                `  性格/MBTI: ${c.personality || c.mbti || '未知'}`,
                `  核心欲望: ${c.core_desire || '未知'} | 目标: ${c.goal || '未知'} | 动机: ${c.motivation || '未知'}`,
                `  缺陷: ${c.flaw || '未知'} | 恐惧: ${c.fear || '未知'} | 成长弧光: ${c.character_arc || '未知'}`,
                `  人物规则: ${c.character_rules || '见背景中的【人物规则】或暂无'}`,
                `  职业/能力: ${c.profession || '未知'} / ${c.skills || '未知'}`,
                `  背景/简介: ${c.background || ''} ${c.description || ''}`.trim()
            ].join('\n')).join('\n')
            : '本章暂无设定角色。禁止擅自创造重要角色、职位、关系或背景；如必须出现路人，只能作为无姓名、无剧情决策权的场景功能人物。';
            
        const hookContext = hooks && hooks.length > 0 
            ? hooks.map(h => `- 【必须引爆的伏笔】: ${h.description}`).join('\n')
            : '无特殊伏笔需处理。';

        // 2. 铸造 AI 铁律 (System Prompt)
        const systemPrompt = `你是一位工业级小说主笔。你的任务是根据给定的【严格上下文】，撰写或续写本章的正文。
【铁律】：
1. 绝对不要偏离《本章任务梗概》的核心逻辑。
2. 只能使用《活跃角色情报》中提供的人物，绝不能虚构重要的新角色，且必须严格符合他们的人物卡。人物姓名、唯一ID、职位、职业、身份、阵营、关系、能力、病症、经历、性格/MBTI、欲望、目标、动机、缺陷、恐惧、成长弧线都是不可改事实。
3. 不得把未设定内容写成确定事实，不得临时新增会改变剧情的亲属、上级、下属、头衔或履历。例如人物卡是“刑侦队长”，正文绝不能写成“副所长”；如确需变动，必须先修改人物卡或事件设定，不能在正文中自行改。
4. 如果有《待引爆伏笔》，请务必将其自然地融入到本章剧情中，完成闭环。
5. 《统一规则/专家资料》是世界规则与专家系统的合并结果。涉及职业、行业或学科时，必须遵守其中的流程、术语、权限边界、常见误区和真实感细节；资料不足时不要装懂，不要编造确定专业结论。
6. 历史专家为内置后台能力。涉及历史剧、古代、朝代、官职、科举、礼法、战争时，必须检查朝代/年代、官职称谓、礼法礼仪、服饰器物、交通通讯、军队调动、审案/科举/婚嫁/朝会流程，以及现代价值观误套问题；史实不确定时不要写成确定事实。
7. 写作时内置监督系统：检查因果链、信息来源、人物动机、救猫咪类型契合度、专业真实感、伏笔闭环，避免不合逻辑、强行巧合、人物降智。
8. 救猫咪类型如果出现在《统一规则/专家资料与正文监督标准》中，必须作为本章叙事承诺执行；每个主要场景都要服务该类型的读者期待。
9. MBTI/性格不是标签，必须影响人物的措辞、风险偏好、回避策略、冲突处理和关键选择；除非有明确压力和转折，否则不要写出与性格相反的行为。
10. 好莱坞级叙事要求：每个场景都必须有明确目标、阻力、情绪变化、信息释放或反转；必须有场面记忆点和结尾钩子，避免流水账。
11. 必须执行长篇节奏制动：除非任务明确是高潮章/追逐章/连续危机章，否则不得连续三个场景都是高压推进或重大事件爆发。重大事件之后必须有短反应空间：情绪余波、信息整理、关系变化、身体代价、环境观察或铺垫。
12. 呼吸段不是水文，必须服务人物弧光、关系线、世界质感、伏笔铺垫、信息消化或下一次选择。不得把大纲里的多个事件压缩成连续爆点；一个自然段最多承载一个主要动作/信息变化。
13. 如果提供了《本章场景卡》，必须按场景卡顺序写作；可以润色合并，但不能丢掉场景目标、冲突、升级点、压力等级、反应/消化场和结尾钩子。
14. 如果《本章任务梗概》中包含“SOP写作硬边界”“已确认的本事件故事梗概”或“最终SOP大纲”，这些内容是最高优先级。不得新增会改变因果链的事件、隐藏真相、反派计划、人物关系、能力、道具、死因、时间顺序或世界规则；不得提前解决下一事件；不得把下一事件核心内容写进当前事件。
15. 如果需要补充《本章任务梗概》没有写明的环境、动作、心理、对白，只能补不改变剧情事实的表现层细节。任何创造性润色都不能覆盖已确认梗概和最终大纲。
16. 如果《本章场景卡》《角色声音》《对白专项》《动作/场面导演》与《已确认的本事件故事梗概》或《最终SOP大纲》冲突，必须服从事件梗概和最终大纲；如果它们导致节奏过载，必须保留事件事实但降低爆发密度。
17. 如果《好莱坞大片蓝图/阻力/长篇状态》中包含篇幅规划、节拍表、连续性账本、章节看板、强制验收或人物/反派弧光表，正文必须服务这些全书生产约束。
18. 如果《好莱坞大片蓝图/阻力/长篇状态》中包含角色声音、对白专项、动作/场面导演、情感/关系线、主题与母题追踪，正文必须执行：人物说话要可区分，场面要有空间和代价，关系变化要由选择触发，主题要通过意象和行动呈现。
19. 涉及历史、法律、医疗、行业流程、现实资料时，必须优先依据《统一规则/专家资料与正文监督标准》或本地资料片段；资料不足时写得谨慎，不要伪造来源或确定事实。
20. 如果上下文包含《上帝视角信息权限》，未揭露/部分揭露的秘密只能用于后台因果校验，正文中的角色和观众只能知道观众视角；已揭露后才可把上帝视角作为公开事实。
21. 用词、器物、货币、称谓、计量单位和时代语感必须连续一致。同一物件不能前后变形，例如“碎银三两”不能无因写成“铜钱洒了一地”；如需兑换、掉包、误认或伪装，必须在正文中交代原因。
22. 语言风格要符合当前作品调性，文字要有画面感和张力。
23. 输出前必须自检：人物卡事实、SOP事件事实、世界规则、伏笔权限、用词体系、节奏是否被你破坏；发现冲突或节奏过载必须在输出前自行修正。
24. 直接输出正文内容，绝不要输出任何解释性废话（如“好的，我这就开始写”）。`;

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
${sceneCard || '暂无独立场景卡；请自行按目标-阻力-转折-情绪变化-反应/消化-结尾钩子组织场景，避免连续爆点。'}

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
                temperature: 0.65
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
