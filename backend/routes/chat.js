// backend/routes/chat.js
const express = require('express');
const router = express.Router();

// 我们暂时使用环境变量里的 KEY，如果你没在 .env 写，就暂时填明文
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

router.post('/deduce', async (req, res) => {
    const { conversation = [], memorySummary = '', requirePanelJson = false } = req.body;
    
    // 我们给 AI 的超级系统指令 (System Prompt)
    const systemPrompt = `你是一位顶级的网文主编和世界观架构师。用户正在使用一个名为 OmniStory 的推演沙盒。
你的任务是通过对话，引导作者一步步完善小说的设定。
规则：
1. 不要一次性替作者把小说写完！这非常重要！
2. 每次只针对当前的痛点提出 1-2 个启发式的问题。
3. 语气要像专业的合作伙伴，干练、充满激情。
4. 例如：如果用户说“两个家族反目”，你要问“导火索是什么？是利益分配不均，还是年轻一代的情感纠葛？”让用户来选择或补充。`;

    const messages = [
        { role: "system", content: systemPrompt },
        memorySummary ? { role: "system", content: `【长期记忆摘要】\n以下是较早对话中需要继续遵守的关键上下文。不要逐字复述，只在推演时保持一致：\n${memorySummary}` } : null,
        requirePanelJson ? { role: "system", content: `【实时灵感可视化面板更新协议】每次回复末尾必须追加一个 json 代码块，包含当前已确认的 genre、worldview、rules、characters、relations、timeline、chapters。字段不存在时使用空字符串或空数组。聊天正文可以简洁，但 json 代码块必须是合法 JSON。` } : null,
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
                model: "deepseek-chat",
                messages: messages,
                temperature: 0.7
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
