const state = {
  projectId: localStorage.getItem('nws_project_id') || '',
  chapterId: '',
  projectBundle: null
};

function tokenHeaders() {
  const token = localStorage.getItem('novel_access_token') || '';
  return token ? { 'x-novel-token': token } : {};
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
    const token = prompt('请输入访问口令');
    if (token) {
      localStorage.setItem('novel_access_token', token.trim());
      return api(path, options);
    }
  }
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value || '');
  }
}

function parseBibleEditor() {
  const raw = $('bibleEditor').value.trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

async function loadProjects() {
  const data = await api('/api/projects');
  const list = $('projectList');
  list.innerHTML = '';
  data.projects.forEach(project => {
    const button = document.createElement('button');
    button.textContent = project.title;
    button.className = project.id === state.projectId ? 'active' : '';
    button.onclick = () => selectProject(project.id);
    list.appendChild(button);
  });
}

async function selectProject(projectId) {
  state.projectId = projectId;
  localStorage.setItem('nws_project_id', projectId);
  const data = await api(`/api/projects/${projectId}`);
  state.projectBundle = data;
  $('projectStatus').textContent = data.project.title;
  $('bibleEditor').value = data.bible?.payload ? safeJson(data.bible.payload) : '';
  renderProjectBundle();
  await loadProjects();
}

function renderProjectBundle() {
  const bundle = state.projectBundle;
  if (!bundle) return;
  $('auditStatus').textContent = bundle.findings?.some(f => f.severity === 'blocking') ? 'Blocked' : (bundle.findings?.length ? 'Warning' : 'Clean');

  const canon = $('canonList');
  canon.innerHTML = '';
  bundle.canon.forEach(fact => {
    const item = document.createElement('div');
    item.className = 'fact';
    item.innerHTML = `<strong>${fact.subject}</strong><div>${fact.predicate}：${fact.object}</div><div>${fact.fact_type}</div>`;
    canon.appendChild(item);
  });

  const events = $('eventList');
  events.innerHTML = '';
  bundle.events.forEach(event => {
    const item = document.createElement('div');
    item.className = 'event';
    item.innerHTML = `<strong>${event.event_order}. ${event.title}</strong><span>${event.summary || ''}</span><div>${event.result || ''}</div>`;
    events.appendChild(item);
  });

  const chapters = $('chapterList');
  chapters.innerHTML = '';
  bundle.chapters.forEach(chapter => {
    const button = document.createElement('button');
    button.textContent = `${chapter.chapter_number}. ${chapter.title} · ${chapter.status}`;
    button.className = chapter.id === state.chapterId ? 'active' : '';
    button.onclick = () => selectChapter(chapter.id);
    chapters.appendChild(button);
  });

  renderAudit(bundle.findings || []);
}

function renderAudit(findings) {
  const list = $('auditList');
  list.innerHTML = '';
  findings.slice(-20).forEach(finding => {
    const item = document.createElement('div');
    item.className = `fact finding-${finding.severity}`;
    item.innerHTML = `<strong>${finding.finding_type} · ${finding.severity}</strong><div>${finding.message}</div><div>${finding.suggested_fix || ''}</div>`;
    list.appendChild(item);
  });
}

async function selectChapter(chapterId) {
  state.chapterId = chapterId;
  const data = await api(`/api/chapters/${chapterId}`);
  $('chapterEditor').value = data.chapter.content || data.chapter.outline || '';
  await loadChapterState();
  renderProjectBundle();
}

async function refreshProject() {
  if (state.projectId) await selectProject(state.projectId);
}

async function loadChapterState() {
  if (!state.chapterId) return toast('先选择章节');
  const data = await api(`/api/chapters/${state.chapterId}/state`);
  $('stateView').textContent = safeJson(data.state);
}

async function loadProposedFacts() {
  if (!state.projectId) return;
  const data = await api(`/api/projects/${state.projectId}/proposed-facts`);
  const list = $('proposedFacts');
  list.innerHTML = '';
  data.facts.forEach(fact => {
    const item = document.createElement('div');
    item.className = 'fact';
    item.innerHTML = `<strong>${fact.risk_level} · ${fact.status}</strong><div>${safeJson(fact.fact_payload)}</div><div>${fact.reason || ''}</div>`;
    list.appendChild(item);
  });
}

$('projectForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify(Object.fromEntries(form.entries()))
  });
  toast('项目已创建');
  event.currentTarget.reset();
  await loadProjects();
  await selectProject(data.project.id);
});

$('generateBible').onclick = async () => {
  if (!state.projectId) return toast('先创建或选择项目');
  const data = await api(`/api/projects/${state.projectId}/bible/generate`, { method: 'POST', body: '{}' });
  $('bibleEditor').value = safeJson(data.bible.payload);
  toast('故事圣经已生成');
};

$('approveBible').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  const payload = parseBibleEditor();
  await api(`/api/projects/${state.projectId}/bible/approve`, {
    method: 'PUT',
    body: JSON.stringify({ payload })
  });
  toast('故事圣经已确认，Canon 已建立');
  await refreshProject();
};

$('generateBeats').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await api(`/api/projects/${state.projectId}/beats/generate`, { method: 'POST', body: '{}' });
  toast('六节点已生成');
  await refreshProject();
};

$('generateEvents').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  const data = await api(`/api/projects/${state.projectId}/events/generate`, { method: 'POST', body: '{}' });
  toast(data.warnings?.length ? data.warnings[0] : '事件链已生成');
  await refreshProject();
};

$('planChapters').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await api(`/api/projects/${state.projectId}/chapters/plan`, {
    method: 'POST',
    body: JSON.stringify({ count: 10 })
  });
  toast('前10章契约已生成');
  await refreshProject();
};

$('loadState').onclick = loadChapterState;

$('generateDraft').onclick = async () => {
  if (!state.chapterId) return toast('先选择章节');
  const data = await api(`/api/chapters/${state.chapterId}/generate`, { method: 'POST', body: '{}' });
  $('chapterEditor').value = data.chapter.content;
  toast('正文已生成');
  await refreshProject();
};

$('reviewDraft').onclick = async () => {
  if (!state.chapterId) return toast('先选择章节');
  const data = await api(`/api/chapters/${state.chapterId}/review`, { method: 'POST', body: '{}' });
  renderAudit(data.audit.findings || []);
  await loadProposedFacts();
  toast(data.audit.pass ? '审校通过，等待批准' : '审校阻塞，请处理问题');
  await refreshProject();
};

$('approveDraft').onclick = async () => {
  if (!state.chapterId) return toast('先选择章节');
  await api(`/api/chapters/${state.chapterId}/approve`, { method: 'POST', body: '{}' });
  toast('已批准入稿并写入章后状态');
  await refreshProject();
};

async function boot() {
  try {
    await loadProjects();
    if (state.projectId) await selectProject(state.projectId);
    await loadProposedFacts();
    $('connectionStatus').textContent = 'API 已连接';
  } catch (err) {
    console.error(err);
    toast(err.message);
  }
}

boot();
