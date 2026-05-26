const { callAi } = require('./aiClient');
const { findCanonConflicts } = require('./canonService');

function localAudit({ text, contract, state, extraction }) {
  const findings = [];
  findings.push(...findCanonConflicts(text, state.known_facts || []));

  const hiddenLeak = (state.hidden_facts || []).find(secret =>
    secret.god_view && String(text || '').includes(secret.god_view)
  );
  if (hiddenLeak) {
    findings.push({
      type: 'secret_leakage',
      severity: 'blocking',
      message: `正文提前写出了隐藏秘密《${hiddenLeak.title}》的上帝视角。`,
      suggested_fix: '改成角色只发现观众视角线索，不直接揭露真相。'
    });
  }

  const expected = JSON.stringify(contract.expected_end_state || {});
  if (expected && expected.length > 8 && extraction.state_delta?.length === 0) {
    findings.push({
      type: 'state_transition_weak',
      severity: 'warning',
      message: '正文没有抽取到明确状态迁移，可能未完成章节契约要求。',
      suggested_fix: '补强本章事件造成的认知、关系、资源或目标变化。'
    });
  }

  const expectedScene = contract.expected_end_state?.scene_continuity || contract.expected_start_state?.scene_continuity;
  const sceneDelta = (extraction.state_delta || []).find(item => item.target_type === 'scene_continuity');
  if (expectedScene && !sceneDelta && !extraction.scene_end_state) {
    findings.push({
      type: 'scene_continuity_missing',
      severity: 'warning',
      message: '正文没有明确记录本章结束时的地点、交通方式、身体姿态和正在进行的动作，下一章容易发生场景漂移。',
      suggested_fix: '在结尾补一句能锁定连续性的动作或位置，例如车是否停下、谁在驾驶、谁坐在哪、人物是否已下车。'
    });
  }

  const proposedHighRisk = (extraction.proposed_facts || []).filter(item => item.risk_level === 'high');
  proposedHighRisk.forEach(item => {
    findings.push({
      type: 'new_high_risk_fact',
      severity: 'blocking',
      message: `正文新增高风险事实：${item.subject || ''}${item.predicate || ''}${item.object || ''}`,
      suggested_fix: '删除该事实，或提交给用户确认后再更新 Canon。'
    });
  });

  return findings;
}

async function auditChapter({ project, contract, state, text, extraction }) {
  const fallbackFindings = localAudit({ text, contract, state, extraction });
  const fallback = {
    pass: !fallbackFindings.some(item => item.severity === 'blocking'),
    severity: fallbackFindings.some(item => item.severity === 'blocking') ? 'blocking' : (fallbackFindings.length ? 'warning' : 'pass'),
    findings: fallbackFindings,
    state_delta: extraction.state_delta || [],
    proposed_facts: extraction.proposed_facts || [],
    revision_instructions: fallbackFindings.map(item => item.suggested_fix).filter(Boolean)
  };

  const result = await callAi({
    json: true,
    fallback,
    system: '你是长篇小说一致性总审。你不能替正文合理化错误，只能判断是否违反设定、状态和章节契约。输出 JSON。',
    user: `项目：${project.title}
章节契约：
${JSON.stringify(contract)}

章前合法状态：
${JSON.stringify(state)}

正文事实抽取：
${JSON.stringify(extraction)}

正文：
${text}

请返回 JSON：
{
  "pass": true,
  "severity": "pass|warning|blocking",
  "findings": [{"type":"","severity":"warning|blocking","message":"","suggested_fix":""}],
  "state_delta": [],
  "proposed_facts": [],
  "revision_instructions": []
}`
  });

  const parsed = result.parsed || fallback;
  const combined = [...fallbackFindings, ...(parsed.findings || [])]
    .filter(item => item && item.message && !/状态迁移|state_transition_weak/i.test(item.type || ''));
  const unique = Array.from(new Map(combined.map(item => [`${item.type}:${item.message}`, item])).values());
  const normalized = unique.map(item => ({
    ...item,
    severity: item.severity === 'blocking' && /场景|节奏|状态迁移|scene|transition/i.test(`${item.type} ${item.message}`)
      ? 'warning'
      : item.severity
  }));
  return {
    ...parsed,
    findings: normalized,
    pass: !normalized.some(item => item.severity === 'blocking'),
    severity: normalized.some(item => item.severity === 'blocking') ? 'blocking' : (normalized.length ? 'warning' : 'pass')
  };
}

module.exports = { auditChapter };
