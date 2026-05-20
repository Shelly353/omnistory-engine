// backend/routes/ai.js
const express = require('express');
const router = express.Router();
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

router.post('/generate-chapter', async (req, res) => {
    const { title, synopsis, characters, hooks, currentText } = req.body;

    try {
        // 1. 结构化上下文压缩 (Context Compression)
        const charContext = characters && characters.length > 0 
            ? characters.map(c => `- ${c.name} (${c.role}, 阵营: ${c.faction || '未定'}): ${c.description}`).join('\n')
            : '本章暂无设定角色，请自由发挥或引入新角色。';
            
        const hookContext = hooks && hooks.length > 0 
            ? hooks.map(h => `- 【必须引爆的伏笔】: ${h.description}`).join('\n')
            : '无特殊伏笔需处理。';

        // 2. 铸造 AI 铁律 (System Prompt)
        const systemPrompt = `你是一位工业级小说主笔。你的任务是根据给定的【严格上下文】，撰写或续写本章的正文。
【铁律】：
1. 绝对不要偏离《本章任务梗概》的核心逻辑。
2. 只能使用《活跃角色情报》中提供的人物，绝不能虚构重要的新角色，且必须严格符合他们的性格与阵营设定。
3. 如果有《待引爆伏笔》，请务必将其自然地融入到本章剧情中，完成闭环。
4. 语言风格要符合赛博朋克/硬核悬疑的调性，文字要有画面感和张力。
5. 直接输出正文内容，绝不要输出任何解释性废话（如“好的，我这就开始写”）。`;

        // 3. 组装发给 AI 的弹药
        const userContent = `
【本章标题】: ${title}
【本章任务梗概】: ${synopsis}

【活跃角色情报】(切勿崩坏):
${charContext}

【局部时空雷达】(伏笔):
${hookContext}

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
