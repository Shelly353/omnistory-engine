const steps = ['bible', 'canon', 'beats', 'events', 'chapters', 'draft'];

const state = {
  projectId: '',
  chapterId: '',
  projectBundle: null,
  activeTab: 'bible',
  runningStep: ''
};

function $(id) {
  return document.getElementById(id);
}

function tokenHeaders() {
  const token = localStorage.getItem('omnistory_access_token') || localStorage.getItem('novel_access_token') || '';
  return token ? { 'x-omnistory-token': token, 'x-novel-token': token } : {};
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...tokenHeaders(),
      ...(options.headers || {})
    }
  });
  if (res.status === 401) {
    localStorage.removeItem('omnistory_access_token');
    localStorage.removeItem('novel_access_token');
    const token = prompt('请输入访问口令');
    if (token) {
      localStorage.setItem('omnistory_access_token', token.trim());
      localStorage.setItem('novel_access_token', token.trim());
      return api(path, options);
    }
    throw new Error('需要访问口令');
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function runStep(step, label, fn, nextStep = '') {
  state.runningStep = step;
  updateStepStatus();
  document.body.classList.add('busy');
  toast(`${label}创建中...`);
  try {
    const result = await fn();
    state.runningStep = '';
    if (state.projectId) await refreshProject(false);
    updateStepStatus();
    toast(`${label}已完成`);
    if (nextStep) activateTab(nextStep);
    return result;
  } catch (err) {
    console.error(err);
    toast(formatError(err, label));
    throw err;
  } finally {
    state.runningStep = '';
    document.body.classList.remove('busy');
    updateStepStatus();
  }
}

function formatError(err, label = '操作') {
  const message = err.message || `${label}失败`;
  if (/schema cache|尚未创建表|Could not find the table|does not exist/i.test(message)) {
    return '数据库表还没初始化：请在 Supabase SQL Editor 执行 supabase/schema.sql，然后刷新页面。';
  }
  return message;
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value || '');
  }
}

function parseJsonField(value, fallback = []) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const parsed = JSON.parse(raw);
  return parsed;
}

function parseBibleEditor() {
  const raw = $('bibleEditor').value.trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function showProjectPage() {
  $('projectPage').classList.remove('hidden');
  $('workspacePage').classList.add('hidden');
  $('backToProjects').classList.add('hidden');
  $('projectStatus').textContent = '项目管理';
  state.projectId = '';
  state.chapterId = '';
  state.projectBundle = null;
}

function showWorkspace() {
  $('projectPage').classList.add('hidden');
  $('workspacePage').classList.remove('hidden');
  $('backToProjects').classList.remove('hidden');
}

function activateTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tab);
  });
}

function stepDoneMap() {
  const bundle = state.projectBundle || {};
  const events = bundle.events || [];
  const chapters = bundle.chapters || [];
  const selectedChapter = chapters.find(chapter => chapter.id === state.chapterId);
  return {
    bible: Boolean(bundle.bible?.payload),
    canon: Boolean((bundle.canon || []).length),
    beats: events.some(event => event.status === 'beat'),
    events: events.some(event => event.status !== 'beat'),
    chapters: Boolean(chapters.length),
    draft: Boolean(selectedChapter?.content || selectedChapter?.status === 'approved')
  };
}

function updateStepStatus() {
  const done = stepDoneMap();
  document.querySelectorAll('.tab').forEach(button => {
    const tab = button.dataset.tab;
    const label = button.querySelector('b');
    button.classList.toggle('creating', state.runningStep === tab);
    button.classList.toggle('done', done[tab]);
    if (state.runningStep === tab) label.textContent = '创建中';
    else label.textContent = done[tab] ? '已完成' : '待创建';
  });
}

async function loadProjects() {
  const data = await api('/api/projects');
  const list = $('projectList');
  list.innerHTML = '';
  $('projectCount').textContent = `${data.projects.length} 个项目`;
  data.projects.forEach(project => {
    const row = document.createElement('article');
    row.className = 'project-card';
    row.innerHTML = `
      <div>
        <h3>${escapeHtml(project.title)}</h3>
        <p>${escapeHtml(project.concept || '').slice(0, 140)}</p>
        <span>${project.target_words || 200000} 字 · ${escapeHtml(project.style_profile || '默认商业网文')}</span>
      </div>
      <div class="card-actions">
        <button type="button" data-open="${project.id}">打开</button>
        <button type="button" class="danger" data-delete="${project.id}">删除</button>
      </div>
    `;
    row.querySelector('[data-open]').onclick = () => selectProject(project.id);
    row.querySelector('[data-delete]').onclick = async () => {
      if (!confirm(`删除项目《${project.title}》？这会删除该项目的圣经、Canon、章节和审校记录。`)) return;
      await deleteProject(project.id);
    };
    list.appendChild(row);
  });
}

async function deleteProject(projectId) {
  await runStep('', '删除项目', async () => {
    await api(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (state.projectId === projectId) showProjectPage();
    await loadProjects();
  });
}

async function selectProject(projectId) {
  state.projectId = projectId;
  localStorage.setItem('nws_recent_project_id', projectId);
  const data = await api(`/api/projects/${projectId}`);
  state.projectBundle = data;
  $('projectStatus').textContent = data.project.title;
  $('subtitle').textContent = data.project.concept || '长篇小说一致性工作流';
  $('bibleEditor').value = data.bible?.payload ? safeJson(data.bible.payload) : '';
  showWorkspace();
  renderProjectBundle();
  updateStepStatus();
}

async function refreshProject(renderToast = true) {
  if (!state.projectId) return;
  const data = await api(`/api/projects/${state.projectId}`);
  state.projectBundle = data;
  $('projectStatus').textContent = data.project.title;
  $('bibleEditor').value = data.bible?.payload ? safeJson(data.bible.payload) : $('bibleEditor').value;
  renderProjectBundle();
  await loadProposedFacts();
  if (renderToast) toast('已刷新');
}

function renderProjectBundle() {
  const bundle = state.projectBundle;
  if (!bundle) return;
  const findings = bundle.findings || [];
  $('auditStatus').textContent = findings.some(f => f.severity === 'blocking') ? 'Blocked' : (findings.length ? 'Warning' : 'Clean');
  renderCanon(bundle.canon || []);
  renderEventEditors('beatList', (bundle.events || []).filter(event => event.status === 'beat'), 'beat');
  renderEventEditors('eventList', (bundle.events || []).filter(event => event.status !== 'beat'), 'planned');
  renderChapters(bundle.chapters || []);
  renderAudit(findings);
  updateStepStatus();
}

function renderCanon(canonFacts) {
  const canon = $('canonList');
  canon.innerHTML = '';
  canonFacts.forEach(fact => {
    const item = document.createElement('div');
    item.className = 'fact';
    item.innerHTML = `<strong>${escapeHtml(fact.subject)}</strong><div>${escapeHtml(fact.predicate)}：${escapeHtml(fact.object)}</div><div>${escapeHtml(fact.fact_type)}</div>`;
    canon.appendChild(item);
  });
  if (!canonFacts.length) canon.innerHTML = '<p class="empty">确认故事圣经后会生成 Canon 硬事实。</p>';
}

function renderEventEditors(containerId, events, defaultStatus) {
  const list = $(containerId);
  list.innerHTML = '';
  const characters = state.projectBundle?.characters || [];
  events.forEach(event => list.appendChild(createEventCard(event, characters)));
  if (!events.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = defaultStatus === 'beat' ? '还没有六事件。' : '还没有拓展事件。';
    list.appendChild(empty);
  }
}

function createEventCard(event, characters) {
  const card = document.createElement('article');
  card.className = 'event-card';
  card.dataset.eventId = event.id;
  card.innerHTML = `
    <div class="event-card-head">
      <input class="order" name="event_order" type="number" step="0.1" value="${Number(event.event_order || 1)}" aria-label="顺序">
      <select name="status" aria-label="事件类型">
        <option value="beat">六事件</option>
        <option value="planned">小事件</option>
        <option value="drafted">已写入</option>
        <option value="archived">归档</option>
      </select>
      <input name="title" value="${escapeAttr(event.title || '')}" placeholder="事件标题">
    </div>
    <label>摘要<textarea name="summary" rows="3">${escapeHtml(event.summary || '')}</textarea></label>
    <div class="grid-2">
      <label>触发<textarea name="trigger" rows="3">${escapeHtml(event.trigger || '')}</textarea></label>
      <label>结果<textarea name="result" rows="3">${escapeHtml(event.result || '')}</textarea></label>
    </div>
    <div class="grid-2">
      <label>行动人物<select name="actor_character_id">${characterOptions(characters, event.actor_character_id)}</select></label>
      <label>冲突目标<input name="conflict_target" value="${escapeAttr(event.conflict_target || '')}"></label>
    </div>
    <label>状态变化 JSON<textarea name="state_changes" rows="4">${escapeHtml(safeJson(event.state_changes || []))}</textarea></label>
    <div class="event-actions">
      <button type="button" data-move="-1">上移</button>
      <button type="button" data-move="1">下移</button>
      <button type="button" data-save>保存</button>
      <button type="button" class="danger" data-delete>删除</button>
    </div>
  `;
  card.querySelector('[name="status"]').value = event.status || 'planned';
  card.querySelector('[data-save]').onclick = () => saveEventCard(card);
  card.querySelector('[data-delete]').onclick = () => deleteEventCard(card);
  card.querySelectorAll('[data-move]').forEach(button => {
    button.onclick = () => moveEventCard(card, Number(button.dataset.move));
  });
  return card;
}

function characterOptions(characters, selectedId) {
  const options = ['<option value="">未指定</option>'];
  characters.forEach(character => {
    const selected = character.id === selectedId ? ' selected' : '';
    options.push(`<option value="${character.id}"${selected}>${escapeHtml(character.name)}</option>`);
  });
  return options.join('');
}

function eventPayloadFromCard(card) {
  return {
    event_order: Number(card.querySelector('[name="event_order"]').value || 1),
    status: card.querySelector('[name="status"]').value,
    title: card.querySelector('[name="title"]').value.trim(),
    summary: card.querySelector('[name="summary"]').value,
    trigger: card.querySelector('[name="trigger"]').value,
    result: card.querySelector('[name="result"]').value,
    actor_character_id: card.querySelector('[name="actor_character_id"]').value || null,
    conflict_target: card.querySelector('[name="conflict_target"]').value,
    state_changes: parseJsonField(card.querySelector('[name="state_changes"]').value, []),
    related_character_ids: [],
    related_secret_ids: [],
    related_hook_ids: []
  };
}

async function saveEventCard(card) {
  if (!state.projectId) return toast('先选择项目');
  await runStep(card.querySelector('[name="status"]').value === 'beat' ? 'beats' : 'events', '保存事件', async () => {
    await api(`/api/projects/${state.projectId}/events/${card.dataset.eventId}`, {
      method: 'PUT',
      body: JSON.stringify(eventPayloadFromCard(card))
    });
  });
}

async function deleteEventCard(card) {
  if (!confirm('删除这个事件？')) return;
  await runStep(card.querySelector('[name="status"]').value === 'beat' ? 'beats' : 'events', '删除事件', async () => {
    await api(`/api/projects/${state.projectId}/events/${card.dataset.eventId}`, { method: 'DELETE' });
  });
}

function moveEventCard(card, direction) {
  const sibling = direction < 0 ? card.previousElementSibling : card.nextElementSibling;
  if (!sibling || !sibling.classList.contains('event-card')) return;
  if (direction < 0) card.parentElement.insertBefore(card, sibling);
  else card.parentElement.insertBefore(sibling, card);
  syncVisibleOrder(card.parentElement);
}

function syncVisibleOrder(list) {
  [...list.querySelectorAll('.event-card')].forEach((card, index) => {
    card.querySelector('[name="event_order"]').value = index + 1;
  });
}

async function saveOrder(containerId, step) {
  const cards = [...$(containerId).querySelectorAll('.event-card')];
  const orderedIds = cards.map(card => card.dataset.eventId);
  await runStep(step, '保存事件顺序', async () => {
    await api(`/api/projects/${state.projectId}/events/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds })
    });
  });
}

async function addEvent(defaultStatus) {
  if (!state.projectId) return toast('先选择项目');
  await runStep(defaultStatus === 'beat' ? 'beats' : 'events', defaultStatus === 'beat' ? '新增六事件' : '新增小事件', async () => {
    await api(`/api/projects/${state.projectId}/events`, {
      method: 'POST',
      body: JSON.stringify({
        status: defaultStatus,
        title: defaultStatus === 'beat' ? '新的六事件' : '新的小事件',
        summary: '',
        state_changes: []
      })
    });
  });
}

function renderChapters(chapters) {
  const list = $('chapterList');
  list.innerHTML = '';
  chapters.forEach(chapter => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${chapter.chapter_number}. ${chapter.title} · ${chapter.status}`;
    button.className = chapter.id === state.chapterId ? 'active' : '';
    button.onclick = () => selectChapter(chapter.id);
    list.appendChild(button);
  });
  if (!chapters.length) list.innerHTML = '<p class="empty">还没有章节契约。</p>';
}

function renderAudit(findings) {
  const list = $('auditList');
  list.innerHTML = '';
  findings.slice(-20).forEach(finding => {
    const item = document.createElement('div');
    item.className = `fact finding-${finding.severity}`;
    item.innerHTML = `<strong>${escapeHtml(finding.finding_type)} · ${escapeHtml(finding.severity)}</strong><div>${escapeHtml(finding.message)}</div><div>${escapeHtml(finding.suggested_fix || '')}</div>`;
    list.appendChild(item);
  });
  if (!findings.length) list.innerHTML = '<p class="empty">暂无审校问题。</p>';
}

async function selectChapter(chapterId) {
  state.chapterId = chapterId;
  const data = await api(`/api/chapters/${chapterId}`);
  $('chapterEditor').value = data.chapter.content || data.chapter.outline || '';
  activateTab('draft');
  await loadChapterState();
  renderProjectBundle();
}

async function loadChapterState() {
  if (!state.chapterId) return toast('先选择章节');
  const data = await api(`/api/chapters/${state.chapterId}/state`);
  $('stateView').textContent = safeJson(data.state);
  toast('章前状态已加载');
}

async function loadProposedFacts() {
  if (!state.projectId) return;
  const data = await api(`/api/projects/${state.projectId}/proposed-facts`);
  const list = $('proposedFacts');
  list.innerHTML = '';
  data.facts.forEach(fact => {
    const item = document.createElement('div');
    item.className = 'fact';
    item.innerHTML = `<strong>${escapeHtml(fact.risk_level)} · ${escapeHtml(fact.status)}</strong><div>${escapeHtml(safeJson(fact.fact_payload))}</div><div>${escapeHtml(fact.reason || '')}</div>`;
    list.appendChild(item);
  });
  if (!data.facts.length) list.innerHTML = '<p class="empty">暂无待确认新事实。</p>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

$('projectForm').addEventListener('submit', async event => {
  event.preventDefault();
  const projectForm = event.currentTarget;
  await runStep('', '创建项目', async () => {
    const form = new FormData(projectForm);
    const data = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    projectForm.reset();
    await loadProjects();
    await selectProject(data.project.id);
  });
});

$('backToProjects').onclick = async () => {
  showProjectPage();
  await loadProjects();
};

$('refreshProjects').onclick = () => runStep('', '刷新项目', loadProjects);
$('reloadCanon').onclick = () => runStep('canon', '刷新 Canon', () => refreshProject(false));

document.querySelectorAll('.tab').forEach(button => {
  button.onclick = () => activateTab(button.dataset.tab);
});

$('generateBible').onclick = async () => {
  if (!state.projectId) return toast('先创建或选择项目');
  await runStep('bible', '生成故事圣经', async () => {
    const data = await api(`/api/projects/${state.projectId}/bible/generate`, { method: 'POST', body: '{}' });
    $('bibleEditor').value = safeJson(data.bible.payload);
  }, 'canon');
};

$('approveBible').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('canon', '确认故事圣经', async () => {
    const payload = parseBibleEditor();
    await api(`/api/projects/${state.projectId}/bible/approve`, {
      method: 'PUT',
      body: JSON.stringify({ payload })
    });
  }, 'beats');
};

$('generateBeats').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('beats', '生成六事件', async () => {
    await api(`/api/projects/${state.projectId}/beats/generate`, { method: 'POST', body: '{}' });
  }, 'events');
};

$('generateEvents').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('events', '扩展事件链', async () => {
    const data = await api(`/api/projects/${state.projectId}/events/generate`, { method: 'POST', body: '{}' });
    if (data.warnings?.length) toast(data.warnings[0]);
  }, 'chapters');
};

$('planChapters').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('chapters', '生成章节契约', async () => {
    await api(`/api/projects/${state.projectId}/chapters/plan`, {
      method: 'POST',
      body: JSON.stringify({ count: 10 })
    });
  }, 'draft');
};

$('addBeat').onclick = () => addEvent('beat');
$('addEvent').onclick = () => addEvent('planned');
$('saveBeatOrder').onclick = () => saveOrder('beatList', 'beats');
$('saveEventOrder').onclick = () => saveOrder('eventList', 'events');

$('loadState').onclick = async () => {
  await runStep('draft', '查看章前状态', loadChapterState);
};

$('generateDraft').onclick = async () => {
  if (!state.chapterId) return toast('先选择章节');
  await runStep('draft', '生成正文', async () => {
    const data = await api(`/api/chapters/${state.chapterId}/generate`, { method: 'POST', body: '{}' });
    $('chapterEditor').value = data.chapter.content;
  });
};

$('reviewDraft').onclick = async () => {
  if (!state.chapterId) return toast('先选择章节');
  await runStep('draft', '审校正文', async () => {
    const data = await api(`/api/chapters/${state.chapterId}/review`, { method: 'POST', body: '{}' });
    renderAudit(data.audit.findings || []);
    await loadProposedFacts();
    if (!data.audit.pass) {
      const firstFinding = data.audit.findings?.[0]?.message || '';
      toast(`审校提示：${firstFinding || '请查看审校栏'}`);
    }
  });
};

$('approveDraft').onclick = async () => {
  if (!state.chapterId) return toast('先选择章节');
  await runStep('draft', '批准入稿', async () => {
    await api(`/api/chapters/${state.chapterId}/approve`, { method: 'POST', body: '{}' });
  });
};

async function boot() {
  try {
    await loadProjects();
    $('connectionStatus').textContent = 'API 已连接';
    showProjectPage();
  } catch (err) {
    console.error(err);
    toast(formatError(err, '加载项目'));
  }
}

boot();
