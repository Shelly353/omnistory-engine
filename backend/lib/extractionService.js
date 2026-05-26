const { callAi } = require('./aiClient');

function fallbackExtraction(chapter, text) {
  return {
    summary: String(text || '').slice(0, 300),
    scene_end_state: {
      location: '',
      transport: '',
      body_posture: '',
      active_action: '',
      continuity_note: 'fallback 未能可靠抽取场景状态；下一章需从正文末段人工确认。'
    },
    actual_events: [
      {
        title: chapter.title,
        description: '本章按章节契约推进了主线事件。',
        evidence: String(text || '').slice(0, 120)
      }
    ],
    state_delta: [
      {
        target_type: 'scene_continuity',
        target: '主场景',
        before: '',
        after: 'fallback 未能可靠抽取；请在审校中补充本章结束地点、交通、姿态和动作。',
        evidence: String(text || '').slice(-160)
      }
    ],
    proposed_facts: [],
    possible_secret_leakage: []
  };
}

async function extractChapterFacts({ projectId, chapter, text }) {
  const fallback = fallbackExtraction(chapter, text);
  const result = await callAi({
    json: true,
    fallback,
    system: '你是小说连续性审计员。只抽取正文实际写出的事实，返回 JSON，不要补脑。',
    user: `项目ID：${projectId}
章节：第 ${chapter.chapter_number} 章《${chapter.title}》
正文：
${text}

请返回 JSON：
{
  "summary": "不超过200字章节摘要",
  "scene_end_state": {"location":"","transport":"","body_posture":"","active_action":"","continuity_note":"本章结束时人物在哪里、使用什么交通方式、身体姿态是什么、正在做什么"},
  "actual_events": [{"title":"","description":"","evidence":""}],
  "state_delta": [{"target_type":"character|relationship|secret|hook|world|scene_continuity","target":"","before":"","after":"","evidence":""}],
  "proposed_facts": [{"fact_type":"","subject":"","predicate":"","object":"","risk_level":"low|medium|high","reason":""}],
  "possible_secret_leakage": [{"secret_title":"","evidence":"","reason":""}]
}`
  });
  return result.parsed || fallback;
}

module.exports = { extractChapterFacts };
