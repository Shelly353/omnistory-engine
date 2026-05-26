const steps = ['bible', 'canon', 'characters', 'beats', 'events', 'chapters', 'draft'];

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
    characters: Boolean((bundle.characters || []).length),
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
  renderCharacters(bundle.characters || []);
  renderEventEditors('beatList', (bundle.events || []).filter(event => event.status === 'beat'), 'beat');
  renderEventEditors('eventList', (bundle.events || []).filter(event => event.status !== 'beat'), 'planned');
  renderChapters(bundle.chapters || []);
  renderAudit(findings);
  updateStepStatus();
}

function renderCharacters(characters) {
  const list = $('characterList');
  list.innerHTML = '';
  characters.forEach(character => list.appendChild(createCharacterCard(character)));
  if (!characters.length) list.innerHTML = '<p class="empty">确认故事圣经后会生成基础人物卡，也可以手动新增。</p>';
}

function createCharacterCard(character) {
  const card = document.createElement('article');
  card.className = 'character-card';
  card.dataset.characterId = character.id;
  card.innerHTML = `
    <div class="event-card-head">
      <input name="name" value="${escapeAttr(character.name || '')}" placeholder="姓名">
      <input name="role" value="${escapeAttr(character.role || '')}" placeholder="角色功能">
      <input name="faction" value="${escapeAttr(character.faction || '')}" placeholder="阵营">
    </div>
    <div class="grid-2">
      <label>身份<input name="identity" value="${escapeAttr(character.identity || '')}"></label>
      <label>性格/MBTI推断<textarea name="personality" rows="3">${escapeHtml(character.personality || '')}</textarea></label>
    </div>
    <div class="grid-2">
      <label>核心欲望<textarea name="core_desire" rows="2">${escapeHtml(character.core_desire || '')}</textarea></label>
      <label>外部目标<textarea name="goal" rows="2">${escapeHtml(character.goal || '')}</textarea></label>
    </div>
    <div class="grid-2">
      <label>动机<textarea name="motivation" rows="2">${escapeHtml(character.motivation || '')}</textarea></label>
      <label>缺陷<textarea name="flaw" rows="2">${escapeHtml(character.flaw || '')}</textarea></label>
    </div>
    <div class="grid-2">
      <label>恐惧<textarea name="fear" rows="2">${escapeHtml(character.fear || '')}</textarea></label>
      <label>能力/限制<textarea name="skills" rows="2">${escapeHtml(character.skills || '')}</textarea></label>
    </div>
    <label>不能突破的限制<textarea name="limits" rows="2">${escapeHtml(character.limits || '')}</textarea></label>
    <label>台词/叙述规则<textarea name="voice_rules" rows="2">${escapeHtml(character.voice_rules || '')}</textarea></label>
    <label>复用计划 JSON<textarea name="reuse_plan" rows="3">${escapeHtml(safeJson(character.reuse_plan || []))}</textarea></label>
    <div class="event-actions">
      <button type="button" data-save>保存人物</button>
      <button type="button" class="danger" data-delete>删除人物</button>
    </div>
  `;
  card.querySelector('[data-save]').onclick = () => saveCharacterCard(card);
  card.querySelector('[data-delete]').onclick = () => deleteCharacterCard(card);
  return card;
}

function characterPayloadFromCard(card) {
  return {
    name: card.querySelector('[name="name"]').value.trim(),
    role: card.querySelector('[name="role"]').value,
    faction: card.querySelector('[name="faction"]').value,
    identity: card.querySelector('[name="identity"]').value,
    personality: card.querySelector('[name="personality"]').value,
    core_desire: card.querySelector('[name="core_desire"]').value,
    goal: card.querySelector('[name="goal"]').value,
    motivation: card.querySelector('[name="motivation"]').value,
    flaw: card.querySelector('[name="flaw"]').value,
    fear: card.querySelector('[name="fear"]').value,
    skills: card.querySelector('[name="skills"]').value,
    limits: card.querySelector('[name="limits"]').value,
    voice_rules: card.querySelector('[name="voice_rules"]').value,
    reuse_plan: parseJsonField(card.querySelector('[name="reuse_plan"]').value, []),
    status: 'active'
  };
}

async function saveCharacterCard(card) {
  if (!state.projectId) return toast('先选择项目');
  await runStep('characters', '保存人物卡', async () => {
    await api(`/api/projects/${state.projectId}/characters/${card.dataset.characterId}`, {
      method: 'PUT',
      body: JSON.stringify(characterPayloadFromCard(card))
    });
  });
}

async function deleteCharacterCard(card) {
  if (!confirm('删除这个人物？已关联事件会保留，但行动人物可能需要重新选择。')) return;
  await runStep('characters', '删除人物', async () => {
    await api(`/api/projects/${state.projectId}/characters/${card.dataset.characterId}`, { method: 'DELETE' });
  });
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
  if (defaultStatus === 'beat') {
    events.forEach(event => list.appendChild(createEventCard(event, characters)));
  } else {
    renderBridgeEventGroups(list, events, characters);
  }
  if (!events.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = defaultStatus === 'beat' ? '还没有六事件。' : '还没有六事件之间的小事件。';
    list.appendChild(empty);
  }
}

function renderBridgeEventGroups(list, bridgeEvents, characters) {
  const beats = (state.projectBundle?.events || [])
    .filter(event => event.status === 'beat')
    .sort((a, b) => Number(a.event_order || 0) - Number(b.event_order || 0));
  if (beats.length < 2) {
    bridgeEvents.forEach(event => list.appendChild(createEventCard(event, characters)));
    return;
  }
  for (let index = 0; index < beats.length - 1; index += 1) {
    const from = beats[index];
    const to = beats[index + 1];
    const groupEvents = bridgeEvents.filter(event => Number(event.event_order) > Number(from.event_order) && Number(event.event_order) < Number(to.event_order));
    const group = document.createElement('section');
    group.className = 'event-group';
    group.innerHTML = `
      <div class="event-group-title">
        <strong>${escapeHtml(from.event_order)}. ${escapeHtml(from.title)} -> ${escapeHtml(to.event_order)}. ${escapeHtml(to.title)}</strong>
        <span>${groupEvents.length} 个小事件</span>
      </div>
    `;
    groupEvents.forEach(event => group.appendChild(createEventCard(event, characters)));
    if (!groupEvents.length) {
      const empty = document.createElement('p');
      empty.className = 'empty compact';
      empty.textContent = '这一组还没有过渡小事件。点击“生成六事件间小事件”自动补齐。';
      group.appendChild(empty);
    }
    list.appendChild(group);
  }
  const outsideEvents = bridgeEvents.filter(event => !beats.some((from, index) => Number(event.event_order) > Number(from.event_order) && Number(event.event_order) < Number(beats[index + 1]?.event_order || Infinity)));
  if (outsideEvents.length) {
    const group = document.createElement('section');
    group.className = 'event-group';
    group.innerHTML = '<div class="event-group-title"><strong>未归组事件</strong><span>请调整 event_order 到两个六事件之间</span></div>';
    outsideEvents.forEach(event => group.appendChild(createEventCard(event, characters)));
    list.appendChild(group);
  }
}

function characterBrief(characterId) {
  const character = (state.projectBundle?.characters || []).find(item => item.id === characterId);
  if (!character) return '<p class="empty compact">行动人物未指定。请从人物卡中选择，避免事件变成无源事件。</p>';
  return `
    <div class="character-brief">
      <strong>${escapeHtml(character.name)} · ${escapeHtml(character.role || '角色')}</strong>
      <span>${escapeHtml(character.personality || '未填写性格/MBTI')}</span>
      <span>欲望：${escapeHtml(character.core_desire || '未填写')}；缺陷：${escapeHtml(character.flaw || '未填写')}</span>
      <span>复用：${escapeHtml((character.reuse_plan || []).join(' / ') || '未填写')}</span>
    </div>
  `;
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
        <option value="bridge">过渡小事件</option>
        <option value="planned">普通小事件</option>
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
    <div class="linked-character">${characterBrief(event.actor_character_id)}</div>
    <label>状态变化 JSON<textarea name="state_changes" rows="4">${escapeHtml(safeJson(event.state_changes || []))}</textarea></label>
    <div class="event-actions">
      <button type="button" data-move="-1">上移</button>
      <button type="button" data-move="1">下移</button>
      <button type="button" data-save>保存</button>
      <button type="button" class="danger" data-delete>删除</button>
    </div>
  `;
  card.querySelector('[name="status"]').value = event.status || 'planned';
  card.querySelector('[name="actor_character_id"]').onchange = event => {
    card.querySelector('.linked-character').innerHTML = characterBrief(event.currentTarget.value);
  };
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
  const cards = [...$(containerId).querySelectorAll('.event-card')].sort((a, b) => Number(a.querySelector('[name="event_order"]').value || 0) - Number(b.querySelector('[name="event_order"]').value || 0));
  await runStep(step, '保存事件顺序', async () => {
    if (step === 'events') {
      for (const card of cards) {
        await api(`/api/projects/${state.projectId}/events/${card.dataset.eventId}`, {
          method: 'PUT',
          body: JSON.stringify(eventPayloadFromCard(card))
        });
      }
      return;
    }
    await api(`/api/projects/${state.projectId}/events/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds: cards.map(card => card.dataset.eventId) })
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
  const contracts = state.projectBundle?.contracts || [];
  const characters = state.projectBundle?.characters || [];
  const characterNames = new Map(characters.map(character => [character.id, character.name]));
  const maxChapter = chapters.reduce((max, chapter) => Math.max(max, Number(chapter.chapter_number || 0)), 0);
  $('chapterStart').value = maxChapter ? maxChapter + 1 : '';
  chapters.forEach(chapter => {
    const contract = contracts.find(item => Number(item.chapter_number) === Number(chapter.chapter_number));
    const item = document.createElement('article');
    item.className = `chapter-card ${chapter.id === state.chapterId ? 'active' : ''}`;
    const allowed = (contract?.allowed_characters || []).map(id => characterNames.get(id) || id).join('、') || '未指定';
    const requiredEvents = (contract?.required_events || []).join('、') || '未指定';
    item.innerHTML = `
      <button type="button">${chapter.chapter_number}. ${escapeHtml(chapter.title)} · ${escapeHtml(chapter.status)}</button>
      <div>
        <strong>契约摘要</strong>
        <p>${escapeHtml(contract?.summary || chapter.outline || '未填写')}</p>
        <span>允许人物：${escapeHtml(allowed)}</span>
        <span>必需事件：${escapeHtml(requiredEvents)}</span>
        <span>章末状态：${escapeHtml(safeJson(contract?.expected_end_state || {}))}</span>
      </div>
    `;
    item.querySelector('button').onclick = () => selectChapter(chapter.id);
    list.appendChild(item);
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
  }, 'characters');
};

$('enrichCharacters').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('characters', '补齐人物卡空白', async () => {
    await api(`/api/projects/${state.projectId}/characters/enrich-mbti`, { method: 'POST', body: '{}' });
  }, 'beats');
};

$('addCharacter').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('characters', '新增人物', async () => {
    await api(`/api/projects/${state.projectId}/characters`, {
      method: 'POST',
      body: JSON.stringify({
        name: '新人物',
        role: '待定义',
        personality: 'MBTI推断：待补全',
        reuse_plan: ['至少参与两个未来事件']
      })
    });
  });
};

$('generateBeats').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('beats', '生成六事件', async () => {
    await api(`/api/projects/${state.projectId}/beats/generate`, { method: 'POST', body: '{}' });
  }, 'events');
};

$('generateEvents').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('events', '生成六事件间小事件', async () => {
    const data = await api(`/api/projects/${state.projectId}/events/generate`, { method: 'POST', body: '{}' });
    if (data.warnings?.length) toast(data.warnings[0]);
  }, 'chapters');
};

$('planChapters').onclick = async () => {
  if (!state.projectId) return toast('先选择项目');
  await runStep('chapters', '按事件生成章节契约', async () => {
    const rawCount = Number($('chapterCount').value || 0);
    const count = rawCount ? Math.min(Math.max(rawCount, 1), 120) : undefined;
    const startChapter = Number($('chapterStart').value || 0);
    await api(`/api/projects/${state.projectId}/chapters/plan`, {
      method: 'POST',
      body: JSON.stringify({ count, startChapter: startChapter || undefined })
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
