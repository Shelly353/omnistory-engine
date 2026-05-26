const { callAi } = require('./aiClient');
const { insert, insertMany } = require('./db');
const { getProject, getChapter, getContractForChapter, patchChapter } = require('./repositories');
const { compileChapterStartState } = require('./stateCompiler');
const { buildChapterContext } = require('./contextBuilder');
const { extractChapterFacts } = require('./extractionService');
const { auditChapter } = require('./auditService');

function wordCount(text = '') {
  return String(text).replace(/\s+/g, '').length;
}

function fallbackDraft(project, contract, state) {
  const characters = (state.active_characters || []).slice(0, 3).map(char => char.name).join('、') || '主角';
  return [
    `第${contract.chapter_number}章 ${contract.title}`,
    '',
    `夜色压在城市边缘，${characters}沿着上一章留下的线索继续向前。`,
    '',
    `这一章的目标很清楚：${contract.summary}`,
    '',
    '他没有把不确定的猜测说成结论，只把已经能证明的部分摊开。每一句话都像在试探地面是否结冰，谨慎，却没有退回去。',
    '',
    '阻力很快出现。对方没有直接否认，只改变了话题，把真正关键的信息藏在一段看似无关的细节里。主角意识到，如果继续沿用旧方法，只会被牵着走。',
    '',
    '于是他做出了一个小而不可逆的选择：不再独自处理线索，而是把其中一部分交给可信的人验证。这个决定没有立刻带来胜利，却改变了下一步的关系和信息流向。',
    '',
    '章节结束时，真相仍没有公开，但通向真相的门缝已经变宽。'
  ].join('\n');
}

async function generateDraft(chapterId) {
  const chapter = await getChapter(chapterId);
  if (!chapter) throw new Error('Chapter not found');
  const project = await getProject(chapter.project_id);
  const contract = await getContractForChapter(chapter.project_id, chapter.chapter_number);
  if (!contract) throw new Error('Chapter contract not found');

  const state = await compileChapterStartState(chapter.project_id, chapter.chapter_number);
  const context = await buildChapterContext({ project, contract, state });
  const fallback = fallbackDraft(project, contract, state);

  const ai = await callAi({
    fallback,
    system: '你是工业级长篇小说主笔。你只能执行章节契约和章前状态，不能新增重大事实、不能提前泄露秘密、不能改变 Canon。',
    user: `写作上下文：
${JSON.stringify(context)}

请写本章正文。只输出正文。`
  });

  const content = ai.content || fallback;
  const updated = await patchChapter(chapterId, {
    content,
    word_count: wordCount(content),
    status: 'drafted'
  });

  await insert('generation_runs', {
    project_id: chapter.project_id,
    operation: 'chapter.generate',
    input_payload: context,
    output_payload: { content },
    model: ai.model,
    status: 'success'
  });

  return { chapter: updated, state, contract };
}

async function reviewDraft(chapterId) {
  const chapter = await getChapter(chapterId);
  if (!chapter) throw new Error('Chapter not found');
  const project = await getProject(chapter.project_id);
  const contract = await getContractForChapter(chapter.project_id, chapter.chapter_number);
  const state = await compileChapterStartState(chapter.project_id, chapter.chapter_number);
  const extraction = await extractChapterFacts({ projectId: chapter.project_id, chapter, text: chapter.content });
  const audit = await auditChapter({ project, contract, state, text: chapter.content, extraction });

  await insertMany('audit_findings', (audit.findings || []).map(item => ({
    project_id: chapter.project_id,
    chapter_number: chapter.chapter_number,
    finding_type: item.type || 'unknown',
    severity: item.severity || 'warning',
    message: item.message || '',
    suggested_fix: item.suggested_fix || '',
    status: 'open'
  })));

  await insertMany('proposed_facts', (audit.proposed_facts || extraction.proposed_facts || []).map(item => ({
    project_id: chapter.project_id,
    chapter_number: chapter.chapter_number,
    fact_payload: item,
    risk_level: item.risk_level || 'medium',
    reason: item.reason || '',
    status: 'pending'
  })));

  await patchChapter(chapterId, {
    summary: extraction.summary || chapter.summary,
    status: audit.pass ? 'needs_approval' : 'blocked'
  });

  return { extraction, audit };
}

async function approveDraft(chapterId) {
  const chapter = await getChapter(chapterId);
  if (!chapter) throw new Error('Chapter not found');
  const extraction = await extractChapterFacts({ projectId: chapter.project_id, chapter, text: chapter.content });

  await insert('state_snapshots', {
    project_id: chapter.project_id,
    chapter_number: chapter.chapter_number,
    snapshot_type: 'chapter_end',
    payload: {
      summary: extraction.summary,
      scene_end_state: extraction.scene_end_state || {},
      state_delta: extraction.state_delta || [],
      actual_events: extraction.actual_events || []
    }
  });

  const stateDelta = extraction.state_delta || [];
  if (extraction.scene_end_state && !stateDelta.some(item => item.target_type === 'scene_continuity')) {
    stateDelta.push({
      target_type: 'scene_continuity',
      target: '主场景',
      before: '',
      after: JSON.stringify(extraction.scene_end_state),
      evidence: extraction.scene_end_state.continuity_note || ''
    });
  }

  await insertMany('state_transitions', stateDelta.map(item => ({
    project_id: chapter.project_id,
    chapter_number: chapter.chapter_number,
    source_event_id: null,
    target_type: item.target_type || 'unknown',
    target_id: item.target || '',
    before_state: { value: item.before || '' },
    after_state: { value: item.after || '' },
    evidence: item.evidence || '',
    approved: true
  })));

  return patchChapter(chapterId, { status: 'approved', summary: extraction.summary || chapter.summary });
}

module.exports = { generateDraft, reviewDraft, approveDraft };
