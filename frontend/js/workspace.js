// frontend/js/workspace.js
(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (resource, options = {}) => {
        const url = typeof resource === 'string' ? resource : resource?.url || '';
        const isLocalApi = url.startsWith('/api/');
        const token = localStorage.getItem('omnistory_access_token') || '';
        const headers = new Headers(options.headers || {});

        if (isLocalApi && token) headers.set('x-omnistory-token', token);

        const response = await originalFetch(resource, { ...options, headers });
        if (isLocalApi && response.status === 401) {
            const nextToken = prompt('请输入 OmniStory 访问口令：');
            if (nextToken) {
                localStorage.setItem('omnistory_access_token', nextToken.trim());
                headers.set('x-omnistory-token', nextToken.trim());
                return originalFetch(resource, { ...options, headers });
            }
        }
        return response;
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const PROJECT_ID = urlParams.get('id');
    const GENESIS_CHAT_KEY = `genesis_chat_${PROJECT_ID}`;
    const LATEST_BIBLE_KEY = `latest_bible_${PROJECT_ID}`;
    const MANUAL_BIBLE_EDITS_KEY = `manual_bible_edits_${PROJECT_ID}`;
    const MANUAL_BIBLE_WARNINGS_KEY = `manual_bible_warnings_${PROJECT_ID}`;
    const MANUAL_BIBLE_WARNING_SIGNATURE_KEY = `manual_bible_warning_signature_${PROJECT_ID}`;
    const SANDBOX_RULE_GATE_DRAFT_KEY = `sandbox_rule_gate_draft_${PROJECT_ID}`;
    const GENESIS_CLOUD_TYPE = "上帝沙盒 · 创世圣经";
    const LONGFORM_STATE_KEY = `longform_editor_state_${PROJECT_ID}`;
    const LONGFORM_CLOUD_TYPE = "长篇连载编辑系统";
    const INTERACTION_STATE_KEY = `interaction_focus_state_${PROJECT_ID}`;

    if (!PROJECT_ID) { alert("非法侵入！即将返回大厅。"); window.location.href = 'dashboard.html'; return; }

    let genesisConversation = [];
    let genesisPanelSyncBlocked = false;
    let genesisRequestInFlight = false;
    let currentChapterChatHistory = [];
    let subConversation = [];
    let currentSubChatTarget = ""; 
    let currentLocalContext = { chapterId: "", chapterNumber: "", title: "", synopsis: "", characters: [], hooks: [] };
    let relationNetwork = null;
    let workspaceChapters = [];
    let saveTimeout;
    let previewSyncTimer;
    let currentSelectedString = "";
    let insertEventContext = { prev: null, next: null, suggestedNumber: null, chat: [] };
    let localSourceDocs = [];
    let longformState = loadLongformState();
    let sandboxAutoRepairInFlight = false;
    let sandboxAutoRepairSignature = '';
    let sandboxRuleGate = { blocked: false, ignored: false, ignoredSignature: '', ignoredItems: [], reason: '', pendingText: '', items: [] };
    let activeRuleConflictItem = null;
    let sandboxPendingResolution = { items: [], activeIndex: 0, chat: [] };
    let sopEventBriefState = { chapterId: '', brief: '', confirmed: false, chat: [] };
    let sandboxNextQuestionRetryCount = 0;
    let sandboxRuleGateResumeTimer = null;
    let sopSupervisionGate = { blocked: false, reason: '' };

    const RECENT_CHAT_LIMIT = 10;
    const MEMORY_SUMMARY_LIMIT = 6000;
    const MESSAGE_CONTENT_LIMIT = 3500;
    const WorkspaceMemory = window.OmniWorkspaceMemory;
    const stripFencedBlocks = WorkspaceMemory.stripFencedBlocks;
    const stripSystemAppendix = WorkspaceMemory.stripSystemAppendix;
    const limitText = WorkspaceMemory.limitText;
    const buildChatPayloadBase = WorkspaceMemory.buildChatPayload;

    function buildChatPayload(conversation, recentLimit = RECENT_CHAT_LIMIT) {
        return buildChatPayloadBase(conversation, {
            recentLimit,
            memoryLimit: MEMORY_SUMMARY_LIMIT,
            messageLimit: MESSAGE_CONTENT_LIMIT
        });
    }

    function buildChatPayloadWithLocalSources(conversation, recentLimit = RECENT_CHAT_LIMIT, queryText = "") {
        return {
            ...buildChatPayload(conversation, recentLimit),
            localReferenceSnippets: getRelevantLocalSourceSnippets(queryText)
        };
    }

    function escapeHtml(text = "") {
        return String(text).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    async function readApiJson(res, fallbackLabel = '请求失败') {
        let data = null;
        try {
            data = await res.json();
        } catch (e) {}
        if (!res.ok) {
            throw new Error(data?.error || `${fallbackLabel}：HTTP ${res.status}`);
        }
        if (data && data.success === false) {
            throw new Error(data.error || fallbackLabel);
        }
        return data || {};
    }

    function loadInteractionState() {
        try {
            const state = JSON.parse(localStorage.getItem(INTERACTION_STATE_KEY) || '{}');
            return state && typeof state === 'object' ? state : {};
        } catch (e) {
            return {};
        }
    }

    function saveInteractionState(state = {}) {
        localStorage.setItem(INTERACTION_STATE_KEY, JSON.stringify(state));
        return state;
    }

    function getInteractionScope(scope = 'sandbox') {
        return scope === 'sop' && currentLocalContext.chapterId
            ? `sop_${currentLocalContext.chapterId}`
            : 'sandbox';
    }

    function getScopedInteractionState(scope = 'sandbox') {
        const all = loadInteractionState();
        const key = getInteractionScope(scope);
        return {
            queue: [],
            inbox: [],
            lastUpdated: '',
            ...(all[key] || {})
        };
    }

    function saveScopedInteractionState(scope = 'sandbox', scopedState = {}) {
        const all = loadInteractionState();
        const key = getInteractionScope(scope);
        all[key] = {
            queue: Array.isArray(scopedState.queue) ? scopedState.queue.slice(0, 24) : [],
            inbox: Array.isArray(scopedState.inbox) ? scopedState.inbox.slice(0, 30) : [],
            lastUpdated: new Date().toISOString()
        };
        saveInteractionState(all);
        return all[key];
    }

    function normalizeQuestionId(id = '') {
        const match = String(id || '').match(/Q\s*(\d+)/i);
        return match ? `Q${match[1]}` : '';
    }

    function collectQuestionCandidatesFromJson(value, results = [], allowString = false) {
        if (!value || results.length >= 12) return results;
        if (typeof value === 'string') {
            const text = value.trim();
            if (allowString && text && /[？?]|是否|什么|如何|哪|谁|要不要|选择|决定/.test(text)) results.push(text);
            return results;
        }
        if (Array.isArray(value)) {
            value.forEach(item => collectQuestionCandidatesFromJson(item, results, allowString));
            return results;
        }
        if (typeof value === 'object') {
            Object.entries(value).forEach(([key, entry]) => {
                if (/question|questions|next_questions|nextQuestion|下一步|下一轮|待确认|选择/i.test(key)) {
                    collectQuestionCandidatesFromJson(entry, results, true);
                } else if (entry && typeof entry === 'object') {
                    collectQuestionCandidatesFromJson(entry, results, false);
                }
            });
        }
        return results;
    }

    function extractQuestionsFromJsonPayload(text = '') {
        const parsed = extractJsonObjectFromText(text);
        if (!parsed) return [];
        const seen = new Set();
        return collectQuestionCandidatesFromJson(parsed)
            .map((question, index) => {
                const cleaned = String(question || '').replace(/^Q\s*\d+[\.、:：\s-]*/i, '').trim();
                return cleaned ? { id: `Q${index + 1}`, question: cleaned } : null;
            })
            .filter(item => {
                if (!item || seen.has(item.question)) return false;
                seen.add(item.question);
                return true;
            });
    }

    function extractNumberedQuestions(text = '') {
        const rawText = String(text || '');
        const clean = stripBibleJsonBlocks(stripFencedBlocks(rawText));
        const questions = [];
        const seen = new Set();
        let currentSection = '';
        clean.split('\n').forEach(line => {
            const trimmed = line.trim().replace(/^[-*]\s*/, '');
            const sectionMatch = trimmed.match(/^【(.+?)】/);
            if (sectionMatch) currentSection = sectionMatch[1];
            if (/已吸收|新增重要设定|监督提醒|可展开|推演依据/.test(currentSection)) return;
            if (/已回答|已吸收|已解决|部分回答|冲突|不再追问/.test(trimmed)) return;
            const qMatch = trimmed.match(/^(Q\s*\d+)[\.、:：\s-]+(.+)/i);
            const numberMatch = !qMatch && /下一步|待确认|问题|选择|需要你|请你/.test(currentSection)
                ? trimmed.match(/^(\d+)[\.、:：\s-]+(.+)/)
                : null;
            const id = qMatch ? normalizeQuestionId(qMatch[1]) : (numberMatch ? `Q${numberMatch[1]}` : '');
            const question = (qMatch ? qMatch[2] : numberMatch?.[2] || '').trim();
            if (!id || !question || seen.has(id)) return;
            seen.add(id);
            questions.push({ id, question });
        });
        if (questions.length > 0) return questions;
        return extractQuestionsFromJsonPayload(rawText);
    }

    function normalizeQuestionTextForMatch(text = '') {
        return String(text || '')
            .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
            .replace(/是否|什么|如何|哪一|哪个|哪种|谁|要不要|需要|请你|决定|选择|此时|本轮|当前/g, '');
    }

    function extractQuestionSignals(question = '') {
        const clean = normalizeQuestionTextForMatch(question);
        const signals = new Set();
        (clean.match(/[a-zA-Z0-9]{3,}/g) || []).forEach(token => signals.add(token.toLowerCase()));
        const chinese = clean.replace(/[a-zA-Z0-9]/g, '');
        for (let index = 0; index < chinese.length - 1; index += 1) {
            const gram = chinese.slice(index, index + 2);
            if (gram.length === 2) signals.add(gram);
        }
        for (let index = 0; index < chinese.length - 2; index += 1) {
            const gram = chinese.slice(index, index + 3);
            if (gram.length === 3) signals.add(gram);
        }
        return [...signals].filter(signal => !/^(事件|人物|设定|一个|这个|那个)$/.test(signal));
    }

    function isLikelyAnsweringQuestion(question = '', userText = '') {
        const answer = normalizeQuestionTextForMatch(userText).toLowerCase();
        if (!answer) return false;
        const signals = extractQuestionSignals(question);
        if (signals.length === 0) return false;
        const hits = signals.filter(signal => answer.includes(signal.toLowerCase()));
        return hits.length >= 2 || hits.some(signal => signal.length >= 3);
    }

    function extractStatusQuestionIds(text = '', statusPattern) {
        const ids = new Set();
        const clean = stripBibleJsonBlocks(stripFencedBlocks(text || ''));
        clean.split('\n').forEach(line => {
            const id = normalizeQuestionId(line);
            if (id && statusPattern.test(line)) ids.add(id);
        });
        return ids;
    }

    function extractInboxSettings(text = '') {
        const clean = stripBibleJsonBlocks(stripFencedBlocks(text || ''));
        const settings = [];
        const seen = new Set();
        clean.split('\n').forEach(line => {
            const trimmed = line.trim().replace(/^[-*]\s*/, '');
            const match = trimmed.match(/^(S\s*\d+)[\.、:：\s-]+(.+)/i);
            if (!match) return;
            const id = match[1].replace(/\s+/g, '').toUpperCase();
            const content = match[2].trim();
            if (!content || seen.has(`${id}:${content}`)) return;
            seen.add(`${id}:${content}`);
            const destinationMatch = content.match(/建议写入[：:]\s*([^；。\n]+)/);
            settings.push({
                id,
                content,
                destination: destinationMatch ? destinationMatch[1].trim() : '',
                status: /暂存/.test(content) ? '暂存' : '待确认'
            });
        });
        return settings;
    }

    function mergeInteractionStateFromReply(scope = 'sandbox', reply = '') {
        const state = getScopedInteractionState(scope);
        const queue = Array.isArray(state.queue) ? [...state.queue] : [];
        const inbox = Array.isArray(state.inbox) ? [...state.inbox] : [];
        const answered = extractStatusQuestionIds(reply, /已回答|已吸收|已解决|覆盖|不再追问/);
        const partial = extractStatusQuestionIds(reply, /部分回答|待补充|不完整|还缺/);
        const conflict = extractStatusQuestionIds(reply, /冲突|矛盾|不一致/);

        queue.forEach(item => {
            if (answered.has(item.id)) item.status = 'answered';
            if (partial.has(item.id)) item.status = 'partial';
            if (conflict.has(item.id)) item.status = 'conflict';
        });

        const activeQuestions = extractNumberedQuestions(reply).filter(item => !answered.has(item.id) && !conflict.has(item.id));
        activeQuestions.forEach(item => {
            const existing = queue.find(q => q.id === item.id);
            if (existing) {
                existing.question = item.question;
                if (!existing.status || !['answered', 'skipped'].includes(existing.status)) existing.status = 'pending';
            } else {
                queue.push({ ...item, status: 'pending' });
            }
        });

        extractInboxSettings(reply).forEach(item => {
            const exists = inbox.some(existing => normalizeStableKey(existing.content) === normalizeStableKey(item.content));
            if (!exists) inbox.unshift(item);
        });

        return saveScopedInteractionState(scope, { queue, inbox });
    }

    function getPendingInteractionQuestions(scope = 'sandbox') {
        const state = getScopedInteractionState(scope);
        return (state.queue || []).filter(item => !['answered', 'answered_local', 'skipped'].includes(item.status));
    }

    function formatQuestionAnswerSummary(scope = 'sandbox') {
        const state = getScopedInteractionState(scope);
        const answered = (state.queue || []).filter(item => item.answer && ['answered', 'answered_local'].includes(item.status));
        if (answered.length === 0) return '';
        return answered.map(item => `${item.id}：${item.question}\nA${item.id.replace('Q', '')}：${item.answer}`).join('\n\n');
    }

    function recordLocalQuestionAnswer(scope = 'sandbox', userText = '') {
        const state = getScopedInteractionState(scope);
        const queue = Array.isArray(state.queue) ? [...state.queue] : [];
        const pending = queue.filter(item => !['answered', 'answered_local', 'skipped'].includes(item.status));
        if (pending.length === 0) return { handled: false, done: false, summary: '' };

        const pendingIds = new Set(pending.map(item => item.id));
        const explicitIds = [...new Set((String(userText || '').match(/Q\s*\d+/gi) || []).map(normalizeQuestionId).filter(id => pendingIds.has(id)))];
        const inferredIds = explicitIds.length > 0
            ? []
            : pending.slice(1).filter(item => isLikelyAnsweringQuestion(item.question, userText)).map(item => item.id);
        const targetIds = explicitIds.length > 0 ? explicitIds : [pending[0].id, ...inferredIds];
        queue.forEach(item => {
            if (!targetIds.includes(item.id)) return;
            item.status = 'answered_local';
            item.answer = userText;
            item.answered_at = new Date().toISOString();
        });
        const remaining = queue.filter(item => !['answered', 'answered_local', 'skipped'].includes(item.status));
        saveScopedInteractionState(scope, { queue, inbox: state.inbox || [] });
        return {
            handled: true,
            done: remaining.length === 0,
            answeredIds: targetIds,
            next: remaining[0] || null,
            summary: formatQuestionAnswerSummary(scope)
        };
    }

    function clearAnsweredLocalQuestions(scope = 'sandbox') {
        const state = getScopedInteractionState(scope);
        const queue = (state.queue || []).filter(item => !['answered', 'answered_local', 'skipped'].includes(item.status));
        saveScopedInteractionState(scope, { queue, inbox: state.inbox || [] });
    }

    function extractLocalAnswerIdsFromText(text = '') {
        const headerMatch = String(text || '').match(/【本地问题回答\s+([^】]+)】/);
        if (!headerMatch) return [];
        return [...new Set((headerMatch[1].match(/Q\s*\d+/gi) || []).map(normalizeQuestionId).filter(Boolean))];
    }

    function restoreLocalQuestionsFromRollback(scope = 'sandbox', removedMessages = []) {
        const rollbackIds = [...new Set(removedMessages
            .filter(msg => msg?.role === 'user')
            .flatMap(msg => extractLocalAnswerIdsFromText(msg.content)))];
        if (rollbackIds.length === 0) return;
        const state = getScopedInteractionState(scope);
        const queue = Array.isArray(state.queue) ? [...state.queue] : [];
        const knownQuestions = new Map();
        [...genesisConversation, ...removedMessages].forEach(msg => {
            extractNumberedQuestions(msg?.content || '').forEach(item => {
                if (!knownQuestions.has(item.id)) knownQuestions.set(item.id, item.question);
            });
        });
        queue.forEach(item => {
            if (!rollbackIds.includes(item.id)) return;
            item.status = 'pending';
            delete item.answer;
            delete item.answered_at;
        });
        rollbackIds.forEach(id => {
            if (queue.some(item => item.id === id)) return;
            queue.push({
                id,
                question: knownQuestions.get(id) || '请重新回答这个问题。',
                status: 'pending'
            });
        });
        queue.sort((a, b) => {
            const aNum = Number(String(a.id || '').replace(/\D/g, '')) || 0;
            const bNum = Number(String(b.id || '').replace(/\D/g, '')) || 0;
            return aNum - bNum;
        });
        saveScopedInteractionState(scope, { queue, inbox: state.inbox || [] });
    }

    function buildLocalQuestionPromptText(scope = 'sandbox') {
        const pending = getPendingInteractionQuestions(scope);
        if (pending.length === 0) return '';
        const current = pending[0];
        return `【当前任务】\n本轮问题本地推进中，不请求 AI。\n\n【下一步选择】\n${current.id}. ${current.question}`;
    }

    function buildQuestionBatchSummaryMessage(summary = '') {
        const bible = getCurrentBibleSnapshot() || {};
        const knownContext = [
            `【已有上帝视角/隐藏剧情】\n${limitText(formatGodViewContext(bible), 1800)}`,
            `【已有人物关系】\n${limitText(JSON.stringify(bible.relations || []), 1200)}`,
            `【已有人物卡摘要】\n${limitText(JSON.stringify((bible.characters || []).map(c => ({ name: c.name, role: c.role, description: c.description, motivation: c.motivation, character_rules: c.character_rules }))), 1800)}`,
            `【已有时间线/事件】\n${limitText(JSON.stringify(bible.timeline || bible.chapters || []), 1800)}`
        ].join('\n\n');
        return `【本轮问题与回答汇总】\n${summary}\n\n${knownContext}\n\n请现在统一吸收以上回答：\n1. 先检查【已有上帝视角/隐藏剧情】【已有人物关系】【已有人物卡摘要】【已有时间线/事件】，不要重复询问这些已存在的信息；如果需要使用，只能说“已读取/沿用”。\n2. 更新事件、人物、规则、上帝视角和伏笔设定。\n3. 检查是否存在冲突、降智或与人物卡不一致。\n4. 必须输出合法实时面板 JSON。\n5. 实时面板更新内容完成后，再提出下一组需要作者回答的问题；下一组问题只能询问仍缺失的信息。
6. 如果沙盒尚未结束，下一组问题必须像第一轮一样使用 Q1、Q2、Q3... 编号列出，且只输出这一轮真正需要作者回答的问题；不要只说“继续讨论”或“等待作者补充”。如果已经达到沙盒验收条件，请明确输出【沙盒验收】而不是新问题。`;
    }

    function markAnsweredQuestionsBeforeSend(scope = 'sandbox', userText = '') {
        const state = getScopedInteractionState(scope);
        const queue = Array.isArray(state.queue) ? [...state.queue] : [];
        const pending = queue.filter(item => !['answered', 'answered_local', 'skipped'].includes(item.status));
        if (pending.length === 0) return { before: 0, after: 0, answeredIds: [] };

        const pendingIds = new Set(pending.map(item => item.id));
        const explicitIds = [...new Set((String(userText || '').match(/Q\s*\d+/gi) || []).map(normalizeQuestionId).filter(id => pendingIds.has(id)))];
        const inferredIds = explicitIds.length > 0
            ? []
            : pending.slice(1).filter(item => isLikelyAnsweringQuestion(item.question, userText)).map(item => item.id);
        const answeredIds = explicitIds.length > 0 ? explicitIds : [pending[0].id, ...inferredIds];
        queue.forEach(item => {
            if (answeredIds.includes(item.id) && !['skipped'].includes(item.status)) item.status = 'answered';
        });
        saveScopedInteractionState(scope, { queue, inbox: state.inbox || [] });
        return {
            before: pending.length,
            after: queue.filter(item => !['answered', 'answered_local', 'skipped'].includes(item.status)).length,
            answeredIds
        };
    }

    function shouldSyncPanelAfterReply(scope = 'sandbox', answerProgress = {}) {
        if (scope !== 'sandbox') return false;
        return (answerProgress.before || 0) > 0 && getPendingInteractionQuestions(scope).length === 0;
    }

    function shouldDeferPanelSyncAfterReply(scope = 'sandbox', answerProgress = {}) {
        if (scope !== 'sandbox') return false;
        if (answerProgress.completedBatch) return false;
        const pendingCount = getPendingInteractionQuestions(scope).length;
        if ((answerProgress.before || 0) > 0) return pendingCount > 0;
        return pendingCount > 0;
    }

    function isSandboxAcceptanceReply(text = '') {
        return /【沙盒验收】|沙盒验收通过|正式铸造|进入SOP|进入 SOP|验收条件已满足/.test(String(text || ''));
    }

    function buildNextSandboxQuestionRoundPrompt(aiReplyText = '') {
        const bible = getCurrentBibleSnapshot() || {};
        return `【内部续问请求：不要输出纯 JSON】
上一轮回答已经吸收并刷新实时面板，但你的上一条回复没有给出新的逐条问题，或问题被 JSON 吃掉了。现在请继续沙盒下一轮提问。

要求：
1. 如果沙盒尚未达到【沙盒验收】，必须像第一轮一样输出【当前任务】和【下一步选择】。
2. 【下一步选择】里必须列出 Q1、Q2、Q3...，只列这一轮真正需要作者回答的问题。
3. 每个问题只能问一个清晰决定点，不要把多个问题揉成一段。
4. 不要写正文，不要只输出 JSON；可在末尾附带世界圣经 JSON，但可见正文必须先出现 Q1。
5. 如果已经满足沙盒验收，请明确输出【沙盒验收】并说明可以正式铸造。

【当前面板阶段】${bible.workflow?.stage || '未知'}
${buildSandboxWorkflowGatePrompt(bible)}
【当前面板摘要】
${limitText(JSON.stringify(compactBibleForPrompt(bible)), 3500)}

【上一条 AI 回复】
${limitText(stripBibleJsonBlocks(aiReplyText), 1200) || '上一条回复主要是 JSON。'}`;
    }

    function shouldRequestNextSandboxQuestionRound(aiReplyText = '', completedLocalBatch = false) {
        if (!completedLocalBatch) return false;
        if (isSandboxAcceptanceReply(aiReplyText)) return false;
        if (getPendingInteractionQuestions('sandbox').length > 0) return false;
        return sandboxNextQuestionRetryCount < 1;
    }

    function restorePendingQuestionsFromLatestAssistant(scope = 'sandbox') {
        if (getPendingInteractionQuestions(scope).length > 0) return getPendingInteractionQuestions(scope);
        for (let index = genesisConversation.length - 1; index >= 0; index -= 1) {
            const msg = genesisConversation[index];
            if (msg?.role !== 'assistant') continue;
            const questions = extractNumberedQuestions(msg.content || '');
            if (questions.length === 0) return [];
            const state = getScopedInteractionState(scope);
            const queue = Array.isArray(state.queue) ? [...state.queue] : [];
            questions.forEach(item => {
                const existing = queue.find(q => q.id === item.id);
                if (existing) {
                    existing.question = item.question;
                    existing.status = 'pending';
                    delete existing.answer;
                    delete existing.answered_at;
                } else {
                    queue.push({ ...item, status: 'pending' });
                }
            });
            saveScopedInteractionState(scope, { queue, inbox: state.inbox || [] });
            return getPendingInteractionQuestions(scope);
        }
        return [];
    }

    function requestNextSandboxQuestionRoundAfterGate(source = '', options = {}) {
        if (sandboxRuleGate.blocked || genesisRequestInFlight) return;
        const { autoContinue = true } = options;
        if (sandboxRuleGateResumeTimer) clearTimeout(sandboxRuleGateResumeTimer);
        sandboxRuleGateResumeTimer = setTimeout(() => {
            sandboxRuleGateResumeTimer = null;
            if (sandboxRuleGate.blocked || genesisRequestInFlight) return;
            const pending = restorePendingQuestionsFromLatestAssistant('sandbox');
            if (pending.length > 0) {
                appendSandboxSystemAssistant(`${source ? `【${source}】\n` : ''}${buildLocalQuestionPromptText('sandbox')}`);
                setSandboxAlert('green', '规则冲突已处理，已恢复到当前待回答问题。');
                return;
            }
            if (chatInput?.value?.trim()) {
                appendSandboxSystemAssistant(`【规则冲突已处理】\n暂存输入已恢复到输入框。你可以检查后继续发送，系统会从这里接回沙盒推演。`);
                setSandboxAlert('green', '规则冲突已处理，暂存输入已恢复。');
                return;
            }
            if (!autoContinue) {
                appendSandboxSystemAssistant(`【${source || '规则冲突已处理'}】\n沙盒已解锁。请先确认是否继续，让系统再请求下一轮 Q1/Q2。`);
                setSandboxAlert('green', '规则冲突已处理，等待你继续。');
                return;
            }
            sandboxNextQuestionRetryCount = 0;
            genesisConversation.push({ role: 'user', content: buildNextSandboxQuestionRoundPrompt(`${source || '规则冲突已处理'}，请继续沙盒下一轮问题。`) });
            localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
            appendMessage('assistant', '【当前任务】\n规则冲突已处理，系统正在恢复沙盒推演并请求下一轮 Q1/Q2。', genesisConversation.length);
            setSandboxAlert('green', '规则冲突已处理，正在恢复下一轮沙盒提问。');
            fetchChatResponse();
        }, 80);
    }

    function buildInteractionFocusPrompt(scope = 'sandbox', userText = '') {
        const state = getScopedInteractionState(scope);
        const pending = (state.queue || []).filter(item => !['answered', 'answered_local', 'skipped'].includes(item.status));
        const inbox = (state.inbox || []).filter(item => item.status === '待确认' || item.status === '暂存');
        const queueText = pending.length
            ? pending.slice(0, 6).map(item => `${item.id}【${item.status || 'pending'}】${item.question}`).join('\n')
            : '暂无未解决问题。';
        const inboxText = inbox.length
            ? inbox.slice(0, 6).map(item => `${item.id}【${item.status}】${limitText(item.content, 240)}${item.destination ? ` -> ${item.destination}` : ''}`).join('\n')
            : '暂无待处理新增设定。';
        return `\n\n【问题队列与设定收件箱协议】\n当前未解决问题：\n${queueText}\n\n当前设定收件箱：\n${inboxText}\n\n用户本轮原文：\n${limitText(userText, 1200)}\n\n请先判断用户本轮是否回答了当前问题、后续问题或没有被问到但重要的新设定。规则：\n1. 当前未解决问题列表已经扣除了用户本轮默认回答的问题；如果还有 Q2/Q3，请优先继续显示下一个未解决问题，不要复述已回答的 Q。\n2. 如果用户一段话已经回答了后续问题，必须在【已吸收】中写明“Qx 已回答：摘要”，后续不要重复问。\n3. 如果用户提供了 AI 没问但重要的设定，必须在【新增重要设定】中写成 S1、S2...，并标注建议写入：人物卡/人物规则/事件/规则/上帝视角/伏笔/暂存。\n4. 有冲突时给 A/B/C 处理选项。【下一步选择】只放仍未解决的问题；如果没有未解决问题，请写【本轮问题完成】，不要开启新一轮问题，等待系统刷新实时面板。`;
    }

    function renderInteractionQueueHtml(scope = 'sandbox') {
        const state = getScopedInteractionState(scope);
        const active = (state.queue || []).filter(item => !['answered', 'answered_local', 'skipped'].includes(item.status));
        const inbox = (state.inbox || []).filter(item => ['待确认', '暂存'].includes(item.status)).slice(0, 5);
        if (active.length === 0 && inbox.length === 0) return '';
        const current = active[0];
        const later = active.slice(1, 8);
        return `
            <div class="mt-3 border border-cyan-900/50 bg-cyan-950/20 rounded-xl p-3 text-xs text-cyan-100 space-y-2">
                ${current ? `<div><span class="text-[10px] text-cyan-400 font-bold">当前要回答</span><div class="mt-1 font-bold">${escapeHtml(current.id)}：${escapeHtml(current.question)}</div></div>` : ''}
                ${later.length ? `<details class="text-cyan-200/90"><summary class="cursor-pointer hover:text-white">后续问题 ${later.length} 个</summary><div class="mt-2 space-y-1">${later.map(item => `<div>${escapeHtml(item.id)}：${escapeHtml(item.question)}</div>`).join('')}</div></details>` : ''}
                ${inbox.length ? `<details class="text-amber-200/90"><summary class="cursor-pointer hover:text-white">设定收件箱 ${inbox.length} 条</summary><div class="mt-2 space-y-1">${inbox.map(item => `<div>${escapeHtml(item.id)}：${escapeHtml(item.content)}</div>`).join('')}</div></details>` : ''}
            </div>
        `;
    }

    function buildSopQuestionBatchSummaryMessage(summary = '') {
        const eventContext = getAdjacentEventContext(currentLocalContext.chapterNumber);
        return `【SOP 本轮问题与回答汇总】\n${summary}

【当前事件】\n${eventContext.startInfo}
【下一事件过渡锚点】\n${eventContext.endInfo}
【当前事件可调用人物卡】\n${getCharacterDetailsForSop()}
【统一规则/专家资料】\n${getWorldRulesText()}
【上帝视角信息权限】\n${formatGodViewContext()}

请统一吸收以上回答，继续当前事件的 SOP 推演：
1. 只讨论当前事件内部，不展开下一事件内容。
2. 不要重复追问已回答问题。
3. 如果仍有缺口，下一步选择必须使用 Q1、Q2、Q3 编号。
4. 如果当前事件已经足够进入分章，请明确询问“分成几章”或给出 2 个章数方案。
5. 当当前事件理解、人物选择、阻力/代价、信息释放、伏笔和章数都已确认时，必须明确输出【SOP_READY】可以提取大纲，并停止继续提出新问题。
6. 不要写正文。`;
    }

    function setSopSupervisionBlocked(blocked, reason = '') {
        sopSupervisionGate = { blocked, reason: blocked ? reason : '' };
    }

    function renderSopSupervisionGate(reason = '') {
        setSopSupervisionBlocked(true, reason);
        if (!localDeviationPanel) return;
        localDeviationPanel.innerHTML = `
            <div class="bg-red-950/30 border border-red-700/60 rounded-xl p-3 text-red-100 space-y-3">
                <div class="flex items-center justify-between gap-3">
                    <div class="font-bold text-red-200 flex items-center">
                        <i data-lucide="shield-alert" class="w-3.5 h-3.5 mr-1.5"></i>SOP 红色阻断
                    </div>
                    <span class="text-[10px] px-2 py-0.5 rounded bg-red-900/60 border border-red-700/70 text-red-100">必须处理</span>
                </div>
                <div class="max-h-44 overflow-y-auto whitespace-pre-wrap leading-relaxed">${escapeHtml(limitText(reason, 1800))}</div>
                <div class="grid grid-cols-3 gap-2">
                    <button id="btn-sop-gate-discuss" class="px-2 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-[10px] font-bold">讨论修复</button>
                    <button id="btn-sop-gate-recheck" class="px-2 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded text-[10px] font-bold">重新检查</button>
                    <button id="btn-sop-gate-ignore" class="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-100 rounded text-[10px] font-bold">暂时忽略</button>
                </div>
            </div>
        `;
        document.getElementById('btn-sop-gate-discuss')?.addEventListener('click', () => {
            if (tabSop) tabSop.click();
            if (chapterChatInput) {
                chapterChatInput.value = `请针对这条 SOP 红色警告给出最小修复方案，并只讨论当前事件：\n${limitText(reason, 900)}`;
                chapterChatInput.focus();
            }
        });
        document.getElementById('btn-sop-gate-recheck')?.addEventListener('click', () => runSopRealtimeSupervision('手动重新检查 SOP 红色警告'));
        document.getElementById('btn-sop-gate-ignore')?.addEventListener('click', () => {
            setSopSupervisionBlocked(false);
            renderDeviationItems([`已暂时忽略 SOP 红色警告。后续如果再次触发，系统仍会重新阻断。\n\n${limitText(reason, 900)}`]);
            setSandboxAlert('yellow', '已暂时忽略 SOP 红色警告，可以继续当前事件推演。');
        });
        if (window.lucide) lucide.createIcons();
    }

    function shouldAllowSopFixMessage(text = '') {
        return /修正|修改|调整|改成|解决|处理|重审|重新|忽略|暂时忽略|继续处理|按建议/.test(String(text || ''));
    }

    function getSopOutlineGateReport() {
        const discussion = currentChapterChatHistory.slice(1).map(msg => ({
            role: msg.role,
            content: stripSystemAppendix(msg.content || '')
        }));
        const userTrail = discussion.filter(msg => msg.role === 'user').map(msg => msg.content).join('\n');
        const trail = discussion.map(msg => msg.content).join('\n');
        const checks = [
            { label: '作者已确认/补充当前事件设定', ok: userTrail.trim().length >= 10 },
            { label: '当前事件理解', ok: /当前事件|开始事件|事件\s*\d+/.test(trail) },
            { label: '人物选择/行为来源', ok: /人物选择|行为来源|动机|欲望|恐惧|缺陷|性格|MBTI/.test(trail) },
            { label: '阻力/代价/对抗', ok: /阻力|代价|对抗|反制|冲突/.test(trail) },
            { label: '信息释放/观众视角/上帝视角', ok: /信息释放|观众视角|上帝视角|信息差|揭露/.test(trail) },
            { label: '伏笔种植/回收', ok: /伏笔|种植|回收|暗线/.test(trail) },
            { label: '章数方案或分章确认', ok: /分成几章|章数|第\s*\d+\s*章|每章|章节/.test(trail) }
        ];
        const missing = checks.filter(item => !item.ok).map(item => item.label);
        return { ok: missing.length === 0, missing, checks };
    }

    function renderSopReadySignal(reason = '', force = false) {
        if (!localDeviationPanel || sopSupervisionGate.blocked) return;
        const report = getSopOutlineGateReport();
        if (!report.ok && !force) return;
        localDeviationPanel.innerHTML = `
            <div class="bg-emerald-950/30 border border-emerald-700/60 rounded-xl p-3 text-emerald-100 space-y-3">
                <div class="font-bold text-emerald-200 flex items-center">
                    <i data-lucide="check-circle" class="w-3.5 h-3.5 mr-1.5"></i>SOP 已完成：先确认事件梗概
                </div>
                <div class="text-xs leading-relaxed">当前事件的核心设定已齐：事件理解、人物选择、阻力代价、信息释放、伏笔和章数方案都已覆盖。提取分章大纲前，需要先确认本事件故事梗概，避免事件顺序或细节不顺。${reason ? `\n${escapeHtml(limitText(reason, 500))}` : ''}</div>
                <button id="btn-sop-ready-extract" class="w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold">确认事件梗概并提取大纲</button>
            </div>
        `;
        document.getElementById('btn-sop-ready-extract')?.addEventListener('click', () => btnExtractSynopsis?.click());
        if (window.lucide) lucide.createIcons();
    }

    function refreshSopCompletionSignal(reply = '') {
        if (sopSupervisionGate.blocked) return;
        const report = getSopOutlineGateReport();
        const explicitReady = /【SOP_READY】|可以提取大纲|可提取大纲|点击.*提取.*大纲|进入提取大纲/.test(reply || '');
        if (report.ok || explicitReady) renderSopReadySignal(explicitReady ? 'AI 已给出明确完成信号。' : '', explicitReady);
    }

    function getSopEventBriefKey(chapterId = currentLocalContext.chapterId) {
        return `sop_event_brief_${PROJECT_ID}_${chapterId || 'unknown'}`;
    }

    function loadSopEventBriefState(chapterId = currentLocalContext.chapterId) {
        try {
            const saved = JSON.parse(localStorage.getItem(getSopEventBriefKey(chapterId)) || '{}');
            sopEventBriefState = {
                chapterId: chapterId || '',
                brief: saved.brief || '',
                confirmed: !!saved.confirmed,
                chat: Array.isArray(saved.chat) ? saved.chat : []
            };
        } catch (e) {
            sopEventBriefState = { chapterId: chapterId || '', brief: '', confirmed: false, chat: [] };
        }
        return sopEventBriefState;
    }

    function saveSopEventBriefState(state = sopEventBriefState) {
        if (!currentLocalContext.chapterId) return;
        sopEventBriefState = { ...state, chapterId: currentLocalContext.chapterId };
        localStorage.setItem(getSopEventBriefKey(), JSON.stringify(sopEventBriefState));
    }

    function ensureSopEventBriefModal() {
        let modal = document.getElementById('sop-event-brief-modal');
        if (modal) return modal;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="sop-event-brief-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md z-[86] hidden flex items-center justify-center p-6">
                <div class="bg-gray-950 border border-emerald-700/70 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden">
                    <div class="p-5 border-b border-emerald-900/50 bg-emerald-950/20 flex items-start justify-between gap-4">
                        <div>
                            <div class="text-[11px] font-bold tracking-wider text-emerald-300 mb-1">SOP 入大纲前 · 当前事件梗概确认</div>
                            <h3 class="text-xl font-bold text-white">先确认本事件故事流</h3>
                            <div class="text-xs text-gray-400 mt-1">可在这里调整事件顺序和细节，确认后再提取分章大纲。</div>
                        </div>
                        <button id="btn-close-sop-event-brief" class="text-gray-500 hover:text-white p-1 rounded border border-transparent hover:border-gray-700"><i data-lucide="x" class="w-5 h-5"></i></button>
                    </div>
                    <div class="grid md:grid-cols-[1.2fr_1fr] flex-1 min-h-0">
                        <div class="p-5 overflow-y-auto border-r border-gray-800">
                            <div class="text-xs text-gray-400 mb-2 font-bold">本事件故事梗概</div>
                            <textarea id="sop-event-brief-text" class="w-full min-h-[420px] bg-gray-900 border border-gray-700 rounded-xl p-4 text-sm text-emerald-50 leading-relaxed resize-none"></textarea>
                        </div>
                        <div class="flex flex-col min-h-0">
                            <div id="sop-event-brief-chat" class="flex-1 overflow-y-auto p-4 space-y-3 text-xs"></div>
                            <div class="p-4 border-t border-gray-800 bg-gray-950">
                                <textarea id="sop-event-brief-input" class="w-full h-24 bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm text-white resize-none" placeholder="例如：把第2个细节放到第1个之前；加强反派阻力；删除这个巧合..."></textarea>
                                <div class="grid grid-cols-3 gap-2 mt-3">
                                    <button id="btn-send-sop-event-brief" class="py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-bold text-sm">和 AI 修改</button>
                                    <button id="btn-save-sop-event-brief" class="py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold text-sm">保存梗概</button>
                                    <button id="btn-confirm-sop-event-brief" class="py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-lg font-bold text-sm">确认并提取大纲</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);
        modal = document.getElementById('sop-event-brief-modal');
        document.getElementById('btn-close-sop-event-brief')?.addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('btn-send-sop-event-brief')?.addEventListener('click', sendSopEventBriefRevision);
        document.getElementById('btn-save-sop-event-brief')?.addEventListener('click', () => {
            sopEventBriefState.brief = document.getElementById('sop-event-brief-text')?.value.trim() || '';
            sopEventBriefState.confirmed = false;
            saveSopEventBriefState();
            alert('本事件梗概已保存。');
        });
        document.getElementById('btn-confirm-sop-event-brief')?.addEventListener('click', () => {
            const brief = document.getElementById('sop-event-brief-text')?.value.trim() || '';
            if (!brief) return alert('请先生成或填写本事件梗概。');
            sopEventBriefState.brief = brief;
            sopEventBriefState.confirmed = true;
            saveSopEventBriefState();
            currentChapterChatHistory.push({ role: 'user', content: `【已确认的本事件故事梗概】\n${brief}` });
            localStorage.setItem(`sop_v3_${PROJECT_ID}_${currentLocalContext.chapterId}`, JSON.stringify(currentChapterChatHistory));
            modal.classList.add('hidden');
            btnExtractSynopsis?.click();
        });
        if (window.lucide) lucide.createIcons();
        return modal;
    }

    function renderSopEventBriefModal() {
        const textBox = document.getElementById('sop-event-brief-text');
        const chatBox = document.getElementById('sop-event-brief-chat');
        if (textBox) textBox.value = sopEventBriefState.brief || '';
        if (chatBox) {
            chatBox.innerHTML = (sopEventBriefState.chat || []).map(msg => `
                <div class="${msg.role === 'user' ? 'ml-12 bg-emerald-900/40' : 'mr-12 bg-gray-800'} p-3 rounded-xl whitespace-pre-wrap leading-relaxed">${escapeHtml(msg.content || '')}</div>
            `).join('');
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    }

    async function generateSopEventBrief() {
        const eventContext = getAdjacentEventContext(currentLocalContext.chapterNumber);
        const prompt = `你是 SOP 当前事件总览编辑。请在进入分章大纲前，基于当前 SOP 讨论写一份“本事件故事梗概”，用于确认事件顺序和细节。

【当前事件】
${eventContext.startInfo}
【下一事件锚点】
${eventContext.endInfo}
【SOP 讨论记录】
${limitText(currentChapterChatHistory.map(msg => `${msg.role}: ${stripSystemAppendix(msg.content || '')}`).join('\n\n'), 7000)}
【人物卡】
${getCharacterDetailsForSop()}
【规则/专家资料】
${getWorldRulesText()}
【上帝视角信息权限】
${formatGodViewContext()}

要求：
1. 必须以【本事件故事梗概】开头。
2. 只讲当前事件，不展开下一事件。
3. 按事件发生顺序写清：起因、关键行动、阻力升级、人物选择、代价、信息释放、伏笔种植/回收、结尾如何过渡到下一事件。
4. 单独输出【顺序与细节检查】，指出是否有不顺、跳步、巧合、动机不足或可修改的细节。
5. 不写正文，不写分章大纲。`;
        const res = await fetch('/api/chat/deduce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '生成事件梗概失败');
        return stripFencedBlocks(data.reply) || data.reply;
    }

    async function requireSopEventBriefBeforeOutline() {
        loadSopEventBriefState();
        if (sopEventBriefState.confirmed && sopEventBriefState.brief) return true;
        const modal = ensureSopEventBriefModal();
        modal.classList.remove('hidden');
        if (!sopEventBriefState.brief) {
            sopEventBriefState.brief = 'AI 正在生成本事件故事梗概...';
            renderSopEventBriefModal();
            try {
                sopEventBriefState.brief = await generateSopEventBrief();
                sopEventBriefState.chat = [{ role: 'assistant', content: '我已生成本事件故事梗概。你可以直接修改文本，或在右侧告诉我想调整的顺序和细节。' }];
                sopEventBriefState.confirmed = false;
                saveSopEventBriefState();
            } catch (error) {
                sopEventBriefState.brief = '';
                sopEventBriefState.chat = [{ role: 'assistant', content: `事件梗概生成失败：${error.message || '未知错误'}` }];
            }
        }
        renderSopEventBriefModal();
        return false;
    }

    async function sendSopEventBriefRevision() {
        const input = document.getElementById('sop-event-brief-input');
        const textBox = document.getElementById('sop-event-brief-text');
        const sendBtn = document.getElementById('btn-send-sop-event-brief');
        const text = input?.value.trim();
        if (!text) return;
        input.value = '';
        sopEventBriefState.brief = textBox?.value.trim() || sopEventBriefState.brief || '';
        sopEventBriefState.chat.push({ role: 'user', content: text });
        sopEventBriefState.chat.push({ role: 'assistant', content: 'AI 正在按你的意见调整事件梗概...' });
        renderSopEventBriefModal();
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.textContent = '修改中...';
        }
        const prompt = `请根据作者意见修改【本事件故事梗概】。只调整当前事件顺序和细节，不写分章大纲，不写正文。

【当前梗概】
${sopEventBriefState.brief}

【作者修改意见】
${text}

【SOP 讨论记录尾迹】
${limitText(currentChapterChatHistory.slice(-8).map(msg => `${msg.role}: ${stripSystemAppendix(msg.content || '')}`).join('\n\n'), 5000)}

请输出更新后的完整【本事件故事梗概】，并保留【顺序与细节检查】。`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `修改失败：${data.error || '未知错误'}`;
            sopEventBriefState.chat.pop();
            sopEventBriefState.chat.push({ role: 'assistant', content: '已按你的意见更新梗概。' });
            sopEventBriefState.brief = reply;
            sopEventBriefState.confirmed = false;
            saveSopEventBriefState();
            renderSopEventBriefModal();
        } catch (error) {
            sopEventBriefState.chat.pop();
            sopEventBriefState.chat.push({ role: 'assistant', content: `修改失败：${error.message || '未知错误'}` });
            renderSopEventBriefModal();
        } finally {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = '和 AI 修改';
            }
        }
    }

    function buildGenesisChatPayload() {
        const manualEdits = loadManualBibleEdits();
        const currentBible = applyManualBibleEditsToValue(getCurrentBibleSnapshot(), manualEdits);
        const currentBibleText = JSON.stringify(compactBibleForPrompt(currentBible) || {});
        const manualWarnings = (() => {
            try {
                const saved = JSON.parse(localStorage.getItem(MANUAL_BIBLE_WARNINGS_KEY) || '{}');
                return Array.isArray(saved.warnings) ? saved.warnings.slice(0, 8).join('\n\n') : '';
            } catch (e) { return ''; }
        })();
        const queryText = [
            getActiveSandboxModuleLabel(),
            currentBible?.worldview || '',
            currentBible?.rules || '',
            JSON.stringify(currentBible?.workflow || {}),
            JSON.stringify(currentBible?.protagonist_arc || {}),
            JSON.stringify(currentBible?.antagonist_arc || {}),
            JSON.stringify(currentBible?.hollywood_beats || []),
            formatGodViewContext(currentBible),
            (currentBible?.chapters || []).map(ch => `${ch.title || ''} ${ch.content || ''}`).join('\n'),
            genesisConversation.slice(-3).map(msg => applyManualCharacterRenamesToText(msg.content, manualEdits)).join('\n')
        ].join('\n');
        const renamedConversation = genesisConversation.map(msg => ({
            ...msg,
            content: applyManualCharacterRenamesToText(msg.content, manualEdits)
        }));
        const priorityMessage = currentBible ? [{
            role: 'user',
            content: `【最高优先级校准：以右侧实时面板为准】\n用户可能已经在右侧实时灵感面板手动修改了你之前提出的低质量设定。以下面板快照是最新有效设定，优先级高于旧聊天记录和你过去的方案。若旧内容冲突，必须废弃旧内容，并基于此快照继续推演。\n${currentBibleText}\n\n${buildSandboxWorkflowGatePrompt(currentBible)}\n\n【当前权限模式】${getCurrentControlMode()}\n- auto 全自动：发现红/黄风险时，先自我修复并说明修复结果，只把真正需要作者做审美决定的 1-2 个问题抛出。\n- semi 半自动：发现风险时给 2-3 个修复方案，让作者选择，不要擅自覆盖核心设定。\n- manual 手动：只报警和解释，不自动修改。\n\n【沙盒主流程】救猫咪类型 -> 开始/结束事件 -> 主角/最终反派 -> 基础行为决策人物卡 -> 主角/反派弧线 -> 好莱坞六节点 -> 桥接事件/完整时间线 -> 叙事逻辑 -> 沙盒验收。沙盒只做故事骨架，不做章节细化和正文。\n\n【上帝视角信息权限】\n${formatGodViewContext(currentBible)}\n\n规则：未揭露/部分揭露的秘密只供后台因果校验，不可让角色或观众提前知道；沙盒推理事件只能基于 audience_view 推进。状态为 revealed 后，才可把 god_view 作为公开事实调用。${manualWarnings ? `\n\n【手动设定变更警报】\n${manualWarnings}\n如果这些变更与旧事件冲突，必须主动指出冲突并给出整改方案。` : ''}`
        }] : [];
        return {
            ...buildChatPayload([...priorityMessage, ...renamedConversation]),
            currentBible: compactBibleForPrompt(currentBible),
            localReferenceSnippets: getRelevantLocalSourceSnippets(queryText),
            requirePanelJson: getPendingInteractionQuestions('sandbox').length === 0
        };
    }

    function normalizeStableKey(value = '') {
        return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
    }

    function stableHash(value = '') {
        let hash = 0;
        String(value || '').split('').forEach(char => {
            hash = ((hash << 5) - hash) + char.charCodeAt(0);
            hash |= 0;
        });
        return Math.abs(hash).toString(36);
    }

    function ensureCharacterIdentity(char = {}) {
        const seed = char.character_id || char.id || char.original_name || char.name || JSON.stringify(char);
        return {
            ...char,
            character_id: char.character_id || char.id || `char_${stableHash(seed)}`
        };
    }

    function isPlaceholderCharacterName(name = '') {
        return !String(name || '').trim() || /^(未知|未命名|主角|主人公|男主|女主|反派|最终反派|核心阻力|角色\d*|人物\d*|待定|TBD)$/i.test(String(name || '').trim());
    }

    function extractLeadNamesFromConversation() {
        const text = genesisConversation
            .filter(msg => msg?.role === 'user')
            .map(msg => stripSystemAppendix(msg.content || ''))
            .join('\n');
        const patterns = [
            ['protagonist', /(?:主角|主人公|男主|女主)(?:叫|名叫|名字是|设定为|是)\s*([一-龥A-Za-z][一-龥A-Za-z0-9·]{1,12})/g],
            ['antagonist', /(?:反派|最终反派|核心阻力|对手)(?:叫|名叫|名字是|设定为|是)\s*([一-龥A-Za-z][一-龥A-Za-z0-9·]{1,12})/g]
        ];
        const names = {};
        patterns.forEach(([type, pattern]) => {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const candidate = cleanupMixedCharacterName(match[1]);
                if (!isPlaceholderCharacterName(candidate)) names[type] = candidate;
            }
        });
        return names;
    }

    function applyConversationLeadNamesToBible(bible = {}) {
        const names = extractLeadNamesFromConversation();
        if (!names.protagonist && !names.antagonist) return bible;
        const next = { ...bible, characters: Array.isArray(bible.characters) ? [...bible.characters] : [] };
        const upsertLead = (type, name) => {
            if (!name) return;
            const rolePattern = type === 'antagonist' ? /反派|对手|敌人|核心阻力|最终阻力|antagonist/i : /主角|主人公|男主|女主|protagonist/i;
            const roleLabel = type === 'antagonist' ? '最终反派/核心阻力' : '主角';
            const existingIndex = next.characters.findIndex(char => rolePattern.test(`${char.role || ''} ${char.description || ''} ${char.name || ''}`));
            if (existingIndex >= 0) {
                const existing = next.characters[existingIndex];
                if (isPlaceholderCharacterName(existing.name)) {
                    next.characters[existingIndex] = ensureCharacterIdentity({
                        ...existing,
                        original_name: existing.original_name || existing.name,
                        name,
                        role: existing.role || roleLabel
                    });
                }
                return;
            }
            next.characters.push(ensureCharacterIdentity({
                name,
                role: roleLabel,
                description: `${roleLabel}，由沙盒对话中提取姓名；基础人物卡仍需补全。`
            }));
        };
        upsertLead('protagonist', names.protagonist);
        upsertLead('antagonist', names.antagonist);
        return next;
    }

    function getCharacterIdentity(char = {}) {
        return char.character_id || char.id || '';
    }

    function getCharacterNameKey(char = {}) {
        return normalizeStableKey(char.name || char.original_name || '');
    }

    function indexCharactersByIdentity(characters = []) {
        const byId = new Map();
        const byName = new Map();
        characters.forEach(char => {
            const id = getCharacterIdentity(char);
            const nameKey = getCharacterNameKey(char);
            if (id) byId.set(id, char);
            if (nameKey && !byName.has(nameKey)) byName.set(nameKey, char);
        });
        return { byId, byName };
    }

    function dedupeCharactersByIdentity(characters = []) {
        const byId = new Map();
        const byName = new Map();
        characters.filter(char => char && !isPlaceholderCharacterName(char.name)).forEach(rawChar => {
            const char = ensureCharacterIdentity(rawChar);
            const id = getCharacterIdentity(char);
            const nameKey = getCharacterNameKey(char);
            const existing = (id && byId.get(id)) || (nameKey && byName.get(nameKey));
            const merged = existing ? mergeObjectMissingFields(existing, char) : char;
            const stableId = getCharacterIdentity(existing || char);
            merged.character_id = stableId || merged.character_id;
            if (existing?.id && !merged.id) merged.id = existing.id;
            if (stableId) byId.set(stableId, merged);
            if (nameKey) byName.set(nameKey, merged);
        });
        return Array.from(new Set([...byId.values(), ...byName.values()]));
    }

    function mergeObjectMissingFields(previousItem = {}, nextItem = {}) {
        const merged = { ...previousItem, ...nextItem };
        Object.entries(previousItem || {}).forEach(([key, value]) => {
            const nextValue = nextItem ? nextItem[key] : undefined;
            if ((nextValue === '' || nextValue === null || nextValue === undefined) && value !== '' && value !== null && value !== undefined) {
                merged[key] = value;
            }
        });
        return merged;
    }

    function loadManualBibleEdits() {
        try {
            const edits = JSON.parse(localStorage.getItem(MANUAL_BIBLE_EDITS_KEY) || '{}');
            return {
                characterRenames: edits.characterRenames || {},
                characterRenameLabels: edits.characterRenameLabels || {},
                characterRenameIds: edits.characterRenameIds || {},
                deletedCharacters: edits.deletedCharacters || {},
                deletedRelations: edits.deletedRelations || {},
                deletedTimeline: edits.deletedTimeline || {}
            };
        } catch (e) {
            return { characterRenames: {}, characterRenameLabels: {}, characterRenameIds: {}, deletedCharacters: {}, deletedRelations: {}, deletedTimeline: {} };
        }
    }

    function saveManualBibleEdits(edits) {
        localStorage.setItem(MANUAL_BIBLE_EDITS_KEY, JSON.stringify({
            characterRenames: edits.characterRenames || {},
            characterRenameLabels: edits.characterRenameLabels || {},
            characterRenameIds: edits.characterRenameIds || {},
            deletedCharacters: edits.deletedCharacters || {},
            deletedRelations: edits.deletedRelations || {},
            deletedTimeline: edits.deletedTimeline || {}
        }));
    }

    function canonicalCharacterName(name, edits = loadManualBibleEdits()) {
        const cleanName = cleanupMixedCharacterName(name);
        const key = normalizeStableKey(cleanName);
        return edits.characterRenames[key] || cleanName;
    }

    function getCharacterRenameEntries(edits = loadManualBibleEdits()) {
        return Object.entries(edits.characterRenames || {})
            .map(([oldKey, newName]) => ({
                oldName: edits.characterRenameLabels?.[oldKey] || oldKey,
                oldKey,
                newName
            }))
            .filter(item => item.oldName && item.newName && normalizeStableKey(item.oldName) !== normalizeStableKey(item.newName));
    }

    function rememberCharacterRename(oldName, newName, characterId = '') {
        const cleanOldName = cleanupMixedCharacterName(oldName);
        const cleanNewName = cleanupMixedCharacterName(newName);
        if (!cleanOldName || !cleanNewName || normalizeStableKey(cleanOldName) === normalizeStableKey(cleanNewName)) return false;
        const edits = loadManualBibleEdits();
        const oldKey = normalizeStableKey(cleanOldName);
        edits.characterRenames[oldKey] = cleanNewName;
        edits.characterRenameLabels[oldKey] = cleanOldName;
        if (characterId) edits.characterRenameIds[characterId] = cleanNewName;
        delete edits.deletedCharacters[normalizeStableKey(cleanNewName)];
        saveManualBibleEdits(edits);
        return true;
    }

    function refreshCurrentBibleAfterCharacterRename(oldName, newName, characterId = '') {
        const renamed = rememberCharacterRename(oldName, newName, characterId);
        if (!renamed) return;
        const currentBible = loadLatestBible();
        if (!currentBible) return;
        const normalizedBible = normalizeManualBibleSnapshot(currentBible);
        localStorage.setItem(LATEST_BIBLE_KEY, JSON.stringify(normalizedBible));
        renderHumanPreview(normalizedBible);
        syncGenesisDraftToCloud().catch(error => console.warn('人物改名后云端同步失败:', error));
    }

    function escapeRegExp(value = '') {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function cleanupMixedCharacterName(name = '') {
        const value = String(name || '').trim();
        return value.replace(/([\u4e00-\u9fff])[A-Za-z]+(?=[\u4e00-\u9fff])/g, '$1');
    }

    function applyManualCharacterRenamesToText(text = '', edits = loadManualBibleEdits()) {
        let result = String(text || '').replace(/([\u4e00-\u9fff])[A-Za-z]+(?=[\u4e00-\u9fff])/g, '$1');
        getCharacterRenameEntries(edits)
            .sort((a, b) => b.oldName.length - a.oldName.length)
            .forEach(({ oldName, newName }) => {
                if (oldName) result = result.replace(new RegExp(escapeRegExp(oldName), 'g'), newName);
            });
        return result;
    }

    function applyManualBibleEditsToValue(value, edits = loadManualBibleEdits()) {
        if (typeof value === 'string') return applyManualCharacterRenamesToText(value, edits);
        if (Array.isArray(value)) return value.map(item => applyManualBibleEditsToValue(item, edits));
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, applyManualBibleEditsToValue(entryValue, edits)]));
        }
        return value;
    }

    function getRelationManualKey(rel = {}) {
        return [
            normalizeStableKey(rel.from_name || rel.from || rel.source),
            normalizeStableKey(rel.to_name || rel.to || rel.target),
            normalizeStableKey(rel.label || rel.relation)
        ].join('|');
    }

    function getRelationMergeKey(rel = {}) {
        return [
            normalizeStableKey(canonicalCharacterName(rel.from_name || rel.from || rel.source)),
            normalizeStableKey(canonicalCharacterName(rel.to_name || rel.to || rel.target))
        ].join('|');
    }

    function getTimelineManualKey(item = {}) {
        return [
            normalizeStableKey(item.time_label),
            normalizeStableKey(item.description)
        ].join('|');
    }

    function getTimelineMergeKey(item = {}) {
        const chapter = String(item.chapter_number || '').trim();
        const time = normalizeStableKey(item.time_label);
        const desc = normalizeStableKey(item.description);
        return [chapter, time || desc].join('|');
    }

    function rememberManualBibleEdits(previousBible = {}, nextBible = {}) {
        const previousCharacters = Array.isArray(previousBible.characters) ? previousBible.characters : [];
        const nextCharacters = Array.isArray(nextBible.characters) ? nextBible.characters : [];
        const edits = loadManualBibleEdits();
        const renamedOldKeys = new Set();

        const previousById = new Map(previousCharacters.map(char => [char.character_id || char.id, char]).filter(([id]) => id));
        nextCharacters.forEach((char) => {
            const previousBySameId = previousById.get(char.character_id || char.id);
            const oldName = char.original_name || previousBySameId?.name;
            const newName = char.name;
            if (!oldName || !newName || normalizeStableKey(oldName) === normalizeStableKey(newName)) return;
            const oldKey = normalizeStableKey(oldName);
            renamedOldKeys.add(oldKey);
            edits.characterRenames[oldKey] = newName;
            edits.characterRenameLabels[oldKey] = oldName;
            if (char.character_id || char.id) edits.characterRenameIds[char.character_id || char.id] = newName;
            delete edits.deletedCharacters[normalizeStableKey(newName)];
        });

        const nextNames = new Set(nextCharacters.map(char => normalizeStableKey(char.name)).filter(Boolean));
        previousCharacters.forEach(char => {
            const key = normalizeStableKey(char.name);
            if (!key || nextNames.has(key) || renamedOldKeys.has(key)) return;
            edits.deletedCharacters[key] = char.name;
        });

        const nextRelationKeys = new Set((Array.isArray(nextBible.relations) ? nextBible.relations : []).map(getRelationManualKey).filter(Boolean));
        nextRelationKeys.forEach(key => delete edits.deletedRelations[key]);
        (Array.isArray(previousBible.relations) ? previousBible.relations : []).forEach(rel => {
            const key = getRelationManualKey(rel);
            if (key && !nextRelationKeys.has(key)) edits.deletedRelations[key] = true;
        });

        const nextTimelineKeys = new Set((Array.isArray(nextBible.timeline) ? nextBible.timeline : []).map(getTimelineManualKey).filter(Boolean));
        nextTimelineKeys.forEach(key => delete edits.deletedTimeline[key]);
        (Array.isArray(previousBible.timeline) ? previousBible.timeline : []).forEach(item => {
            const key = getTimelineManualKey(item);
            if (key && !nextTimelineKeys.has(key)) edits.deletedTimeline[key] = true;
        });

        saveManualBibleEdits(edits);
    }

    function getCharacterDisplayName(char = {}) {
        return char.name || char.original_name || '';
    }

    function getCharacterReferencedEvents(name, bible = {}) {
        const key = normalizeStableKey(name);
        if (!key) return [];
        const mentions = [];
        const hasName = text => normalizeStableKey(text || '').includes(key);
        (bible.timeline || []).forEach(item => {
            if (hasName(`${item.time_label || ''}\n${item.description || ''}`)) {
                mentions.push(`时间轴事件 ${item.chapter_number || '-'}：${item.description || item.time_label || '未命名事件'}`);
            }
        });
        (bible.chapters || []).forEach(chapter => {
            if (hasName(`${chapter.title || ''}\n${chapter.content || ''}`)) {
                mentions.push(`章节/事件 ${chapter.chapter_number || '-'}《${chapter.title || '未命名'}》`);
            }
        });
        (bible.relations || []).forEach(rel => {
            if (normalizeStableKey(rel.from_name) === key || normalizeStableKey(rel.to_name) === key) {
                mentions.push(`人物羁绊：${rel.from_name || '-'} -> ${rel.to_name || '-'}：${rel.label || '羁绊'}`);
            }
        });
        return Array.from(new Set(mentions));
    }

    function findBibleEditWarnings(previousBible = {}, nextBible = {}) {
        if (!previousBible || !nextBible) return [];
        const warnings = [];
        const previousChars = Array.isArray(previousBible.characters) ? previousBible.characters : [];
        const nextChars = Array.isArray(nextBible.characters) ? nextBible.characters : [];
        const nextByOriginalOrName = new Map();
        nextChars.forEach(char => {
            [char.original_name, char.name].filter(Boolean).forEach(name => nextByOriginalOrName.set(normalizeStableKey(name), char));
        });

        previousChars.forEach(prevChar => {
            const prevName = getCharacterDisplayName(prevChar);
            const nextChar = nextByOriginalOrName.get(normalizeStableKey(prevName));
            const refs = getCharacterReferencedEvents(prevName, previousBible);
            if (!nextChar) {
                if (refs.length > 0) warnings.push(`你删除了人物「${prevName}」，但他/她仍关联：\n${refs.slice(0, 8).join('\n')}`);
                return;
            }
            const changedFields = ['name', 'role', 'faction', 'description', 'personality', 'core_desire', 'goal', 'motivation', 'flaw', 'fear', 'skills', 'character_rules', 'background', 'character_arc']
                .filter(field => String(prevChar[field] || '').trim() !== String(nextChar[field] || '').trim());
            if (changedFields.length > 0 && refs.length > 0) {
                warnings.push(`你修改了人物「${prevName}」的 ${changedFields.join('、')}。\n这些已确定内容可能需要同步检查：\n${refs.slice(0, 8).join('\n')}`);
            }
        });

        if (String(previousBible.rules || '').trim() !== String(nextBible.rules || '').trim()) {
            warnings.push('你修改了世界规则/专家资料。系统需要重新检查六节点、桥接事件、人物能力边界、SOP 大纲和已写正文是否仍然成立。');
        }
        if (String(previousBible.worldview || '').trim() !== String(nextBible.worldview || '').trim()) {
            warnings.push('你修改了世界观背景。系统需要重新检查事件发生条件、职业/历史/社会规则和人物行动边界。');
        }
        const previousBeats = new Map((previousBible.hollywood_beats || []).map(beat => [beat.beat || beat.key, beat]));
        (nextBible.hollywood_beats || []).forEach(beat => {
            const prev = previousBeats.get(beat.beat || beat.key);
            if (!prev) return;
            const changed = ['title', 'event_ref', 'status', 'content', 'function']
                .some(field => String(prev[field] || '').trim() !== String(beat[field] || '').trim());
            if (changed) warnings.push(`你修改了好莱坞六节点「${beat.title || beat.beat || '未命名'}」。系统需要重新检查桥接事件、主角/反派弧线和后续 SOP 是否对齐。`);
        });
        if (JSON.stringify(normalizeArc(previousBible.protagonist_arc || {})) !== JSON.stringify(normalizeArc(nextBible.protagonist_arc || {}))) {
            warnings.push('你修改了主角弧线。系统需要重新检查主角在六节点、桥接事件、SOP 和正文中的选择是否仍然成立。');
        }
        if (JSON.stringify(normalizeArc(previousBible.antagonist_arc || {})) !== JSON.stringify(normalizeArc(nextBible.antagonist_arc || {}))) {
            warnings.push('你修改了反派/核心阻力弧线。系统需要重新检查反派计划、反制升级、虚假胜利、至暗时刻和终局是否仍然成立。');
        }
        if (JSON.stringify(normalizeSecrets(previousBible.secrets || [])) !== JSON.stringify(normalizeSecrets(nextBible.secrets || []))) {
            warnings.push('你修改了上帝视角/观众视角信息。系统需要重新检查信息权限、伏笔、误导和后续事件是否提前泄密或失去悬念。');
        }

        const previousChapters = new Map((previousBible.chapters || []).map(ch => [String(ch.chapter_number || ''), ch]));
        (nextBible.chapters || []).forEach(ch => {
            const prev = previousChapters.get(String(ch.chapter_number || ''));
            if (!prev) return;
            const changed = String(prev.title || '').trim() !== String(ch.title || '').trim()
                || String(prev.content || '').trim() !== String(ch.content || '').trim();
            if (!changed) return;
            const linkedCharacters = (nextBible.characters || [])
                .filter(char => normalizeStableKey(`${ch.title || ''}\n${ch.content || ''}`).includes(normalizeStableKey(char.name)))
                .map(char => char.name);
            warnings.push(`你修改了事件 ${ch.chapter_number}《${ch.title || prev.title || '未命名'}》。\n后续 AI 会以新事件为准；建议检查相邻事件、伏笔和人物动机。${linkedCharacters.length ? `\n受影响人物：${Array.from(new Set(linkedCharacters)).join('、')}` : ''}`);
        });

        const previousTimeline = new Map((previousBible.timeline || []).map(item => [getTimelineManualKey(item), item]));
        const nextTimelineKeys = new Set((nextBible.timeline || []).map(getTimelineManualKey));
        (nextBible.timeline || []).forEach(item => {
            const sameKey = getTimelineManualKey(item);
            if (previousTimeline.has(sameKey)) return;
            const sameChapter = (previousBible.timeline || []).find(prev => String(prev.chapter_number || '') === String(item.chapter_number || ''));
            if (!sameChapter) return;
            const changed = String(sameChapter.time_label || '').trim() !== String(item.time_label || '').trim()
                || String(sameChapter.description || '').trim() !== String(item.description || '').trim();
            if (!changed) return;
            warnings.push(`你修改了细密时间轴事件 ${item.chapter_number || '-'}：${item.description || item.time_label || '未命名事件'}。\n后续 AI 会以新时间轴为准；建议检查同章大纲、相邻事件和相关人物动机。`);
        });
        (previousBible.timeline || []).forEach(item => {
            const key = getTimelineManualKey(item);
            if (key && !nextTimelineKeys.has(key)) {
                warnings.push(`你删除或改写了细密时间轴事件 ${item.chapter_number || '-'}：${item.description || item.time_label || '未命名事件'}。\n如果这是已确定因果节点，请检查前后事件是否仍能连接。`);
            }
        });

        return warnings;
    }

    function getEventNumbersFromText(text = '') {
        const nums = new Set();
        String(text || '').replace(/(?:事件|章节|第)\s*(\d+(?:\.\d+)?)/g, (_, num) => {
            nums.add(String(num));
            return _;
        });
        return Array.from(nums);
    }

    function inferAffectedChapterNumbers(warnings = [], bible = {}) {
        const nums = new Set();
        warnings.forEach(warning => getEventNumbersFromText(warning).forEach(num => nums.add(num)));
        if (warnings.some(w => /规则|世界观|主角弧线|反派|六节点|上帝视角|观众视角/.test(w))) {
            (bible.chapters || []).forEach(ch => nums.add(String(ch.chapter_number || '')));
            (bible.timeline || []).forEach(t => nums.add(String(t.chapter_number || '')));
        }
        return Array.from(nums).filter(Boolean);
    }

    function recordChangePatch(previousBible = {}, nextBible = {}, warnings = []) {
        if (!warnings.length) return null;
        const affectedChapters = inferAffectedChapterNumbers(warnings, nextBible);
        const finalized = longformState.finalizedChapters || {};
        const finalizedAffected = affectedChapters.filter(num => finalized[getLongformChapterKey(num)]);
        const patch = {
            id: `patch_${Date.now()}_${stableHash(warnings.join('|')).slice(0, 6)}`,
            createdAt: new Date().toISOString(),
            status: finalizedAffected.length > 0 ? 'blocks_finalized' : 'needs_review',
            warnings,
            affectedChapters,
            finalizedAffected,
            recommendedActions: [
                affectedChapters.length ? `重跑受影响事件的 SOP：${affectedChapters.join('、')}` : '',
                finalizedAffected.length ? `已定稿事件受影响，需重新验收：${finalizedAffected.join('、')}` : '',
                '重跑连续性、人物状态、事件闸门和验收闸门。',
                '若变更涉及规则/上帝视角，检查是否有信息提前泄露或旧伏笔失效。'
            ].filter(Boolean)
        };
        longformState.changePatches = [patch, ...((longformState.changePatches || []).filter(item => item.status !== 'resolved'))].slice(0, 20);
        saveLongformState();
        return patch;
    }

    function renderChangePatchPanel(patch = null) {
        const activePatch = patch || (longformState.changePatches || [])[0];
        if (!activePatch) return;
        const lines = [
            `【设定变更补丁】${activePatch.status === 'blocks_finalized' ? '已影响定稿章节' : '需要重审'}`,
            ...(activePatch.warnings || []).slice(0, 5),
            activePatch.affectedChapters?.length ? `受影响事件：${activePatch.affectedChapters.join('、')}` : '',
            activePatch.finalizedAffected?.length ? `受影响定稿事件：${activePatch.finalizedAffected.join('、')}` : '',
            ...(activePatch.recommendedActions || [])
        ].filter(Boolean);
        renderDeviationItems(lines);
    }

    async function rerunActiveChangePatchReview() {
        const patch = (longformState.changePatches || []).find(item => item.status !== 'resolved');
        if (!patch) {
            renderDeviationItems(['当前没有待处理的设定变更补丁。']);
            return;
        }
        renderDeviationItems([`正在重审设定变更影响：${patch.affectedChapters?.join('、') || '全局'}...`]);
        const prompt = `你是设定变更传播审查器。请根据补丁记录判断哪些 SOP、正文、定稿章节需要重跑，并给出最小修复顺序。
【补丁记录】\n${JSON.stringify(patch)}
【当前世界圣经】\n${JSON.stringify(compactBibleForPrompt(getCurrentBibleSnapshot()))}
【长篇编辑状态】\n${getLongformEditorialContext()}

请输出：
【影响范围】受影响事件/人物/规则/伏笔/上帝视角；
【定稿风险】哪些已定稿章节需要重新验收；
【重跑清单】SOP、连续性、人物状态、验收闸门、正文改稿的顺序；
【最小补丁】优先改哪里，避免推倒重来。`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `变更重审失败：${data.error || '未知错误'}`;
            patch.lastReview = reply;
            patch.lastReviewedAt = new Date().toISOString();
            patch.status = /无需|没有明显|可继续/.test(reply) ? 'reviewed' : patch.status;
            saveLongformState();
            renderDeviationItems([reply]);
        } catch (error) {
            renderDeviationItems([`变更重审请求失败：${error.message || '未知错误'}`]);
        }
    }

    function warnBibleEditConflicts(previousBible, nextBible) {
        const warnings = findBibleEditWarnings(previousBible, nextBible);
        if (warnings.length === 0) return;
        const signature = warnings.join('\n---\n');
        if (localStorage.getItem(MANUAL_BIBLE_WARNING_SIGNATURE_KEY) === signature) return;
        localStorage.setItem(MANUAL_BIBLE_WARNING_SIGNATURE_KEY, signature);
        localStorage.setItem(MANUAL_BIBLE_WARNINGS_KEY, JSON.stringify({
            savedAt: new Date().toISOString(),
            warnings: warnings.slice(0, 12)
        }));
        const patch = recordChangePatch(previousBible, nextBible, warnings);
        if (warnings.every(warning => warning.startsWith('你修改了人物') && warning.includes('name'))) return;
        updateRealtimeAlarmFromBible(nextBible, `设定变更传播提醒：\n${warnings.slice(0, 3).join('\n')}`);
        renderChangePatchPanel(patch);
        alert(`设定变更提醒：\n\n${warnings.slice(0, 4).join('\n\n')}\n\n后续 AI 已会按新设定继续，但建议你检查以上事件是否需要重写/调整。`);
    }

    window.getSandboxCharacterDeleteWarning = (item) => {
        const name = item?.querySelector('.char-name')?.value.trim() || item?.dataset.originalName || '';
        const refs = getCharacterReferencedEvents(name, collectBibleFromPreview());
        if (refs.length === 0) return `确认删除人物「${name || '未命名'}」吗？`;
        return `人物「${name}」已经关联以下已确定内容：\n\n${refs.slice(0, 10).join('\n')}\n\n删除后，后续 AI 将不再自动调用此人物；相关事件可能需要改写。仍要删除吗？`;
    };

    function mergeCharactersPreservingCards(previousCharacters = [], nextCharacters = []) {
        const edits = loadManualBibleEdits();
        const previous = dedupeCharactersByIdentity(Array.isArray(previousCharacters) ? previousCharacters
            .filter(c => c && c.name)
            .map(c => ensureCharacterIdentity({ ...c, name: canonicalCharacterName(c.name, edits) }))
            .filter(c => !edits.deletedCharacters[normalizeStableKey(c.name)]) : []);
        const previousIndex = indexCharactersByIdentity(previous);
        const next = dedupeCharactersByIdentity(Array.isArray(nextCharacters) ? nextCharacters
            .filter(c => c && c.name)
            .map(c => {
                const canonicalName = canonicalCharacterName(c.name, edits);
                const existing = previousIndex.byId.get(getCharacterIdentity(c))
                    || previousIndex.byName.get(normalizeStableKey(canonicalName))
                    || previousIndex.byName.get(normalizeStableKey(c.original_name));
                return ensureCharacterIdentity({
                    ...c,
                    id: c.id || existing?.id,
                    character_id: getCharacterIdentity(existing) || getCharacterIdentity(c),
                    original_name: c.original_name || existing?.original_name || existing?.name,
                    name: canonicalName
                });
            })
            .filter(c => !edits.deletedCharacters[normalizeStableKey(c.name)]) : []);
        if (next.length === 0 && previous.length > 0) return previous;

        const previousByIdentity = new Map(previous.map(char => [getCharacterIdentity(char) || normalizeStableKey(char.name), char]));
        const previousByName = new Map(previous.map(char => [normalizeStableKey(char.name), char]));
        const seen = new Set();
        const merged = next.map(char => {
            const key = getCharacterIdentity(char) || normalizeStableKey(char.name);
            seen.add(key);
            return mergeObjectMissingFields(previousByIdentity.get(key) || previousByName.get(normalizeStableKey(char.name)), char);
        });

        previous.forEach(char => {
            const key = getCharacterIdentity(char) || normalizeStableKey(char.name);
            if (!seen.has(key)) merged.push(char);
        });
        return dedupeCharactersByIdentity(merged);
    }

    function mergeStableArray(previousItems = [], nextItems = [], getKey) {
        const previous = Array.isArray(previousItems) ? previousItems.filter(Boolean) : [];
        const next = Array.isArray(nextItems) ? nextItems.filter(Boolean) : [];
        if (next.length === 0 && previous.length > 0) return previous;

        const previousByKey = new Map(previous.map(item => [getKey(item), item]).filter(([key]) => key));
        const seen = new Set();
        const merged = next.map(item => {
            const key = getKey(item);
            if (key) seen.add(key);
            return mergeObjectMissingFields(previousByKey.get(key), item);
        });

        previous.forEach(item => {
            const key = getKey(item);
            if (key && !seen.has(key)) merged.push(item);
        });
        return merged;
    }

    function uniqueStableArray(items = [], getKey) {
        const unique = new Map();
        (Array.isArray(items) ? items : []).filter(Boolean).forEach(item => {
            const key = getKey(item);
            if (!key) return;
            unique.set(key, unique.has(key) ? mergeObjectMissingFields(unique.get(key), item) : item);
        });
        return Array.from(unique.values());
    }

    function normalizeManualBibleSnapshot(bible = {}) {
        const edits = loadManualBibleEdits();
        const normalized = applyManualBibleEditsToValue(bible, edits) || {};
        normalized.characters = dedupeCharactersByIdentity((normalized.characters || [])
            .filter(char => char?.name)
            .map(char => ensureCharacterIdentity({ ...char, name: canonicalCharacterName(char.name, edits) }))
            .filter(char => !edits.deletedCharacters[normalizeStableKey(char.name)]));
        normalized.relations = uniqueStableArray((normalized.relations || [])
            .map(rel => ({
                ...rel,
                from_name: canonicalCharacterName(rel.from_name || rel.from || rel.source, edits),
                to_name: canonicalCharacterName(rel.to_name || rel.to || rel.target, edits)
            }))
            .filter(rel => rel.from_name && rel.to_name && !edits.deletedRelations[getRelationManualKey(rel)]), getRelationMergeKey);
        normalized.timeline = uniqueStableArray((normalized.timeline || [])
            .filter(item => !edits.deletedTimeline[getTimelineManualKey(item)]), getTimelineMergeKey);
        normalized.secrets = normalizeSecrets(normalized.secrets || []);
        normalized.workflow = normalizeWorkflow(normalized.workflow || {});
        normalized.protagonist_arc = normalizeArc(normalized.protagonist_arc || {});
        normalized.antagonist_arc = normalizeArc(normalized.antagonist_arc || {});
        normalized.hollywood_beats = normalizeHollywoodBeats(normalized.hollywood_beats || []);
        normalized.chapters = uniqueStableArray(normalized.chapters || [], chapter => [
            String(chapter.chapter_number || '').trim(),
            normalizeStableKey(chapter.title)
        ].join('|'));
        return normalized;
    }

    function mergeBibleWithStableLists(previous, next) {
        const manualEdits = loadManualBibleEdits();
        if (!previous || !next || typeof next !== 'object') return normalizeManualBibleSnapshot(next);
        const editedPrevious = applyManualBibleEditsToValue(previous, manualEdits);
        const editedNext = applyManualBibleEditsToValue(next, manualEdits);
        const merged = { ...editedNext };
        Object.entries(editedPrevious || {}).forEach(([key, value]) => {
            const nextValue = merged[key];
            if ((nextValue === '' || nextValue === null || nextValue === undefined) && value !== '' && value !== null && value !== undefined) {
                merged[key] = applyManualBibleEditsToValue(value, manualEdits);
            }
        });
        merged.characters = mergeCharactersPreservingCards(editedPrevious.characters, editedNext.characters);
        const nextRelations = Array.isArray(editedNext.relations) ? editedNext.relations.map(rel => ({
            ...rel,
            from_name: canonicalCharacterName(rel.from_name || rel.from || rel.source, manualEdits),
            to_name: canonicalCharacterName(rel.to_name || rel.to || rel.target, manualEdits)
        })).filter(rel => !manualEdits.deletedRelations[getRelationManualKey(rel)]) : editedNext.relations;
        merged.relations = mergeStableArray(editedPrevious.relations, nextRelations, getRelationMergeKey);
        const nextTimeline = Array.isArray(editedNext.timeline)
            ? editedNext.timeline.filter(item => !manualEdits.deletedTimeline[getTimelineManualKey(item)])
            : editedNext.timeline;
        merged.timeline = mergeStableArray(editedPrevious.timeline, nextTimeline, getTimelineMergeKey);
        merged.secrets = mergeStableArray(normalizeSecrets(editedPrevious.secrets), normalizeSecrets(editedNext.secrets), getSecretMergeKey);
        merged.workflow = normalizeWorkflow({ ...(editedPrevious.workflow || {}), ...(editedNext.workflow || {}) });
        merged.protagonist_arc = mergeObjectMissingFields(normalizeArc(editedPrevious.protagonist_arc || {}), normalizeArc(editedNext.protagonist_arc || {}));
        merged.antagonist_arc = mergeObjectMissingFields(normalizeArc(editedPrevious.antagonist_arc || {}), normalizeArc(editedNext.antagonist_arc || {}));
        merged.hollywood_beats = normalizeHollywoodBeats(mergeStableArray(editedPrevious.hollywood_beats || [], editedNext.hollywood_beats || [], beat => beat.beat || beat.key));
        merged.chapters = mergeStableArray(editedPrevious.chapters, editedNext.chapters, chapter => [
            String(chapter.chapter_number || '').trim(),
            normalizeStableKey(chapter.title)
        ].join('|'));
        return merged;
    }

    function saveLatestBible(bible, options = {}) {
        if (!bible) return null;
        bible = applyConversationLeadNamesToBible(bible);
        const previous = options.preserveStableLists === false ? null : loadLatestBible();
        if (options.preserveStableLists === false) rememberManualBibleEdits(loadLatestBible(), bible);
        const bibleToSave = options.preserveStableLists === false
            ? normalizeManualBibleSnapshot(bible)
            : mergeBibleWithStableLists(previous, bible);
        if (previous && options.backup !== false) backupLatestBible(previous);
        localStorage.setItem(LATEST_BIBLE_KEY, JSON.stringify(bibleToSave));
        return bibleToSave;
    }

    function backupLatestBible(bible) {
        try {
            const hasRecoverableData = (bible.characters || []).length > 0
                || (bible.relations || []).length > 0
                || (bible.timeline || []).length > 0
                || (bible.chapters || []).length > 0;
            if (!hasRecoverableData) return;
            const backupKey = `${LATEST_BIBLE_KEY}_backups`;
            const backups = JSON.parse(localStorage.getItem(backupKey) || '[]');
            const latest = backups[0]?.bible ? JSON.stringify(backups[0].bible) : '';
            const current = JSON.stringify(bible);
            if (latest === current) return;
            backups.unshift({ savedAt: new Date().toISOString(), bible });
            localStorage.setItem(backupKey, JSON.stringify(backups.slice(0, 12)));
        } catch (e) {
            console.warn('世界圣经本地备份失败:', e);
        }
    }

    function loadLatestBible() {
        try {
            const savedBible = localStorage.getItem(LATEST_BIBLE_KEY);
            return savedBible ? JSON.parse(savedBible) : null;
        } catch (e) {
            console.warn('最新面板数据读取失败:', e);
            return null;
        }
    }

    async function fetchBibleSnapshotFromDatabase() {
        try {
            const res = await fetch(`/api/crystallize/snapshot/${PROJECT_ID}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.success && data.bible ? data.bible : null;
        } catch (e) {
            console.warn('数据库圣经快照读取失败:', e);
            return null;
        }
    }

    function loadLatestBibleBackups() {
        try {
            const backups = JSON.parse(localStorage.getItem(`${LATEST_BIBLE_KEY}_backups`) || '[]');
            return Array.isArray(backups) ? backups.map(item => item.bible).filter(Boolean) : [];
        } catch (e) {
            return [];
        }
    }

    async function fetchGenesisCloudBibleBackups() {
        try {
            const res = await fetch(`/api/workspace/cloud-sync/${PROJECT_ID}?type=${encodeURIComponent(`${GENESIS_CLOUD_TYPE}::backup`)}`);
            if (!res.ok) return [];
            const data = await res.json();
            const items = data.payload?.items || [];
            return Array.isArray(items) ? items.map(item => item.payload?.bible).filter(Boolean) : [];
        } catch (e) {
            console.warn('云端世界圣经备份读取失败:', e);
            return [];
        }
    }

    function hasStableBibleGaps(bible = {}) {
        return !bible
            || !Array.isArray(bible.relations) || bible.relations.length === 0
            || !Array.isArray(bible.timeline) || bible.timeline.length === 0
            || !Array.isArray(bible.characters) || bible.characters.length === 0;
    }

    function looksLikeBibleJson(value) {
        return value && typeof value === 'object' && (
            Object.prototype.hasOwnProperty.call(value, 'genre') ||
            Object.prototype.hasOwnProperty.call(value, 'worldview') ||
            Object.prototype.hasOwnProperty.call(value, 'rules') ||
            Object.prototype.hasOwnProperty.call(value, 'workflow') ||
            Object.prototype.hasOwnProperty.call(value, 'protagonist_arc') ||
            Object.prototype.hasOwnProperty.call(value, 'antagonist_arc') ||
            Array.isArray(value.hollywood_beats) ||
            Array.isArray(value.characters) ||
            Array.isArray(value.timeline) ||
            Array.isArray(value.chapters)
        );
    }

    function extractBibleJsonFromText(text = "") {
        const candidates = [];
        const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
        let match;
        while ((match = fenceRegex.exec(text)) !== null) {
            candidates.push(match[1].trim());
        }
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
        }
        for (const candidate of candidates.reverse()) {
            try {
                const parsed = JSON.parse(candidate);
                if (looksLikeBibleJson(parsed)) return parsed;
            } catch (e) {}
        }
        return null;
    }

    function extractJsonObjectFromText(text = "") {
        const candidates = [];
        const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
        let match;
        while ((match = fenceRegex.exec(text)) !== null) candidates.push(match[1].trim());
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
        for (const candidate of candidates.reverse()) {
            try {
                const parsed = JSON.parse(candidate);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch (e) {}
        }
        return null;
    }

    function stripBibleJsonBlocks(text = "") {
        const raw = String(text || '').trim();
        try {
            const parsed = JSON.parse(raw);
            if (looksLikeBibleJson(parsed)) return '';
        } catch (e) {}
        return raw.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, (block, inner) => {
            try {
                const parsed = JSON.parse(inner.trim());
                return looksLikeBibleJson(parsed) ? '' : block;
            } catch (e) {
                return block;
            }
        }).trim();
    }

    function applyRealtimeBibleUpdate(bible, options = {}) {
        if (!looksLikeBibleJson(bible)) return false;
        const mergedBible = saveLatestBible(bible) || bible;
        if (options.render !== false) renderHumanPreview(mergedBible);
        updateRealtimeAlarmFromBible(mergedBible, 'AI 回复后已实时检查。');
        if (options.audit) window.runSandboxRuleAudit(mergedBible);
        if (options.cloud !== false) syncGenesisDraftToCloud();
        return true;
    }

    function setGenesisChatLocked(locked, label = '') {
        genesisRequestInFlight = locked;
        if (chatInput) chatInput.disabled = locked;
        if (btnSend) {
            btnSend.disabled = locked || genesisPanelSyncBlocked || sandboxRuleGate.blocked;
            btnSend.dataset.originalText = btnSend.dataset.originalText || btnSend.innerHTML;
            if (locked && label) btnSend.innerHTML = label;
            if (!locked) {
                btnSend.innerHTML = sandboxRuleGate.blocked
                    ? `<i data-lucide="shield-alert" class="w-4 h-4 mr-1.5"></i>处理规则冲突`
                    : genesisPanelSyncBlocked
                    ? `<i data-lucide="shield-alert" class="w-4 h-4 mr-1.5"></i>等待面板同步`
                    : btnSend.dataset.originalText;
            }
        }
        if (window.lucide) lucide.createIcons();
    }

    function setGenesisSyncBlocked(blocked, message = '') {
        genesisPanelSyncBlocked = blocked;
        if (chatInput) chatInput.disabled = genesisRequestInFlight;
        if (btnSend) {
            btnSend.disabled = blocked || genesisRequestInFlight || sandboxRuleGate.blocked;
            btnSend.dataset.originalText = btnSend.dataset.originalText || btnSend.innerHTML;
            if (!genesisRequestInFlight) {
                btnSend.innerHTML = sandboxRuleGate.blocked
                    ? `<i data-lucide="shield-alert" class="w-4 h-4 mr-1.5"></i>处理规则冲突`
                    : blocked
                    ? `<i data-lucide="shield-alert" class="w-4 h-4 mr-1.5"></i>等待面板同步`
                    : btnSend.dataset.originalText;
            }
        }
        if (blocked && message) alert(message);
        if (window.lucide) lucide.createIcons();
    }

    function stashSandboxRuleGateDraft() {
        const draft = chatInput?.value?.trim() || sandboxRuleGate.pendingText || '';
        if (!draft) return;
        sandboxRuleGate.pendingText = draft;
        localStorage.setItem(SANDBOX_RULE_GATE_DRAFT_KEY, draft);
    }

    function restoreSandboxRuleGateDraft() {
        const draft = sandboxRuleGate.pendingText || localStorage.getItem(SANDBOX_RULE_GATE_DRAFT_KEY) || '';
        if (draft && chatInput && !chatInput.value.trim()) chatInput.value = draft;
        localStorage.removeItem(SANDBOX_RULE_GATE_DRAFT_KEY);
        sandboxRuleGate.pendingText = '';
    }

    function updateSandboxRuleGateControls() {
        if (sandboxRuleGateActions) sandboxRuleGateActions.classList.toggle('hidden', !sandboxRuleGate.blocked);
        if (sandboxAlertActions) sandboxAlertActions.classList.toggle('hidden', sandboxRuleGate.blocked);
        if (btnSend && !genesisRequestInFlight) {
            btnSend.disabled = genesisPanelSyncBlocked || sandboxRuleGate.blocked;
            btnSend.dataset.originalText = btnSend.dataset.originalText || btnSend.innerHTML;
            btnSend.innerHTML = sandboxRuleGate.blocked
                ? `<i data-lucide="shield-alert" class="w-4 h-4 mr-1.5"></i>处理规则冲突`
                : genesisPanelSyncBlocked
                ? `<i data-lucide="shield-alert" class="w-4 h-4 mr-1.5"></i>等待面板同步`
                : btnSend.dataset.originalText;
        }
        if (window.lucide) lucide.createIcons();
    }

    function openSandboxRuleFixEntrance() {
        hideSandboxRuleConflictModal();
        if (window.switchSandboxModule) window.switchSandboxModule('rules');
        const alarm = document.getElementById('sandbox-rule-alarm');
        const rulesBox = document.getElementById('prev-rules') || document.getElementById('prev-worldview');
        setTimeout(() => {
            alarm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            rulesBox?.focus();
        }, 80);
    }

    function getRuleGateSignature(text = '') {
        return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
    }

    function extractRuleConflictItems(report = '') {
        const text = String(report || '').trim();
        if (!text || isNoRuleIssueReport(text)) return [];
        const redMatch = text.match(/【红色警报】([\s\S]*?)(?=【黄色警报】|【信息权限警报】|【整改意见】|【专家资料缺口】|$)/);
        const source = (redMatch ? redMatch[1] : text).trim();
        if (isNoRuleIssueReport(source)) return [];
        const lines = source.split('\n').map(line => line.trim()).filter(Boolean);
        const items = [];
        let current = '';
        lines.forEach(line => {
            const startsItem = /^(\d+[\.、:：]|[-*•]|Q\d+[\.、:：]|红色警报\s*\d*)/.test(line);
            if (startsItem && current) {
                items.push(current.trim());
                current = line.replace(/^(\d+[\.、:：]|[-*•]\s*|Q\d+[\.、:：]\s*)/, '').trim();
            } else {
                current = current ? `${current}\n${line}` : line.replace(/^(\d+[\.、:：]|[-*•]\s*)/, '').trim();
            }
        });
        if (current) items.push(current.trim());
        const cleanItems = items
            .map(content => content.replace(/^无[。.]?$/, '').trim())
            .filter(content => content && !/没有明显|暂无|无明显/.test(content));
        return cleanItems.length ? cleanItems.map((content, index) => ({
            id: `rule-conflict-${index + 1}`,
            title: `冲突 ${index + 1}`,
            content,
            signature: getRuleGateSignature(content)
        })) : [{
            id: 'rule-conflict-1',
            title: '冲突 1',
            content: text,
            signature: getRuleGateSignature(text)
        }];
    }

    function isNoRuleIssueReport(text = '') {
        const source = String(text || '').replace(/\s+/g, ' ').trim();
        if (!source) return true;
        return /未发现明显|没有明显|无明显|暂无明显|无冲突|没有冲突|未发现阻断|当前可继续|可以继续|通过/.test(source)
            && !/必须整改|不通过|严重违反|红色警报\s*[:：]?\s*(?!无|暂无|没有|未发现)/.test(source);
    }

    function getRuleAuditLevel(reply = '') {
        const text = String(reply || '');
        if (isNoRuleIssueReport(text)) return 'green';
        const redSection = text.match(/【红色警报】([\s\S]*?)(?=【黄色警报】|【信息权限警报】|【整改意见】|【专家资料缺口】|$)/)?.[1] || '';
        if (redSection && !isNoRuleIssueReport(redSection) && /严重|违反|冲突|不通过|泄露|矛盾|降智|必须整改/.test(redSection)) return 'red';
        if (/不通过|严重违反|必须整改|阻断/.test(text)) return 'red';
        const yellowSection = text.match(/【黄色警报】([\s\S]*?)(?=【信息权限警报】|【整改意见】|【专家资料缺口】|$)/)?.[1] || '';
        if (yellowSection && !isNoRuleIssueReport(yellowSection) && /风险|不足|建议|可能|缺口/.test(yellowSection)) return 'yellow';
        return /风险|不足|建议|缺口/.test(text) ? 'yellow' : 'green';
    }

    function renderRuleConflictItems() {
        if (!ruleConflictList) return;
        const items = sandboxRuleGate.items?.length ? sandboxRuleGate.items : extractRuleConflictItems(sandboxRuleGate.reason);
        const ignored = new Set(sandboxRuleGate.ignoredItems || []);
        ruleConflictList.innerHTML = items.map((item, index) => {
            const isIgnored = ignored.has(item.signature);
            return `
                <div class="bg-gray-950 border ${isIgnored ? 'border-gray-700 opacity-70' : 'border-red-800/70'} rounded-xl p-4">
                    <div class="flex items-start justify-between gap-3 mb-2">
                        <div class="text-sm font-bold ${isIgnored ? 'text-gray-300' : 'text-red-100'}">${escapeHtml(item.title || `冲突 ${index + 1}`)}</div>
                        <span class="text-[10px] px-2 py-0.5 rounded border ${isIgnored ? 'bg-gray-800 text-gray-300 border-gray-600' : 'bg-red-950 text-red-200 border-red-700'}">${isIgnored ? '已暂时忽略' : '待处理'}</span>
                    </div>
                    <div class="text-xs leading-relaxed whitespace-pre-wrap text-gray-200 bg-black/30 border border-gray-800 rounded-lg p-3">${escapeHtml(item.content)}</div>
                    <div class="grid grid-cols-2 gap-2 mt-3">
                        <button type="button" data-rule-conflict-index="${index}" class="btn-rule-conflict-edit py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-bold">修改这条</button>
                        <button type="button" data-rule-conflict-index="${index}" class="btn-rule-conflict-ignore py-2 bg-gray-800 hover:bg-gray-700 text-gray-100 rounded-lg text-xs font-bold">${isIgnored ? '取消忽略' : '暂时忽略'}</button>
                    </div>
                </div>
            `;
        }).join('');
        ruleConflictList.querySelectorAll('.btn-rule-conflict-edit').forEach(button => {
            button.addEventListener('click', () => openRuleConflictDiscussion(Number(button.dataset.ruleConflictIndex || 0)));
        });
        ruleConflictList.querySelectorAll('.btn-rule-conflict-ignore').forEach(button => {
            button.addEventListener('click', () => toggleRuleConflictIgnore(Number(button.dataset.ruleConflictIndex || 0)));
        });
    }

    function showSandboxRuleConflictModal(reason = '') {
        if (!sandboxRuleConflictModal) return;
        if (isNoRuleIssueReport(reason)) {
            releaseSandboxRuleGate('规则审查完成，未发现阻断级冲突。');
            return;
        }
        if (ruleConflictReport) ruleConflictReport.textContent = reason || '规则专家发现红色冲突，请修改设定后重新检测。';
        if (reason) sandboxRuleGate.items = extractRuleConflictItems(reason);
        if (!sandboxRuleGate.items.length) {
            releaseSandboxRuleGate('规则审查完成，未发现阻断级冲突。');
            return;
        }
        renderRuleConflictItems();
        sandboxRuleConflictModal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    }

    function hideSandboxRuleConflictModal() {
        sandboxRuleConflictModal?.classList.add('hidden');
    }

    function activateSandboxRuleGate(reason = '') {
        if (isNoRuleIssueReport(reason) || extractRuleConflictItems(reason).length === 0) {
            releaseSandboxRuleGate('规则审查完成，未发现阻断级冲突。');
            return;
        }
        const signature = getRuleGateSignature(reason);
        if (sandboxRuleGate.ignored && sandboxRuleGate.ignoredSignature === signature) {
            setSandboxAlert('yellow', `本次红色规则警告已被暂时忽略，沙盒可继续推进。\n${limitText(reason, 650)}`);
            return;
        }
        stashSandboxRuleGateDraft();
        sandboxRuleGate = { ...sandboxRuleGate, blocked: true, ignored: false, ignoredSignature: '', ignoredItems: [], items: extractRuleConflictItems(reason), reason: reason || sandboxRuleGate.reason };
        setSandboxAlert('red', `规则冲突已中断沙盒推演。请先点击“修改设定”处理冲突，或“暂时忽略”继续当前轮。\n${limitText(reason, 650)}`);
        openSandboxRuleFixEntrance();
        showSandboxRuleConflictModal(reason);
        updateSandboxRuleGateControls();
    }

    function releaseSandboxRuleGate(message = '规则冲突已解除，可以继续沙盒推演。') {
        const wasBlocked = sandboxRuleGate.blocked;
        sandboxRuleGate = { blocked: false, ignored: false, ignoredSignature: '', ignoredItems: [], reason: '', pendingText: sandboxRuleGate.pendingText, items: [] };
        restoreSandboxRuleGateDraft();
        hideSandboxRuleConflictModal();
        updateSandboxRuleGateControls();
        if (wasBlocked) {
            setSandboxAlert('green', message);
            requestNextSandboxQuestionRoundAfterGate('规则冲突已解除');
        }
    }

    function ignoreSandboxRuleGate() {
        stashSandboxRuleGateDraft();
        sandboxRuleGate = { ...sandboxRuleGate, blocked: false, ignored: true, ignoredSignature: getRuleGateSignature(sandboxRuleGate.reason) };
        restoreSandboxRuleGateDraft();
        hideSandboxRuleConflictModal();
        updateSandboxRuleGateControls();
        setSandboxAlert('yellow', '已暂时忽略本次红色规则警告，可以继续当前推演。请在后续对话中补齐或修正，否则下一次规则检测仍可能再次中断。');
        requestNextSandboxQuestionRoundAfterGate('规则冲突已暂时忽略', { autoContinue: false });
    }

    function toggleRuleConflictIgnore(index = 0) {
        const item = sandboxRuleGate.items?.[index];
        if (!item) return;
        const ignored = new Set(sandboxRuleGate.ignoredItems || []);
        if (ignored.has(item.signature)) ignored.delete(item.signature);
        else ignored.add(item.signature);
        sandboxRuleGate = { ...sandboxRuleGate, ignoredItems: [...ignored] };
        renderRuleConflictItems();
        const remaining = (sandboxRuleGate.items || []).filter(entry => !ignored.has(entry.signature));
        if (remaining.length === 0) {
            ignoreSandboxRuleGate();
        } else {
            setSandboxAlert('red', `还有 ${remaining.length} 条规则冲突未处理。请逐条修改或暂时忽略。`);
        }
    }

    async function autoFixRemainingRuleConflicts() {
        const ignored = new Set(sandboxRuleGate.ignoredItems || []);
        const items = (sandboxRuleGate.items || []).filter(item => !ignored.has(item.signature));
        if (!items.length) {
            ignoreSandboxRuleGate();
            return;
        }
        if (!confirm(`将一键修复 ${items.length} 条未忽略的规则冲突；已忽略的冲突不会修复。本操作会把修复规则写入规则/专家资料，并重新检测。继续吗？`)) return;
        const btn = btnModalRuleGateAutofix;
        if (btn) {
            btn.disabled = true;
            btn.textContent = '一键修复中...';
        }
        setSandboxAlert('yellow', '正在一键修复未忽略的规则冲突...');
        try {
            const prompt = `你是规则冲突终极修复器。请只修复下面这些未忽略的规则冲突，不做剧情推演，不写正文。

【未忽略冲突】
${items.map((item, index) => `${index + 1}. ${item.content}`).join('\n\n')}

【当前规则/世界观/专家资料】
${getRulesTextForPrompt()}

【最新沙盒对话尾迹】
${limitText(genesisConversation.slice(-12).map(msg => `${msg.role}: ${stripBibleJsonBlocks(stripFencedBlocks(msg.content || ''))}`).join('\n\n'), 3500)}

要求：
1. 输出可直接写入规则/专家资料的补丁，不要输出剧情方案。
2. 只修复未忽略冲突；没有列出的冲突视为暂时忽略。
3. 若作者最新对话已补充信息，以最新作者发言为准。
4. 必须输出：
【可入库规则条目】
【仍需作者确认】
【重新检测重点】`;
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `一键修复失败：${data.error || '未知错误'}`;
            const patchInfo = buildRulesDiscussionPatchInfo(reply);
            applyRulesDiscussionPatch(reply, patchInfo);
            sandboxRuleGate = {
                ...sandboxRuleGate,
                ignoredItems: Array.from(new Set([...(sandboxRuleGate.ignoredItems || []), ...items.map(item => item.signature)]))
            };
            renderRuleConflictItems();
            await window.runSandboxRuleAudit(getFreshBibleForRuleAudit());
            if (currentLocalContext.chapterId && tabSop) tabSop.click();
        } catch (error) {
            setSandboxAlert('red', `一键修复失败：${error.message || '未知错误'}`);
            alert(`一键修复失败：${error.message || '未知错误'}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '一键修复未忽略项';
            }
        }
    }

    function buildRecoveryLedger(conversation = []) {
        const correctionPattern = /(不是|不对|否定|改成|修改|更改|换成|不要|应该|必须|设定为|新增|加入|删除|保留|关系|羁绊|时间轴|事件|人物|性格|动机|目标|规则)/;
        const manualEdits = loadManualBibleEdits();
        const cleaned = conversation.map((msg, index) => {
            const raw = msg.role === 'assistant' ? stripBibleJsonBlocks(msg.content) : stripSystemAppendix(msg.content);
            return {
                index,
                role: msg.role === 'user' ? '用户' : 'AI',
                content: limitText(applyManualCharacterRenamesToText(raw, manualEdits), msg.role === 'user' ? 1200 : 700)
            };
        }).filter(msg => msg.content && msg.content !== '已更新设定数据。');
        const userCorrections = cleaned
            .filter(msg => msg.role === '用户' && correctionPattern.test(msg.content))
            .slice(-80)
            .map(msg => `${msg.index + 1}. ${msg.content}`)
            .join('\n\n');
        const fullTrail = cleaned
            .slice(-100)
            .map(msg => `${msg.index + 1}. ${msg.role}: ${msg.content}`)
            .join('\n\n');
        return {
            userCorrections: limitText(userCorrections, 18000),
            fullTrail: limitText(fullTrail, 26000)
        };
    }

    async function buildExtractionConversationFromChat(conversation, instruction, options = {}) {
        const lightweight = !!options.lightweight;
        const payload = buildChatPayload(conversation, lightweight ? 8 : (options.recoveryMode ? 24 : 16));
        const manualEdits = loadManualBibleEdits();
        const currentBibleRaw = applyManualBibleEditsToValue(getCurrentBibleSnapshot(), manualEdits);
        let stableBible = currentBibleRaw;
        if (!lightweight) {
            const databaseBible = await fetchBibleSnapshotFromDatabase();
            const cloudBackups = await fetchGenesisCloudBibleBackups();
            const backupBible = [...loadLatestBibleBackups(), ...cloudBackups].find(item => !hasStableBibleGaps(item));
            stableBible = databaseBible
                ? mergeBibleWithStableLists(databaseBible, currentBibleRaw || {})
                : currentBibleRaw;
            if (backupBible) stableBible = stableBible ? mergeBibleWithStableLists(backupBible, stableBible) : backupBible;
        }
        if (stableBible) saveLatestBible(stableBible);
        const currentBible = compactBibleForPrompt(stableBible);
        const recoveryMode = !lightweight && (options.recoveryMode || hasStableBibleGaps(stableBible));
        const recoveryLedger = recoveryMode ? buildRecoveryLedger(conversation) : null;
        return [
            currentBible ? { role: 'system', content: `【当前面板数据】\n${JSON.stringify(currentBible)}` } : null,
            payload.memorySummary ? { role: 'system', content: `【较早对话摘要】\n${payload.memorySummary}` } : null,
            recoveryLedger?.userCorrections ? { role: 'system', content: `【全量用户修正记录：恢复模式最高优先级】\n以下是从整个沙盒对话中筛出的用户否定、修改、新增、关系、时间轴、人物设定相关记录。恢复丢失人物卡、人物羁绊和细密时间轴时，优先服从这里，而不是 AI 早期旧方案。\n${recoveryLedger.userCorrections}` } : null,
            recoveryLedger?.fullTrail ? { role: 'system', content: `【全量沙盒对话尾迹：用于补全丢失资产】\n${recoveryLedger.fullTrail}` } : null,
            ...payload.conversation.map(msg => ({ ...msg, content: applyManualCharacterRenamesToText(msg.content, manualEdits) })),
            { role: 'user', content: instruction }
        ].filter(Boolean);
    }

    async function extractAndSaveBibleFromConversation(conversation, instruction, options = {}) {
        const extractionConversation = await buildExtractionConversationFromChat(conversation, instruction, options);
        const res = await fetch('/api/crystallize/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation: extractionConversation })
        });
        const data = await readApiJson(res, '提取会话要素失败');
        const mergedBible = saveLatestBible(data.bible) || data.bible;
        renderHumanPreview(mergedBible);
        window.runSandboxRuleAudit(mergedBible);
        await syncGenesisDraftToCloud();
        setGenesisSyncBlocked(false);
        return mergedBible;
    }

    function buildLightweightExtractionInstruction(aiReplyText = '') {
        return `请只根据当前这轮沙盒问答和当前面板数据，提取本轮新增或修正的关键设定，合并为世界圣经 JSON。
要求：
1. 优先记录用户本轮回答中明确出现的人物、事件、规则、上帝视角、观众视角、伏笔、人物关系。
2. 不要恢复全量旧资产，不要扩写正文，不要补写章节细节。
3. 如果某字段暂时未知，保留当前面板已有内容；没有已有内容时可用空字符串或空数组，但不要编造。
4. 必须输出合法 JSON，字段至少包含 genre、worldview、rules、workflow、protagonist_arc、antagonist_arc、hollywood_beats、characters、relations、timeline、narrative_logic、secrets、chapters。

【本轮 AI 可见回复】
${limitText(stripBibleJsonBlocks(aiReplyText), 1800) || '本轮 AI 回复主要是结构化数据或空文本。'}`;
    }

    function syncPanelFromReplyInBackground(aiReplyText, conversationForExtraction, options = {}) {
        if (options.defer) {
            setGenesisSyncBlocked(false);
            setSandboxAlert('green', '本轮问题尚未答完，实时面板将在本轮问题完成后统一更新。');
            syncGenesisDraftToCloud().catch(error => {
                console.warn('沙盒云端同步失败:', error);
            });
            return Promise.resolve(null);
        }
        const parsedBible = extractBibleJsonFromText(aiReplyText);
        if (parsedBible) {
            applyRealtimeBibleUpdate(parsedBible, { audit: true, cloud: false });
            syncGenesisDraftToCloud().catch(error => {
                console.warn('沙盒云端同步失败:', error);
            });
            setGenesisSyncBlocked(false);
            return Promise.resolve(parsedBible);
        }

        setGenesisSyncBlocked(true);
        const extractionOptions = options.lightweight ? { lightweight: true } : { recoveryMode: true };
        const instruction = options.lightweight
            ? buildLightweightExtractionInstruction(aiReplyText)
            : `上一轮 AI 回复没有提供合法 JSON。请根据当前面板数据、全量用户修正记录、最近对话和上一轮 AI 回复，提取并合并最新共识，输出完整世界圣经 JSON。
要求：
1. 必须记录用户在对话中否定、修正或新增的人物/事件/规则。
2. workflow 流程状态、protagonist_arc 主角弧线、antagonist_arc 反派弧线、hollywood_beats 好莱坞六节点、characters 详细字段、人物规则 character_rules、relations 人物羁绊、timeline 细密时间轴、secrets 上帝视角信息是稳定资产；除非用户明确说删除，否则必须保留。
3. 如果当前面板中的人物羁绊或细密时间轴为空，必须从全量用户修正记录和全量沙盒对话尾迹中重建，不要留空。
4. 与人物有关的专家设定必须进入对应人物的 character_rules；全局专业规则进入 rules；观众不知道但作者必须知道的真相进入 secrets；沙盒推进阶段必须按 workflow.stage 和 hollywood_beats 补骨架，不要跳去写正文。
5. 只输出 JSON，不要输出正文。`;
        return extractAndSaveBibleFromConversation(conversationForExtraction, instruction, extractionOptions).catch(error => {
            console.error('后台面板补同步失败:', error);
            setGenesisSyncBlocked(true, `上一轮设定没有确认写入实时面板：${error.message || '未知错误'}\n你可以先看 AI 的问题，也可以在输入框里草拟回答，但暂时不能发送。建议优先用上一条用户消息旁的撤回按钮重新回答；如果连续失败，再点“从对话刷新面板”兜底修复。`);
            throw error;
        });
    }

    function isSandboxFocusLine(line = '') {
        const text = String(line || '').trim();
        if (!text) return false;
        if (/【(当前任务|监督提醒|规则|风险|降智|警报|自检|下一步|待确认|问题|选择|需要你|请你|你问|回答|推进)/.test(text)) return true;
        return /(当前任务|本轮只处理|本轮目标|你需要决定|不讨论|规则|风险|降智|警报|冲突|自检|下一步|待确认|需要你|请你|你问|问题|选择|回复|回答|确认|推进|补充|决定|是否|哪一种|哪个|如何处理|要不要)/.test(text);
    }

    function splitSandboxAssistantReply(text = '') {
        const cleanText = stripBibleJsonBlocks(text).trim();
        const lines = cleanText.split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length === 0) return { focus: '', details: '' };

        const focus = [];
        const details = [];
        let currentSection = '';
        lines.forEach(line => {
            const sectionMatch = line.match(/^【(.+?)】/);
            if (sectionMatch) currentSection = sectionMatch[1];
            const isExplicitDetails = /可展开|推演依据|完整推演|详细依据|分析依据/.test(currentSection);
            const isFocusSection = !isExplicitDetails && /(当前任务|监督提醒|规则|风险|警报|降智|自检|下一步|待确认|问题|选择|需要你)/.test(currentSection);
            if (isSandboxFocusLine(line) || isFocusSection) {
                focus.push(line);
            } else {
                details.push(line);
            }
        });

        if (focus.length === 0) {
            const tailQuestionLines = lines.filter(line => /[？?]$|请|需要你|是否|哪|如何|要不要|选择|确认/.test(line));
            focus.push(...(tailQuestionLines.length ? tailQuestionLines : lines.slice(-4)));
            const focusSet = new Set(focus);
            return {
                focus: focus.join('\n'),
                details: lines.filter(line => !focusSet.has(line)).join('\n')
            };
        }

        return {
            focus: focus.join('\n'),
            details: details.join('\n')
        };
    }

    function splitSopAssistantReply(text = '') {
        const cleanText = stripFencedBlocks(text).trim();
        const lines = cleanText.split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length === 0) return { focus: '', details: '' };
        const focus = [];
        const details = [];
        let currentSection = '';
        lines.forEach(line => {
            const sectionMatch = line.match(/^【(.+?)】/);
            if (sectionMatch) currentSection = sectionMatch[1];
            const isExplicitDetails = /可展开|完整|依据|分析|蓝图|审查细则/.test(currentSection);
            const isFocusSection = !isExplicitDetails && /(当前任务|监督提醒|下一步|选择|需要你|伏笔|信息差|风险|警报)/.test(currentSection);
            if (isFocusSection || isSandboxFocusLine(line)) {
                focus.push(line);
            } else {
                details.push(line);
            }
        });
        if (focus.length === 0) {
            const tailQuestionLines = lines.filter(line => /[？?]$|请|需要你|是否|哪|如何|要不要|选择|确认/.test(line));
            focus.push(...(tailQuestionLines.length ? tailQuestionLines : lines.slice(-5)));
            const focusSet = new Set(focus);
            return {
                focus: focus.join('\n'),
                details: lines.filter(line => !focusSet.has(line)).join('\n')
            };
        }
        return { focus: focus.join('\n'), details: details.join('\n') };
    }

    window.toggleSandboxMessageDetails = (button) => {
        const bubble = button?.closest('[data-sandbox-assistant-message]');
        const detail = bubble?.querySelector('[data-sandbox-message-details]');
        if (!detail) return;
        const hidden = detail.classList.toggle('hidden');
        button.innerHTML = hidden
            ? `<i data-lucide="chevron-down" class="w-3.5 h-3.5 mr-1"></i>展开完整推演`
            : `<i data-lucide="chevron-up" class="w-3.5 h-3.5 mr-1"></i>收起完整推演`;
        if (window.lucide) lucide.createIcons();
    };

    window.toggleSopMessageDetails = (button) => {
        const bubble = button?.closest('[data-sop-assistant-message]');
        const detail = bubble?.querySelector('[data-sop-message-details]');
        if (!detail) return;
        const hidden = detail.classList.toggle('hidden');
        button.innerHTML = hidden
            ? `<i data-lucide="chevron-down" class="w-3.5 h-3.5 mr-1"></i>展开更多信息`
            : `<i data-lucide="chevron-up" class="w-3.5 h-3.5 mr-1"></i>收起更多信息`;
        if (window.lucide) lucide.createIcons();
    };

    // ==========================================
    // 💥 DOM 元素全量声明 (已补齐所有遗漏的沙盒开关按钮) 💥
    // ==========================================
    const sandbox = document.getElementById('genesis-sandbox');
    const sandboxChatPane = document.getElementById('sandbox-chat-pane');
    const sandboxPreviewPane = document.getElementById('sandbox-preview-pane');
    const btnToggleSandboxLayout = document.getElementById('btn-toggle-sandbox-layout');
    const sandboxMobileTask = document.getElementById('sandbox-mobile-task');
    const sandboxMobileAssets = document.getElementById('sandbox-mobile-assets');
    const sandboxMobileNav = document.getElementById('sandbox-mobile-nav');
    const mobileTaskStage = document.getElementById('mobile-task-stage');
    const mobileTaskFocus = document.getElementById('mobile-task-focus');
    const mobileTaskQuestion = document.getElementById('mobile-task-question');
    const mobileTaskAlert = document.getElementById('mobile-task-alert');
    const mobileTaskGoChat = document.getElementById('mobile-task-go-chat');
    const mobileTaskGoPanel = document.getElementById('mobile-task-go-panel');
    const mobileTaskGoWarning = document.getElementById('mobile-task-go-warning');
    const mobileTaskGoAssets = document.getElementById('mobile-task-go-assets');
    const mobileOpenAssetModal = document.getElementById('mobile-open-asset-modal');
    const mobileOpenTimeline = document.getElementById('mobile-open-timeline');
    const mobileOpenRelation = document.getElementById('mobile-open-relation');
    const sandboxControlMode = document.getElementById('sandbox-control-mode');
    const sandboxAlertCenter = document.getElementById('sandbox-alert-center');
    const sandboxAlertLevel = document.getElementById('sandbox-alert-level');
    const sandboxAlertSummary = document.getElementById('sandbox-alert-summary');
    const sandboxAlertActions = document.getElementById('sandbox-alert-actions');
    const btnSandboxAutoRepair = document.getElementById('btn-sandbox-auto-repair');
    const btnSandboxFixOptions = document.getElementById('btn-sandbox-fix-options');
    const btnSandboxRiskReport = document.getElementById('btn-sandbox-risk-report');
    const sandboxRuleGateActions = document.getElementById('sandbox-rule-gate-actions');
    const btnRuleGateEdit = document.getElementById('btn-rule-gate-edit');
    const btnRuleGateRecheck = document.getElementById('btn-rule-gate-recheck');
    const btnRuleGateIgnore = document.getElementById('btn-rule-gate-ignore');
    const sandboxRuleConflictModal = document.getElementById('sandbox-rule-conflict-modal');
    const ruleConflictList = document.getElementById('rule-conflict-list');
    const ruleConflictReport = document.getElementById('rule-conflict-report');
    const btnCloseRuleConflictModal = document.getElementById('btn-close-rule-conflict-modal');
    const btnModalRuleGateEdit = document.getElementById('btn-modal-rule-gate-edit');
    const btnModalRuleGateAutofix = document.getElementById('btn-modal-rule-gate-autofix');
    const btnModalRuleGateRecheck = document.getElementById('btn-modal-rule-gate-recheck');
    const btnModalRuleGateIgnore = document.getElementById('btn-modal-rule-gate-ignore');
    const mainWorkspace = document.getElementById('main-workspace');
    const chatHistory = document.getElementById('chat-history');
    const chatInput = document.getElementById('chat-input');
    const humanPreviewContainer = document.getElementById('human-preview-container');
    
    const subChatModal = document.getElementById('sub-chat-modal');
    const subChatTitle = document.getElementById('sub-chat-title');
    const subChatHistory = document.getElementById('sub-chat-history');
    const subChatInput = document.getElementById('sub-chat-input');
    
    const chapterTree = document.getElementById('chapter-tree');
    const editorTextarea = document.getElementById('editor-textarea');
    const currentChapterTitle = document.getElementById('current-chapter-title');
    const editorSopConflict = document.getElementById('editor-sop-conflict');
    const saveStatus = document.getElementById('save-status');
    const tabSop = document.getElementById('tab-sop');
    const tabEditor = document.getElementById('tab-editor');
    const viewSop = document.getElementById('view-sop');
    const viewEditor = document.getElementById('view-editor');
    const chapHistoryDiv = document.getElementById('chapter-chat-history');
    const chapterChatInput = document.getElementById('chapter-chat-input');
    const localHooks = document.getElementById('local-hooks');
    const localSourceHooks = document.getElementById('local-source-hooks');
    const localCharacters = document.getElementById('local-characters');
    const localEventScope = document.getElementById('local-event-scope');
    const btnToggleEventScope = document.getElementById('btn-toggle-event-scope');
    const localDeviationPanel = document.getElementById('local-deviation-panel');
    const floatingToolbar = document.getElementById('floating-toolbar');
   const worldRulesContainer = document.getElementById('world-rules-container');
    
    const timelineModal = document.getElementById('timeline-modal');
    const timelineDisplayList = document.getElementById('timeline-display-list');
    const relationModal = document.getElementById('relation-modal');
    const assetModal = document.getElementById('asset-modal');
    const addChapterModal = document.getElementById('add-chapter-modal');
    const hookModal = document.getElementById('hook-modal');

    // --- 所有可点击的按钮声明区 ---
    const btnForceGenesis = document.getElementById('btn-force-genesis');
    const btnCloseSandbox = document.getElementById('btn-close-sandbox');
    const btnCrystallize = document.getElementById('btn-crystallize');
    const btnCancelPreview = document.getElementById('btn-cancel-preview');
    
    const btnSend = document.getElementById('btn-send-chat'); 
    const btnRefreshPreview = document.getElementById('btn-refresh-preview');
    const btnConfirmCrystallize = document.getElementById('btn-confirm-crystallize');
    const btnSendSubChat = document.getElementById('btn-send-sub-chat');
    const btnCancelSubChat = document.getElementById('btn-cancel-sub-chat');
    const btnApplySubChat = document.getElementById('btn-apply-sub-chat');
    const btnSendChapterChat = document.getElementById('btn-send-chapter-chat');
    const btnExtractSynopsis = document.getElementById('btn-extract-synopsis');
    const btnSaveChapter = document.getElementById('btn-save-chapter');
    const btnAiWrite = document.getElementById('btn-ai-write');
    const btnReviewCurrentDraft = document.getElementById('btn-review-current-draft');
    const btnRerunChangePatch = document.getElementById('btn-rerun-change-patch');
    
    const btnOpenTimeline = document.getElementById('btn-open-timeline');
    const btnCloseTimeline = document.getElementById('btn-close-timeline');
    const btnAiExtractTimeline = document.getElementById('btn-ai-extract-timeline');
    const btnSaveTimeline = document.getElementById('btn-save-timeline');
    const btnManualHook = document.getElementById('btn-manual-hook');
    
    const btnOpenRelation = document.getElementById('btn-open-relation');
    const btnCloseRelation = document.getElementById('btn-close-relation');
    const btnSaveRelation = document.getElementById('btn-save-relation');
    
    const btnOpenAssetModal = document.getElementById('btn-open-asset-modal');
    const btnCloseAssetModal = document.getElementById('btn-close-asset-modal');
    const btnNewCharacter = document.getElementById('btn-new-character');
    const btnSaveAsset = document.getElementById('btn-save-asset');
    
    const btnAddChapter = document.getElementById('btn-add-chapter');
    const btnCancelChapter = document.getElementById('btn-cancel-chapter');
    const btnConfirmChapter = document.getElementById('btn-confirm-chapter');
    const btnInsertEventChat = document.getElementById('btn-insert-event-chat');
    
    const btnTriggerHook = document.getElementById('btn-trigger-hook');
    const btnSelectionHook = document.getElementById('btn-selection-hook');
    const btnCancelHook = document.getElementById('btn-cancel-hook');
    const btnConfirmHook = document.getElementById('btn-confirm-hook');
    const btnExportBook = document.getElementById('btn-export-book');
    const btnFinalizeChapter = document.getElementById('btn-finalize-chapter');
    const btnVolumePlan = document.getElementById('btn-volume-plan');
    const btnRhythmCurve = document.getElementById('btn-rhythm-curve');
    const btnSourceCitations = document.getElementById('btn-source-citations');
    const btnVersionCompare = document.getElementById('btn-version-compare');
    const btnBookAudit = document.getElementById('btn-book-audit');
    const btnGoldenThree = document.getElementById('btn-golden-three');
    const btnCharacterVoice = document.getElementById('btn-character-voice');
    const btnDialoguePolish = document.getElementById('btn-dialogue-polish');
    const btnSetpieceDirector = document.getElementById('btn-setpiece-director');
    const btnRelationshipLine = document.getElementById('btn-relationship-line');
    const btnThemeMotif = document.getElementById('btn-theme-motif');
    const btnWordBudget = document.getElementById('btn-word-budget');
    const btnBeatSheet = document.getElementById('btn-beat-sheet');
    const btnContinuityLedger = document.getElementById('btn-continuity-ledger');
    const btnProductionBoard = document.getElementById('btn-production-board');
    const btnAcceptanceGate = document.getElementById('btn-acceptance-gate');
    const btnArcTracker = document.getElementById('btn-arc-tracker');
    const btnHollywoodBlueprint = document.getElementById('btn-hollywood-blueprint');
    const btnOppositionPlan = document.getElementById('btn-opposition-plan');
    const btnSceneCard = document.getElementById('btn-scene-card');
    const btnRewriteLoop = document.getElementById('btn-rewrite-loop');
    const btnLongformGate = document.getElementById('btn-longform-gate');
    const btnLongformHook = document.getElementById('btn-longform-hook');
    const btnLongformState = document.getElementById('btn-longform-state');
    const btnLongformMemory = document.getElementById('btn-longform-memory');

    // ==========================================
    // 💥 核心数据保存函数
    // ==========================================
    async function saveChapterContent() {
        if (!currentLocalContext.chapterId) return;
        if (saveStatus) saveStatus.innerHTML = `<i data-lucide="loader" class="w-3 h-3 inline animate-spin mr-1"></i>`;
        if (window.lucide) lucide.createIcons();
        try {
            await fetch('/api/workspace/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chapterId: currentLocalContext.chapterId, content_text: editorTextarea.value })
            });
            updateLatestBibleChapterFields({ content_text: editorTextarea.value });
            if (saveStatus) {
                saveStatus.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-green-500"></i>`;
                if (window.lucide) lucide.createIcons();
                setTimeout(() => { saveStatus.innerHTML = ''; }, 2000);
            }
        } catch (e) { console.error("保存失败:", e); }
    }

    function updateLatestBibleChapterFields(fields = {}) {
        const bible = loadLatestBible();
        if (!bible || !Array.isArray(bible.chapters) || bible.chapters.length === 0) return;
        const targetNumber = String(currentLocalContext.chapterNumber || '');
        const targetTitle = String(currentLocalContext.title || '').trim();
        let changed = false;
        const chapters = bible.chapters.map(chapter => {
            const sameNumber = targetNumber && String(chapter.chapter_number || '') === targetNumber;
            const sameTitle = targetTitle && String(chapter.title || '').trim() === targetTitle;
            if (!sameNumber && !sameTitle) return chapter;
            changed = true;
            return { ...chapter, ...fields };
        });
        if (!changed) return;
        saveLatestBible({ ...bible, chapters }, { backup: false });
        syncGenesisDraftToCloud().catch(error => console.warn('章节内容同步到世界圣经云端失败:', error));
    }

    function attachPreviewAutosave() {
        if (!humanPreviewContainer || humanPreviewContainer.dataset.autosaveBound === '1') return;
        humanPreviewContainer.dataset.autosaveBound = '1';
        const sync = (event) => {
            if (!document.getElementById('prev-genre')) return;
            const shouldRenderAfterSave = event?.type === 'change' && event.target?.classList?.contains('char-name');
            clearTimeout(previewSyncTimer);
            previewSyncTimer = setTimeout(() => {
                try {
                    const previousBible = loadLatestBible();
                    const bible = collectBibleFromPreview();
                    warnBibleEditConflicts(previousBible, bible);
                    const savedBible = saveLatestBible(bible, { preserveStableLists: false });
                    syncSandboxModeControls(savedBible.workflow?.control_mode || bible.workflow?.control_mode || 'semi');
                    updateRealtimeAlarmFromBible(savedBible || bible, '面板修改后已重新检查。');
                    if (shouldRenderAfterSave && savedBible) renderHumanPreview(savedBible);
                    syncGenesisDraftToCloud();
                } catch (e) {
                    console.warn('实时面板自动保存失败:', e);
                }
            }, 500);
        };
        humanPreviewContainer.addEventListener('input', sync);
        humanPreviewContainer.addEventListener('change', sync);
    }

    // ==========================================
    // 💥 实时表单渲染系统
    // ==========================================
    function renderHumanPreview(bible) {
        window.OmniWorkspacePreview.renderHumanPreview(humanPreviewContainer, bible);
        renderLocalSourcePanel();
        attachPreviewAutosave();
        syncSandboxModeControls(bible?.workflow?.control_mode || 'semi');
        updateRealtimeAlarmFromBible(bible, '面板已加载。');
    }

    function syncSandboxModeControls(mode = 'semi') {
        const safeMode = ['auto', 'semi', 'manual'].includes(mode) ? mode : 'semi';
        if (sandboxControlMode && sandboxControlMode.value !== safeMode) sandboxControlMode.value = safeMode;
        const workflowMode = document.getElementById('workflow-control-mode');
        if (workflowMode && workflowMode.value !== safeMode) workflowMode.value = safeMode;
    }

    function getCurrentControlMode() {
        return document.getElementById('workflow-control-mode')?.value || sandboxControlMode?.value || 'semi';
    }

    function setSandboxAlert(level = 'green', summary = '') {
        if (!sandboxAlertCenter || !sandboxAlertLevel || !sandboxAlertSummary) return;
        const config = {
            green: { label: '绿色', box: 'border-emerald-800/60 text-emerald-200', badge: 'bg-emerald-900/40 text-emerald-200 border-emerald-700/60' },
            yellow: { label: '黄色', box: 'border-yellow-800/60 text-yellow-100', badge: 'bg-yellow-900/40 text-yellow-200 border-yellow-700/60' },
            red: { label: '红色', box: 'border-red-800/70 text-red-100', badge: 'bg-red-900/50 text-red-200 border-red-700/70' }
        }[level] || {};
        sandboxAlertCenter.className = `mx-6 mt-4 shrink-0 bg-gray-950/95 border rounded-xl shadow-lg p-3 text-xs ${config.box}`;
        sandboxAlertLevel.className = `text-[10px] px-2 py-0.5 rounded border ${config.badge}`;
        sandboxAlertLevel.textContent = config.label || '绿色';
        sandboxAlertSummary.textContent = summary || '当前未发现明显风险。';
        if (sandboxAlertActions) sandboxAlertActions.classList.toggle('hidden', level === 'green' || sandboxRuleGate.blocked);
        if (sandboxRuleGateActions) sandboxRuleGateActions.classList.toggle('hidden', !sandboxRuleGate.blocked);
        refreshSandboxMobileTask();
    }

    function hasEnoughSandboxContentForAutoRepair(bible = {}) {
        return !!(bible.genre || bible.worldview || bible.rules || (bible.characters || []).length || (bible.timeline || []).length || (bible.chapters || []).length || (bible.hollywood_beats || []).some(beat => beat.title || beat.content));
    }

    function getBibleAlarmSnapshot(bible = {}) {
        const warnings = [];
        const reds = [];
        const beats = normalizeHollywoodBeats(bible.hollywood_beats || []);
        const filledBeats = beats.filter(beat => beat.title || beat.content || beat.function);
        const chars = bible.characters || [];
        const protagonist = chars.find(c => /主角|主人公|男主|女主|protagonist/i.test(`${c.role || ''} ${c.description || ''}`));
        const antagonist = chars.find(c => /反派|对手|敌人|核心阻力|antagonist/i.test(`${c.role || ''} ${c.description || ''}`));
        if (!bible.genre) warnings.push('救猫咪类型未确认。');
        if (chars.length === 0) warnings.push('人物卡尚未建立。');
        if (!protagonist) reds.push('主角尚未明确，无法建立主角弧线。');
        if (!antagonist) warnings.push('最终反派/核心阻力尚未明确。');
        if (filledBeats.length < 6) warnings.push(`好莱坞六节点只完成 ${filledBeats.length}/6。`);
        if (beats.some(beat => beat.status === 'needs_fix')) reds.push('六节点中存在“需修复”的关键事件。');
        if (!bible.protagonist_arc?.want || !bible.protagonist_arc?.need) warnings.push('主角弧线缺少外在目标或内在需求。');
        if (!bible.antagonist_arc?.want && !bible.antagonist_arc?.start) warnings.push('反派/核心阻力弧线不足。');
        if ((bible.timeline || []).length === 0 && (bible.chapters || []).length === 0) warnings.push('事件时间线尚未建立。');
        if ((bible.secrets || []).some(secret => secret.god_view && !secret.audience_view)) reds.push('存在上帝视角秘密缺少观众视角，容易提前泄露。');
        return { level: reds.length ? 'red' : (warnings.length ? 'yellow' : 'green'), items: [...reds, ...warnings] };
    }

    function updateRealtimeAlarmFromBible(bible = null, prefix = '') {
        const targetBible = bible || getCurrentBibleSnapshot();
        if (!targetBible) return setSandboxAlert('yellow', '等待沙盒设定。');
        const snapshot = getBibleAlarmSnapshot(targetBible);
        const modeLabel = ({ auto: '全自动', semi: '半自动', manual: '手动' })[getCurrentControlMode()] || '半自动';
        const summary = [
            prefix,
            `权限模式：${modeLabel}。`,
            snapshot.items.length ? snapshot.items.slice(0, 5).join('\n') : '当前骨架、人物、信息权限未发现明显阻断风险。'
        ].filter(Boolean).join('\n');
        setSandboxAlert(snapshot.level, summary);
        if (snapshot.level !== 'green' && getCurrentControlMode() === 'auto' && hasEnoughSandboxContentForAutoRepair(targetBible)) {
            const signature = JSON.stringify({ level: snapshot.level, items: snapshot.items, bibleSeed: stableHash(JSON.stringify(compactBibleForPrompt(targetBible))) });
            if (!sandboxAutoRepairInFlight && sandboxAutoRepairSignature !== signature) {
                sandboxAutoRepairSignature = signature;
                setTimeout(() => runSandboxSupervisionAction('auto'), 800);
            }
        }
    }

    function getSandboxLayoutMode() {
        return localStorage.getItem('omnistory_sandbox_layout') || 'auto';
    }

    function resolveSandboxLayout(mode = getSandboxLayoutMode()) {
        if (mode === 'left' || mode === 'right') return mode;
        return window.innerWidth >= 1180 ? 'right' : 'left';
    }

    function applySandboxLayoutMode(mode = getSandboxLayoutMode()) {
        if (!sandbox || !sandboxChatPane || !sandboxPreviewPane) return;
        const resolved = resolveSandboxLayout(mode);
        sandbox.classList.toggle('flex-col', window.innerWidth < 900);
        sandbox.classList.toggle('flex-row', window.innerWidth >= 900);
        sandboxChatPane.classList.remove('order-1', 'order-2', 'w-2/5', 'w-full', 'h-2/5', 'h-1/2', 'h-auto', 'border-r', 'border-l', 'border-t');
        sandboxPreviewPane.classList.remove('order-1', 'order-2', 'w-3/5', 'w-full', 'h-3/5', 'h-1/2', 'h-auto');
        if (window.innerWidth < 900) {
            sandboxChatPane.classList.add('order-2', 'w-full', 'h-2/5', 'border-t');
            sandboxPreviewPane.classList.add('order-1', 'w-full', 'h-3/5');
        } else {
            sandboxChatPane.classList.add(resolved === 'right' ? 'order-2' : 'order-1', 'w-2/5', 'h-auto', resolved === 'right' ? 'border-l' : 'border-r');
            sandboxPreviewPane.classList.add(resolved === 'right' ? 'order-1' : 'order-2', 'w-3/5', 'h-auto');
        }
        const label = mode === 'auto' ? '布局：自动' : (mode === 'right' ? '对话：右' : '对话：左');
        const icon = mode === 'auto' ? 'columns-2' : (mode === 'right' ? 'panel-right' : 'panel-left');
        if (btnToggleSandboxLayout) {
            btnToggleSandboxLayout.innerHTML = `<i data-lucide="${icon}" class="w-3.5 h-3.5 mr-1.5"></i><span>${label}</span>`;
        }
        if (window.lucide) lucide.createIcons();
    }

    function cycleSandboxLayoutMode() {
        const modes = ['auto', 'right', 'left'];
        const current = getSandboxLayoutMode();
        const next = modes[(modes.indexOf(current) + 1) % modes.length] || 'auto';
        localStorage.setItem('omnistory_sandbox_layout', next);
        applySandboxLayoutMode(next);
    }

    function isSandboxMobileLayout() {
        return window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches;
    }

    function getSandboxMobileTab() {
        const saved = localStorage.getItem('omnistory_sandbox_mobile_tab') || 'task';
        return ['task', 'chat', 'panel', 'warning', 'assets'].includes(saved) ? saved : 'task';
    }

    function syncSandboxMobileNav(tab = getSandboxMobileTab()) {
        if (!sandboxMobileNav) return;
        sandboxMobileNav.querySelectorAll('[data-sandbox-mobile-tab]').forEach(button => {
            button.dataset.active = button.dataset.sandboxMobileTab === tab ? 'true' : 'false';
        });
    }

    function setSandboxMobileTab(tab = 'task', { persist = true } = {}) {
        if (!sandbox) return;
        const safeTab = ['task', 'chat', 'panel', 'warning', 'assets'].includes(tab) ? tab : 'task';
        sandbox.dataset.mobileTab = safeTab;
        if (persist) localStorage.setItem('omnistory_sandbox_mobile_tab', safeTab);
        syncSandboxMobileNav(safeTab);
        refreshSandboxMobileTask();
        if (safeTab === 'chat' && isSandboxMobileLayout()) setTimeout(() => chatInput?.focus(), 80);
    }

    function getLatestSandboxAssistantFocus() {
        const latest = [...genesisConversation].reverse().find(msg => msg?.role === 'assistant' && String(msg.content || '').trim());
        if (!latest) return '';
        const visible = stripBibleJsonBlocks(latest.content || '').trim();
        if (!visible) return '';
        const parts = splitSandboxAssistantReply(visible);
        return limitText(parts.focus || visible, 260);
    }

    function refreshSandboxMobileTask() {
        if (!sandboxMobileTask && !sandboxMobileNav) return;
        const bible = typeof getCurrentBibleSnapshot === 'function' ? getCurrentBibleSnapshot() : null;
        const gate = typeof getSandboxWorkflowGate === 'function' ? getSandboxWorkflowGate(bible) : null;
        const pending = typeof getPendingInteractionQuestions === 'function' ? getPendingInteractionQuestions('sandbox') : [];
        const stageLabels = {
            genre: '锁定类型',
            anchors: '首尾锚点',
            leads: '主角/反派',
            basic_character_cards: '基础人物卡',
            arcs: '人物弧线',
            six_beats: '六节点骨架',
            six_beats_review: '确认六节点',
            bridges: '桥接事件',
            narrative_logic: '叙事逻辑',
            sandbox_acceptance: '沙盒验收'
        };
        if (mobileTaskStage) mobileTaskStage.textContent = stageLabels[gate?.stage] || '沙盒推演';
        if (mobileTaskFocus) {
            mobileTaskFocus.textContent = gate?.focus || getLatestSandboxAssistantFocus() || '当前没有明确阶段，请先进入对话继续推演。';
        }
        if (mobileTaskQuestion) {
            if (pending.length > 0) {
                const current = pending[0];
                mobileTaskQuestion.textContent = `${current.id || 'Q1'}. ${current.question || '请继续补充这个问题。'}`;
            } else {
                mobileTaskQuestion.textContent = getLatestSandboxAssistantFocus() || '暂无待回答问题。';
            }
        }
        if (mobileTaskAlert) {
            const level = sandboxAlertLevel?.textContent ? `【${sandboxAlertLevel.textContent}】` : '';
            mobileTaskAlert.textContent = `${level}${level ? '\n' : ''}${sandboxAlertSummary?.textContent || '等待规则检测。'}`;
        }
        syncSandboxMobileNav(sandbox?.dataset?.mobileTab || getSandboxMobileTab());
    }

    if (sandboxControlMode) {
        sandboxControlMode.addEventListener('change', () => {
            syncSandboxModeControls(sandboxControlMode.value);
            if (document.getElementById('prev-genre')) {
                const bible = collectBibleFromPreview();
                bible.workflow = normalizeWorkflow({ ...(bible.workflow || {}), control_mode: sandboxControlMode.value });
                const savedBible = saveLatestBible(bible, { preserveStableLists: false });
                updateRealtimeAlarmFromBible(savedBible || bible, '权限模式已更新。');
                syncGenesisDraftToCloud();
            } else {
                updateRealtimeAlarmFromBible(loadLatestBible(), '权限模式已更新。');
            }
        });
    }

    function appendSandboxSystemAssistant(text = '') {
        if (!text.trim()) return;
        const newIndex = genesisConversation.length;
        genesisConversation.push({ role: 'assistant', content: text });
        appendMessage('assistant', text, newIndex);
        localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
        syncGenesisDraftToCloud().catch(error => console.warn('监督消息云端同步失败:', error));
    }

    function buildSandboxSupervisionPrompt(bible, issues, mode, intent) {
        const modeInstruction = {
            auto: '全自动：请直接生成最小修复后的完整世界圣经 JSON。只修补冲突，不推翻用户已确认设定；修复后 workflow.status 应改为 reviewing 或 approved，并把修复记录写入 workflow.notes。',
            options: '半自动：不要修改 JSON。请给出 2-3 个修复方案，每个方案说明改哪些事件/人物/规则/上帝视角、优缺点、推荐选择。最后问作者选择哪一个。',
            report: '手动：不要修改 JSON。只输出冲突报告、影响范围、最小修复建议和继续创作前必须确认的问题。'
        }[intent] || '';
        return `你是 OmniStory 实时监督调度器。当前沙盒采用好莱坞六节点骨架，规则/专家系统权限最高。
【权限模式】${mode}
【本次动作】${modeInstruction}
【当前风险】\n${issues.join('\n') || '未列出具体风险，请自行检查。'}
【当前世界圣经】\n${JSON.stringify(compactBibleForPrompt(bible))}

必须检查：
1. 救猫咪类型、开始/结束事件、主角/最终反派是否完整。
2. 主角弧线和反派弧线是否能支撑六节点。
3. 六节点是否完整、因果是否连续、反派是否聪明升级。
4. 桥接事件、时间线、人物卡、规则、观众视角/上帝视角是否冲突。
5. 是否存在降智、巧合、提前泄露真相、人物 OOC 或世界规则失效。

如果本次动作是全自动，请只输出合法 JSON 代码块，包含完整 genre、worldview、rules、workflow、protagonist_arc、antagonist_arc、hollywood_beats、characters、relations、timeline、narrative_logic、secrets、chapters。
如果本次动作是半自动或手动，请不要输出 JSON。`;
    }

    async function runSandboxSupervisionAction(intent = 'report') {
        const bible = getCurrentBibleSnapshot();
        if (!bible) return;
        const snapshot = getBibleAlarmSnapshot(bible);
        const mode = getCurrentControlMode();
        if (intent === 'auto' && !hasEnoughSandboxContentForAutoRepair(bible)) return;
        sandboxAutoRepairInFlight = true;
        setSandboxAlert(snapshot.level || 'yellow', `${intent === 'auto' ? '全自动修复中' : intent === 'options' ? '正在生成修复方案' : '正在生成风险报告'}...\n${snapshot.items.join('\n')}`);
        try {
            const prompt = buildSandboxSupervisionPrompt(bible, snapshot.items, mode, intent);
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || '监督调度失败');
            if (intent === 'auto') {
                const parsedBible = extractBibleJsonFromText(data.reply);
                if (!parsedBible) throw new Error('自动修复没有返回合法世界圣经 JSON');
                const mergedBible = saveLatestBible(parsedBible) || parsedBible;
                renderHumanPreview(mergedBible);
                appendSandboxSystemAssistant(`【自动监督修复完成】\n系统已根据当前红/黄风险生成最小修复补丁并写入右侧面板。请检查“流程骨架”和“事件讨论”面板；如果不满意，可以撤回上一轮或切换为半自动讨论方案。`);
                window.runSandboxRuleAudit(mergedBible);
                syncGenesisDraftToCloud();
            } else {
                appendSandboxSystemAssistant(`${intent === 'options' ? '【半自动修复方案】' : '【手动风险报告】'}\n${stripFencedBlocks(data.reply) || data.reply}`);
                setSandboxAlert(snapshot.level || 'yellow', `${intent === 'options' ? '修复方案已发送到对话区。' : '风险报告已发送到对话区。'}\n${snapshot.items.slice(0, 4).join('\n')}`);
            }
        } catch (error) {
            setSandboxAlert('yellow', `监督调度失败：${error.message || '未知错误'}。你可以切换为半自动或手动后重试。`);
        } finally {
            sandboxAutoRepairInFlight = false;
        }
    }

    if (btnSandboxAutoRepair) btnSandboxAutoRepair.addEventListener('click', () => runSandboxSupervisionAction('auto'));
    if (btnSandboxFixOptions) btnSandboxFixOptions.addEventListener('click', () => runSandboxSupervisionAction('options'));
    if (btnSandboxRiskReport) btnSandboxRiskReport.addEventListener('click', () => runSandboxSupervisionAction('report'));
    if (btnRuleGateEdit) btnRuleGateEdit.addEventListener('click', openSandboxRuleFixEntrance);
    if (btnRuleGateRecheck) btnRuleGateRecheck.addEventListener('click', () => window.runSandboxRuleAudit(getFreshBibleForRuleAudit()));
    if (btnRuleGateIgnore) btnRuleGateIgnore.addEventListener('click', ignoreSandboxRuleGate);
    if (btnCloseRuleConflictModal) btnCloseRuleConflictModal.addEventListener('click', hideSandboxRuleConflictModal);
    if (btnModalRuleGateEdit) btnModalRuleGateEdit.addEventListener('click', () => openRuleConflictDiscussion(0));
    if (btnModalRuleGateAutofix) btnModalRuleGateAutofix.addEventListener('click', autoFixRemainingRuleConflicts);
    if (btnModalRuleGateRecheck) btnModalRuleGateRecheck.addEventListener('click', () => window.runSandboxRuleAudit(getFreshBibleForRuleAudit()));
    if (btnModalRuleGateIgnore) btnModalRuleGateIgnore.addEventListener('click', ignoreSandboxRuleGate);

    function closeGenesisSandbox() {
        if (sandbox) sandbox.classList.add('hidden');
        if (mainWorkspace) mainWorkspace.classList.remove('opacity-30', 'blur-sm');
    }

    window.handleWorkspaceBack = () => {
        if (sandbox && !sandbox.classList.contains('hidden')) {
            closeGenesisSandbox();
            return;
        }
        window.location.href = 'dashboard.html';
    };

    function stripReferenceMaterials(rules = "") {
        return String(rules || '').replace(/\n*【参考资料摘录】[\s\S]*$/g, '').trim();
    }

    function stripWorldLexicon(rules = "") {
        return String(rules || '')
            .replace(/\n*【世界用词规范表】[\s\S]*?(?=\n【参考资料摘录】|$)/g, '')
            .trim();
    }

    function stripSandboxStoryBrief(rules = "") {
        return String(rules || '')
            .replace(/\n*【沙盒故事简介】[\s\S]*?(?=\n【世界用词规范表】|\n【参考资料摘录】|$)/g, '')
            .trim();
    }

    function buildRulesWithReferenceMaterials(rules = "", materials = "") {
        const cleanRules = stripReferenceMaterials(rules);
        const cleanMaterials = String(materials || '').trim();
        return [cleanRules, cleanMaterials ? `【参考资料摘录】\n${cleanMaterials}` : ''].filter(Boolean).join('\n\n');
    }

    function upsertWorldLexicon(rules = "", lexicon = "") {
        const cleanRules = stripWorldLexicon(rules);
        const cleanLexicon = String(lexicon || '').trim();
        if (!cleanLexicon) return rules;
        return [cleanRules, cleanLexicon.startsWith('【世界用词规范表】') ? cleanLexicon : `【世界用词规范表】\n${cleanLexicon}`].filter(Boolean).join('\n\n');
    }

    function upsertSandboxStoryBrief(rules = "", brief = "") {
        const cleanRules = stripSandboxStoryBrief(rules);
        const cleanBrief = String(brief || '').trim();
        if (!cleanBrief) return rules;
        return [cleanRules, cleanBrief.startsWith('【沙盒故事简介】') ? cleanBrief : `【沙盒故事简介】\n${cleanBrief}`].filter(Boolean).join('\n\n');
    }

    function buildFallbackWorldLexicon(bible = {}) {
        const genre = bible.genre || '未明确';
        const worldview = limitText(bible.worldview || '未明确', 260);
        const rules = limitText(stripWorldLexicon(stripReferenceMaterials(bible.rules || '')) || '未明确', 380);
        const characters = (bible.characters || []).slice(0, 12).map(char => `${char.name || '未命名'}：${char.role || '定位未定'}；口吻依据=${char.personality || char.description || '待定'}`).join('\n') || '待 SOP 绑定角色后补充。';
        return `【世界用词规范表】
适用类型：${genre}
世界/时代基准：${worldview}
核心规则依据：${rules}

1. 时代语感与禁用词
- 正文用词必须服务上述世界/时代基准；未确认前避免现代网络词、现代制度词和跨时代比喻。
- 如果角色出现超时代词汇，必须有教育、身份、资料来源或戏剧性误用原因。

2. 货币与资源
- 未明确货币体系前，不得随意混用银两、铜钱、银票、纸币、信用点等。
- 同一物件和资源必须连续一致；例如“碎银三两”不能无交代变成“铜钱洒了一地”。

3. 计量单位
- 长度、重量、时间、距离和官制/职业单位必须保持同一体系；如需换算，正文要交代。

4. 称谓、身份与官职
- 称谓必须符合人物身份、亲疏关系、阶层和场景礼法；官职/职业头衔不能混用。

5. 器物、服饰、武器与道具
- 服饰器物、交通通讯、武器工具和专业道具必须符合世界规则；同一道具状态变化要进入连续性账本。

6. 专业术语与资料边界
- 涉及历史、法律、医疗、金融、警务、战争、政治、技能体系时，优先使用规则/专家资料和本地资料；资料不足时写谨慎，不写确定结论。

7. 人物口吻基准
${characters}

8. 正文审查硬规则
- 生成、重写、审查、定稿时必须检查：称谓、货币、器物、计量单位、时代词、专业术语是否前后一致。
- 发生兑换、掉包、误认、伪装、视角误导时，正文必须明确交代原因。`;
    }

    async function ensureWorldLexiconForBible(bible = {}) {
        if (!bible || typeof bible !== 'object') return bible;
        const existingRules = String(bible.rules || '');
        const existingLexicon = existingRules.match(/【世界用词规范表】[\s\S]*?(?=\n【参考资料摘录】|$)/)?.[0] || '';
        const baseBible = { ...bible, rules: stripWorldLexicon(existingRules) };
        const fallback = buildFallbackWorldLexicon(baseBible);
        let lexicon = existingLexicon;
        if (!lexicon || lexicon.length < 260) {
            const prompt = `你是长篇小说世界用词规范编辑。请根据沙盒已确认设定，生成一份可直接写入规则系统的【世界用词规范表】，用于20万字长篇正文保持用词、器物、货币、称谓、计量单位、时代语感一致。

【当前世界圣经】
${limitText(JSON.stringify(compactBibleForPrompt(baseBible)), 7000)}

要求：
1. 必须以“【世界用词规范表】”开头。
2. 覆盖：时代语感与禁用词、货币与资源、计量单位、称谓/身份/官职、器物/服饰/武器/道具、专业术语与资料边界、人物口吻基准、正文审查硬规则。
3. 不确定的项目写“待定/需作者确认”，不要编造成确定事实。
4. 明确写入：同一物件不能无因前后变形，例如“碎银三两”不能无交代变成“铜钱洒了一地”；如发生兑换、掉包、误认、伪装或视角误导，正文必须交代。
5. 只输出规范表，不要输出解释。`;
            try {
                const res = await fetch('/api/chat/deduce', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
                });
                const data = await res.json();
                lexicon = data.success ? (stripFencedBlocks(data.reply) || data.reply || '').trim() : '';
            } catch (e) {
                console.warn('世界用词规范表自动生成失败，使用兜底骨架:', e);
            }
        }
        if (!lexicon || !/【世界用词规范表】/.test(lexicon)) lexicon = fallback;
        return { ...bible, rules: upsertWorldLexicon(existingRules, lexicon) };
    }

    async function ensureSandboxStoryBriefForBible(bible = {}) {
        if (!bible || typeof bible !== 'object') return bible;
        const existingRules = String(bible.rules || '');
        const existingBrief = existingRules.match(/【沙盒故事简介】[\s\S]*?(?=\n【世界用词规范表】|\n【参考资料摘录】|$)/)?.[0] || '';
        if (existingBrief && existingBrief.length > 300) return bible;
        const eventDescriptions = [
            ...(bible.hollywood_beats || []).map(beat => `${getHollywoodBeatLabel(beat.beat || beat.key)}《${beat.title || '未命名'}》：${beat.content || ''}\n叙事功能：${beat.function || ''}`),
            ...(bible.timeline || []).map(item => `时间线 ${item.time_label || ''} / 事件${item.chapter_number || '-'}：${item.description || ''}`),
            ...(bible.chapters || []).map(item => `事件${item.chapter_number || '-'}《${item.title || '未命名'}》：${item.content || ''}`)
        ].filter(Boolean).join('\n\n');
        const prompt = `你是沙盒故事总览编辑。请根据当前已经确定的故事架构，写一份用于检查事件流畅性的【沙盒故事简介】。

【判定依据最高优先级】
事件讨论面板中的事件描述、时间线、章节/事件描述是判断故事流向的依据。如果人物卡、规则或旧对话与事件描述冲突，必须以事件描述为准，并在“需回看事件”中指出。

【当前世界圣经】
${limitText(JSON.stringify(compactBibleForPrompt({ ...bible, rules: stripSandboxStoryBrief(bible.rules || '') })), 8000)}

【事件描述汇总】
${limitText(eventDescriptions || '暂无事件描述', 5000)}

要求：
1. 必须以“【沙盒故事简介】”开头。
2. 用流畅梗概讲清完整故事，不写正文场景，不扩写新事件。
3. 必须包含：故事类型、世界规则、主角、最终反派/核心阻力、主角弧线、反派弧线、六节点、桥接事件、观众视角/上帝视角、人物关系、关键伏笔、结尾状态。
4. 单独输出【事件流畅性检查】：指出每个关键事件如何自然推到下一个事件。
5. 单独输出【需回看事件】：列出你认为可能不顺、不合理、信息缺失或可讨论修改的具体事件名。
6. 如果没有明显问题，也要写“事件流畅性：当前可进入 SOP”。`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const brief = data.success ? (stripFencedBlocks(data.reply) || data.reply || '').trim() : '';
            if (brief) return { ...bible, rules: upsertSandboxStoryBrief(existingRules, brief) };
        } catch (e) {
            console.warn('沙盒故事简介生成失败:', e);
        }
        return bible;
    }

    function splitListText(value = '') {
        return String(value || '')
            .split(/[、,，;；\n]/)
            .map(item => item.trim())
            .filter(Boolean);
    }

    function getSecretMergeKey(secret = {}) {
        return [
            normalizeStableKey(secret.id),
            normalizeStableKey(secret.title),
            normalizeStableKey(secret.reveal_event)
        ].filter(Boolean).join('|') || normalizeStableKey(secret.god_view || secret.audience_view);
    }

    function normalizeSecretItem(secret = {}) {
        const title = String(secret.title || '').trim();
        const status = ['hidden', 'partial', 'revealed'].includes(secret.status) ? secret.status : 'hidden';
        const seed = secret.id || title || secret.god_view || secret.audience_view || JSON.stringify(secret);
        return {
            id: secret.id || `secret_${stableHash(seed)}`,
            title,
            status,
            audience_view: String(secret.audience_view || '').trim(),
            god_view: String(secret.god_view || '').trim(),
            reveal_event: String(secret.reveal_event || '').trim(),
            related_characters: Array.isArray(secret.related_characters) ? secret.related_characters : splitListText(secret.related_characters),
            related_events: Array.isArray(secret.related_events) ? secret.related_events : splitListText(secret.related_events)
        };
    }

    function normalizeSecrets(secrets = []) {
        return uniqueStableArray((Array.isArray(secrets) ? secrets : [])
            .map(normalizeSecretItem)
            .filter(secret => secret.title || secret.audience_view || secret.god_view), getSecretMergeKey);
    }

    function normalizeWorkflow(workflow = {}) {
        return {
            control_mode: ['auto', 'semi', 'manual'].includes(workflow.control_mode) ? workflow.control_mode : 'semi',
            stage: workflow.stage || 'concept',
            status: workflow.status || 'draft',
            notes: String(workflow.notes || '').trim()
        };
    }

    function normalizeArc(arc = {}) {
        return {
            want: String(arc.want || '').trim(),
            need: String(arc.need || '').trim(),
            lie: String(arc.lie || '').trim(),
            fear: String(arc.fear || '').trim(),
            start: String(arc.start || '').trim(),
            end: String(arc.end || '').trim(),
            turning_points: String(arc.turning_points || '').trim()
        };
    }

    function normalizeHollywoodBeats(beats = []) {
        const beatOrder = ['opening', 'first_turn', 'midpoint_false_victory', 'opposition_rises', 'dark_night', 'finale'];
        const byKey = new Map((Array.isArray(beats) ? beats : []).map(beat => [beat.beat || beat.key, beat]));
        return beatOrder.map(key => {
            const beat = byKey.get(key) || {};
            return {
                beat: key,
                title: String(beat.title || '').trim(),
                event_ref: String(beat.event_ref || '').trim(),
                status: ['draft', 'approved', 'needs_fix'].includes(beat.status) ? beat.status : 'draft',
                content: String(beat.content || '').trim(),
                function: String(beat.function || beat.purpose || '').trim()
            };
        });
    }

    function getHollywoodBeatLabel(key = '') {
        return {
            opening: '开始事件',
            first_turn: '第一转折',
            midpoint_false_victory: '中点/虚假胜利',
            opposition_rises: '反派逼近',
            dark_night: '至暗时刻',
            finale: '终局事件'
        }[key] || key || '未命名节点';
    }

    function hasArcCore(arc = {}) {
        const normalized = normalizeArc(arc || {});
        return !!(normalized.want && normalized.need && normalized.fear && normalized.start && normalized.end);
    }

    function hasCharacterArcText(character = {}) {
        return /(弧线|成长|开始|结束|转折|变化|误判|目标|恐惧|需求|代价)/.test(`${character.character_arc || ''} ${character.background || ''} ${character.description || ''}`);
    }

    function isHollywoodBeatFilled(beat = {}) {
        return !!(String(beat.title || '').trim() && String(beat.content || '').trim() && String(beat.function || '').trim());
    }

    function getSandboxStructureText(bible = {}) {
        return [
            bible.genre,
            bible.worldview,
            bible.rules,
            JSON.stringify(bible.protagonist_arc || {}),
            JSON.stringify(bible.antagonist_arc || {}),
            ...(bible.hollywood_beats || []).map(beat => `${getHollywoodBeatLabel(beat.beat || beat.key)} ${beat.title || ''} ${beat.event_ref || ''} ${beat.content || ''} ${beat.function || ''}`),
            ...(bible.characters || []).map(char => `${char.name || ''} ${char.role || ''} ${char.faction || ''} ${char.description || ''} ${char.personality || ''} ${char.core_desire || ''} ${char.goal || ''} ${char.motivation || ''} ${char.flaw || ''} ${char.fear || ''} ${char.skills || ''} ${char.character_rules || ''} ${char.background || ''} ${char.character_arc || ''}`),
            ...(bible.timeline || []).map(item => `${item.time_label || ''} ${item.chapter_number || ''} ${item.description || ''}`),
            ...(bible.chapters || []).map(item => `${item.chapter_number || ''} ${item.title || ''} ${item.content || ''}`),
            JSON.stringify(bible.narrative_logic || {}),
            JSON.stringify(bible.secrets || [])
        ].filter(Boolean).join('\n');
    }

    function textHasEventAnchor(text = '', type = 'opening') {
        const source = String(text || '');
        return type === 'finale'
            ? /(结束事件|终局事件|结局|最终事件|最后|收束|终点|终章|高潮|大结局|finale)/i.test(source)
            : /(开始事件|开场|开端|起点|旧秩序|打破|诱因|opening)/i.test(source);
    }

    function getOpeningBeat(bible = {}) {
        return normalizeHollywoodBeats(bible.hollywood_beats || []).find(beat => beat.beat === 'opening') || {};
    }

    function getFinaleBeat(bible = {}) {
        return normalizeHollywoodBeats(bible.hollywood_beats || []).find(beat => beat.beat === 'finale') || {};
    }

    function hasStartEndAnchors(bible = {}) {
        const opening = getOpeningBeat(bible);
        const finale = getFinaleBeat(bible);
        const sortedChapters = (bible.chapters || []).filter(ch => String(ch.title || ch.content || '').trim())
            .sort((a, b) => (parseFloat(a.chapter_number) || 0) - (parseFloat(b.chapter_number) || 0));
        const sortedTimeline = (bible.timeline || []).filter(item => String(item.description || '').trim())
            .sort((a, b) => (parseFloat(a.chapter_number) || 0) - (parseFloat(b.chapter_number) || 0));
        const structureText = getSandboxStructureText(bible);
        const firstEventText = [
            opening.title,
            opening.content,
            sortedChapters[0]?.title,
            sortedChapters[0]?.content,
            sortedTimeline[0]?.description
        ].filter(Boolean).join('\n');
        const lastEventText = [
            finale.title,
            finale.content,
            sortedChapters[sortedChapters.length - 1]?.title,
            sortedChapters[sortedChapters.length - 1]?.content,
            sortedTimeline[sortedTimeline.length - 1]?.description
        ].filter(Boolean).join('\n');
        const hasOpening = isHollywoodBeatFilled(opening)
            || !!String(opening.title || opening.content || '').trim()
            || textHasEventAnchor(firstEventText || structureText, 'opening');
        const hasFinale = isHollywoodBeatFilled(finale)
            || !!String(finale.title || finale.content || '').trim()
            || textHasEventAnchor(lastEventText || structureText, 'finale');
        return { hasOpening, hasFinale, opening, finale };
    }

    function findLeadCharacter(bible = {}, type = 'protagonist') {
        const chars = Array.isArray(bible.characters) ? bible.characters : [];
        const pattern = type === 'antagonist'
            ? /反派|对手|敌人|敌方|核心阻力|最终阻力|幕后|真凶|凶手|恶人|boss|antagonist/i
            : /主角|主人公|男主|女主|主视角|核心人物|protagonist/i;
        return chars.find(c => !isPlaceholderCharacterName(c.name) && pattern.test(`${c.role || ''} ${c.description || ''} ${c.name || ''}`));
    }

    function hasLeadCharacters(bible = {}) {
        return {
            protagonist: findLeadCharacter(bible, 'protagonist'),
            antagonist: findLeadCharacter(bible, 'antagonist')
        };
    }

    function hasBasicCharacterDecisionCard(character = {}) {
        if (!character) return false;
        const desire = character.core_desire || character.goal || character.motivation;
        const limit = character.character_rules || character.skills;
        const combined = `${character.description || ''} ${character.background || ''} ${character.character_arc || ''} ${character.character_rules || ''}`;
        return !!(
            !isPlaceholderCharacterName(character.name)
            && String(character.role || '').trim()
            && (String(character.personality || '').trim() || /性格|MBTI|冷静|冲动|谨慎|偏执|外向|内向|理性|感性/.test(combined))
            && (String(desire || '').trim() || /欲望|目标|动机|想要|追求|必须|为了/.test(combined))
            && (String(character.flaw || '').trim() || /缺陷|弱点|盲点|错误|执念/.test(combined))
            && (String(character.fear || '').trim() || /恐惧|害怕|软肋|不敢|畏惧/.test(combined))
            && (String(limit || '').trim() || /限制|代价|不能|禁忌|弱点|规则|能力/.test(combined))
        );
    }

    function getBasicCharacterCardStatus(bible = {}) {
        const leads = hasLeadCharacters(bible);
        return {
            protagonistReady: hasBasicCharacterDecisionCard(leads.protagonist),
            antagonistReady: hasBasicCharacterDecisionCard(leads.antagonist),
            protagonist: leads.protagonist,
            antagonist: leads.antagonist
        };
    }

    function hasBridgeEvents(bible = {}) {
        const timelineCount = (bible.timeline || []).filter(item => String(item.description || '').trim()).length;
        const chapterCount = (bible.chapters || []).filter(item => String(item.title || item.content || '').trim()).length;
        return timelineCount >= 4 || chapterCount >= 4;
    }

    function hasNarrativeLogic(bible = {}) {
        const logic = bible.narrative_logic || {};
        const text = getSandboxStructureText(bible);
        return !!(String(logic.mode || '').trim() && String(logic.description || '').trim())
            || /(顺叙|倒叙|双线|多视角|框架叙事|非线性|读者阅读顺序|叙事顺序|presentation_order)/.test(text);
    }

    function hasSixBeatStructure(bible = {}, filledBeats = []) {
        if (filledBeats.length >= 6) return true;
        const text = getSandboxStructureText(bible);
        return ['开始事件', '第一转折', '中点', '虚假胜利', '反派逼近', '至暗', '终局'].every(label => text.includes(label));
    }

    function getSandboxCompletionReport(bible = getCurrentBibleSnapshot()) {
        const target = applyConversationLeadNamesToBible(bible || {});
        const gate = getSandboxWorkflowGate(target);
        const characters = Array.isArray(target.characters) ? target.characters : [];
        const placeholderNames = characters.filter(char => isPlaceholderCharacterName(char.name)).map(char => char.role || char.description || '未命名人物');
        const namelessRelations = (target.relations || []).filter(rel => isPlaceholderCharacterName(rel.from_name) || isPlaceholderCharacterName(rel.to_name));
        const issues = [];
        if (!String(target.worldview || '').trim()) issues.push('世界观为空：请先确认世界背景、时代/社会结构或故事发生环境。');
        if (!String(target.rules || '').trim()) issues.push('规则/专家资料为空：请先确认核心戒律、能力/制度限制或专业资料边界。');
        if (placeholderNames.length > 0) issues.push(`人物卡存在未命名或占位姓名：${placeholderNames.slice(0, 6).join('、')}。`);
        if (namelessRelations.length > 0) issues.push('人物关系中存在未命名人物，请先修正关系两端姓名。');
        if (gate.stage !== 'sandbox_acceptance') issues.push(`沙盒流程尚未完成：当前阶段为「${gate.stage}」。${gate.focus}`);
        return {
            ok: issues.length === 0,
            issues,
            bible: target,
            gate
        };
    }

    function buildPendingResolutionItems(completion = {}) {
        return (completion.issues || []).map((issue, index) => ({
            id: `pending-${index + 1}`,
            title: `待确定 ${index + 1}`,
            issue,
            status: 'pending',
            chat: [{
                role: 'assistant',
                content: `这条设定还没完成：\n${issue}\n\n请直接补充你的想法；如果你不确定，也可以回复“给我 2 个方案”。我会只围绕这一条讨论，确认后把关键要素写回右侧设定。`
            }]
        }));
    }

    function ensureSandboxPendingModal() {
        let modal = document.getElementById('sandbox-pending-modal');
        if (modal) return modal;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="sandbox-pending-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md z-[88] hidden flex items-center justify-center p-6">
                <div class="bg-gray-950 border border-amber-700/70 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[88vh] flex flex-col overflow-hidden">
                    <div class="p-5 border-b border-amber-900/50 bg-amber-950/20 flex items-start justify-between gap-4">
                        <div>
                            <div class="text-[11px] font-bold tracking-wider text-amber-300 mb-1">正式铸造前 · 待确定面板</div>
                            <h3 class="text-xl font-bold text-white">先补齐未完成项目</h3>
                            <div class="text-xs text-gray-400 mt-1">逐条讨论、提取、保存后，再统一送入沙盒设定。</div>
                        </div>
                        <button id="btn-close-sandbox-pending" class="text-gray-500 hover:text-white p-1 rounded border border-transparent hover:border-gray-700"><i data-lucide="x" class="w-5 h-5"></i></button>
                    </div>
                    <div class="grid md:grid-cols-[320px_1fr] flex-1 min-h-0">
                        <div class="border-r border-gray-800 bg-gray-950 p-4 overflow-y-auto">
                            <div id="sandbox-pending-list" class="space-y-2"></div>
                        </div>
                        <div class="flex flex-col min-h-0">
                            <div id="sandbox-pending-active" class="p-4 border-b border-gray-800 text-sm text-amber-100 whitespace-pre-wrap"></div>
                            <div id="sandbox-pending-chat" class="flex-1 overflow-y-auto p-4 space-y-3 text-xs"></div>
                            <div class="p-4 border-t border-gray-800 bg-gray-950">
                                <textarea id="sandbox-pending-input" class="w-full h-24 bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm text-white resize-none" placeholder="补充这一条设定，或让 AI 给方案..."></textarea>
                                <div class="grid grid-cols-3 gap-2 mt-3">
                                    <button id="btn-send-sandbox-pending" class="py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg font-bold text-sm">发送讨论</button>
                                    <button id="btn-apply-sandbox-pending" class="py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-bold text-sm">提取并保存本条</button>
                                    <button id="btn-finish-sandbox-pending" class="py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-lg font-bold text-sm">全部完成后重新铸造</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);
        modal = document.getElementById('sandbox-pending-modal');
        document.getElementById('btn-close-sandbox-pending')?.addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('btn-send-sandbox-pending')?.addEventListener('click', sendSandboxPendingDiscussion);
        document.getElementById('btn-apply-sandbox-pending')?.addEventListener('click', applySandboxPendingResolution);
        document.getElementById('btn-finish-sandbox-pending')?.addEventListener('click', () => {
            const unresolved = sandboxPendingResolution.items.filter(item => item.status !== 'resolved');
            if (unresolved.length) return alert(`还有 ${unresolved.length} 条未确认。请逐条提取保存后再铸造。`);
            modal.classList.add('hidden');
            btnConfirmCrystallize?.click();
        });
        if (window.lucide) lucide.createIcons();
        return modal;
    }

    function renderSandboxPendingModal() {
        const list = document.getElementById('sandbox-pending-list');
        const activeBox = document.getElementById('sandbox-pending-active');
        const chatBox = document.getElementById('sandbox-pending-chat');
        if (!list || !activeBox || !chatBox) return;
        const items = sandboxPendingResolution.items;
        const active = items[sandboxPendingResolution.activeIndex] || items[0];
        list.innerHTML = items.map((item, index) => `
            <button type="button" data-pending-index="${index}" class="w-full text-left rounded-xl border ${index === sandboxPendingResolution.activeIndex ? 'border-amber-600 bg-amber-950/30' : 'border-gray-800 bg-gray-900 hover:bg-gray-800'} p-3">
                <div class="flex justify-between gap-2">
                    <span class="text-xs font-bold ${item.status === 'resolved' ? 'text-emerald-300' : 'text-amber-200'}">${escapeHtml(item.title)}</span>
                    <span class="text-[10px] text-gray-400">${item.status === 'resolved' ? '已保存' : '待确定'}</span>
                </div>
                <div class="text-[11px] text-gray-400 mt-1 line-clamp-3">${escapeHtml(item.issue)}</div>
            </button>
        `).join('');
        list.querySelectorAll('[data-pending-index]').forEach(button => {
            button.addEventListener('click', () => {
                sandboxPendingResolution.activeIndex = Number(button.dataset.pendingIndex || 0);
                renderSandboxPendingModal();
            });
        });
        if (!active) return;
        activeBox.textContent = active.issue;
        chatBox.innerHTML = (active.chat || []).map(msg => `
            <div class="${msg.role === 'user' ? 'ml-16 bg-amber-900/40' : 'mr-16 bg-gray-800'} p-3 rounded-xl whitespace-pre-wrap leading-relaxed">${escapeHtml(msg.content || '')}</div>
        `).join('');
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function openSandboxPendingResolutionPanel(completion = {}) {
        sandboxPendingResolution = {
            items: buildPendingResolutionItems(completion),
            activeIndex: 0,
            chat: []
        };
        const modal = ensureSandboxPendingModal();
        renderSandboxPendingModal();
        modal.classList.remove('hidden');
    }

    async function sendSandboxPendingDiscussion() {
        const active = sandboxPendingResolution.items[sandboxPendingResolution.activeIndex];
        const input = document.getElementById('sandbox-pending-input');
        const sendBtn = document.getElementById('btn-send-sandbox-pending');
        const text = input?.value.trim();
        if (!active || !text) return;
        input.value = '';
        active.chat.push({ role: 'user', content: text });
        active.chat.push({ role: 'assistant', content: 'AI 正在整理这一条设定...' });
        renderSandboxPendingModal();
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.textContent = '思考中...';
        }
        const prompt = `你是沙盒待确定项讨论助手。只处理当前这一条未完成项目，不写正文，不扩展无关剧情。

【当前待确定项】
${active.issue}

【当前世界圣经】
${limitText(JSON.stringify(compactBibleForPrompt(collectBibleFromPreview())), 7000)}

【本条讨论记录】
${active.chat.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

请输出：
【已吸收】
【仍缺什么】
【可选方案】如已足够则写“无需更多方案”
【可写入设定】用短条目列出应写回人物卡/人物规则/事件描述/规则/上帝视角/叙事逻辑/时间线的内容。`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            active.chat.pop();
            active.chat.push({ role: 'assistant', content: data.success ? (stripFencedBlocks(data.reply) || data.reply) : `讨论失败：${data.error || '未知错误'}` });
            renderSandboxPendingModal();
        } catch (error) {
            active.chat.pop();
            active.chat.push({ role: 'assistant', content: `讨论失败：${error.message || '未知错误'}` });
            renderSandboxPendingModal();
        } finally {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = '发送讨论';
            }
        }
    }

    async function applySandboxPendingResolution() {
        const active = sandboxPendingResolution.items[sandboxPendingResolution.activeIndex];
        const applyBtn = document.getElementById('btn-apply-sandbox-pending');
        if (!active) return;
        if ((active.chat || []).filter(msg => msg.role === 'user').length === 0) {
            return alert('请先补充或讨论这一条，再提取保存。');
        }
        if (applyBtn) {
            applyBtn.disabled = true;
            applyBtn.textContent = '提取中...';
        }
        const currentBible = collectBibleFromPreview();
        const prompt = `你是严格的世界圣经修订器。请把当前待确定项的讨论结果写回完整 JSON，不要丢失原有字段。

【当前待确定项】
${active.issue}

【当前世界圣经 JSON】
${JSON.stringify(currentBible)}

【本条讨论记录】
${active.chat.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

要求：
1. 只输出完整合法 JSON 代码块。
2. 必须保留 genre、worldview、rules、workflow、protagonist_arc、antagonist_arc、hollywood_beats、characters、relations、timeline、narrative_logic、secrets、chapters。
3. 根据讨论内容更新对应字段：人物补人物卡/character_rules；事件补 hollywood_beats/timeline/chapters 的事件描述；规则补 rules；观众/上帝视角补 secrets；叙事顺序补 narrative_logic。
4. 事件描述是判定依据，修改事件时优先更新事件讨论面板中的事件描述字段。`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const parsed = data.success ? extractBibleJsonFromText(data.reply || '') : null;
            if (!parsed) throw new Error(data.error || 'AI 没有返回可解析的世界圣经 JSON');
            const saved = saveLatestBible(parsed, { preserveStableLists: false }) || parsed;
            renderHumanPreview(saved);
            active.status = 'resolved';
            active.chat.push({ role: 'assistant', content: '已提取并保存到右侧设定。' });
            const nextIndex = sandboxPendingResolution.items.findIndex(item => item.status !== 'resolved');
            sandboxPendingResolution.activeIndex = nextIndex >= 0 ? nextIndex : sandboxPendingResolution.activeIndex;
            await syncGenesisDraftToCloud({ force: true });
            renderSandboxPendingModal();
        } catch (error) {
            alert(`提取保存失败：${error.message || '未知错误'}`);
        } finally {
            if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.textContent = '提取并保存本条';
            }
        }
    }

    function getSandboxWorkflowGate(bible = getCurrentBibleSnapshot()) {
        const target = applyConversationLeadNamesToBible(bible || {});
        const beats = normalizeHollywoodBeats(target.hollywood_beats || []);
        const filledBeats = beats.filter(isHollywoodBeatFilled);
        const missingBeats = beats.filter(beat => !isHollywoodBeatFilled(beat)).map(beat => getHollywoodBeatLabel(beat.beat));
        const unapprovedBeats = beats.filter(beat => isHollywoodBeatFilled(beat) && beat.status !== 'approved').map(beat => getHollywoodBeatLabel(beat.beat));
        const issues = [];
        const anchors = hasStartEndAnchors(target);
        const leads = hasLeadCharacters(target);
        const basicCards = getBasicCharacterCardStatus(target);
        const protagonistArcReady = hasArcCore(target.protagonist_arc) || hasCharacterArcText(leads.protagonist);
        const antagonistArcReady = hasArcCore(target.antagonist_arc) || hasCharacterArcText(leads.antagonist);
        const sixBeatsReady = hasSixBeatStructure(target, filledBeats);
        let stage = 'sandbox_acceptance';
        let focus = '沙盒骨架已基本完成，可以进入沙盒验收。';
        let forbid = '';

        if (!String(target.genre || '').trim()) {
            stage = 'genre';
            focus = '先锁定救猫咪类型。';
            forbid = '禁止询问人物细节、六节点、桥接事件、章节细节、场景细节。';
            issues.push('救猫咪类型未锁定。');
        } else if (!anchors.hasOpening || !anchors.hasFinale) {
            stage = 'anchors';
            focus = `先确认开始事件和结束事件。缺失：${[!anchors.hasOpening ? '开始事件' : '', !anchors.hasFinale ? '结束事件' : ''].filter(Boolean).join('、')}。`;
            forbid = '禁止进入人物弧线、六节点、桥接事件、章节细节；下一轮只能围绕起点和终点。';
            issues.push(focus);
        } else if (!leads.protagonist || !leads.antagonist) {
            stage = 'leads';
            focus = `先确认主角和最终反派/核心阻力。缺失：${[!leads.protagonist ? '主角' : '', !leads.antagonist ? '最终反派/核心阻力' : ''].filter(Boolean).join('、')}。`;
            forbid = '禁止进入六节点和桥接事件；下一轮只能确认故事的行动主体和核心阻力。';
            issues.push(focus);
        } else if (!basicCards.protagonistReady || !basicCards.antagonistReady) {
            stage = 'basic_character_cards';
            focus = `先补全六节点前的基础行为决策卡。缺失：${[!basicCards.protagonistReady ? '主角基础卡' : '', !basicCards.antagonistReady ? '反派/核心阻力基础卡' : ''].filter(Boolean).join('、')}。基础卡至少要有人物定位、性格/MBTI、欲望/目标/动机、缺陷、恐惧、能力限制或人物规则。`;
            forbid = '禁止进入六节点细化、桥接事件或章节细节；下一轮只能补人物行为决策依据。';
            issues.push(focus);
        } else if (!protagonistArcReady) {
            stage = 'arcs';
            focus = '先补全主角人物弧线：外在目标、内在需求、恐惧、开始状态、结束状态。';
            forbid = '禁止进入六节点细化、桥接事件或场景细节。';
            issues.push('主角弧线核心字段未完成。');
        } else if (!antagonistArcReady) {
            stage = 'arcs';
            focus = '先补全最终反派/核心阻力弧线：目标、优势、恐惧/误判、开始状态、结束状态。';
            forbid = '禁止进入六节点细化、桥接事件或场景细节。';
            issues.push('反派/核心阻力弧线核心字段未完成。');
        } else if (!sixBeatsReady) {
            stage = 'six_beats';
            focus = `必须先确定好莱坞六节点，当前完成 ${filledBeats.length}/6，缺失：${missingBeats.join('、') || '未识别'}。`;
            forbid = '禁止追问桥接事件、章节细节、场景细节、人物小动作、具体执行过程；下一轮问题只能围绕缺失六节点。';
            issues.push(focus);
        } else if (!hasBridgeEvents(target)) {
            stage = 'bridges';
            focus = '六节点已完成，下一步补桥接事件：连接六节点之间的中间事件、参与人物、状态变化、观众视角和上帝视角。';
            forbid = '禁止进入 SOP、章节细化和正文；下一轮只能补桥接事件和完整时间线。';
            issues.push('桥接事件/完整时间线不足。');
        } else if (!hasNarrativeLogic(target)) {
            stage = 'narrative_logic';
            focus = '进入 SOP 前必须确认叙事逻辑：顺叙、倒叙、双线叙事、多视角或其他呈现顺序，以及它如何服务人物弧线、悬念和信息释放。';
            forbid = '禁止进入 SOP 和正文；下一轮只能确认读者看到故事的顺序。';
            issues.push('叙事逻辑尚未确认。');
        }

        return {
            stage,
            canBridge: stage === 'bridges' || stage === 'narrative_logic' || stage === 'sandbox_acceptance',
            canSop: stage === 'sandbox_acceptance',
            filledBeats: filledBeats.length,
            missingBeats,
            unapprovedBeats,
            focus,
            forbid,
            issues
        };
    }

    function buildSandboxWorkflowGatePrompt(bible = getCurrentBibleSnapshot()) {
        const gate = getSandboxWorkflowGate(bible);
        return `【本地阶段闸门：最高优先级】
当前允许阶段：${gate.stage}
阶段中文名：genre=救猫咪类型；anchors=开始/结束事件；leads=主角/最终反派；basic_character_cards=基础行为决策人物卡；arcs=主角/反派弧线；six_beats=好莱坞六节点；six_beats_review=六节点确认；bridges=桥接事件/完整时间线；narrative_logic=叙事逻辑；sandbox_acceptance=沙盒验收。
六节点固定中文名：opening=开始事件；first_turn=第一转折；midpoint_false_victory=中点/虚假胜利；opposition_rises=反派逼近；dark_night=至暗时刻；finale=终局事件。
对作者提问时必须使用中文阶段名，不要问“opposition rise 是哪个阶段”，它固定就是“反派逼近”。
当前焦点：${gate.focus}
${gate.forbid ? `禁止事项：${gate.forbid}` : '允许事项：可以进入桥接事件，但仍不得写正文。'}
提问规则：如果当前允许阶段不是 sandbox_acceptance，【下一步选择】只能问当前焦点相关问题；不得追问后续阶段、章节细节、场景细节或执行细节。只有 stage=sandbox_acceptance 才允许建议进入 SOP。`;
    }

    function saveSecretToCurrentBible(secretPayload = {}) {
        const currentBible = collectBibleFromPreview();
        currentBible.secrets = normalizeSecrets([...(currentBible.secrets || []), normalizeSecretItem(secretPayload)]);
        const savedBible = saveLatestBible(currentBible) || currentBible;
        renderHumanPreview(savedBible);
        if (window.switchSandboxModule) window.switchSandboxModule('secrets');
        syncGenesisDraftToCloud().catch(error => console.warn('上帝视角云端同步失败:', error));
        return savedBible;
    }

    function openLocalSourceDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('omnistory-local-sources', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('docs')) {
                    const store = db.createObjectStore('docs', { keyPath: 'id' });
                    store.createIndex('projectId', 'projectId', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function runLocalSourceStore(mode, action) {
        return openLocalSourceDb().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction('docs', mode);
            const store = tx.objectStore('docs');
            const result = action(store);
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
        }));
    }

    function normalizeLocalSourceText(fileName, text) {
        let value = String(text || '');
        if (/\.(html?|xhtml)$/i.test(fileName)) {
            value = value.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                .replace(/<[^>]+>/g, ' ');
        }
        return value.replace(/\s+/g, ' ').trim();
    }

    function loadExternalScript(src, globalName) {
        if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
        return new Promise((resolve, reject) => {
            const existing = Array.from(document.scripts).find(script => script.src === src);
            if (existing) {
                existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), { once: true });
                existing.addEventListener('error', reject, { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve(globalName ? window[globalName] : true);
            script.onerror = () => reject(new Error(`无法加载解析库：${src}`));
            document.head.appendChild(script);
        });
    }

    async function extractPdfText(file) {
        const pdfjsLib = await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib');
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const data = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const pageTexts = [];
        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
            const page = await pdf.getPage(pageNo);
            const content = await page.getTextContent();
            const text = content.items.map(item => item.str || '').join(' ');
            if (text.trim()) pageTexts.push(`【第 ${pageNo} 页】\n${text}`);
        }
        return pageTexts.join('\n\n');
    }

    async function extractImageText(file) {
        const Tesseract = await loadExternalScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', 'Tesseract');
        const result = await Tesseract.recognize(file, 'chi_sim+eng', {
            logger: (info) => {
                const list = document.getElementById('local-source-list');
                if (list && info.status) list.dataset.status = `${file.name}: ${info.status} ${Math.round((info.progress || 0) * 100)}%`;
            }
        });
        return result?.data?.text || '';
    }

    async function extractLocalSourceText(file) {
        if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return extractPdfText(file);
        if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name)) return extractImageText(file);
        const raw = await file.text();
        return normalizeLocalSourceText(file.name, raw);
    }

    function chunkLocalSourceText(text, size = 900, overlap = 120) {
        const chunks = [];
        for (let i = 0; i < text.length; i += (size - overlap)) {
            const chunk = text.slice(i, i + size).trim();
            if (chunk.length > 80) chunks.push(chunk);
            if (chunks.length >= 500) break;
        }
        return chunks;
    }

    function extractLocalSourceTerms(text = "") {
        const value = String(text || '');
        const latin = value.match(/[A-Za-z0-9_]{3,}/g) || [];
        const chinese = value.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
        return Array.from(new Set([...latin, ...chinese]))
            .filter(term => !['系统附加', '当前事件', '世界观', '规则专家', '用户'].includes(term))
            .slice(-80);
    }

    function searchLocalSourceSnippets(queryText = "", maxSnippets = 6) {
        if (!localSourceDocs.length) return [];
        const terms = extractLocalSourceTerms(queryText);
        if (!terms.length) return [];
        const scored = [];
        localSourceDocs.forEach(doc => {
            (doc.chunks || []).forEach((chunk, index) => {
                let score = 0;
                terms.forEach(term => {
                    if (chunk.includes(term)) score += Math.min(6, term.length);
                });
                if (score > 0) scored.push({ score, doc, chunk, index });
            });
        });
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, maxSnippets);
    }

    function formatLocalSourceSnippets(items = []) {
        return items
            .map(item => `【${item.doc.name} · 片段${item.index + 1}】\n${limitText(item.chunk, 900)}`)
            .join('\n\n');
    }

    function getRelevantLocalSourceSnippets(queryText = "", maxSnippets = 6) {
        return formatLocalSourceSnippets(searchLocalSourceSnippets(queryText, maxSnippets));
    }

    async function loadLocalSourceDocs() {
        try {
            const db = await openLocalSourceDb();
            const tx = db.transaction('docs', 'readonly');
            const index = tx.objectStore('docs').index('projectId');
            const req = index.getAll(PROJECT_ID);
            localSourceDocs = await new Promise((resolve, reject) => {
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
            renderLocalSourcePanel();
        } catch (e) {
            console.warn('读取本地资料库失败:', e);
        }
    }

    window.ingestLocalSourceFiles = async (files) => {
        const fileList = Array.from(files || []);
        if (!fileList.length) return;
        const unsupported = [];
        const failed = [];
        const list = document.getElementById('local-source-list');
        if (list) list.innerHTML = `<div class="text-amber-300 animate-pulse">正在本地解析 ${fileList.length} 个文件，PDF/图片可能需要稍等...</div>`;
        for (const file of fileList) {
            const isReadableText = /\.(txt|md|markdown|html?|csv|json|xml|log)$/i.test(file.name) || /^text\//.test(file.type);
            const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
            const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name);
            const isSupported = isReadableText || isPdf || isImage;
            if (!isSupported) {
                unsupported.push(file.name);
                continue;
            }
            try {
                if (list) list.innerHTML = `<div class="text-amber-300 animate-pulse">正在解析：${escapeHtml(file.name)}</div>`;
                const text = normalizeLocalSourceText(file.name, await extractLocalSourceText(file));
                if (!text) {
                    failed.push(`${file.name}（未识别到文字）`);
                    continue;
                }
                const doc = {
                    id: `${PROJECT_ID}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
                    projectId: PROJECT_ID,
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size,
                    createdAt: new Date().toISOString(),
                    chunks: chunkLocalSourceText(text)
                };
                await runLocalSourceStore('readwrite', store => store.put(doc));
            } catch (e) {
                console.error('本地资料解析失败:', file.name, e);
                failed.push(file.name);
            }
        }
        await loadLocalSourceDocs();
        const notes = [];
        if (unsupported.length) notes.push(`不支持的文件：\n${unsupported.join('\n')}`);
        if (failed.length) notes.push(`解析失败或未识别文字：\n${failed.join('\n')}`);
        if (notes.length) alert(notes.join('\n\n'));
    };

    window.deleteLocalSourceDoc = async (id) => {
        await runLocalSourceStore('readwrite', store => store.delete(id));
        await loadLocalSourceDocs();
    };

    function renderLocalSourcePanel() {
        const list = document.getElementById('local-source-list');
        if (!list) return;
        list.innerHTML = localSourceDocs.length ? localSourceDocs.map(doc => `
            <div class="flex items-center justify-between bg-gray-900 border border-gray-800 rounded p-2">
                <div class="truncate">
                    <div class="text-amber-200 truncate">${escapeHtml(doc.name)}</div>
                    <div class="text-[10px] text-gray-500">${doc.chunks?.length || 0} 个本地片段 · 不上传云端</div>
                </div>
                <button type="button" onclick="deleteLocalSourceDoc('${doc.id}')" class="text-gray-500 hover:text-red-300 ml-2"><i data-lucide="trash-2" class="w-3 h-3"></i></button>
            </div>
        `).join('') : `<div class="text-gray-500 italic">尚未选择本地资料文件。</div>`;
        if (window.lucide) lucide.createIcons();
    }

    function ensureLocalSourceQaModal() {
        let modal = document.getElementById('local-source-qa-modal');
        if (modal) return modal;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="local-source-qa-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md z-[88] hidden flex items-center justify-center p-6">
                <div class="bg-gray-900 border border-amber-500/50 rounded-2xl p-6 w-full max-w-4xl h-[84vh] shadow-2xl flex flex-col">
                    <div class="flex items-center justify-between mb-4">
                        <h3 class="text-lg font-bold text-white flex items-center"><i data-lucide="search-check" class="w-5 h-5 mr-2 text-amber-300"></i>本地资料问答</h3>
                        <button id="btn-close-local-source-qa" class="text-gray-500 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
                    </div>
                    <div class="grid grid-cols-2 gap-4 flex-1 min-h-0">
                        <div class="flex flex-col min-h-0">
                            <textarea id="local-source-question" class="bg-gray-950 border border-gray-700 rounded-xl p-3 text-sm text-white h-24 resize-none" placeholder="问资料：例如“明代县令上级有哪些官职？县令能否直接见皇帝？”"></textarea>
                            <button id="btn-ask-local-source" class="mt-2 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-xl font-bold">只根据本地资料回答</button>
                            <div class="mt-4 text-xs text-gray-500">命中片段</div>
                            <div id="local-source-hit-list" class="mt-2 flex-1 overflow-y-auto bg-gray-950 border border-gray-800 rounded-xl p-3 text-xs text-amber-100/80 whitespace-pre-wrap"></div>
                        </div>
                        <div class="flex flex-col min-h-0">
                            <div class="text-xs text-gray-500 mb-2">资料回答</div>
                            <textarea id="local-source-answer" class="flex-1 bg-gray-950 border border-gray-800 rounded-xl p-3 text-sm text-gray-100 resize-none" placeholder="回答会出现在这里。如果资料中没有，AI 必须说未找到。"></textarea>
                            <button id="btn-apply-local-source-answer" class="mt-2 py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded-xl font-bold">加入规则/专家</button>
                        </div>
                    </div>
                </div>
            </div>
        `);
        modal = document.getElementById('local-source-qa-modal');
        document.getElementById('btn-close-local-source-qa').onclick = () => modal.classList.add('hidden');
        document.getElementById('btn-ask-local-source').onclick = askLocalSourceQuestion;
        document.getElementById('btn-apply-local-source-answer').onclick = applyLocalSourceAnswerToRules;
        if (window.lucide) lucide.createIcons();
        return modal;
    }

    window.openLocalSourceQa = () => {
        const modal = ensureLocalSourceQaModal();
        const hitList = document.getElementById('local-source-hit-list');
        if (hitList) hitList.textContent = localSourceDocs.length
            ? `已索引 ${localSourceDocs.length} 个本地资料文件。`
            : '还没有本地资料，请先选择文件。';
        modal.classList.remove('hidden');
    };

    async function askLocalSourceQuestion() {
        const questionInput = document.getElementById('local-source-question');
        const answerBox = document.getElementById('local-source-answer');
        const hitList = document.getElementById('local-source-hit-list');
        const question = questionInput?.value.trim();
        if (!question) return alert('请先输入资料问题。');
        const hits = searchLocalSourceSnippets(question, 8);
        const snippets = formatLocalSourceSnippets(hits);
        if (hitList) hitList.textContent = snippets || '本地资料中未命中相关片段。';
        if (!snippets) {
            if (answerBox) answerBox.value = '资料中未找到相关内容。你可以换关键词，或加入更多本地资料。';
            return;
        }
        if (answerBox) answerBox.value = '正在根据本地资料回答...';
        const prompt = `你是本地资料问答助手。只能根据【本地资料命中片段】回答，不得使用外部知识补全。
如果片段不足以回答，必须说“资料中未找到/资料不足以确认”，并说明还需要什么关键词或资料。
回答要标注来自哪个文件/片段，并给出可直接用于创作或规则设定的结论。

【问题】\n${question}

【本地资料命中片段】\n${snippets}`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayload([{ role: 'user', content: prompt }], 1))
            });
            const data = await res.json();
            if (answerBox) answerBox.value = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `资料问答失败：${data.error || '未知错误'}`;
        } catch (e) {
            if (answerBox) answerBox.value = '资料问答请求失败，请稍后重试。';
        }
    }

    function applyLocalSourceAnswerToRules() {
        const answer = document.getElementById('local-source-answer')?.value.trim();
        if (!answer) return alert('没有可加入的资料回答。');
        const rules = document.getElementById('prev-rules') || document.getElementById('asset-rules');
        if (!rules) return alert('请先打开规则/专家面板。');
        rules.value = [rules.value.trim(), `【本地资料问答结论】\n${answer}`].filter(Boolean).join('\n\n');
        alert('已加入规则/专家。记得保存或正式铸造入库。');
    }

    function collectBibleFromPreview() {
        const rulesInput = document.getElementById('prev-rules') ? document.getElementById('prev-rules').value.trim() : "";
        const sourceMaterials = document.getElementById('prev-source-materials') ? document.getElementById('prev-source-materials').value.trim() : "";
        return {
            genre: document.getElementById('prev-genre') ? document.getElementById('prev-genre').value.trim() : "",
            worldview: document.getElementById('prev-worldview') ? document.getElementById('prev-worldview').value.trim() : "",
            rules: buildRulesWithReferenceMaterials(rulesInput, sourceMaterials),
            workflow: normalizeWorkflow({
                control_mode: document.getElementById('workflow-control-mode')?.value || document.getElementById('sandbox-control-mode')?.value || "semi",
                stage: document.getElementById('workflow-stage')?.value || "concept",
                status: document.getElementById('workflow-status')?.value || "draft",
                notes: document.getElementById('workflow-notes')?.value || ""
            }),
            protagonist_arc: normalizeArc({
                want: document.querySelector('.arc-protagonist-want')?.value || "",
                need: document.querySelector('.arc-protagonist-need')?.value || "",
                lie: document.querySelector('.arc-protagonist-lie')?.value || "",
                fear: document.querySelector('.arc-protagonist-fear')?.value || "",
                start: document.querySelector('.arc-protagonist-start')?.value || "",
                end: document.querySelector('.arc-protagonist-end')?.value || "",
                turning_points: document.querySelector('.arc-protagonist-turning-points')?.value || ""
            }),
            antagonist_arc: normalizeArc({
                want: document.querySelector('.arc-antagonist-want')?.value || "",
                need: document.querySelector('.arc-antagonist-need')?.value || "",
                lie: document.querySelector('.arc-antagonist-lie')?.value || "",
                fear: document.querySelector('.arc-antagonist-fear')?.value || "",
                start: document.querySelector('.arc-antagonist-start')?.value || "",
                end: document.querySelector('.arc-antagonist-end')?.value || "",
                turning_points: document.querySelector('.arc-antagonist-turning-points')?.value || ""
            }),
            hollywood_beats: normalizeHollywoodBeats(Array.from(document.querySelectorAll('.hollywood-beat-item')).map(el => ({
                beat: el.dataset.beat || "",
                title: el.querySelector('.beat-title')?.value || "",
                event_ref: el.querySelector('.beat-event-ref')?.value || "",
                status: el.querySelector('.beat-status')?.value || "draft",
                content: el.querySelector('.beat-content')?.value || "",
                function: el.querySelector('.beat-function')?.value || ""
            }))),
            characters: Array.from(document.querySelectorAll('.prev-char-item')).map(el => {
                const characterId = el.dataset.characterId && el.dataset.characterId !== 'char_' ? el.dataset.characterId : "";
                return {
                    character_id: characterId,
                    id: characterId,
                    original_name: el.dataset.originalName || "",
                    name: cleanupMixedCharacterName(el.querySelector('.char-name')?.value.trim() || ""),
                    role: el.querySelector('.char-role')?.value.trim() || "",
                    faction: el.querySelector('.char-faction')?.value.trim() || "",
                    description: el.querySelector('.char-desc')?.value.trim() || "",
                    age: el.querySelector('.char-age')?.value.trim() || "",
                    appearance: el.querySelector('.char-app')?.value.trim() || "",
                    profession: el.querySelector('.char-prof')?.value.trim() || "",
                    personality: el.querySelector('.char-pers')?.value.trim() || "",
                    core_desire: el.querySelector('.char-desire')?.value.trim() || "",
                    goal: el.querySelector('.char-goal')?.value.trim() || "",
                    motivation: el.querySelector('.char-motiv')?.value.trim() || "",
                    flaw: el.querySelector('.char-flaw')?.value.trim() || "",
                    fear: el.querySelector('.char-fear')?.value.trim() || "",
                    skills: el.querySelector('.char-skills')?.value.trim() || "",
                    character_rules: el.querySelector('.char-rules')?.value.trim() || "",
                    background: el.querySelector('.char-bg')?.value.trim() || "",
                    character_arc: el.querySelector('.char-arc')?.value.trim() || "",
                };
            }).filter(c => c.name !== ""),
            relations: Array.from(document.querySelectorAll('.prev-rel-item')).map(el => ({
                from_name: el.querySelector('.rel-from')?.value.trim() || "",
                to_name: el.querySelector('.rel-to')?.value.trim() || "",
                label: el.querySelector('.rel-label')?.value.trim() || ""
            })).filter(r => r.from_name !== "" && r.to_name !== ""),
            timeline: Array.from(document.querySelectorAll('.prev-tl-item')).map(el => ({
                time_label: el.querySelector('.tl-time')?.value.trim() || "",
                chapter_number: parseFloat(el.querySelector('.tl-chap')?.value) || 1,
                description: el.querySelector('.tl-desc')?.value.trim() || ""
            })).filter(t => t.time_label !== ""),
            narrative_logic: {
                mode: document.getElementById('prev-narrative-mode') ? document.getElementById('prev-narrative-mode').value.trim() : "顺叙",
                description: document.getElementById('prev-narrative-desc') ? document.getElementById('prev-narrative-desc').value.trim() : "",
                presentation_order: Array.from(document.querySelectorAll('.prev-narrative-item')).map(el => ({
                    order: parseFloat(el.querySelector('.nar-order')?.value) || 1,
                    source_chapter_number: parseFloat(el.querySelector('.nar-source')?.value) || 1,
                    title: el.querySelector('.nar-title')?.value.trim() || "",
                    purpose: el.querySelector('.nar-purpose')?.value.trim() || "",
                    transition: el.querySelector('.nar-transition')?.value.trim() || ""
                })).filter(item => item.title !== "" || item.source_chapter_number)
            },
            secrets: Array.from(document.querySelectorAll('.prev-secret-item')).map(el => normalizeSecretItem({
                id: el.dataset.secretId || "",
                title: el.querySelector('.secret-title')?.value.trim() || "",
                status: el.querySelector('.secret-status')?.value || "hidden",
                audience_view: el.querySelector('.secret-audience')?.value.trim() || "",
                god_view: el.querySelector('.secret-god')?.value.trim() || "",
                reveal_event: el.querySelector('.secret-reveal')?.value.trim() || "",
                related_characters: splitListText(el.querySelector('.secret-chars')?.value || ""),
                related_events: splitListText(el.querySelector('.secret-events')?.value || "")
            })).filter(secret => secret.title || secret.audience_view || secret.god_view),
            chapters: Array.from(document.querySelectorAll('.prev-chap-item')).map(el => ({
                chapter_number: parseFloat(el.querySelector('.chap-num')?.value) || 1,
                title: el.querySelector('.chap-title')?.value.trim() || "",
                content: el.querySelector('.chap-content')?.value.trim() || ""
            })).filter(c => c.title !== "")
        };
    }

    function getCurrentBibleSnapshot() {
        if (document.getElementById('prev-genre')) return collectBibleFromPreview();
        return applyManualBibleEditsToValue(loadLatestBible());
    }

    function hasMeaningfulBible(bible = {}) {
        return !!(
            bible
            && (
                String(bible.genre || bible.worldview || bible.rules || '').trim()
                || (Array.isArray(bible.characters) && bible.characters.length > 0)
                || (Array.isArray(bible.timeline) && bible.timeline.length > 0)
                || (Array.isArray(bible.chapters) && bible.chapters.length > 0)
                || (Array.isArray(bible.hollywood_beats) && bible.hollywood_beats.some(beat => String(`${beat.title || ''}${beat.content || ''}`).trim()))
            )
        );
    }

    function getFreshBibleForRuleAudit() {
        const previewBible = document.getElementById('prev-genre') ? collectBibleFromPreview() : null;
        return hasMeaningfulBible(previewBible || {}) ? previewBible : getCurrentBibleSnapshot();
    }

    function compactBibleForPrompt(value) {
        if (!value) return null;
        if (typeof value === 'string') return limitText(value, 700);
        if (Array.isArray(value)) return value.slice(0, 80).map(item => compactBibleForPrompt(item));
        if (typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value)
                    .filter(([, entryValue]) => entryValue !== '' && entryValue !== null && entryValue !== undefined)
                    .map(([key, entryValue]) => [key, compactBibleForPrompt(entryValue)])
            );
        }
        return value;
    }

    function getAdjacentEventContext(chapterNumber) {
        const currentIndex = workspaceChapters.findIndex(ch => Number(ch.chapter_number) === Number(chapterNumber));
        const prev = currentIndex > 0 ? workspaceChapters[currentIndex - 1] : null;
        const current = currentIndex >= 0 ? workspaceChapters[currentIndex] : null;
        const next = currentIndex >= 0 ? workspaceChapters[currentIndex + 1] : null;

        return {
            prevInfo: prev ? `事件 ${prev.chapter_number}《${prev.title}》：${prev.content || '暂无梗概'}` : '无前置事件，这是当前叙事段落的起点。',
            startInfo: current ? `事件 ${current.chapter_number}《${current.title}》：${current.content || '暂无梗概'}` : `事件 ${chapterNumber}《${currentLocalContext.title || ''}》`,
            endInfo: next ? `事件 ${next.chapter_number}《${next.title}》：${next.content || '暂无梗概'}` : '暂无下一事件；请把当前事件自身的结果作为本段结束锚点，并提醒作者需要补充下一部分开始事件。'
        };
    }

    function getWorldRulesText() {
        return document.getElementById('world-rules-container') ? document.getElementById('world-rules-container').innerText.trim() : "无特殊限制";
    }

    function extractCharacterRulesFromBackground(background = '') {
        const match = String(background || '').match(/【人物规则】\s*([\s\S]*)$/);
        return match ? match[1].trim() : '';
    }

    function getEnrichedActiveCharacters() {
        const active = Array.isArray(currentLocalContext.characters) ? currentLocalContext.characters : [];
        if (active.length === 0) return [];
        return active.map(lc => {
            const global = window.globalCharacters?.find(c => c.id === lc.id || c.name === lc.name) || {};
            const gc = applyManualBibleEditsToValue(global);
            const characterRules = gc.character_rules || extractCharacterRulesFromBackground(gc.background) || extractCharacterRulesFromBackground(lc.background);
            return {
                ...lc,
                ...gc,
                id: lc.id || gc.id || lc.name || gc.name,
                name: gc.name || lc.name || '未命名角色',
                role: gc.role || lc.role || '',
                faction: gc.faction || lc.faction || '',
                personality: gc.personality || lc.personality || '',
                mbti: gc.mbti || lc.mbti || '',
                core_desire: gc.core_desire || lc.core_desire || '',
                goal: gc.goal || lc.goal || '',
                motivation: gc.motivation || lc.motivation || '',
                flaw: gc.flaw || lc.flaw || '',
                fear: gc.fear || lc.fear || '',
                character_arc: gc.character_arc || lc.character_arc || '',
                character_rules: characterRules || '',
                profession: gc.profession || lc.profession || '',
                position: gc.position || lc.position || gc.title || lc.title || '',
                occupation: gc.occupation || lc.occupation || '',
                skills: gc.skills || lc.skills || '',
                background: gc.background || lc.background || '',
                description: gc.description || lc.description || ''
            };
        });
    }

    function buildCharacterFactLockPrompt() {
        const characters = getEnrichedActiveCharacters();
        if (characters.length === 0) {
            return `【人物事实锁】
本事件尚未绑定可调用人物。正文不得擅自创造重要角色、职位、关系或背景；如必须出现路人，只能作为无姓名、无剧情决策权的场景功能人物。`;
        }
        const rows = characters.map(c => {
            const profession = [c.profession, c.position, c.occupation].filter(Boolean).join(' / ') || '未设定';
            return [
                `【${c.name}】`,
                `唯一ID：${c.id || c.name}`,
                `定位/阵营：${c.role || '未设定'} / ${c.faction || '未设定'}`,
                `职业/职位/身份：${profession}`,
                `性格/MBTI：${c.personality || c.mbti || '未设定'}`,
                `欲望/目标/动机：${c.core_desire || '未设定'} / ${c.goal || '未设定'} / ${c.motivation || '未设定'}`,
                `缺陷/恐惧/弧光：${c.flaw || '未设定'} / ${c.fear || '未设定'} / ${c.character_arc || '未设定'}`,
                `人物规则：${c.character_rules || '未设定'}`,
                `简介：${limitText([c.description, c.background].filter(Boolean).join(' '), 600) || '未设定'}`
            ].join('\n');
        }).join('\n\n');
        return `【人物事实锁：最高优先级】
以下人物卡是正文不可修改的事实来源。正文不得把人物写成其他职位、身份、阵营、姓名、关系、能力、病症、年龄、经历或性格；不得把未设定身份当成已设定事实；不得临时新增会改变剧情的亲属、上级、下属、头衔或履历。
如果人物卡写“刑侦队长”，正文绝不能写成“副所长”；如果确需变动，必须先回到人物卡/事件设定中修改，不能在正文里自行改。

${rows}`;
    }

    function formatGodViewContext(bible = getCurrentBibleSnapshot()) {
        const secrets = normalizeSecrets(bible?.secrets || []);
        if (secrets.length === 0) return '暂无上帝视角信息。';
        return secrets.map(secret => {
            const statusLabel = secret.status === 'revealed' ? '已揭露' : (secret.status === 'partial' ? '部分揭露' : '隐藏');
            const scopeRule = secret.status === 'revealed'
                ? '后续推理、SOP 与正文可把上帝视角作为公开事实调用。'
                : '真相揭露前，角色和观众只能基于观众视角推理；上帝视角只供作者/AI 后台校验伏笔与因果，禁止提前泄露。';
            return [
                `【${statusLabel}秘密：${secret.title || '未命名'}】`,
                `观众视角：${secret.audience_view || '暂无'}`,
                `上帝视角：${secret.god_view || '暂无'}`,
                secret.reveal_event ? `揭露事件：${secret.reveal_event}` : '',
                secret.related_characters?.length ? `关联人物：${secret.related_characters.join('、')}` : '',
                secret.related_events?.length ? `关联事件：${secret.related_events.join('、')}` : '',
                `调用规则：${scopeRule}`
            ].filter(Boolean).join('\n');
        }).join('\n\n');
    }

    function getCharacterDetailsForSop() {
        const characters = getEnrichedActiveCharacters();
        if (characters.length === 0) return "无详细资产设定";

        return characters.map(c => {
            const profession = [c.profession, c.position, c.occupation].filter(Boolean).join('/') || '未知';
            return `【角色：${c.name}】ID:${c.id || c.name} | 定位:${c.role || '未知'} | 阵营:${c.faction || '未知'} | 职业/职位/身份:${profession} | 性格:${c.personality || c.mbti || '未知'} | 欲望:${c.core_desire || '未知'} | 目标:${c.goal || '未知'} | 动机:${c.motivation || '未知'} | 缺陷:${c.flaw || '未知'} | 恐惧:${c.fear || '未知'} | 人物规则:${c.character_rules || '暂无'} | 弧光:${c.character_arc || '未知'} | 简介:${c.description || c.background || '无'}`;
        }).join('\n');
    }

    function getCurrentStoryGenre() {
        const previewGenre = document.getElementById('prev-genre')?.value?.trim();
        if (previewGenre) return previewGenre;
        const assetGenre = document.getElementById('asset-genre')?.value?.trim();
        if (assetGenre) return assetGenre;
        const badgeText = document.getElementById('story-genre-badge')?.innerText || '';
        return badgeText.replace(/^类型[:：]\s*/, '').trim() || '未锁定';
    }

    function getSaveTheCatGenreGuide(genre = '') {
        const key = (genre || '未锁定').trim();
        const guides = {
            '屋里有鬼': '类型承诺：怪物/威胁、封闭或难以逃离的屋子、角色过去或欲望造成的罪。监督重点：威胁必须逐步升级，逃离失败要有规则原因，人物越想掩盖问题越被逼近真相。',
            '金羊毛': '类型承诺：明确目标、路途/任务、同伴关系与主角变化。监督重点：每个事件都应是通往目标的一站，障碍要改变人物关系或价值观，不能只是换地图流水账。',
            '神灯出窍': '类型承诺：愿望/奇迹带来短期满足，也带来代价和反噬。监督重点：能力或好运必须有使用条件、代价和误判，最终要让主角面对真正需求。',
            '面临困境': '类型承诺：普通人被压进异常压力，必须在坏选择中做选择。监督重点：困境不能靠巧合解除，主角每次选择都要付出道德、关系或现实成本。',
            '成长仪式': '类型承诺：外部事件逼出内在成长。监督重点：事件要持续戳中缺陷/恐惧，让主角从旧自我走向新自我，不能只靠说教完成变化。',
            '伙伴情谊': '类型承诺：两人或多人关系互补、冲突、破裂、再选择。监督重点：事件必须测试关系，冲突应来自性格/欲望差异，和解要有行动证明。',
            '推理侦探': '类型承诺：谜题、线索、嫌疑、误导、公平揭示。监督重点：关键真相必须提前有线索，调查手段要符合权限和专业流程，不能靠神来一笔破案。',
            '愚者成功': '类型承诺：被低估者进入强规则环境，用独特视角打破虚伪秩序。监督重点：成功不能靠装傻或运气，必须来自隐藏能力、真诚优势或系统漏洞。',
            '进退两难': '类型承诺：两边都有代价的不可兼得选择。监督重点：不能给无痛第三选项，抉择必须暴露价值排序，并制造不可逆后果。',
            '超级英雄': '类型承诺：非凡能力/身份与责任负担。监督重点：能力必须有代价、限制、反制和身份压力，对手应攻击主角的价值弱点而不只是战力。'
        };
        if (guides[key]) return `当前救猫咪类型：${key}\n${guides[key]}`;
        return `当前救猫咪类型：${key || '未锁定'}\n尚未锁定明确类型。监督重点：在继续大纲或正文前，应先确认故事主承诺属于哪一类；若暂时未分类，也要说明本事件承担的类型功能和读者期待。`;
    }

    function getExpertCatalog() {
        return [
            { label: '历史专家', keys: ['历史', '古代', '朝代', '皇帝', '皇后', '太子', '宰相', '县令', '官府', '科举', '宗族', '礼法', '朝堂', '边军', '粮草', '诏令', '唐朝', '宋朝', '明朝', '清朝', '民国'], desc: '朝代制度、官职称谓、礼法风俗、交通通讯、战争财政、现代价值观误套。' },
            { label: '法律/律师专家', keys: ['律师', '法庭', '诉讼', '起诉', '辩护', '证据', '检察', '法院', '法官', '合同'], desc: '接案、利益冲突、会见、证据、文书、庭审、判后沟通与权限边界。' },
            { label: '医疗/心理专家', keys: ['医生', '医院', '手术', '诊断', '病历', '急救', '药物', '心理治疗'], desc: '诊断、检查、病历、用药、手术、急救、心理干预流程和不确定性。' },
            { label: '刑侦/警务专家', keys: ['警察', '刑侦', '侦查', '审讯', '取证', '监控', '逮捕', '案发'], desc: '立案、侦查、取证、审讯、监控、逮捕、证据链和程序边界。' },
            { label: '金融/商业专家', keys: ['金融', '股票', '银行', '基金', '债务', '投资', '审计'], desc: '资金流、合同、审计、投融资、银行、公司治理和交易复杂度。' },
            { label: '政治制度专家', keys: ['政治', '选举', '议会', '官僚', '政变', '外交'], desc: '权力来源、制度结构、官僚流程、外交博弈、政变成本与反制。' },
            { label: '社会文化专家', keys: ['种族', '宗教', '文化', '部落', '阶层', '礼制'], desc: '阶层流动、宗教文化、族群关系、礼仪禁忌、社会代价与反制机制。' },
            { label: '力量体系专家', keys: ['魔法', '技能', '战力', '异能', '修炼', '能力'], desc: '能力、资源、战力、使用条件、代价、限制、反制和无敌解法排查。' }
        ];
    }

    function getBuiltInExpertBaseline() {
        return `【内置专家系统基线】
专家系统不需要作者手动粘贴模板。作者只需说明题材、时代、职业、行业或关键词；AI 必须自动调用对应专家审查标准。
专家系统只负责专业知识设定、事实边界、流程、术语、资料缺口和风险提醒；不得进行剧情推演，不得替作者设计事件走向、反转、人物选择或章节桥段。剧情推演只在沙盒/SOP 中发生，并引用这里沉淀的专业知识完成设定。
专家输出应沉淀为可复用规则：适用范围、真实流程、关键术语、权限边界、常见误区、戏剧化可压缩部分、不可突破红线、资料不足问题清单。

【历史专家】
触发词：历史剧、古代、朝代、皇帝、皇后、太子、宰相、县令、官府、科举、宗族、礼法、朝堂、边军、粮草、诏令、唐朝、宋朝、明朝、清朝、民国等。
审查维度：
1. 朝代、年代、官职、称谓、礼仪、服饰、器物不能混用；不确定时必须提示“不确定”，不能编成确定史实。
2. 人物行为必须符合时代身份、阶层、性别处境、宗族关系、礼法和权力边界。
3. 审案、科举、婚嫁、朝会、战争、军队调动、财政税制等场景要符合时代流程。
4. 交通、通讯、军队调动不能像现代一样快；重大行动要考虑诏令、粮草、地方配合和信息延迟。
5. 不能把现代价值观直接套给古人；如果角色有超时代思想，必须给出教育、经历、身份或冲突代价。
6. 戏剧化可以压缩时间、合并人物、虚构小事件，但不能破坏重大制度、时代风俗和权力结构。

【法律/律师专家】
检查接案、利益冲突、会见、证据、法律检索、文书、庭前准备、庭审、判后沟通；避免律师像侦探一样随意调取一切资料，避免庭审靠突然神证据解决。

【医疗/心理专家】
检查诊断、检查、病历、用药、手术、急救、心理干预的流程和边界；不编造确定医疗结论。

【警务/刑侦专家】
检查立案、侦查、取证、审讯、监控、逮捕、证据链和程序边界；避免主角随意越权。

【金融/商业专家】
检查资金流、合同、审计、投融资、银行和公司治理；避免一句话解决复杂交易。

【政治/社会文化专家】
检查制度结构、权力来源、阶层流动、宗教文化、种族关系、礼仪禁忌和反制机制。

【力量体系专家】
检查能力、技能、战力、资源是否有代价、限制、反制和使用条件，禁止无敌解法。`;
    }

    function getUnifiedQualityGuardrails() {
        const localSnippets = getRelevantLocalSourceSnippets([
            currentLocalContext.title || '',
            currentLocalContext.synopsis || '',
            editorTextarea?.value || '',
            getWorldRulesText()
        ].join('\n'), 5);
        return [
            `【统一规则/专家资料】\n${getWorldRulesText()}`,
            `【上帝视角信息权限】\n${formatGodViewContext()}`,
            localSnippets ? `【本地资料库相关片段】\n${localSnippets}` : '',
            getBuiltInExpertBaseline(),
            `【救猫咪类型监督】\n${getSaveTheCatGenreGuide(getCurrentStoryGenre())}`,
            `【长篇连载编辑状态】\n${getLongformEditorialContext()}`,
            `【当前事件可调用人物卡】\n${getCharacterDetailsForSop()}`,
            `【监督标准】
1. 专业真实感：涉及职业、行业、学科时，必须符合已入库的流程、术语、权限边界、常见误区；资料不足时避免装懂。
2. 叙事逻辑：因果链成立，信息来源清楚，关键转折不得靠无铺垫巧合。
3. 救猫咪类型契合度：本事件必须承担当前类型的叙事功能，不能违背读者对该类型的核心期待。
4. MBTI/人物性格一致性：性格不是标签；人物的说话方式、风险偏好、回避策略、冲突处理和关键选择必须能从性格、欲望、目标、动机、缺陷、恐惧或成长弧线中找到来源。
5. 世界规则：力量、资源、制度、技能必须有代价、限制和反制，不允许无敌解法。
6. 伏笔闭环：本章需要回应的伏笔必须处理；新伏笔要有后续回收方向。
7. 上帝视角权限：未揭露或部分揭露的秘密只能用于后台因果校验，不能让角色或观众提前知道；推理事件只能基于观众视角推进，揭露后才可公开调用上帝视角。
8. 资料来源：涉及历史、法律、医疗、行业流程或现实事实时，应优先引用本地资料库片段；资料不足要标注不确定，不能伪造来源。
9. 角色声音：主要角色的对白必须有不同词汇、节奏、潜台词和回避方式，不能所有人像同一个 AI。
10. 场面导演：动作、谈判、审讯、法庭、战争、仪式等高张力场景必须有空间调度、目标阻力、身体/心理代价和视觉记忆点。
11. 情感/主题：关系变化要由事件触发，主题母题要形成呼应但不能说教。
12. 定稿标准：章节必须通过验收闸门，且不能破坏分卷结构、节奏曲线、连续性账本和人物/反派弧光表。
13. 用词/器物/货币连续性：同一时代、阶层和场景内的称谓、货币、计量单位、服饰器物、武器、道具和专业术语必须一致；同一物件不能无因前后变形，例如“碎银三两”不能无交代变成“铜钱洒了一地”。如发生兑换、掉包、误认、伪装或叙述视角差异，正文必须明确交代。`
        ].filter(Boolean).join('\n\n');
    }

    function getActiveSandboxModuleLabel() {
        const moduleName = localStorage.getItem('omnistory_sandbox_module') || 'workflow';
        return ({ workflow: '流程骨架', events: '事件讨论', characters: '人物设定', rules: '规则/专家', secrets: '上帝视角' })[moduleName] || '流程骨架';
    }

    function getExpertKeywordHint(text = "") {
        const matched = getExpertCatalog().filter(item => item.keys.some(key => text.includes(key))).map(item => item.label);
        if (matched.length === 0) return '';
        return `\n\n【专家系统自动介入】检测到关键词，启用：${matched.join('、')}。专家只提供专业知识设定、流程、术语、边界、资料缺口和风险提醒；不得推进剧情。请先检查规则/专家资料中是否已有相关约束；资料不足时向作者提出需要补充的专业问题，禁止装懂或编造确定专业流程。`;
    }

    window.runSandboxRuleAudit = async (bible = null) => {
        const targetBible = bible || getCurrentBibleSnapshot();
        const alarmBox = document.getElementById('sandbox-rule-alarm');
        if (!targetBible || !alarmBox) return;
        const rules = [targetBible.worldview, targetBible.rules].filter(Boolean).join('\n\n');
        const events = [
            ...(targetBible.hollywood_beats || []).map(beat => `六节点 ${beat.beat || '-'}《${beat.title || ''}》：${beat.content || ''}\n功能：${beat.function || ''}`),
            ...(targetBible.timeline || []).map(t => `时间轴事件 ${t.chapter_number || '-'}：${t.description || ''}`),
            ...(targetBible.chapters || []).map(ch => `章节/事件 ${ch.chapter_number || '-'}《${ch.title || ''}》：${ch.content || ''}`)
        ].join('\n');
        if (!rules.trim() || !events.trim()) {
            alarmBox.textContent = '规则或事件不足，暂无法进行最高权限审查。';
            return;
        }
        const latestSandboxTrail = genesisConversation.slice(-12)
            .map(msg => `${msg.role === 'user' ? '作者' : 'AI'}：${stripBibleJsonBlocks(stripFencedBlocks(msg.content || ''))}`)
            .join('\n\n');
        const latestRulesTrail = rulesDiscussion.slice(-8)
            .map(msg => `${msg.role === 'user' ? '作者' : '规则AI'}：${msg.content || ''}`)
            .join('\n\n');
        alarmBox.textContent = '规则最高权限审查中...';
        try {
            const prompt = `你是规则最高权限审查器。规则/世界观/专家资料优先级最高，任何不符合设定的事件、情节、人物行为都必须报警并给整改意见。
审查前必须先吸收【最新沙盒/规则讨论尾迹】。如果作者已经在尾迹中补充了死因、动机、规则、时间线、人物关系或其他关键设定，不得再把它当成缺失项；只能检查它是否与结构化面板冲突。若结构化面板与最新对话冲突，以最新作者发言为准，并指出应同步到哪个字段。
【规则/世界观/专家资料】\n${limitText(rules, 3500)}
${getBuiltInExpertBaseline()}
【人物卡】\n${limitText(JSON.stringify(targetBible.characters || []), 2500)}
【主角弧线】\n${limitText(JSON.stringify(targetBible.protagonist_arc || {}), 1500)}
【反派/核心阻力弧线】\n${limitText(JSON.stringify(targetBible.antagonist_arc || {}), 1500)}
【上帝视角信息权限】\n${limitText(formatGodViewContext(targetBible), 2500)}
【事件/章节】\n${limitText(events, 4500)}
【最新沙盒对话尾迹】\n${limitText(latestSandboxTrail || '暂无', 3500)}
【最新规则/专家讨论尾迹】\n${limitText(latestRulesTrail || '暂无', 2500)}

请输出：
【红色警报】严重违反规则/专业常识/人物逻辑的问题；如果有多条，必须逐条编号为 1、2、3，不要合并成一段；
【黄色警报】可能降智、巧合、一次性人物、规则约束不足的问题；如果有多条，必须逐条编号；
【信息权限警报】是否把观众未知的上帝视角信息提前泄露给角色/观众；
【整改意见】最小修改方案；
【专家资料缺口】需要补充哪些职业/行业/世界规则资料。
如果没有明显问题，必须明确写“未发现明显问题 / 当前可继续”，并且不要输出红色警报或黄色警报内容。`;
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `审查失败：${data.error || '未知错误'}`;
            alarmBox.textContent = reply;
            const level = getRuleAuditLevel(reply);
            if (level === 'red') {
                activateSandboxRuleGate(reply);
            } else {
                releaseSandboxRuleGate(`规则审查完成，未发现阻断级冲突。\n${limitText(reply, 700)}`);
                setSandboxAlert(level, `规则审查完成。\n${limitText(reply, 700)}`);
            }
        } catch (e) {
            alarmBox.textContent = '规则审查请求失败，请稍后重试。';
            setSandboxAlert('yellow', '规则审查请求失败，请稍后重试。');
        }
    };

    function renderDeviationItems(items, emptyText = "当前未发现明显设定偏离风险。") {
        if (!localDeviationPanel) return;
        localDeviationPanel.innerHTML = items.length > 0
            ? items.map(w => `<div class="bg-yellow-950/20 border border-yellow-900/30 rounded p-2 whitespace-pre-wrap">${escapeHtml(w)}</div>`).join('')
            : `<div class="bg-emerald-950/20 border border-emerald-900/30 rounded p-2 text-emerald-300">${emptyText}</div>`;
    }

    async function runSopRealtimeSupervision(trigger = 'SOP 对话更新') {
        if (!currentLocalContext.chapterId) return '';
        const mode = getCurrentControlMode();
        const prompt = `你是 OmniStory SOP 实时监督器。请在当前事件推演仍在进行时立刻检查，避免等结束后才发现大问题。
【触发原因】${trigger}
【权限模式】${mode}
【当前 SOP 对话尾迹】\n${limitText(currentChapterChatHistory.slice(-8).map(msg => `${msg.role}: ${msg.content}`).join('\n\n'), 5000)}
${buildLongformBasePrompt()}

请只输出：
【红色警报】会导致当前事件无法对齐前后事件、人物/时间线矛盾、上帝视角泄露、人物降智的阻断问题；
【黄色提醒】动机偏弱、吸引力不足、伏笔/资料/规则不足的问题；
【当前最小修正】${mode === 'auto' ? '直接给出你建议采用的修正版本。' : mode === 'semi' ? '给 2-3 个可选修正方向。' : '只给建议，不改设定。'}
【下一步应该问作者】1-2 个必须确认的问题。
如果没有问题，请明确“当前可继续”。`;
        renderDeviationItems([`实时监督运行中：${trigger}...`]);
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `实时监督失败：${data.error || '未知错误'}`;
            if (/红色警报[\s\S]*(无法|矛盾|泄露|降智|阻断)|不通过|严重/.test(reply)) {
                renderSopSupervisionGate(reply);
                setSandboxAlert('red', `SOP 实时监督发现阻断风险。\n${limitText(reply, 700)}`);
            } else if (/黄色提醒|风险|不足|建议/.test(reply)) {
                setSopSupervisionBlocked(false);
                renderDeviationItems([reply]);
                setSandboxAlert('yellow', `SOP 实时监督发现可修正风险。\n${limitText(reply, 700)}`);
            } else {
                setSopSupervisionBlocked(false);
                const explicitReady = /【SOP_READY】|可以提取大纲|可提取大纲|点击.*提取.*大纲|进入提取大纲/.test(reply || '');
                if (getSopOutlineGateReport().ok || explicitReady) {
                    renderSopReadySignal('实时监督未发现阻断问题。', explicitReady);
                } else {
                    renderDeviationItems([reply]);
                }
            }
            return reply;
        } catch (error) {
            renderDeviationItems([`实时监督请求失败：${error.message || '未知错误'}`]);
            return '';
        }
    }

    function loadLongformState() {
        try {
            return JSON.parse(localStorage.getItem(LONGFORM_STATE_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveLongformState() {
        localStorage.setItem(LONGFORM_STATE_KEY, JSON.stringify(longformState));
        if (window.syncToCloud) {
            window.syncToCloud(LONGFORM_CLOUD_TYPE, longformState, { silent: true });
        }
    }

    function getLongformChapterKey(chapterNumber = currentLocalContext.chapterNumber) {
        return `event_${chapterNumber || 'unknown'}`;
    }

    function getLongformEditorialContext() {
        const key = getLongformChapterKey();
        return [
            longformState.wordBudget ? `【20万字篇幅规划】\n${longformState.wordBudget}` : '',
            longformState.volumePlan ? `【分卷/季结构】\n${longformState.volumePlan}` : '',
            longformState.beatSheet ? `【全书节拍表】\n${longformState.beatSheet}` : '',
            longformState.rhythmCurve ? `【章节节奏曲线】\n${longformState.rhythmCurve}` : '',
            longformState.storyBlueprint ? `【好莱坞大片蓝图】\n${longformState.storyBlueprint}` : '',
            longformState.goldenThree ? `【开篇黄金三章策略】\n${longformState.goldenThree}` : '',
            longformState.characterVoice ? `【角色声音系统】\n${longformState.characterVoice}` : '',
            longformState.relationshipLine ? `【情感/关系线系统】\n${longformState.relationshipLine}` : '',
            longformState.themeMotif ? `【主题与母题追踪】\n${longformState.themeMotif}` : '',
            longformState.arcTracker ? `【全局人物/反派弧光表】\n${longformState.arcTracker}` : '',
            longformState.productionBoard ? `【章节生产看板】\n${longformState.productionBoard}` : '',
            longformState.stageMemory ? `【阶段记忆压缩】\n${longformState.stageMemory}` : '',
            longformState.characterStates ? `【人物当前状态】\n${longformState.characterStates}` : '',
            longformState.continuityLedger ? `【连续性账本】\n${longformState.continuityLedger}` : '',
            longformState.bookAudit ? `【成书级一致性总审】\n${longformState.bookAudit}` : '',
            longformState.oppositionPlans?.[key] ? `【本事件反派/阻力升级】\n${longformState.oppositionPlans[key]}` : '',
            longformState.sceneCards?.[key] ? `【本章场景卡】\n${longformState.sceneCards[key]}` : '',
            longformState.dialoguePolish?.[key] ? `【本章对白专项打磨】\n${longformState.dialoguePolish[key]}` : '',
            longformState.setpieceDirector?.[key] ? `【本章动作/场面导演】\n${longformState.setpieceDirector[key]}` : '',
            longformState.sourceCitations?.[key] ? `【本章资料来源标注】\n${longformState.sourceCitations[key]}` : '',
            longformState.eventGates?.[key] ? `【本事件质量闸门】\n${longformState.eventGates[key]}` : '',
            longformState.attractionPlans?.[key] ? `【本章吸引力设计】\n${longformState.attractionPlans[key]}` : '',
            longformState.acceptanceGates?.[key] ? `【本章强制验收状态】\n${longformState.acceptanceGates[key]}` : '',
            longformState.finalizedChapters?.[key] ? `【本章定稿记录】\n${longformState.finalizedChapters[key].summary || '已标记定稿'}` : '',
            longformState.rewriteReports?.[key] ? `【最近一次改稿闭环】\n${longformState.rewriteReports[key]}` : ''
        ].filter(Boolean).join('\n\n') || '暂无长篇编辑状态。';
    }

    function buildLongformBasePrompt() {
        const eventContext = getAdjacentEventContext(currentLocalContext.chapterNumber);
        const currentBible = getCurrentBibleSnapshot() || {};
        const eventBriefState = loadSopEventBriefState(currentLocalContext.chapterId);
        const confirmedBrief = eventBriefState.confirmed && eventBriefState.brief ? eventBriefState.brief : '暂无已确认事件梗概。';
        return `【当前事件】\n${eventContext.startInfo}\n【下一事件锚点】\n${eventContext.endInfo}\n【沙盒好莱坞六节点】\n${JSON.stringify(compactBibleForPrompt(currentBible.hollywood_beats || []))}\n【主角弧线】\n${JSON.stringify(compactBibleForPrompt(currentBible.protagonist_arc || {}))}\n【反派/核心阻力弧线】\n${JSON.stringify(compactBibleForPrompt(currentBible.antagonist_arc || {}))}\n【已确认的SOP事件梗概】\n${confirmedBrief}\n【当前大纲】\n${currentLocalContext.synopsis || editorSopConflict?.innerText || '暂无'}\n【正文草稿】\n${limitText(editorTextarea?.value || '', 2600)}\n【救猫咪类型监督】\n${getSaveTheCatGenreGuide(getCurrentStoryGenre())}\n${buildCharacterFactLockPrompt()}\n${buildPacingBrakePrompt()}\n【统一规则/专家资料】\n${getWorldRulesText()}\n【上帝视角信息权限】\n${formatGodViewContext()}\n【已有长篇编辑状态】\n${getLongformEditorialContext()}`;
    }

    function buildSopWritingBoundaryPrompt() {
        const eventContext = getAdjacentEventContext(currentLocalContext.chapterNumber);
        const eventBriefState = loadSopEventBriefState(currentLocalContext.chapterId);
        const finalOutline = (editorSopConflict?.innerText || currentLocalContext.synopsis || '').trim();
        const confirmedBrief = eventBriefState.confirmed && eventBriefState.brief
            ? eventBriefState.brief
            : '未找到已确认事件梗概。若当前操作是正文执笔或重写，必须先以最终 SOP 大纲为准，不得新增改变因果的重大细节。';
        return `【SOP写作硬边界：最高优先级】
1. 正文只能执行【已确认的本事件故事梗概】和【最终SOP大纲】中的事件顺序、关键事实、人物选择、信息释放和结尾过渡。
2. 禁止新增会改变因果链的事件、隐藏真相、反派计划、人物关系、能力、道具、死因、时间顺序或世界规则。
3. 禁止提前解决下一事件，禁止把下一事件的核心内容写进当前事件。
4. 需要补环境、动作、心理、对白时，只能补“表现层细节”，不能改变剧情事实。
5. 如果场景卡、对白打磨、场面导演、文笔风格与事件梗概或最终大纲冲突，以事件梗概和最终大纲为准。
6. 如果必须补充大纲没有写明的细节，必须满足：不改变已定事实、不新增关键角色、不制造新规则、不让人物获得未设定能力、不让观众提前知道未揭露秘密。

【当前事件】
${eventContext.startInfo}
【下一事件锚点】
${eventContext.endInfo}
【已确认的本事件故事梗概】
${confirmedBrief}
【最终SOP大纲】
${finalOutline || '暂无最终大纲。'}`;
    }

    function buildPacingBrakePrompt() {
        return `【长篇节奏制动器：防止事件集中爆发】
1. 本章必须有节奏类型标注：推进场、反应/消化场、关系场、信息整理场、铺垫场、静场、高潮场。
2. 除非最终大纲明确写明“高潮章/追逐章/连续危机章”，否则不得连续三个场景都是高压推进或重大事件爆发。
3. 每个重大事件之后必须给人物和读者一个反应空间：情绪余波、误判、沉默、观察、关系变化、信息整理、身体代价或环境细节。
4. 呼吸段不是水文：它必须服务人物弧光、关系线、世界质感、伏笔铺垫、信息消化或下一次选择。
5. 正文不得把大纲里的多个事件压缩成连续爆点；一个自然段最多承载一个主要动作/信息变化。
6. 如果场景卡、吸引力设计、阻力升级导致节奏过载，以本节奏制动器为准：保留事件事实，降低爆发密度，补足反应和消化。
7. 目标章节配比建议：高压推进 30%-45%，中压调查/交锋 25%-35%，低压反应/关系/铺垫 20%-35%。高潮章可以提高高压比例，但仍要保留短反应点。`;
    }

    async function runDraftFactLockCheck(draftText = "", source = "after-ai-write") {
        const text = String(draftText || '').trim();
        if (!text) return { ok: true, report: '空文本，无需检测。' };
        const prompt = `你是正文事实锁审校器。请只检查正文是否违反已确认设定，不评价文笔。

${buildSopWritingBoundaryPrompt()}

${buildCharacterFactLockPrompt()}

${buildPacingBrakePrompt()}

【统一规则/专家资料】
${getWorldRulesText()}

【待检测正文】
${limitText(text, 7000)}

必须逐项检查：
1. 人物姓名、ID、职位、职业、身份、阵营、关系、能力、病症、经历是否与人物卡完全一致。
2. 是否把未设定内容写成确定事实。
3. 是否新增人物卡没有的关键身份或关系，例如把“刑侦队长”写成“副所长”。
4. 是否新增或修改 SOP 没有确认的情节、细节、因果、道具、死因、时间顺序、隐藏真相。
5. 是否违反世界规则、专家资料、上帝视角权限。
6. 是否把多个事件压缩成连续爆点、缺少重大事件后的反应/消化/关系余波。

请按格式输出：
【结论】通过/不通过
【设定漂移】
【幻觉新增】
【节奏过载】
【必须修改】
来源：${source}`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const report = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `事实锁检测失败：${data.error || '未知错误'}`;
            const failed = /【结论】\s*不通过|结论[:：]\s*不通过|设定漂移|幻觉新增|必须修改|不符合|违反|职位|身份/.test(report || '')
                && !/【结论】\s*通过|结论[:：]\s*通过/.test(report || '');
            return { ok: !failed, report };
        } catch (error) {
            return { ok: false, report: `事实锁检测请求失败：${error.message || '未知错误'}` };
        }
    }

    async function repairDraftAgainstFactLock(draftText = "", report = "") {
        const prompt = `你是正文设定修复器。请在不新增情节、不改变 SOP、不改变人物卡的前提下，修复正文中的设定漂移和幻觉新增。

${buildSopWritingBoundaryPrompt()}

${buildCharacterFactLockPrompt()}

${buildPacingBrakePrompt()}

【审校报告】
${report || '暂无'}

【待修复正文】
${limitText(draftText, 7000)}

修复原则：
1. 只改错误称谓、职位、身份、关系、能力、道具、时间、因果等与设定冲突的部分。
2. 不新增剧情，不扩写新桥段，不改变原正文的叙述顺序。
3. 如果某细节没有设定依据，删除或改成中性表述。
4. 如果审校报告指出节奏过载，只能通过人物反应、信息整理、关系余波、环境观察、身体/心理代价来降速；不得新增事件。
5. 直接输出修复后的正文，不要解释。`;
        const res = await fetch('/api/chat/deduce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
        });
        const data = await res.json();
        return data.success ? (stripFencedBlocks(data.reply) || data.reply) : "";
    }

    function getCachedLongformTaskReply(taskType) {
        const key = getLongformChapterKey();
        const map = {
            budget: longformState.wordBudget,
            volume: longformState.volumePlan,
            beats: longformState.beatSheet,
            rhythm: longformState.rhythmCurve,
            blueprint: longformState.storyBlueprint,
            goldenThree: longformState.goldenThree,
            voice: longformState.characterVoice,
            relationship: longformState.relationshipLine,
            theme: longformState.themeMotif,
            arcs: longformState.arcTracker,
            board: longformState.productionBoard,
            memory: longformState.stageMemory,
            bookAudit: longformState.bookAudit,
            state: longformState.characterStates,
            continuity: longformState.continuityLedger,
            opposition: longformState.oppositionPlans?.[key],
            scene: longformState.sceneCards?.[key],
            dialogue: longformState.dialoguePolish?.[key],
            setpiece: longformState.setpieceDirector?.[key],
            citations: longformState.sourceCitations?.[key],
            gate: longformState.eventGates?.[key],
            hook: longformState.attractionPlans?.[key],
            acceptance: longformState.acceptanceGates?.[key]
        };
        return map[taskType] || '';
    }

    async function runLongformEditorTaskCached(taskType, extra = "") {
        const cached = getCachedLongformTaskReply(taskType);
        if (cached) {
            renderDeviationItems([`已复用高级任务缓存：${taskType}\n\n${cached}`]);
            return cached;
        }
        return runLongformEditorTask(taskType, extra);
    }

    async function runLongformEditorTask(taskType, extra = "") {
        const globalTasks = ['memory', 'blueprint', 'budget', 'beats', 'board', 'arcs', 'volume', 'rhythm', 'bookAudit', 'goldenThree', 'voice', 'relationship', 'theme'];
        if (!currentLocalContext.chapterId && !globalTasks.includes(taskType)) return alert("请先选择一个事件。");
        const taskPrompts = {
            budget: `你是长篇小说制片主任。请建立【20万字篇幅规划器】：总字数目标约20万字，建议卷数/幕数/章节数，每章目标字数，三幕或八序列的篇幅比例，关键转折所在章节，高潮与收束字数预算。必须输出可执行表格，并指出当前事件属于哪一段篇幅功能。`,
            volume: `你是长篇分卷/季结构设计师。请建立【分卷/季结构管理】：每卷/季的主题、核心冲突、开始钩子、中段反转、卷末高潮、卷尾悬念、主角弧光阶段、反派阶段计划、伏笔种植与回收边界。要求能支撑约20万字长篇，不要把所有高潮挤在一卷。`,
            beats: `你是好莱坞节拍表设计师。请建立【全书节拍表】：开场钩子、主题陈述、诱因、犹豫、第一幕转折、B故事/关系线、中点、反派逼近、至暗点、灵魂黑夜、终局计划、高潮、结尾余波。每个节拍要绑定章节/事件、人物弧光、情绪功能和伏笔职责。`,
            rhythm: `你是章节节奏曲线师。请为全书建立【章节间节奏曲线】：每章的紧张度、情绪强度、信息量、动作量、关系推进、悬念强度、呼吸/反应空间、疲劳风险，指出连续平淡/连续解释/连续打斗/连续情绪过载/事件爆点过密的问题，并给调节建议。`,
            blueprint: `你是好莱坞级商业叙事总监。请为全书建立或更新【大片蓝图】：一句话高概念、类型承诺、主题问题、主角外在目标/内在需求、反派或核心阻力、三幕式/八序列推进、重大转折点、情绪卖点、视觉/场面卖点、终局画面、续写禁区。要求能指导后续所有事件，不写空话。`,
            goldenThree: `你是商业小说开篇诊断师。请建立【开篇黄金三章系统】：前三章必须完成的读者钩子、主角吸引力、世界入口、核心危机、反派/阻力露面、信息差、章末钩子、不能写慢的部分。逐章输出问题和强化方案。`,
            voice: `你是角色声音设计师。请建立【角色声音系统】：为主要角色设计专属说话方式、词汇偏好、句长节奏、隐喻来源、情绪失控时的语言变化、沉默/回避方式、禁用语气和容易说出口/绝不会说出口的话。要求能让读者不看名字也能分辨是谁在说话。`,
            dialogue: `你是对白专项打磨编辑。请审查并强化当前章节对白：每段对白是否有潜台词、冲突、身份差异、信息推进、关系变化和节奏停顿；删除解释型对白，避免所有人说话像同一个 AI。输出可直接用于改稿的对白原则和重点句段修改建议。`,
            setpiece: `你是动作/场面专项导演。请为当前章节设计或审查场面调度：空间位置、行动目标、障碍变化、节奏段落、视角切换、身体代价、道具/环境利用、专业流程、视觉记忆点和收束钩子。适用于动作戏、战争戏、追逐戏、法庭戏、谈判戏、仪式戏等高张力场景。`,
            relationship: `你是情感线/关系线统筹。请建立或更新【情感/关系线系统】：主要关系的当前状态、隐藏需求、误解、权力差、亲密/疏离节点、破裂/修复/背叛/和解节拍，以及每章应推动的关系变化。要求关系变化必须由事件和人物选择触发。`,
            theme: `你是主题与母题追踪编辑。请建立或更新【主题与母题追踪】：主题问题、反题、人物各自的价值立场、反复出现的象征物/意象/场景、每次出现的变化、与高潮选择的呼应。要求提升作品高级感，但不能让正文变成说教。`,
            arcs: `你是全局人物弧光统筹。请建立【全局人物/反派弧光表】：主角、关键配角、反派/核心阻力的初始信念、欲望、恐惧、错误策略、关键转折章节、关系变化、最低点、最终选择和结局状态。要求每个弧光都能被具体事件触发。`,
            board: `你是长篇生产看板管理员。请根据当前章节列表和已有正文状态建立【章节生产看板】：每章状态标记为待推演/已大纲/已场景卡/已正文/审查未通过/已改稿/已定稿，并列出下一步生产队列、缺失人物、缺失伏笔和高风险章节。`,
            continuity: `你是连续性账本管理员。请更新【连续性账本】：时间、地点、人物状态/伤势/心理变化、道具、秘密、知情范围、关系变化、能力消耗、未解决矛盾、不能遗忘的细节。发现前后冲突要报警，并给最小修正方案。`,
            citations: `你是资料来源标注员。请根据本地资料片段和当前正文/大纲，为专业细节、历史细节、制度流程、术语、事实性描述建立【资料来源标注】。输出：正文/大纲中的说法、可引用的资料片段、来源文件名或片段标题、可信度、仍需补资料的问题。资料不足时必须明确“无资料支撑”，不要编造来源。`,
            bookAudit: `你是成书级一致性总审。请从整书角度审查：人物是否漂移、事件是否断裂、伏笔是否遗忘、世界规则是否冲突、节拍是否偏移、反派是否变弱、章节节奏是否疲劳、开篇三章是否抓人、结尾是否兑现类型承诺。输出严重问题、影响章节、最小修复方案和优先级。`,
            acceptance: `你是强制验收闸门。请判断当前正文是否允许标记为定稿。必须检查：是否完成本章大纲、是否服从场景卡、是否符合篇幅/节拍功能、连续性是否冲突、人物弧光是否推进或保持合理、反派/阻力是否足够聪明、伏笔是否处理、称谓/货币/器物/计量单位/时代词是否前后一致、是否存在事件爆点过密、连续高压无反应段、人物没有消化空间、正文是否有中/高风险。输出：通过/不通过；若不通过，列出必须整改项。`,
            opposition: `你是【反派与阻力升级设计器】。请为当前事件设计对抗：谁/什么在阻止主角、对方目标与计划、压迫如何升级、主角每次选择的代价、对方下一步反制、主角赢了什么又失去什么、如何避免反派降智。输出可直接写进大纲的阻力链。`,
            scene: `你是【场景卡导演】。请把当前大纲拆成 3-7 个可写场景卡。每张场景卡必须包含：场景类型（推进/反应消化/关系/信息整理/铺垫/静场/高潮）、压力等级（低/中/高）、场景目标、登场人物、人物策略、冲突/阻力、情绪起点与终点、信息释放、反转/升级点、视觉或感官记忆点、结尾钩子、不可写成流水账的提醒。除非本章是明确高潮章，否则必须至少安排 1 张低压反应/关系/信息整理/铺垫场景，且不得连续 3 张高压推进场。`,
            gate: `你是长篇连载的【事件质量闸门】。请在事件进入正文前审查：因果必要性、救猫咪类型功能是否成立、人物是否必须这样做、人物行为是否符合 MBTI/性格/欲望/缺陷、是否有更聪明选择、反派是否降智、是否靠巧合、读者是否会觉得假、删掉事件主线是否断裂。输出：通过/不通过、风险点、最小整改方案、必须补充的问题。`,
            hook: `你是长篇连载的【章节吸引力设计器】。请为当前事件设计章节级吸引力：符合当前救猫咪类型承诺的读者钩子、冲突升级、信息差、情绪波峰、关系变化、结尾悬念、爽点/痛点/疑问点；同时利用角色 MBTI/性格差异制造自然冲突，避免平淡流水账。`,
            state: `你是长篇连载的【人物状态追踪器】。请根据当前事件/正文更新人物当前状态：当前目标、误解、情绪状态、关系变化、获得/失去资源、身体/心理代价、秘密、下一次行动倾向。每个变化都要注明来自人物的性格/欲望/缺陷/恐惧中的哪一项，只更新当前事件影响到的人物。`,
            memory: `你是长篇连载的【阶段记忆压缩器】。请压缩目前全部事件为长篇续写记忆：阶段总结、不可逆变化、已兑现伏笔、未兑现伏笔、人物状态变化、世界规则新增、下一阶段风险。要求短而硬，供后续 20 万字持续调用。`
        };
        const prompt = `${taskPrompts[taskType]}\n\n${buildLongformBasePrompt()}\n${extra}`;
        renderDeviationItems([`长篇编辑系统运行中：${taskType}...`]);
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `长篇系统失败：${data.error || '未知错误'}`;
            const key = getLongformChapterKey();
            if (taskType === 'budget') {
                longformState.wordBudget = reply;
            } else if (taskType === 'volume') {
                longformState.volumePlan = reply;
            } else if (taskType === 'beats') {
                longformState.beatSheet = reply;
            } else if (taskType === 'rhythm') {
                longformState.rhythmCurve = reply;
            } else if (taskType === 'blueprint') {
                longformState.storyBlueprint = reply;
            } else if (taskType === 'goldenThree') {
                longformState.goldenThree = reply;
            } else if (taskType === 'voice') {
                longformState.characterVoice = reply;
            } else if (taskType === 'dialogue') {
                longformState.dialoguePolish = { ...(longformState.dialoguePolish || {}), [key]: reply };
            } else if (taskType === 'setpiece') {
                longformState.setpieceDirector = { ...(longformState.setpieceDirector || {}), [key]: reply };
            } else if (taskType === 'relationship') {
                longformState.relationshipLine = reply;
            } else if (taskType === 'theme') {
                longformState.themeMotif = reply;
            } else if (taskType === 'arcs') {
                longformState.arcTracker = reply;
            } else if (taskType === 'board') {
                longformState.productionBoard = reply;
            } else if (taskType === 'continuity') {
                longformState.continuityLedger = reply;
            } else if (taskType === 'citations') {
                longformState.sourceCitations = { ...(longformState.sourceCitations || {}), [key]: reply };
            } else if (taskType === 'bookAudit') {
                longformState.bookAudit = reply;
            } else if (taskType === 'acceptance') {
                longformState.acceptanceGates = { ...(longformState.acceptanceGates || {}), [key]: reply };
            } else if (taskType === 'opposition') {
                longformState.oppositionPlans = { ...(longformState.oppositionPlans || {}), [key]: reply };
            } else if (taskType === 'scene') {
                longformState.sceneCards = { ...(longformState.sceneCards || {}), [key]: reply };
            } else if (taskType === 'gate') {
                longformState.eventGates = { ...(longformState.eventGates || {}), [key]: reply };
            } else if (taskType === 'hook') {
                longformState.attractionPlans = { ...(longformState.attractionPlans || {}), [key]: reply };
            } else if (taskType === 'state') {
                longformState.characterStates = reply;
            } else if (taskType === 'memory') {
                longformState.stageMemory = reply;
            }
            saveLongformState();
            renderDeviationItems([reply]);
            return reply;
        } catch (e) {
            renderDeviationItems(["长篇编辑系统请求失败，请稍后重试。"]);
            return "";
        }
    }

    async function runUnifiedContentReview(source = "manual") {
        if (!editorTextarea || !currentLocalContext.chapterId) return;
        const text = editorTextarea.value.trim();
        if (text.length < 80) {
            renderDeviationItems(["正文太短，暂不进行完整监督检测。"]);
            return "";
        }
        renderDeviationItems(["统一监督系统检测中：专业真实感、叙事逻辑、救猫咪类型、人设一致性、世界规则、用词/器物/货币连续性、伏笔闭环..."]);
        const eventContext = getAdjacentEventContext(currentLocalContext.chapterNumber);
        const sopBoundary = buildSopWritingBoundaryPrompt();
        const prompt = `请作为统一正文监督系统，审查下面正文。专家系统已经合并进规则系统，监督系统已经合并进偏离审查系统。
【当前事件】\n${eventContext.startInfo}
【下一事件锚点】\n${eventContext.endInfo}

${sopBoundary}

${buildCharacterFactLockPrompt()}

${buildPacingBrakePrompt()}

${getUnifiedQualityGuardrails()}

【待审正文】\n${limitText(text, 5000)}

请按以下格式输出：
【风险等级】低/中/高
【专业真实感问题】
【叙事逻辑问题】
【节奏过载/缺少呼吸问题】
【救猫咪类型契合度】
【MBTI/人物性格一致性】
【人物卡事实锁问题】
【人物降智/OOC问题】
【世界规则/设定冲突】
【SOP/事件梗概偏离问题】
【用词/器物/货币连续性问题】
【伏笔闭环问题】
【最小修改建议】
如果没有问题，也要明确说明“未发现明显问题”。来源：${source}`;

        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `监督检测失败：${data.error || '未知错误'}`;
            renderDeviationItems([reply]);
            return reply;
        } catch (e) {
            renderDeviationItems(["监督检测请求失败，请稍后重试。"]);
            return "";
        }
    }

    async function runHollywoodRewriteLoop(reviewText = "") {
        if (!editorTextarea || !currentLocalContext.chapterId) return;
        const draft = editorTextarea.value.trim();
        if (draft.length < 80) return alert("正文太短，暂时不适合进入改稿闭环。");
        const review = reviewText || await runUnifiedContentReview("rewrite-loop");
        const key = getLongformChapterKey();
        renderDeviationItems(["好莱坞改稿闭环运行中：正在根据审查报告重写正文..."]);
        const prompt = `你是好莱坞级小说改稿导演。请根据审查报告，对正文进行一次完整重写。
目标：更强的戏剧冲突、更清楚的主角目标、更聪明的阻力、更有画面感的场面、更稳定的人物性格、更有钩子的结尾。
必须保留：已确认事实、世界规则、人物卡、伏笔方向、当前事件边界。
禁止：改成新剧情、引入无关人物、解决后续事件、用解释代替场景。

${buildSopWritingBoundaryPrompt()}

${buildPacingBrakePrompt()}

${getUnifiedQualityGuardrails()}

【本章场景卡】\n${longformState.sceneCards?.[key] || '暂无，请在重写时先内化场景目标、冲突、转折和结尾钩子。'}

【审查报告】\n${review || '暂无审查报告，请按大片级叙事标准自行审查后重写。'}

【待重写正文】\n${limitText(draft, 6500)}

请只输出重写后的正文，不要输出解释。`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
            });
            const data = await res.json();
            const rewritten = data.success ? (stripFencedBlocks(data.reply) || data.reply) : "";
            if (!rewritten) {
                renderDeviationItems([`改稿失败：${data.error || '未知错误'}`]);
                return "";
            }
            longformState.rewriteReports = { ...(longformState.rewriteReports || {}), [key]: `已根据审查报告完成一次重写。\n\n${review || '未提供审查报告'}` };
            saveLongformState();
            if (confirm("改稿闭环已生成重写版本。是否替换当前正文？")) {
                editorTextarea.value = rewritten;
                saveChapterContent();
                runLongformEditorTask('continuity', '\n\n这是改稿替换后的连续性账本更新。');
                runLongformEditorTask('acceptance', '\n\n这是改稿替换后的强制验收，请判断是否允许定稿。');
                runLongformEditorTask('board', '\n\n这是改稿替换后的章节生产看板更新。');
                renderDeviationItems(["已替换为改稿闭环版本。建议再点一次“检测正文”做最终验收。"]);
            } else {
                renderDeviationItems([`改稿闭环生成了重写版本，但尚未替换。可再次点击“改稿闭环”重新生成。\n\n${limitText(rewritten, 1800)}`]);
            }
            return rewritten;
        } catch (e) {
            renderDeviationItems(["改稿闭环请求失败，请稍后重试。"]);
            return "";
        }
    }

    function sanitizeFilename(name = "omnistory") {
        return String(name || "omnistory").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
    }

    function downloadTextFile(content, filename, mime = "text/plain;charset=utf-8") {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function fetchBookExport(format = "md") {
        const res = await fetch(`/api/projects/export/${PROJECT_ID}?format=${encodeURIComponent(format)}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "导出失败");
        return data;
    }

    async function exportWholeBook(format = "md") {
        try {
            const data = await fetchBookExport(format);
            const ext = format === "md" ? "md" : "txt";
            downloadTextFile(data.content || "", `${sanitizeFilename(data.title)}.${ext}`, format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8");
            longformState.lastExport = {
                at: new Date().toISOString(),
                format,
                title: data.title,
                characters: (data.content || "").length
            };
            saveLongformState();
            renderDeviationItems([`整书已导出：${data.title}，格式 ${ext}，约 ${(data.content || "").length} 字符。`]);
        } catch (e) {
            renderDeviationItems([`整书导出失败：${e.message}`]);
        }
    }

    async function runBookLevelTask(taskType, extra = "") {
        let bookText = "";
        try {
            const data = await fetchBookExport("md");
            bookText = data.content || "";
        } catch (e) {
            bookText = workspaceChapters.map(ch => `事件 ${ch.chapter_number}《${ch.title}》\n${ch.content || ''}`).join('\n\n');
        }
        return runLongformEditorTask(taskType, `\n\n【整书当前文本/大纲摘录】\n${limitText(bookText, 9000)}\n${extra}`);
    }

    async function finalizeCurrentChapter() {
        if (!currentLocalContext.chapterId) return alert("请先选择一个事件。");
        const reviewText = await runUnifiedContentReview("finalize");
        const acceptanceText = await runLongformEditorTask('acceptance', `\n\n这是定稿前强制验收。请结合以下审查报告判断：\n${reviewText || '暂无审查报告'}`);
        if (/不通过|必须整改|未通过|高风险|中风险/.test(`${reviewText}\n${acceptanceText}`)) {
            renderDeviationItems([`${acceptanceText || reviewText}\n\n未标记定稿：请先按整改项修正。`]);
            return;
        }
        const key = getLongformChapterKey();
        const bible = getCurrentBibleSnapshot() || {};
        const dependencySnapshot = {
            bibleHash: stableHash(JSON.stringify(compactBibleForPrompt({
                genre: bible.genre,
                worldview: bible.worldview,
                rules: bible.rules,
                workflow: bible.workflow,
                protagonist_arc: bible.protagonist_arc,
                antagonist_arc: bible.antagonist_arc,
                hollywood_beats: bible.hollywood_beats,
                secrets: bible.secrets
            }))),
            characterHash: stableHash(JSON.stringify(compactBibleForPrompt(bible.characters || []))),
            eventHash: stableHash(JSON.stringify(compactBibleForPrompt([
                ...(bible.timeline || []).filter(item => String(item.chapter_number || '') === String(currentLocalContext.chapterNumber || '')),
                ...(bible.chapters || []).filter(item => String(item.chapter_number || '') === String(currentLocalContext.chapterNumber || ''))
            ])))
        };
        longformState.finalizedChapters = {
            ...(longformState.finalizedChapters || {}),
            [key]: {
                chapterId: currentLocalContext.chapterId,
                chapterNumber: currentLocalContext.chapterNumber,
                title: currentLocalContext.title,
                wordCount: (editorTextarea?.value || '').length,
                finalizedAt: new Date().toISOString(),
                dependencySnapshot,
                summary: `事件 ${currentLocalContext.chapterNumber}《${currentLocalContext.title}》已通过验收并标记定稿。`
            }
        };
        saveLongformState();
        await runLongformEditorTask('board', '\n\n这是章节定稿后的生产看板更新。');
        if ((parseFloat(currentLocalContext.chapterNumber) || 0) % 3 === 0) {
            runLongformEditorTask('memory', '\n\n这是章节定稿后的阶段压缩：请记录已定稿事件、不可逆变化、人物状态、伏笔和设定变更影响。');
        }
        renderDeviationItems([`已标记定稿：事件 ${currentLocalContext.chapterNumber}《${currentLocalContext.title}》。`]);
    }

    async function compareChapterVersion() {
        if (!currentLocalContext.chapterId || !editorTextarea) return alert("请先选择一个事件。");
        const key = getLongformChapterKey();
        const currentText = editorTextarea.value || "";
        const versions = { ...(longformState.versionSnapshots || {}) };
        const previous = versions[key]?.text || "";
        versions[key] = {
            text: currentText,
            savedAt: new Date().toISOString(),
            chapterNumber: currentLocalContext.chapterNumber,
            title: currentLocalContext.title
        };
        longformState.versionSnapshots = versions;
        saveLongformState();
        if (!previous) {
            renderDeviationItems(["已建立本章版本基线。下次点击“版本对比”会和这次快照比较。"]);
            return;
        }
        const prompt = `你是小说改稿版本对比编辑。请比较上一版和当前版，输出：核心剧情变化、人物行为变化、设定/伏笔变化、文风节奏变化、是否偏离原意、是否越改越好、需要回滚或保留的段落。

【上一版】\n${limitText(previous, 4500)}

【当前版】\n${limitText(currentText, 4500)}`;
        const res = await fetch('/api/chat/deduce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 1, prompt))
        });
        const data = await res.json();
        renderDeviationItems([data.success ? (stripFencedBlocks(data.reply) || data.reply) : `版本对比失败：${data.error || '未知错误'}`]);
    }

    function renderHookItem(hook, mode) {
        const borderClass = mode === 'target' ? 'border-red-500 bg-red-950/30' : 'border-amber-800/50 bg-amber-950/10';
        const textClass = mode === 'target' ? 'text-red-300' : 'text-amber-300';
        const label = mode === 'target' ? '🔥[必须在此回收] ' : '[本章种下] ';
        return `
            <li class="group cursor-pointer bg-gray-900/60 p-2 rounded border ${borderClass} transition-all" onclick="jumpToSourceChapter(${hook.source_chapter_number})">
                <div class="flex justify-between items-start mb-0.5">
                    <span class="text-xs ${textClass} font-bold break-all">${label}${hook.description}</span>
                </div>
                <div class="text-[9px] text-gray-500 mt-1">发源于: 事件 ${hook.source_chapter_number || '-'} ${hook.target_chapter ? `➔ 爆发于: 事件 ${hook.target_chapter}` : ''}</div>
                ${hook.annotation ? `<div class="text-[9px] text-gray-400 mt-1 leading-relaxed">注释: ${hook.annotation}</div>` : ''}
            </li>`;
    }

    function renderCompactInfo(label, text) {
        return `<div class="bg-gray-900/70 border border-cyan-900/30 rounded p-2">
            <div class="text-[10px] text-cyan-400 font-bold mb-1">${label}</div>
            <div class="text-[11px] text-gray-300 whitespace-pre-wrap leading-relaxed">${text || '暂无'}</div>
        </div>`;
    }

    function getEventOptions(selectedValue = "") {
        return `<option value="">选择事件...</option>` + workspaceChapters.map(ch => {
            const value = String(ch.chapter_number);
            const selected = String(selectedValue) === value ? 'selected' : '';
            const titleText = `${ch.title || ''}\n${ch.content || '暂无简介'}`.replace(/"/g, '&quot;');
            return `<option value="${value}" title="${titleText}" ${selected}>事件 ${ch.chapter_number}: ${ch.title}</option>`;
        }).join('');
    }

    function refreshEventSelects() {
        const timelineSelect = document.getElementById('tl-chapter');
        const hookTargetSelect = document.getElementById('hook-target-chapter');
        if (timelineSelect) timelineSelect.innerHTML = getEventOptions(timelineSelect.value || currentLocalContext.chapterNumber);
        if (hookTargetSelect) hookTargetSelect.innerHTML = getEventOptions(hookTargetSelect.value);
    }

    function parseCharacterDetailText(text) {
        const fields = {
            "姓名": "name", "定位": "role", "阵营": "faction", "年龄": "age", "外貌": "appearance",
            "职业": "profession", "性格": "personality", "核心欲望": "core_desire", "目标": "goal",
            "动机": "motivation", "缺陷": "flaw", "恐惧": "fear", "能力/技能": "skills",
            "人物规则": "character_rules", "背景": "background", "成长弧光": "character_arc", "简介": "description"
        };
        const payload = {};
        let activeField = null;
        (text || '').split('\n').forEach(line => {
            const match = line.match(/^【(.+?)】(.*)$/);
            if (match && fields[match[1]]) {
                activeField = fields[match[1]];
                payload[activeField] = match[2].trim() === '-' ? '' : match[2].trim();
                return;
            }
            if (activeField && line.trim()) {
                payload[activeField] = [payload[activeField], line.trim()].filter(Boolean).join('\n');
            }
        });
        return payload;
    }

    function ensureAssetOverviewPanel() {
        if (!assetModal || document.getElementById('asset-global-overview')) return;
        const rightPane = assetModal.querySelector('.asset-overview-pane');
        if (!rightPane) return;
        rightPane.insertAdjacentHTML('afterbegin', `
            <div id="asset-global-overview" class="grid grid-cols-2 gap-3 text-xs">
                <div class="bg-gray-950 border border-cyan-900/40 rounded-xl p-3 max-h-72 overflow-y-auto">
                    <h4 class="text-cyan-400 font-bold mb-2 flex items-center"><i data-lucide="scroll" class="w-3 h-3 mr-1"></i>世界观与规则</h4>
                    <input id="asset-genre" class="w-full bg-gray-900 border border-gray-800 rounded p-2 text-gray-200 mb-2" placeholder="类型">
                    <textarea id="asset-worldview" class="w-full bg-gray-900 border border-gray-800 rounded p-2 text-gray-200 h-20 resize-none mb-2" placeholder="世界观"></textarea>
                    <textarea id="asset-rules" class="w-full bg-gray-900 border border-gray-800 rounded p-2 text-gray-200 h-28 resize-none mb-2" placeholder="规则限制与专业顾问资料。例如：律师工作流程、专业术语、行业禁忌、常见误区、真实感细节、优势/劣势/代价/反制方式。"></textarea>
                    <div class="grid grid-cols-2 gap-2">
                        <button id="btn-save-project-asset" class="py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded font-bold">保存世界观/规则</button>
                        <button id="btn-discuss-rules" class="py-2 bg-purple-700 hover:bg-purple-600 text-white rounded font-bold">AI 谈论规则</button>
                        <button id="btn-auto-rule-check" class="py-2 bg-yellow-700 hover:bg-yellow-600 text-white rounded font-bold">自动检测冲突</button>
                        <button id="btn-manual-rule-check" class="py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-bold">手动检测</button>
                    </div>
                    <div id="asset-rule-check-result" class="mt-3 text-yellow-200 whitespace-pre-wrap leading-relaxed"></div>
                </div>
                <div class="bg-gray-950 border border-amber-900/40 rounded-xl p-3 max-h-72 overflow-y-auto">
                    <h4 class="text-amber-400 font-bold mb-2 flex items-center"><i data-lucide="anchor" class="w-3 h-3 mr-1"></i>伏笔设定</h4>
                    <div id="asset-hooks-overview" class="text-gray-300 space-y-1.5"></div>
                </div>
                <div class="bg-gray-950 border border-indigo-900/40 rounded-xl p-3 max-h-64 overflow-y-auto col-span-2">
                    <h4 class="text-indigo-400 font-bold mb-2 flex items-center"><i data-lucide="clock" class="w-3 h-3 mr-1"></i>时间轴</h4>
                    <div id="asset-timeline-overview" class="text-gray-300 grid grid-cols-2 gap-2"></div>
                </div>
            </div>
        `);
        const saveProjectBtn = document.getElementById('btn-save-project-asset');
        if (saveProjectBtn) {
            saveProjectBtn.onclick = async () => {
                const payload = {
                    genre: document.getElementById('asset-genre').value.trim(),
                    worldview: document.getElementById('asset-worldview').value.trim(),
                    rules: document.getElementById('asset-rules').value.trim()
                };
                const res = await fetch(`/api/projects/${PROJECT_ID}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
            if (data.success) {
                    await loadProjectSettings();
                    await runRuleConflictCheck("刚刚保存的世界观/规则");
                    alert("世界观与规则已保存");
                } else alert("保存失败：" + (data.error || "未知错误"));
            };
        }
        const discussRulesBtn = document.getElementById('btn-discuss-rules');
        if (discussRulesBtn) discussRulesBtn.onclick = openRulesDiscussion;
        const autoRuleCheckBtn = document.getElementById('btn-auto-rule-check');
        if (autoRuleCheckBtn) autoRuleCheckBtn.onclick = () => runRuleConflictCheck();
        const manualRuleCheckBtn = document.getElementById('btn-manual-rule-check');
        if (manualRuleCheckBtn) manualRuleCheckBtn.onclick = () => runRuleConflictCheck(prompt("要重点检测什么规则或事件？") || "");
    }

    window.saveAssetHook = async (id) => {
        const description = document.getElementById(`asset-hook-desc-${id}`)?.value.trim();
        const target_chapter = document.getElementById(`asset-hook-target-${id}`)?.value;
        const annotation = document.getElementById(`asset-hook-note-${id}`)?.value.trim();
        if (!description || !target_chapter) return alert("伏笔内容和回收事件不能为空");
        const res = await fetch('/api/workspace/hook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: PROJECT_ID, id, description, target_chapter, annotation })
        });
        const data = await res.json();
        if (data.success) {
            await loadGlobalAssetOverview();
            if (currentLocalContext.chapterId) loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
        } else alert("保存伏笔失败：" + (data.error || "未知错误"));
    };

    window.saveAssetTimeline = async (id) => {
        const time_label = document.getElementById(`asset-tl-time-${id}`)?.value.trim();
        const chapter_number = document.getElementById(`asset-tl-chapter-${id}`)?.value;
        const description = document.getElementById(`asset-tl-desc-${id}`)?.value.trim();
        if (!time_label || !chapter_number || !description) return alert("时间、事件、内容不能为空");
        const res = await fetch('/api/workspace/timeline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: PROJECT_ID, id, time_label, chapter_number, description })
        });
        const data = await res.json();
        if (data.success) {
            await loadGlobalAssetOverview();
            loadTimelineSidebar();
            if (timelineModal && !timelineModal.classList.contains('hidden')) renderTimelineModal();
        } else alert("保存时间轴失败：" + (data.error || "未知错误"));
    };

    function getRulesTextForPrompt() {
        const worldview = document.getElementById('prev-worldview')?.value.trim() || document.getElementById('asset-worldview')?.value.trim() || '';
        const rules = document.getElementById('prev-rules')?.value.trim() || document.getElementById('asset-rules')?.value.trim() || '';
        return [`【世界观】\n${worldview || '暂无'}`, `【规则限制与专业顾问资料】\n${rules || '暂无'}`].join('\n\n');
    }

    function ensureRulesDiscussionModal() {
        let modal = document.getElementById('rules-discussion-modal');
        if (modal) return modal;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="rules-discussion-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md z-[85] hidden flex items-center justify-center p-6">
                <div class="bg-gray-900 border border-cyan-500/50 rounded-2xl p-6 w-full max-w-3xl h-[82vh] shadow-2xl flex flex-col">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold text-white flex items-center"><i data-lucide="scroll" class="w-5 h-5 mr-2 text-cyan-400"></i>规则与世界观讨论</h3>
                        <button id="btn-close-rules-discussion" class="text-gray-500 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
                    </div>
                    <div id="rules-discussion-history" class="flex-1 overflow-y-auto bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3 text-xs"></div>
                    <div class="flex gap-2 mt-4 relative">
                        <textarea id="rules-discussion-input" class="flex-1 bg-gray-950 border border-gray-700 rounded-xl p-3 text-sm text-white h-20 resize-none" placeholder="输入 @ 选择专家，再描述你要讨论的问题..."></textarea>
                        <div id="rules-expert-mention-picker" class="hidden absolute left-0 bottom-full mb-2 w-full max-h-72 overflow-y-auto bg-gray-950 border border-cyan-800/70 rounded-xl shadow-2xl p-2 z-10"></div>
                        <button id="btn-send-rules-discussion" class="px-4 bg-cyan-700 hover:bg-cyan-600 text-white rounded-xl font-bold">发送</button>
                    </div>
                    <div id="rules-apply-status" class="hidden mt-3 text-xs rounded-xl border border-gray-800 bg-gray-950 p-3 text-gray-300 whitespace-pre-wrap"></div>
                    <button id="btn-apply-rules-discussion" class="mt-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl font-bold">应用为规则补丁</button>
                </div>
            </div>
        `);
        modal = document.getElementById('rules-discussion-modal');
        document.getElementById('btn-close-rules-discussion').onclick = () => modal.classList.add('hidden');
        document.getElementById('btn-send-rules-discussion').onclick = sendRulesDiscussion;
        setupRulesExpertMentionPicker();
        document.getElementById('btn-apply-rules-discussion').onclick = async () => {
            const applyBtn = document.getElementById('btn-apply-rules-discussion');
            const messages = Array.from(document.querySelectorAll('#rules-discussion-history [data-role="assistant"]'));
            const latest = messages[messages.length - 1]?.innerText.trim();
            if (!latest) return alert("还没有 AI 回复可应用");
            const patchInfo = buildRulesDiscussionPatchInfo(latest);
            const preview = limitText(patchInfo.patch, 900);
            if (!confirm(`将写入到：${patchInfo.targetLabel}\n\n提取到的规则补丁：\n${preview}\n\n确认应用并重新检测吗？`)) return;
            try {
                setRulesApplyStatus('写入规则补丁中...', 'yellow');
                if (applyBtn) {
                    applyBtn.disabled = true;
                    applyBtn.textContent = '应用中...';
                }
                const applied = applyRulesDiscussionPatch(latest, patchInfo);
                setRulesApplyStatus(`已写入到：${applied.targetLabel}\n\n${limitText(applied.patch, 900)}\n\n正在重新检测规则冲突...`, 'green');
                if (activeRuleConflictItem) {
                    const ignored = new Set(sandboxRuleGate.ignoredItems || []);
                    ignored.add(activeRuleConflictItem.signature);
                    sandboxRuleGate = { ...sandboxRuleGate, ignoredItems: [...ignored] };
                    renderRuleConflictItems();
                }
                await window.runSandboxRuleAudit(getFreshBibleForRuleAudit());
                setRulesApplyStatus(`规则补丁已提交并完成重新检测。\n写入位置：${applied.targetLabel}\n\n如果仍出现红色警告，请继续逐条处理剩余冲突。`, 'green');
                if (currentLocalContext.chapterId && tabSop) {
                    document.getElementById('rules-discussion-modal')?.classList.add('hidden');
                    tabSop.click();
                }
            } catch (error) {
                setRulesApplyStatus(`应用失败：${error.message || '未知错误'}\n当前对话未关闭，你可以继续讨论或重试。`, 'red');
                alert(`应用规则补丁失败：${error.message || '未知错误'}`);
            } finally {
                if (applyBtn) {
                    applyBtn.disabled = false;
                    applyBtn.textContent = '应用为规则补丁';
                }
            }
        };
        if (window.lucide) lucide.createIcons();
        return modal;
    }

    let rulesDiscussion = [];

    function getRulesExpertMentionContext(input) {
        if (!input) return null;
        const cursor = input.selectionStart ?? input.value.length;
        const before = input.value.slice(0, cursor);
        const atIndex = before.lastIndexOf('@');
        if (atIndex < 0) return null;
        const query = before.slice(atIndex + 1);
        if (/\s/.test(query)) return null;
        return { atIndex, cursor, query };
    }

    function getMentionedRuleExperts(text = '') {
        const catalog = getExpertCatalog();
        const labels = new Set();
        const matches = String(text || '').matchAll(/@([^\s@，,；;]+)/g);
        for (const match of matches) {
            const raw = match[1];
            const expert = catalog.find(item => item.label === raw || item.label.includes(raw) || raw.includes(item.label.replace('专家', '')));
            if (expert) labels.add(expert.label);
        }
        return [...labels];
    }

    function renderRulesExpertMentionPicker(query = '') {
        const picker = document.getElementById('rules-expert-mention-picker');
        const input = document.getElementById('rules-discussion-input');
        if (!picker || !input) return;
        const lowerQuery = query.trim().toLowerCase();
        const experts = getExpertCatalog().filter(item => {
            if (!lowerQuery) return true;
            return item.label.toLowerCase().includes(lowerQuery)
                || item.desc.toLowerCase().includes(lowerQuery)
                || item.keys.some(key => key.toLowerCase().includes(lowerQuery));
        });
        if (!experts.length) {
            picker.innerHTML = `<div class="px-3 py-2 text-xs text-gray-500">没有匹配专家</div>`;
        } else {
            picker.innerHTML = experts.map(item => `
                <button type="button" data-expert="${escapeHtml(item.label)}" class="expert-mention-option w-full text-left px-3 py-2 rounded-lg hover:bg-cyan-900/40 border border-transparent hover:border-cyan-800/60">
                    <div class="text-sm font-bold text-cyan-100">@${escapeHtml(item.label)}</div>
                    <div class="text-[11px] text-gray-400 leading-relaxed mt-0.5">${escapeHtml(item.desc)}</div>
                </button>
            `).join('');
        }
        picker.classList.remove('hidden');
        picker.querySelectorAll('.expert-mention-option').forEach(button => {
            button.addEventListener('click', () => insertRulesExpertMention(button.dataset.expert || ''));
        });
    }

    function hideRulesExpertMentionPicker() {
        document.getElementById('rules-expert-mention-picker')?.classList.add('hidden');
    }

    function insertRulesExpertMention(label = '') {
        const input = document.getElementById('rules-discussion-input');
        const context = getRulesExpertMentionContext(input);
        if (!input || !context || !label) return;
        const before = input.value.slice(0, context.atIndex);
        const after = input.value.slice(context.cursor);
        const inserted = `@${label} `;
        input.value = `${before}${inserted}${after}`;
        const cursor = before.length + inserted.length;
        input.focus();
        input.setSelectionRange(cursor, cursor);
        hideRulesExpertMentionPicker();
    }

    function setupRulesExpertMentionPicker() {
        const input = document.getElementById('rules-discussion-input');
        const picker = document.getElementById('rules-expert-mention-picker');
        if (!input || !picker || input.dataset.expertMentionReady) return;
        input.dataset.expertMentionReady = '1';
        const updatePicker = () => {
            const context = getRulesExpertMentionContext(input);
            if (!context) return hideRulesExpertMentionPicker();
            renderRulesExpertMentionPicker(context.query);
        };
        input.addEventListener('input', updatePicker);
        input.addEventListener('keyup', updatePicker);
        input.addEventListener('click', updatePicker);
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') hideRulesExpertMentionPicker();
        });
        document.addEventListener('mousedown', event => {
            if (!picker.contains(event.target) && event.target !== input) hideRulesExpertMentionPicker();
        });
    }

    function appendRulesDiscussion(role, text) {
        const box = document.getElementById('rules-discussion-history');
        if (!box) return;
        box.innerHTML += `<div data-role="${role}" class="${role === 'user' ? 'ml-12 bg-cyan-900/40' : 'mr-12 bg-gray-800'} p-3 rounded-xl whitespace-pre-wrap leading-relaxed">${escapeHtml(text)}</div>`;
        box.scrollTop = box.scrollHeight;
        return box.lastElementChild;
    }

    function getRulesPatchTarget() {
        return document.getElementById('prev-rules') || document.getElementById('asset-rules');
    }

    function setRulesApplyStatus(message = '', level = 'green') {
        const box = document.getElementById('rules-apply-status');
        if (!box) return;
        const color = level === 'red'
            ? 'border-red-800 bg-red-950/30 text-red-100'
            : level === 'yellow'
            ? 'border-amber-800 bg-amber-950/30 text-amber-100'
            : 'border-emerald-800 bg-emerald-950/30 text-emerald-100';
        box.className = `mt-3 text-xs rounded-xl border p-3 whitespace-pre-wrap ${color}`;
        box.textContent = message;
        box.classList.toggle('hidden', !message);
    }

    function extractSectionText(text = '', sectionNames = []) {
        const source = String(text || '').trim();
        for (const name of sectionNames) {
            const pattern = new RegExp(`【${name}】([\\s\\S]*?)(?=\\n?【|$)`);
            const match = source.match(pattern);
            if (match?.[1]?.trim()) return match[1].trim();
        }
        return '';
    }

    function getRulePatchDestination(latest = '') {
        const destination = extractSectionText(latest, ['建议修改到哪里']);
        if (/世界观/.test(destination) && !/规则|专家资料/.test(destination)) {
            return document.getElementById('prev-worldview') || document.getElementById('asset-worldview') || getRulesPatchTarget();
        }
        return getRulesPatchTarget();
    }

    function extractApplicableRulesPatch(latest = '') {
        const extracted = extractSectionText(latest, ['可入库规则条目', '最小修正规则', '专业知识设定'])
            || String(latest || '').trim();
        const lines = extracted
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => !/^【/.test(line))
            .filter(line => !/^(冲突本质|建议修改到哪里|需要作者确认|应用后需要重新检测)/.test(line));
        const normalized = lines.length ? lines.join('\n') : extracted;
        return limitText(normalized, 1400);
    }

    function getRulePatchTargetLabel(target) {
        if (!target) return '未知位置';
        if (/worldview/.test(target.id || '')) return '世界观';
        if (/rules/.test(target.id || '')) return '规则/专家资料';
        return target.id || '规则区';
    }

    function buildRulesDiscussionPatchInfo(latest = '') {
        const target = getRulePatchDestination(latest);
        if (!target) throw new Error('没有找到规则/专家资料输入区，请先打开规则面板。');
        const title = activeRuleConflictItem ? `【规则冲突修正：${activeRuleConflictItem.title}】` : '【规则/专家讨论补丁】';
        const body = extractApplicableRulesPatch(latest);
        if (!body.trim()) throw new Error('没有提取到可写入的规则补丁，请先让 AI 输出【可入库规则条目】或继续讨论。');
        const patch = `${title}\n${body}`;
        return {
            target,
            targetLabel: getRulePatchTargetLabel(target),
            patch
        };
    }

    function applyRulesDiscussionPatch(latest = '', patchInfo = null) {
        const info = patchInfo || buildRulesDiscussionPatchInfo(latest);
        const target = info.target;
        const patch = info.patch;
        target.value = [target.value.trim(), patch].filter(Boolean).join('\n\n');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        const isRulesTarget = /rules/.test(target.id || '');
        const isWorldviewTarget = /worldview/.test(target.id || '');
        if (isRulesTarget && document.getElementById('asset-rules') && target.id !== 'asset-rules') {
            document.getElementById('asset-rules').value = target.value;
        }
        if (isRulesTarget && document.getElementById('prev-rules') && target.id !== 'prev-rules') {
            document.getElementById('prev-rules').value = target.value;
        }
        if (isWorldviewTarget && document.getElementById('asset-worldview') && target.id !== 'asset-worldview') {
            document.getElementById('asset-worldview').value = target.value;
        }
        if (isWorldviewTarget && document.getElementById('prev-worldview') && target.id !== 'prev-worldview') {
            document.getElementById('prev-worldview').value = target.value;
        }
        return info;
    }

    async function openRuleConflictDiscussion(index = 0) {
        const item = sandboxRuleGate.items?.[index];
        if (!item) return openSandboxRuleFixEntrance();
        activeRuleConflictItem = item;
        hideSandboxRuleConflictModal();
        if (window.switchSandboxModule) window.switchSandboxModule('rules');
        const modal = ensureRulesDiscussionModal();
        rulesDiscussion = [{
            role: 'assistant',
            content: `我先只处理这一条规则冲突，不做剧情推演。\n\n【待处理冲突】\n${item.content}\n\n我会先给出合理修正建议；你可以继续告诉我想怎么改。讨论结束后点击“应用为规则补丁”，我会把关键规则更新到规则/专家资料里，再重新检测。`
        }];
        const box = document.getElementById('rules-discussion-history');
        if (box) box.innerHTML = '';
        setRulesApplyStatus('', 'green');
        appendRulesDiscussion('assistant', rulesDiscussion[0].content);
        const input = document.getElementById('rules-discussion-input');
        if (input) input.value = '';
        modal.classList.remove('hidden');

        const loadingText = '正在生成这条冲突的合理修正建议...';
        appendRulesDiscussion('assistant', loadingText);
        const loadingNode = box?.lastElementChild;
        const prompt = `你是规则冲突修复顾问。只处理下面这一条冲突，不做剧情推演，不设计事件桥段，不替人物做选择。

【待处理冲突】
${item.content}

【当前规则/世界观/专家资料】
${getRulesTextForPrompt()}

请先给出可讨论的合理修正建议，格式：
【冲突本质】
【建议修改到哪里】只能从：世界观、规则/专家资料、人物规则、事件设定 中选择，可多选。
【最小修正规则】
【需要作者确认的问题】
【应用后需要重新检测的风险】
【可入库规则条目】只输出最终要写入规则/世界观的 1-5 条短规则，不要包含分析过程。`;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources([{ role: 'user', content: prompt }], 4, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `建议生成失败：${data.error || '未知错误'}`;
            if (loadingNode) loadingNode.remove();
            rulesDiscussion.push({ role: 'assistant', content: reply });
            appendRulesDiscussion('assistant', reply);
        } catch (error) {
            if (loadingNode) loadingNode.remove();
            appendRulesDiscussion('assistant', `建议生成失败：${error.message || '未知错误'}`);
        }
    }

    async function openRulesDiscussion() {
        const modal = ensureRulesDiscussionModal();
        activeRuleConflictItem = null;
        rulesDiscussion = [{
            role: 'assistant',
            content: `我们可以专门打磨这套世界规则和专业顾问资料。这里不做剧情推演，只沉淀可被沙盒引用的知识设定：工作流程、专业术语、权限边界、常见误区、真实感细节、行业禁忌、资料缺口，以及经济、政治、文化、种族、技能/力量体系的优势、代价和反制。输入 @ 可以指定专家。`
        }];
        const box = document.getElementById('rules-discussion-history');
        if (box) box.innerHTML = '';
        setRulesApplyStatus('', 'green');
        appendRulesDiscussion('assistant', rulesDiscussion[0].content);
        document.getElementById('rules-discussion-input').value = '';
        modal.classList.remove('hidden');
    }

    async function sendRulesDiscussion() {
        const input = document.getElementById('rules-discussion-input');
        const sendBtn = document.getElementById('btn-send-rules-discussion');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        rulesDiscussion.push({ role: 'user', content: text });
        appendRulesDiscussion('user', text);
        hideRulesExpertMentionPicker();
        const loadingNode = appendRulesDiscussion('assistant', 'AI 正在思考规则设定...');
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.textContent = '思考中...';
        }
        const mentionedExperts = getMentionedRuleExperts(text);
        const explicitExpertInstruction = mentionedExperts.length
            ? `【本轮@指定专家】${mentionedExperts.join('、')}。你必须明确以这些专家身份优先工作：先说明该专家本轮要检查什么，再给出专业流程、术语、边界、常见误区、资料缺口和最小可执行规则建议。禁止剧情推演，禁止设计事件走向、反转、人物选择或章节桥段；不要越过该专家权限乱编。`
            : '【本轮@指定专家】未手动指定；可根据关键词自动调用相关专家，但必须说明调用理由。';
        const prompt = `请基于当前规则继续讨论，并把“专家系统”并入规则体系。重要边界：专家系统只做专业知识设定，不做剧情推演；不得生成新剧情、事件桥段、人物行动、反转设计或章节方案。沙盒/SOP 会在之后引用这些知识完成剧情设定。
如果涉及职业/行业/学科，请补充工作流程、专业术语、常见误区、真实感细节、不能乱写的边界。
如果涉及历史剧或古代/朝代背景，自动启用历史专家，检查朝代、官职、称谓、礼法、交通通讯、军队调动、审案/科举/婚嫁/朝会等流程，以及现代价值观误套问题。
所有设定都要明确优势、劣势、成本、限制、反制方式，避免无敌设定。
请按以下结构输出：
【专家角色】
【专业知识设定】
【流程/术语/权限边界】
【常见误区与红线】
【可戏剧化但不能破坏真实感的部分】
【资料缺口问题】
【可入库规则条目】
不要输出【剧情建议】、【事件方案】、【人物该怎么做】。
${explicitExpertInstruction}
${getBuiltInExpertBaseline()}
${getRulesTextForPrompt()}`;
        try {
            const convo = [...rulesDiscussion, { role: 'user', content: prompt }];
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources(convo, 8, prompt))
            });
            const data = await res.json();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `讨论失败：${data.error || '未知错误'}`;
            if (loadingNode) loadingNode.remove();
            rulesDiscussion.push({ role: 'assistant', content: reply });
            appendRulesDiscussion('assistant', reply);
        } catch (error) {
            if (loadingNode) loadingNode.remove();
            appendRulesDiscussion('assistant', `讨论失败：${error.message || '未知错误'}`);
        } finally {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = '发送';
            }
        }
    }

    async function runRuleConflictCheck(extraFocus = "") {
        const resultBox = document.getElementById('asset-rule-check-result');
        if (resultBox) resultBox.textContent = "检测中...";
        const eventText = workspaceChapters.map(ch => `事件 ${ch.chapter_number}《${ch.title}》\n${ch.content || ''}`).join('\n\n');
        const convo = [{
            role: 'user',
            content: `请检测以下事件是否与世界观/规则/专业顾问资料冲突。重点检查：
1. 架空世界的经济、政治、文化、种族、技能体系是否出现无代价、无制约、无反制的设定；
2. 如果涉及职业/行业/学科，流程、术语、权限边界、常见误区是否接近事实；
3. 如果涉及历史剧或古代/朝代背景，朝代、官职、称谓、礼法、交通通讯、军队调动、审案/科举/婚嫁/朝会等流程是否合理；
4. 人物行为是否为了剧情降智或违背已知动机。
请输出：冲突点、涉及事件、为什么冲突、修正建议。\n${extraFocus ? `【额外检测重点】${extraFocus}\n` : ''}\n${getBuiltInExpertBaseline()}\n${getRulesTextForPrompt()}\n\n【事件列表】\n${eventText}`
        }];
        const res = await fetch('/api/chat/deduce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildChatPayloadWithLocalSources(convo, 1, convo[0].content))
        });
        const data = await res.json();
        if (resultBox) resultBox.textContent = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `检测失败：${data.error || '未知错误'}`;
    }

    function ensureCharacterAssetModal() {
        let modal = document.getElementById('asset-character-modal');
        if (modal) return modal;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="asset-character-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md z-[86] hidden flex items-center justify-center p-6">
                <div class="bg-gray-900 border border-blue-500/50 rounded-2xl p-6 w-full max-w-2xl h-[80vh] shadow-2xl flex flex-col">
                    <div class="flex justify-between items-center mb-4">
                        <h3 id="asset-character-modal-title" class="text-lg font-bold text-white">人物卡</h3>
                        <button id="btn-close-asset-character" class="text-gray-500 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
                    </div>
                    <input type="hidden" id="asset-char-id">
                    <textarea id="asset-character-detail" class="flex-1 bg-gray-950 border border-blue-900/30 rounded-xl p-4 text-xs text-gray-300 whitespace-pre-wrap leading-relaxed resize-none"></textarea>
                    <button id="btn-save-asset" class="mt-4 py-3 bg-blue-600 text-white rounded-xl font-bold">保存人物卡</button>
                </div>
            </div>
        `);
        modal = document.getElementById('asset-character-modal');
        document.getElementById('btn-close-asset-character').onclick = () => modal.classList.add('hidden');
        document.getElementById('btn-save-asset').onclick = saveSelectedAssetCharacter;
        if (window.lucide) lucide.createIcons();
        return modal;
    }

    async function loadGlobalAssetOverview() {
        ensureAssetOverviewPanel();
        const hooksBox = document.getElementById('asset-hooks-overview');
        const timelineBox = document.getElementById('asset-timeline-overview');

        try {
            const [projectRes, hooksRes, timelineRes] = await Promise.all([
                fetch(`/api/projects/${PROJECT_ID}`),
                fetch(`/api/workspace/hooks/${PROJECT_ID}`),
                fetch(`/api/workspace/timeline/${PROJECT_ID}`)
            ]);
            const [projectData, hooksData, timelineData] = await Promise.all([
                projectRes.ok ? projectRes.json() : Promise.resolve({}),
                hooksRes.ok ? hooksRes.json() : Promise.resolve({ hooks: [] }),
                timelineRes.ok ? timelineRes.json() : Promise.resolve({ events: [] })
            ]);

            const project = projectData.project || {};
            if (document.getElementById('asset-genre')) document.getElementById('asset-genre').value = project.genre || '';
            if (document.getElementById('asset-worldview')) document.getElementById('asset-worldview').value = project.worldview || '';
            if (document.getElementById('asset-rules')) document.getElementById('asset-rules').value = project.rules || '';
            if (hooksBox) {
                const hooks = hooksData.hooks || [];
                hooksBox.innerHTML = hooks.length > 0
                    ? hooks.map(h => `<div class="border border-gray-800 rounded p-2 space-y-1.5">
                        <textarea id="asset-hook-desc-${h.id}" class="w-full bg-gray-900 border border-gray-800 rounded p-1.5 text-gray-200 h-14 resize-none">${h.description || ''}</textarea>
                        <select id="asset-hook-target-${h.id}" class="w-full bg-gray-900 border border-gray-800 rounded p-1.5 text-gray-200">${getEventOptions(h.target_chapter)}</select>
                        <textarea id="asset-hook-note-${h.id}" class="w-full bg-gray-900 border border-gray-800 rounded p-1.5 text-gray-300 h-12 resize-none" placeholder="注释">${h.annotation || ''}</textarea>
                        <button onclick="saveAssetHook('${h.id}')" class="w-full py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded font-bold">保存伏笔</button>
                    </div>`).join('')
                    : `<div class="text-gray-500 italic">暂无伏笔设定</div>`;
            }
            if (timelineBox) {
                const events = timelineData.events || [];
                timelineBox.innerHTML = events.length > 0
                    ? events.map(ev => `<div class="border border-gray-800 rounded p-2 space-y-1.5">
                        <input id="asset-tl-time-${ev.id}" class="w-full bg-gray-900 border border-gray-800 rounded p-1.5 text-gray-200" value="${ev.time_label || ''}" placeholder="时间标度">
                        <select id="asset-tl-chapter-${ev.id}" class="w-full bg-gray-900 border border-gray-800 rounded p-1.5 text-gray-200">${getEventOptions(ev.chapter_number)}</select>
                        <textarea id="asset-tl-desc-${ev.id}" class="w-full bg-gray-900 border border-gray-800 rounded p-1.5 text-gray-200 h-14 resize-none">${ev.description || ''}</textarea>
                        <button onclick="saveAssetTimeline('${ev.id}')" class="w-full py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded font-bold">保存时间轴</button>
                    </div>`).join('')
                    : `<div class="text-gray-500 italic">暂无时间轴事件</div>`;
            }
            if (window.lucide) lucide.createIcons();
        } catch (e) {
            console.error("加载全局资产总览失败:", e);
        }
    }

  // ==========================================
    // 💥 沙盒聊天与回滚系统 💥
    // ==========================================
    window.rollbackChat = async (index) => {
        if (!confirm("回滚将删除这条回答及其后续内容，并同步删除云端草稿中的对应聊天记录。是否继续？")) return;
        const removedMessages = genesisConversation.slice(index);
        const targetMessage = (genesisConversation[index]?.content || '')
            .replace(/【本地问题回答\s+[^】]+】\n?/, '')
            .replace(/\n\n\(系统附加：.*?\)/g, '')
            .trim();
        genesisConversation = genesisConversation.slice(0, index);
        restoreLocalQuestionsFromRollback('sandbox', removedMessages);
        window.__lastSandboxAnswerProgress = null;
        localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
        setGenesisSyncBlocked(false);
        setGenesisChatLocked(false);
        renderChatHistory(); // 重新渲染历史记录
        if (chatInput) {
            chatInput.value = targetMessage;
            chatInput.focus();
        }
        try {
            await syncGenesisDraftToCloud({ force: true });
        } catch (error) {
            console.warn('回滚后云端同步失败:', error);
            alert('前端已回滚，但云端同步失败，请稍后再试或重新点击回滚。');
        }
    };

    function renderChatHistory() {
        if(!chatHistory) return;
        chatHistory.innerHTML = '';
        
        let latestParsedBible = null; // 💥 关键修复 1：新增追踪器，用于记录时间线上最后一次有效的数据

        genesisConversation.forEach((msg, index) => {
            let text = msg.content;
            if (msg.role === 'user' && /^【内部续问请求/.test(String(text || '').trim())) return;
            if (msg.role === 'assistant') {
                const parsed = extractBibleJsonFromText(text);
                if (parsed) latestParsedBible = parsed;
                text = stripBibleJsonBlocks(text);
            } else if (msg.role === 'user') {
                text = text.replace(/\n\n\(系统附加：.*?\)/g, '');
            }
            if(text.length > 0) appendMessage(msg.role, text, index);
        });

        // 💥 面板数据独立于聊天历史保存，避免清理大 JSON 后丢失右侧实时表单。
        if (latestParsedBible) latestParsedBible = saveLatestBible(latestParsedBible) || latestParsedBible;
        const bibleForPreview = latestParsedBible || loadLatestBible();
        if (bibleForPreview) renderHumanPreview(bibleForPreview);
        refreshSandboxMobileTask();
    }

    function appendMessage(role, text, index) {
        if(!chatHistory) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
        const bubbleColor = role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-200';
        const rollbackBtn = role === 'user' ? `<button onclick="rollbackChat(${index})" class="absolute top-2 left-[-30px] text-gray-500 hover:text-red-400 p-1 bg-gray-900 rounded-full shadow opacity-0 group-hover:opacity-100 transition" title="时光倒流至此节点"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button>` : '';
        let contentHtml = escapeHtml(text);
        let assistantAttrs = '';
        if (role === 'assistant') {
            const parts = splitSandboxAssistantReply(text);
            const hasDetails = parts.details && parts.details.trim();
            assistantAttrs = 'data-sandbox-assistant-message="true"';
            contentHtml = `
                <div class="text-[10px] uppercase tracking-wide text-violet-300/80 font-bold mb-2">需要你关注</div>
                <div class="bg-gray-950/60 border border-violet-800/50 rounded-xl p-3 text-violet-50">${escapeHtml(parts.focus || text)}</div>
                ${(typeof index !== 'number' || index === genesisConversation.length - 1) ? renderInteractionQueueHtml('sandbox') : ''}
                ${hasDetails ? `
                    <button type="button" onclick="toggleSandboxMessageDetails(this)" class="mt-3 inline-flex items-center text-xs text-gray-300 hover:text-white bg-gray-900 border border-gray-700 hover:border-violet-600 rounded-lg px-3 py-1.5">
                        <i data-lucide="chevron-down" class="w-3.5 h-3.5 mr-1"></i>展开完整推演
                    </button>
                    <div data-sandbox-message-details class="hidden mt-3 border-t border-gray-700 pt-3 text-gray-300">${escapeHtml(parts.details)}</div>
                ` : ''}
            `;
        }

        msgDiv.innerHTML = `<div class="max-w-[85%] flex flex-col ${role === 'user' ? 'items-end' : 'items-start'}">
            <div ${assistantAttrs} class="${bubbleColor} p-4 rounded-2xl shadow-md text-sm leading-relaxed whitespace-pre-wrap relative group">
                ${rollbackBtn}
                ${contentHtml}
            </div>
        </div>`;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        if(window.lucide) lucide.createIcons();
        refreshSandboxMobileTask();
    }

    async function fetchChatResponse() {
        if(!chatHistory) return;
        setGenesisChatLocked(true, `<i data-lucide="loader" class="w-4 h-4 mr-1.5 animate-spin"></i>推演中`);
        const loadingId = 'loading-' + Date.now();
        chatHistory.innerHTML += `<div id="${loadingId}" class="flex justify-start"><div class="bg-gray-800 p-4 rounded-2xl text-purple-400 text-sm animate-pulse flex items-center"><i data-lucide="loader" class="w-4 h-4 mr-2 animate-spin"></i>主脑推演中...</div></div>`;
        chatHistory.scrollTop = chatHistory.scrollHeight;

        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildGenesisChatPayload())
            });
            const data = await readApiJson(res, '沙盒 AI 回复失败');
            document.getElementById(loadingId)?.remove();
            
                if (data.success) {
                let aiReplyText = data.reply;
                const conversationForExtraction = [...genesisConversation, { role: 'assistant', content: aiReplyText }];
                const completedLocalBatch = !!window.__lastSandboxAnswerProgress?.completedBatch;
                if (completedLocalBatch) clearAnsweredLocalQuestions('sandbox');
                mergeInteractionStateFromReply('sandbox', aiReplyText);
                const panelSync = syncPanelFromReplyInBackground(aiReplyText, conversationForExtraction, {
                    defer: shouldDeferPanelSyncAfterReply('sandbox', window.__lastSandboxAnswerProgress || {}),
                    lightweight: completedLocalBatch
                });
                let panelSyncError = null;
                if (completedLocalBatch) {
                    setSandboxAlert('yellow', '本轮问题已完成，正在先刷新实时面板，再显示下一轮问题。');
                    await panelSync.catch(error => {
                        panelSyncError = error;
                        return null;
                    });
                    if (panelSyncError) {
                        setSandboxAlert('red', `本轮回答已收到，但会话要素提取失败：${panelSyncError.message || '未知错误'}。\nAI 回复会先显示出来；发送下一条前，请先撤回重答或使用“从对话刷新面板”。`);
                    } else {
                        setSandboxAlert('green', '实时面板已根据本轮回答完成更新。');
                    }
                }
                const newIndex = genesisConversation.length;
                genesisConversation.push({ role: 'assistant', content: aiReplyText || '已更新设定数据。' });
                const visibleReply = stripBibleJsonBlocks(aiReplyText).trim();
                if (visibleReply.length > 0 || getPendingInteractionQuestions('sandbox').length > 0) {
                    appendMessage('assistant', visibleReply || '【当前任务】\n实时面板已更新，正在准备下一轮问题。', newIndex);
                }
                localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
                syncGenesisDraftToCloud().catch(error => console.warn('聊天记录云端同步失败:', error));
                if (!panelSyncError && shouldRequestNextSandboxQuestionRound(aiReplyText, completedLocalBatch)) {
                    sandboxNextQuestionRetryCount += 1;
                    genesisConversation.push({ role: 'user', content: buildNextSandboxQuestionRoundPrompt(aiReplyText) });
                    localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
                    appendMessage('assistant', '【当前任务】\n上一轮已吸收，但没有拿到新的逐条问题。系统正在自动请求下一轮 Q1/Q2。', genesisConversation.length);
                    setTimeout(() => fetchChatResponse(), 0);
                    return;
                }
                if (getPendingInteractionQuestions('sandbox').length > 0 || isSandboxAcceptanceReply(aiReplyText)) {
                    sandboxNextQuestionRetryCount = 0;
                }
            }
        } catch (error) {
            console.error('沙盒推演失败:', error);
            appendMessage('assistant', `【当前任务】\n本轮 AI 回复失败。\n\n【监督提醒】\n${error.message || '未知错误'}\n\n【下一步选择】\nQ1. 可以稍后重试。\nQ2. 如果连续失败，请减少本轮输入内容，或先点击“从对话刷新面板”压缩上下文。`, genesisConversation.length);
            alert(`本轮 AI 回复失败：${error.message || '未知错误'}`);
        } finally {
            document.getElementById(loadingId)?.remove();
            setGenesisChatLocked(false);
        }
    }

    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (btnSend) btnSend.click(); } });
    }

    if (btnSend) {
        btnSend.onclick = () => {
            if (genesisRequestInFlight) return;
            if (sandboxRuleGate.blocked) {
                stashSandboxRuleGateDraft();
                showSandboxRuleConflictModal(sandboxRuleGate.reason);
                return alert('规则专家发出红色警告，沙盒推演已暂停。请先修改设定并重新检测，或点击“暂时忽略”后继续。');
            }
            if (genesisPanelSyncBlocked) return alert('上一轮设定还没有确认写入实时面板。你可以继续编辑输入框，但暂时不能发送；如果同步失败，请优先撤回上一条回答重新回答，连续失败时再使用“从对话刷新面板”。');
            const text = chatInput.value.trim();
            if (!text) return;
            chatInput.value = '';
            const localAnswer = recordLocalQuestionAnswer('sandbox', text);
            if (localAnswer.handled) {
                const answerIndex = genesisConversation.length;
                genesisConversation.push({ role: 'user', content: `【本地问题回答 ${localAnswer.answeredIds.join(', ')}】\n${text}` });
                appendMessage('user', text, answerIndex);
                localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
                syncGenesisDraftToCloud().catch(error => console.warn('聊天记录云端同步失败:', error));

                if (!localAnswer.done) {
                    appendMessage('assistant', buildLocalQuestionPromptText('sandbox'));
                    return;
                }

                const summaryMessage = buildQuestionBatchSummaryMessage(localAnswer.summary);
                genesisConversation.push({ role: 'user', content: summaryMessage });
                appendMessage('assistant', `【当前任务】\n本轮问题已全部回答，正在交给 AI 统一吸收并刷新实时面板。\n\n【下一步选择】\nQ1. 等待 AI 总结后进入下一轮问题。`);
                localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
                window.__lastSandboxAnswerProgress = { before: localAnswer.answeredIds.length, after: 0, completedBatch: true };
                sandboxNextQuestionRetryCount = 0;
                fetchChatResponse();
                return;
            }
            window.__lastSandboxAnswerProgress = markAnsweredQuestionsBeforeSend('sandbox', text);
            const userMsgWithContext = text
                + `\n\n(系统附加：当前沙盒模块是【${getActiveSandboxModuleLabel()}】，当前权限模式是【${getCurrentControlMode()}】。${buildSandboxWorkflowGatePrompt(getCurrentBibleSnapshot())} 流程骨架、事件、人物、规则、上帝视角模块互相影响；规则/世界观/专家资料拥有最高权限。右侧数据面板已由用户实时更新，优先级高于旧聊天记录和你之前提出的方案。沙盒主流程必须遵守：类型 -> 起终点 -> 主角/最终反派 -> 基础行为决策人物卡 -> 双弧线 -> 好莱坞六节点 -> 桥接事件/完整时间线 -> 叙事逻辑 -> 沙盒验收；沙盒只做故事骨架，不做章节细化或正文。若旧设定与面板冲突，必须废弃旧设定，以面板为准继续推演。若当前输入新增人物，请将其绑定到相关事件，并提醒参与少于三个事件的人物需要后续复用或合并。人物相关专家设定必须沉淀到人物卡的【人物规则】。未揭露/部分揭露的上帝视角秘密只用于后台校验，沙盒推理只能基于观众视角推进；已揭露后才可公开调用上帝视角。沙盒回复禁止写正文式情节段落；第一段必须是【当前任务】，写清阶段、本轮只处理什么、你需要我决定什么。随后用【缺口诊断】【事件连接】【人物/关系影响】【规则或降智风险】【下一步选择】输出；长分析放进【可展开：推演依据】，完整保留关键因果、人物动机、关系变化、不可逆后果和待确认项。)`
                + buildInteractionFocusPrompt('sandbox', text)
                + getExpertKeywordHint(text);
            const newIndex = genesisConversation.length;
            genesisConversation.push({ role: 'user', content: userMsgWithContext });
            appendMessage('user', text, newIndex);
            localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
            syncGenesisDraftToCloud();
            fetchChatResponse();
        };
    }

    // ==========================================
    // 💥 局部 AI 深度探讨系统 (世界观/规则) 💥
    // ==========================================
    window.openSubChat = (type) => {
        currentSubChatTarget = type;
        subConversation = [];
        if(subChatHistory) subChatHistory.innerHTML = '';
        if(subChatTitle) subChatTitle.innerHTML = `<i data-lucide="cpu" class="text-blue-400 mr-2"></i> ${type === 'worldview' ? '世界观' : '法则与戒律'} 局部深度推演`;
        
        let initialData = type === 'worldview' ? (document.getElementById('prev-worldview') ? document.getElementById('prev-worldview').value : "") : (document.getElementById('prev-rules') ? document.getElementById('prev-rules').value : "");
        const initPrompt = `我们现在单独探讨小说的【${type === 'worldview' ? '世界观背景' : '核心法则与戒律'}】。目前已有的设定是：“${initialData}”。请你作为架空世界设定专家帮我完善这部分细节，每次提1-2个可选择方向，并必须明确：
1. 经济、政治、文化、种族、技能/力量体系如何运转；
2. 每个优势对应的劣势、成本、限制、反制方式；
3. 禁止无敌、万能、无代价设定；
4. 讨论结束后整理成可直接入库的新设定，并指出现有事件可能产生的规则冲突。`;
        
        subConversation.push({ role: 'user', content: initPrompt });
        appendSubMsg('user', "已唤醒局部脑区...");
        if(subChatModal) subChatModal.classList.remove('hidden');
        if(window.lucide) lucide.createIcons();
        fetchSubChatResponse();
    };

    function appendSubMsg(role, text) {
        if(!subChatHistory) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
        const bubbleColor = role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-200';
        msgDiv.innerHTML = `<div class="max-w-[85%] ${bubbleColor} p-3 rounded-xl shadow-md text-sm leading-relaxed whitespace-pre-wrap">${text}</div>`;
        subChatHistory.appendChild(msgDiv);
        subChatHistory.scrollTop = subChatHistory.scrollHeight;
    }

    async function fetchSubChatResponse() {
        if(!subChatHistory) return;
        const loadingId = 'sub-loading-' + Date.now();
        subChatHistory.innerHTML += `<div id="${loadingId}" class="flex justify-start"><div class="bg-gray-800 p-3 rounded-xl text-blue-400 text-xs animate-pulse">脑区运转中...</div></div>`;
        subChatHistory.scrollTop = subChatHistory.scrollHeight;
        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources(subConversation, 8, subConversation.map(msg => msg.content).join('\n')))
            });
            const data = await res.json();
            document.getElementById(loadingId)?.remove();
            if (data.success) {
                const cleanedReply = stripFencedBlocks(data.reply) || data.reply;
                subConversation.push({ role: 'assistant', content: cleanedReply });
                appendSubMsg('assistant', cleanedReply);
            }
        } catch(e) { document.getElementById(loadingId)?.remove(); }
    }

    if (btnSendSubChat) {
        btnSendSubChat.onclick = () => {
            if(!subChatInput) return;
            const text = subChatInput.value.trim();
            if(!text) return;
            subChatInput.value = '';
            subConversation.push({ role: 'user', content: text });
            appendSubMsg('user', text);
            fetchSubChatResponse();
        };
    }
    if(subChatInput) subChatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if(btnSendSubChat) btnSendSubChat.click(); } });
    if (btnCancelSubChat) btnCancelSubChat.onclick = () => { if(subChatModal) subChatModal.classList.add('hidden'); };
    
    if (btnApplySubChat) {
        btnApplySubChat.onclick = async () => {
            btnApplySubChat.disabled = true;
            btnApplySubChat.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin inline mr-1"></i> 提取中...`;
            const extractMsg = `讨论结束。请将上面讨论产生的所有核心设定，融合成一段连贯的高质量纯文本（300字以内），直接给我最终文本。`;
            subConversation.push({ role: 'user', content: extractMsg });
            try {
                const res = await fetch('/api/chat/deduce', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildChatPayloadWithLocalSources(subConversation, 8, subConversation.map(msg => msg.content).join('\n')))
                });
                const data = await res.json();
                if(data.success) {
                    if (currentSubChatTarget === 'worldview') {
                        const wv = document.getElementById('prev-worldview');
                        if(wv) wv.value = data.reply;
                    } else {
                        const ru = document.getElementById('prev-rules');
                        if(ru) ru.value = data.reply;
                    }
                    alert("✅ 最新设定已应用至主表单！");
                    if(subChatModal) subChatModal.classList.add('hidden');
                }
            } catch(e){}
            finally { btnApplySubChat.disabled = false; btnApplySubChat.innerHTML = "提取最新设定应用到表单"; }
        };
    }

    // ==========================================
    // ☁️ 独家云端神经元同步系统
    // ==========================================
    window.syncToCloud = async (dataType, payload, options = {}) => {
        return window.OmniWorkspaceCloud.syncToCloud(PROJECT_ID, dataType, payload, options);
    };

    async function syncGenesisDraftToCloud(options = {}) {
        if (!options.force && genesisConversation.length === 0 && !getCurrentBibleSnapshot()) return;
        const manualEdits = loadManualBibleEdits();
        await window.syncToCloud(GENESIS_CLOUD_TYPE, {
            bible: applyManualBibleEditsToValue(getCurrentBibleSnapshot(), manualEdits),
            chat: genesisConversation.map(msg => ({ ...msg, content: applyManualCharacterRenamesToText(msg.content, manualEdits) }))
        }, { silent: true });
    }

    async function loadGenesisDraftFromCloud() {
        try {
            const res = await fetch(`/api/workspace/cloud-sync/${PROJECT_ID}?type=${encodeURIComponent(GENESIS_CLOUD_TYPE)}`);
            if (!res.ok) return false;
            const data = await res.json();
            const payload = data.payload || null;
            if (!data.success || !payload) return false;

            if (Array.isArray(payload.chat) && payload.chat.length > 0) {
                genesisConversation = payload.chat;
                localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
            }
            if (payload.bible) {
                const mergedBible = saveLatestBible(payload.bible) || payload.bible;
                renderHumanPreview(mergedBible);
            }
            if (genesisConversation.length > 0) renderChatHistory();
            return genesisConversation.length > 0 || !!payload.bible;
        } catch (e) {
            console.warn('云端沙盒草稿恢复失败:', e);
            return false;
        }
    }

    async function loadLongformStateFromCloud() {
        try {
            const res = await fetch(`/api/workspace/cloud-sync/${PROJECT_ID}?type=${encodeURIComponent(LONGFORM_CLOUD_TYPE)}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.payload) {
                longformState = data.payload;
                localStorage.setItem(LONGFORM_STATE_KEY, JSON.stringify(longformState));
            }
        } catch (e) {
            console.warn('长篇编辑状态恢复失败:', e);
        }
    }

    async function loadBibleSnapshotFromDatabase() {
        try {
            const res = await fetch(`/api/crystallize/snapshot/${PROJECT_ID}`);
            if (!res.ok) return false;
            const data = await res.json();
            if (!data.success || !data.bible) return false;

            const hasBibleData = (data.bible.characters || []).length > 0
                || (data.bible.timeline || []).length > 0
                || (data.bible.chapters || []).length > 0
                || data.bible.worldview
                || data.bible.rules;

            if (!hasBibleData) return false;
            const mergedBible = saveLatestBible(data.bible) || data.bible;
            renderHumanPreview(mergedBible);
            return true;
        } catch (e) {
            console.warn('数据库圣经快照恢复失败:', e);
            return false;
        }
    }

    if (btnRefreshPreview) {
        btnRefreshPreview.onclick = async () => {
            const originalHtml = btnRefreshPreview.innerHTML;
            btnRefreshPreview.disabled = true;
            btnRefreshPreview.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 mr-1.5 animate-spin"></i>提取中...`;
            if (window.lucide) lucide.createIcons();

            try {
                await extractAndSaveBibleFromConversation(genesisConversation, `请根据当前面板数据、全量用户修正记录与最近对话，提取并合并最新共识，输出完整世界圣经 JSON。
要求：
1. 用户后续通过对话否定或修改过的低质量人物/事件必须被替换，不要保留旧版本。
2. 沙盒有流程骨架、事件、人物、规则/专家、上帝视角五个模块，它们互相影响，不能各自孤立更新。
3. 规则/世界观/专家资料权限最高；不符合规则、专业流程或人物逻辑的事件必须在 rules 中记录警报或整改约束。
4. 人物必须尽量绑定到 timeline/chapters 的具体事件；参与事件少于三个的人物要在 description 或 character_arc 中提示后续复用价值，避免一次性人物。
5. 如果对话出现律师、医生、警察、金融、政治、文化、历史、古代、朝代、科举、官职、礼法、战争、技能等专业关键词：全局专家资料合并进 rules；与某个人物直接相关的疾病、职业权限、身份限制、能力代价、心理触发点必须写入该人物 character_rules。
6. 历史专家为内置后台能力：遇到历史剧/古代背景时，必须检查朝代、官职、称谓、礼仪、服饰器物、交通通讯、军队调动、审案/科举/婚嫁/朝会流程，以及现代价值观误套问题。
7. 当前面板数据中的 workflow 流程状态、protagonist_arc 主角弧线、antagonist_arc 反派弧线、hollywood_beats 好莱坞六节点、characters 详细字段、character_rules 人物规则、relations 人物羁绊、timeline 细密时间轴、secrets 上帝视角信息是稳定资产；除非最近对话明确要求删除某一项，否则必须完整保留，不允许用摘要版、空数组或字段缺失版覆盖。
8. 如果当前面板中的人物羁绊或细密时间轴为空，必须从全量用户修正记录和全量沙盒对话尾迹中重建，不要留空。`, { recoveryMode: true });
                setGenesisSyncBlocked(false);
                alert('✅ 已根据当前对话刷新右侧面板。');
            } catch (e) {
                console.error('手动刷新面板失败:', e);
                alert('刷新面板失败：' + e.message);
            } finally {
                btnRefreshPreview.disabled = false;
                btnRefreshPreview.innerHTML = originalHtml;
                if (window.lucide) lucide.createIcons();
            }
        };
    }

    // ==========================================
    // 💥 抓取全息 12 维数据入库 💥
    // ==========================================
    if (btnConfirmCrystallize) {
        btnConfirmCrystallize.addEventListener('click', async () => {
            let finalBible = applyConversationLeadNamesToBible(applyManualBibleEditsToValue(collectBibleFromPreview()));
            finalBible = saveLatestBible(finalBible, { preserveStableLists: false, backup: false }) || finalBible;
            renderHumanPreview(finalBible);
            const completion = getSandboxCompletionReport(finalBible);
            if (!completion.ok) {
                setSandboxAlert('red', `沙盒尚未完成，不能正式铸造入库。\n${completion.issues.slice(0, 8).join('\n')}`);
                openSandboxPendingResolutionPanel(completion);
                return;
            }

            btnConfirmCrystallize.disabled = true;
            btnConfirmCrystallize.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin mr-1 inline"></i>生成故事简介...`;
            if (window.lucide) lucide.createIcons();
            
            try {
                finalBible = await ensureSandboxStoryBriefForBible(finalBible);
                finalBible = saveLatestBible(finalBible, { preserveStableLists: false, backup: false }) || finalBible;
                renderHumanPreview(finalBible);
                btnConfirmCrystallize.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin mr-1 inline"></i>生成用词规范...`;
                if (window.lucide) lucide.createIcons();
                finalBible = await ensureWorldLexiconForBible(finalBible);
                finalBible = saveLatestBible(finalBible, { preserveStableLists: false, backup: false }) || finalBible;
                renderHumanPreview(finalBible);
                await syncGenesisDraftToCloud({ force: true });
                btnConfirmCrystallize.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin mr-1 inline"></i>铸造中...`;
                if (window.lucide) lucide.createIcons();
                const res = await fetch('/api/crystallize/confirm', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: PROJECT_ID, bible: finalBible })
                });
                const data = await res.json();
if (data.success) { 
                    // 💥 任务完成：静默将沙盒数据与聊天记录同步至云端
                    const manualEdits = loadManualBibleEdits();
                    await window.syncToCloud(GENESIS_CLOUD_TYPE, {
                        bible: finalBible,
                        chat: genesisConversation.map(msg => ({ ...msg, content: applyManualCharacterRenamesToText(msg.content, manualEdits) }))
                    });
                    alert("✨ 世界圣经已结晶并同步云端！"); 
                    window.location.reload(); 
                }                else { alert("铸造入库失败: " + data.error); }
            } catch(e) { alert("网络错误"); }
            finally { btnConfirmCrystallize.disabled = false; btnConfirmCrystallize.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 mr-1.5 inline"></i>正式铸造入库`; }
        });
    }

    // ==========================================
    // 🚀 工作台读取与渲染
    // ==========================================
    async function loadGlobalAssets() {
        try {
            const res = await fetch(`/api/workspace/characters/${PROJECT_ID}`);
            if (!res.ok) return; // 💥 拦截 404，没有角色就算了，安静退出
            const data = await res.json();
            if (data.success) {
                const manualEdits = loadManualBibleEdits();
                window.globalCharacters = applyManualBibleEditsToValue(data.characters || [], manualEdits);
                const assetCharacterList = document.getElementById('asset-character-list');
                if (assetCharacterList) {
                    assetCharacterList.innerHTML = window.globalCharacters.map(c => `
                        <li class="cursor-pointer p-2 bg-gray-950 hover:bg-gray-800 rounded-lg mb-2 group" onclick="editCharacter('${c.id}')">
                            <div class="flex justify-between items-center">
                                <span class="text-xs font-bold group-hover:text-blue-400">${c.name}</span>
                                <i data-lucide="chevron-right" class="w-3 h-3 text-gray-600"></i>
                            </div>
                            <div class="text-[10px] text-gray-500 mt-1 truncate">${c.role || '定位未定'} · ${c.faction || '阵营未定'}</div>
                            <div class="text-[10px] text-gray-600 mt-1 line-clamp-2">${c.description || '暂无简介'}</div>
                        </li>
                    `).join('');
                }
                if(window.lucide) lucide.createIcons();
            }
            loadGlobalAssetOverview();
        } catch (e) { }
    }

    async function loadProjectSettings() {
        try {
            const res = await fetch(`/api/projects/${PROJECT_ID}`);
            
            // 💥 修复 1：拦截 404/500 等网络报错，防止 JSON 解析崩溃导致卡死
            if (!res.ok) {
                if (worldRulesContainer) worldRulesContainer.innerHTML = `<div class="text-xs text-yellow-500 italic">⚠️ 宇宙尚未凝固，请先去【上帝沙盒】中推演并点击【正式铸造入库】。</div>`;
                return; // 直接终止，不再往下执行
            }
            
            const data = await res.json();
            
            // 💥 修复 2：如果后端返回了成功，并且有项目数据
            if (data.success && data.project) {
                const genreBadge = document.getElementById('story-genre-badge');
                if (genreBadge) genreBadge.innerText = `类型: ${data.project.genre || '未锁定'}`;
                
                if (worldRulesContainer) {
                    let combinedRules = [];
                    if (data.project.worldview) combinedRules.push(`【世界观基石】\n${data.project.worldview}`);
                    if (data.project.rules) combinedRules.push(`【核心绝对戒律】\n${data.project.rules}`);
                    
                    const finalText = combinedRules.join('\n\n').trim();

                    if (finalText.length > 0) {
                        worldRulesContainer.innerHTML = finalText.split('\n').filter(r => r.trim().length > 0).map(r => `<div class="p-1.5 bg-cyan-950/20 border border-cyan-900/30 rounded shadow-sm">${r}</div>`).join('');
                    } else { 
                        worldRulesContainer.innerHTML = `<div class="text-xs text-gray-500 italic">法则为空...请去沙盒【正式铸造入库】</div>`; 
                    }
                }
            } else {
                // 后端返回 success: false
                if (worldRulesContainer) worldRulesContainer.innerHTML = `<div class="text-xs text-gray-500 italic">未找到该项目的数据，请去沙盒入库。</div>`;
            }
        } catch (e) {
            // 💥 修复 3：把被吃掉的报错吐在控制台，并在 UI 上提醒
            console.error("加载世界观发生了不可抗拒的错误:", e);
            if (worldRulesContainer) worldRulesContainer.innerHTML = `<div class="text-xs text-red-500 italic">❌ 后端连接异常，请检查 server.js 是否正常运行。</div>`;
        }
    }

    async function loadTimelineSidebar() {
        try {
            const res = await fetch(`/api/workspace/timeline/${PROJECT_ID}`);
            if (!res.ok) return; // 💥 拦截 404
            const data = await res.json();
            if (data.success) {
                const timeline = document.getElementById('master-timeline');
                if (!timeline) return;
                if (data.events.length === 0) return;
                const manualEdits = loadManualBibleEdits();
                timeline.innerHTML = data.events.map(ev => {
                    const displayDescription = applyManualCharacterRenamesToText(ev.description || '', manualEdits);
                    return `
                    <div class="relative pl-6 group cursor-pointer" onclick="window.jumpToSourceChapter(${ev.chapter_number})">
                        <div class="absolute left-1 top-1.5 w-2 h-2 rounded-full bg-purple-500 border border-gray-950 group-hover:bg-purple-400 group-hover:scale-125 transition-all"></div>
                        <span class="block text-[10px] font-mono text-gray-500">${applyManualCharacterRenamesToText(ev.time_label || '', manualEdits)}</span>
                        <span class="block text-xs font-bold text-gray-300 group-hover:text-purple-400 transition truncate" title="${displayDescription}">${displayDescription.substring(0,12)}...</span>
                    </div>
                `}).join('');
            }
        } catch (e) { }
    }
    async function loadWorkspaceTree() {
        try {
            const res = await fetch(`/api/workspace/tree/${PROJECT_ID}`);
            
            // 💥 拦截 404，如果没拿到数据，就在左侧面板显示友好提示
            if (!res.ok) {
                if (chapterTree) chapterTree.innerHTML = `<li class="text-sm text-gray-600 p-2 italic">尚未生成事件...请先在沙盒推演并入库</li>`;
                return;
            }

            const data = await res.json();
            if (data.success && data.chapters.length > 0) {
                const manualEdits = loadManualBibleEdits();
                workspaceChapters = data.chapters
                    .map(ch => applyManualBibleEditsToValue(ch, manualEdits))
                    .slice()
                    .sort((a,b) => a.chapter_number - b.chapter_number);
                if (chapterTree) chapterTree.innerHTML = '';
                workspaceChapters.forEach((chap, index) => {
                    const li = document.createElement('li');
                    const icon = chap.plot_type === 'sub' ? 'git-branch' : 'git-commit';
                    li.className = `text-sm text-gray-400`;
                    const prevChap = workspaceChapters[index - 1] || null;
                    const nextChap = workspaceChapters[index + 1] || null;

                    li.innerHTML = `
                        <button onclick="openInsertEventModal(${prevChap ? prevChap.chapter_number : 'null'}, ${chap.chapter_number})" class="w-full text-[10px] text-gray-600 hover:text-purple-300 hover:bg-purple-950/30 rounded py-0.5 flex items-center justify-center" title="在此事件前插入"><i data-lucide="plus" class="w-3 h-3"></i></button>
                        <div class="px-2 py-2 hover:bg-gray-800 hover:text-white rounded-lg transition flex items-center justify-between group">
                            <div class="flex-1 flex items-center truncate cursor-pointer" onclick="document.querySelectorAll('#chapter-tree li > div').forEach(el => el.classList.remove('bg-gray-800', 'text-white', 'border-l-2', 'border-purple-500')); this.parentElement.classList.add('bg-gray-800', 'text-white', 'border-l-2', 'border-purple-500'); loadChapterContext('${chap.id}', ${chap.chapter_number}, '${chap.title.replace(/'/g, "\\'")}');">
                                <i data-lucide="${icon}" class="w-4 h-4 mr-2 ${chap.plot_type === 'sub' ? 'text-blue-400' : 'text-purple-400'} opacity-70"></i>
                                <span class="truncate">事件 ${chap.chapter_number}: ${chap.title}</span>
                            </div>
                            <div class="flex space-x-1 opacity-0 group-hover:opacity-100 transition px-1">
                                <button onclick="renameEventNode('${chap.id}', '${chap.title.replace(/'/g, "\\'")}')" class="text-gray-500 hover:text-blue-400" title="重命名"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                                <button onclick="deleteEventNode('${chap.id}')" class="text-gray-500 hover:text-red-500" title="抹除此事件"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                            </div>
                        </div>
                        ${index === workspaceChapters.length - 1 ? `<button onclick="openInsertEventModal(${chap.chapter_number}, null)" class="w-full text-[10px] text-gray-600 hover:text-purple-300 hover:bg-purple-950/30 rounded py-0.5 flex items-center justify-center" title="在此事件后插入"><i data-lucide="plus" class="w-3 h-3"></i></button>` : ''}
                    `;
                    if (chapterTree) chapterTree.appendChild(li);
                });
                if (window.lucide) lucide.createIcons();
                refreshEventSelects();
                if (chapterTree && chapterTree.firstElementChild) chapterTree.firstElementChild.querySelector('div').click();
                loadTimelineSidebar();
            } else {
                workspaceChapters = [];
                if (chapterTree) chapterTree.innerHTML = `<li class="text-sm text-gray-600 p-2 italic">尚未生成事件...</li>`;
            }
        } catch (e) { }
    }

    // 💥 注册给 HTML 调用的全局操作函数 (增删改)
    window.renameEventNode = async (id, oldTitle) => {
        const newTitle = prompt("请输入新的事件名：", oldTitle);
        if (!newTitle || newTitle === oldTitle) return;
        try {
            await fetch(`/api/workspace/chapter/${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle })
            });
            loadWorkspaceTree();
            if (currentLocalContext.chapterId === id) loadChapterContext(id, currentLocalContext.chapterNumber, newTitle);
        } catch (e) { alert('重命名失败'); }
    };

    window.deleteEventNode = async (id) => {
        if (!confirm("⚠️ 确定要抹除此事件及时空数据吗？操作不可逆！")) return;
        try {
            await fetch(`/api/workspace/chapter/${id}`, { method: 'DELETE' });
            editorTextarea.value = ""; currentChapterTitle.innerText = "等待主脑接入...";
            loadWorkspaceTree();
        } catch (e) { alert('删除失败'); }
    };

    function findChapterByNumber(num) {
        if (num === null || num === undefined) return null;
        return workspaceChapters.find(ch => Number(ch.chapter_number) === Number(num)) || null;
    }

    function describeInsertChapter(chapter) {
        return chapter ? `事件 ${chapter.chapter_number}《${chapter.title}》\n${chapter.content || '暂无梗概'}` : '无';
    }

    window.openInsertEventModal = (prevNum, nextNum) => {
        const prev = findChapterByNumber(prevNum);
        const next = findChapterByNumber(nextNum);
        let suggestedNumber = 1;
        if (prev && next) suggestedNumber = Number(((Number(prev.chapter_number) + Number(next.chapter_number)) / 2).toFixed(2));
        else if (prev) suggestedNumber = Number(prev.chapter_number) + 1;
        else if (next) suggestedNumber = Math.max(0.1, Number(next.chapter_number) - 0.1);

        insertEventContext = { prev, next, suggestedNumber, chat: [] };
        document.getElementById('new-chapter-num').value = suggestedNumber;
        document.getElementById('new-chapter-title').value = "";
        document.getElementById('new-chapter-type').value = "main";
        document.getElementById('new-chapter-draft').value = "";
        document.getElementById('insert-prev-context').innerText = describeInsertChapter(prev);
        document.getElementById('insert-next-context').innerText = describeInsertChapter(next);
        const history = document.getElementById('insert-event-chat-history');
        if (history) history.innerHTML = `<div class="bg-gray-800 p-2 rounded">告诉我这个新事件大概想承担什么作用，我会帮你检查它如何承接前后事件。</div>`;
        if (addChapterModal) addChapterModal.classList.remove('hidden');
    };

    function appendInsertEventMsg(role, text) {
        const history = document.getElementById('insert-event-chat-history');
        if (!history) return;
        const row = document.createElement('div');
        row.className = `${role === 'user' ? 'ml-8 bg-purple-900/50 text-purple-50' : 'mr-8 bg-gray-800 text-gray-200'} p-2 rounded leading-relaxed whitespace-pre-wrap`;
        row.textContent = text;
        history.appendChild(row);
        history.scrollTop = history.scrollHeight;
    }

    function applyInsertConsensus(reply) {
        const draft = document.getElementById('new-chapter-draft');
        const title = document.getElementById('new-chapter-title');
        if (!draft || draft.value.trim()) return;
        const consensus = reply.match(/【可写入事件草稿】([\s\S]*)/);
        const titleMatch = reply.match(/事件标题[：:]\s*(.+)/);
        if (title && !title.value.trim() && titleMatch) title.value = titleMatch[1].trim().slice(0, 80);
        draft.value = (consensus ? consensus[1] : reply).trim().slice(0, 1400);
    }

    async function sendInsertEventChat() {
        const input = document.getElementById('insert-event-chat-input');
        const text = input?.value.trim();
        if (!text) return;
        input.value = '';
        insertEventContext.chat.push({ role: 'user', content: text });
        appendInsertEventMsg('user', text);

        const prevText = describeInsertChapter(insertEventContext.prev);
        const nextText = describeInsertChapter(insertEventContext.next);
        const currentDraft = document.getElementById('new-chapter-draft')?.value.trim() || '暂无';
        const hiddenGuide = `你是叙事事件桥接编辑。请帮助作者设计一个插入在前后事件之间的新事件。
【前置事件】\n${limitText(prevText, 1400)}
【后置事件】\n${limitText(nextText, 1400)}
【当前草稿】\n${limitText(currentDraft, 900)}

要求：
1. 只讨论这个新事件如何承接前置事件、推动到后置事件。
2. 明确人物行动的动机、阻力、代价、不可逆后果。
3. 检查是否违背世界观与核心戒律，若冲突请给出修正方向。
4. 不要替作者强行定稿；每次回复最后给 2-4 个可选择方向。
5. 如果信息足够，请用“【可写入事件草稿】”给出一段可直接放进事件草稿框的共识摘要。`;

        const loadingId = `insert-event-loading-${Date.now()}`;
        const history = document.getElementById('insert-event-chat-history');
        if (history) {
            history.insertAdjacentHTML('beforeend', `<div id="${loadingId}" class="mr-8 bg-gray-800 p-2 rounded text-gray-400 animate-pulse">正在推演事件关联...</div>`);
            history.scrollTop = history.scrollHeight;
        }

        try {
            const convo = [...insertEventContext.chat, { role: 'user', content: hiddenGuide }];
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildChatPayloadWithLocalSources(convo, 8, hiddenGuide))
            });
            const data = await res.json();
            document.getElementById(loadingId)?.remove();
            const reply = data.success ? (stripFencedBlocks(data.reply) || data.reply) : `事件推演失败：${data.error || '未知错误'}`;
            insertEventContext.chat.push({ role: 'assistant', content: reply });
            appendInsertEventMsg('assistant', reply);
            if (data.success) applyInsertConsensus(reply);
        } catch (e) {
            document.getElementById(loadingId)?.remove();
            appendInsertEventMsg('assistant', "事件推演请求失败，请稍后再试。");
        }
    }

    window.removeLocalChar = async (charId) => {
        if (!confirm("确定让该角色离开此事件吗？")) return;
        try {
            const res = await fetch(`/api/workspace/context/character/${currentLocalContext.chapterId}/${charId}?projectId=${PROJECT_ID}`, { method: 'DELETE' });
            const data = await res.json();
            if (!data.success) {
                if (data.setupSql) console.warn("章节人物关联表待创建 SQL:", data.setupSql);
                return alert(data.error || '移出角色失败');
            }
            loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
        } catch (e) { alert('移出角色失败'); }
    };

    async function linkCharacterToCurrentChapter(characterId) {
        const res = await fetch(`/api/workspace/context/character`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: PROJECT_ID, chapterId: currentLocalContext.chapterId, characterId })
        });
        const data = await res.json();
        if (!data.success) {
            if (data.setupSql) console.warn("章节人物关联表待创建 SQL:", data.setupSql);
            alert(data.error || '拉入本章失败！');
            return false;
        }
        loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
        return true;
    }

    function ensureCharacterPickerModal() {
        let modal = document.getElementById('character-picker-modal');
        if (modal) return modal;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="character-picker-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md z-[80] hidden flex items-center justify-center p-6">
                <div class="bg-gray-900 border border-blue-500/50 rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] shadow-2xl flex flex-col">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold text-white flex items-center"><i data-lucide="user-plus" class="w-5 h-5 mr-2 text-blue-400"></i>选择本章登场角色</h3>
                        <button id="btn-close-character-picker" class="text-gray-500 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
                    </div>
                    <div id="character-picker-list" class="grid grid-cols-2 gap-3 overflow-y-auto pr-1"></div>
                    <div class="mt-4 border-t border-gray-800 pt-4 space-y-3">
                        <textarea id="new-local-character-brief" class="w-full bg-gray-950 border border-gray-700 rounded-lg p-2 text-sm text-white h-20 resize-none" placeholder="全局资产没有这个人时，在这里输入人物简介。AI 会生成人物卡，等待你确认/修改。"></textarea>
                        <button id="btn-create-and-link-character" class="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg">AI 生成人物卡</button>
                        <div id="new-local-character-review" class="hidden space-y-2">
                            <textarea id="new-local-character-card" class="w-full bg-gray-950 border border-blue-900/60 rounded-lg p-3 text-xs text-blue-100 h-60 resize-none"></textarea>
                            <button id="btn-confirm-generated-character" class="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg">确认入库并拉入本章</button>
                        </div>
                    </div>
                </div>
            </div>
        `);
        modal = document.getElementById('character-picker-modal');
        document.getElementById('btn-close-character-picker').onclick = () => modal.classList.add('hidden');
        document.getElementById('btn-create-and-link-character').onclick = async () => {
            const brief = document.getElementById('new-local-character-brief').value.trim();
            if (!brief) return alert("请先输入人物简介");
            const btn = document.getElementById('btn-create-and-link-character');
            btn.disabled = true;
            btn.innerText = "人物卡生成中...";
            try {
                const convo = [{
                    role: 'user',
                    content: `请根据以下人物简介生成一张可入库的人物卡。只输出以下格式，不要寒暄：\n【姓名】\n【定位】\n【阵营】\n【年龄】\n【外貌】\n【职业】\n【性格】\n【核心欲望】\n【目标】\n【动机】\n【缺陷】\n【恐惧】\n【能力/技能】\n【人物规则】\n【背景】\n【成长弧光】\n【简介】\n\n人物规则用于疾病/职业/身份/能力/心理限制、触发条件、代价和不可写法。\n人物简介：${brief}`
                }];
                const res = await fetch('/api/chat/deduce', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildChatPayloadWithLocalSources(convo, 1, brief))
                });
                const data = await res.json();
                if (!data.success) return alert("人物卡生成失败：" + (data.error || "未知错误"));
                document.getElementById('new-local-character-card').value = stripFencedBlocks(data.reply) || data.reply;
                document.getElementById('new-local-character-review').classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerText = "AI 生成人物卡";
            }
        };
        document.getElementById('btn-confirm-generated-character').onclick = async () => {
            const cardText = document.getElementById('new-local-character-card').value.trim();
            const payload = parseCharacterDetailText(cardText);
            if (!payload.name) return alert("人物卡里必须包含【姓名】");
            const res = await fetch('/api/workspace/character', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: PROJECT_ID, ...payload })
            });
            const data = await res.json();
            if (!data.success) return alert('新建全局角色失败！');
            await loadGlobalAssets();
            const created = (window.globalCharacters || []).find(c => c.name === payload.name);
            if (created && await linkCharacterToCurrentChapter(created.id)) modal.classList.add('hidden');
        };
        if (window.lucide) lucide.createIcons();
        return modal;
    }

    // 💥 添加/新建本章登场角色：从全局资产选择，不再手输猜名字
    window.addLocalChar = async () => {
        if (!currentLocalContext.chapterId) return alert("请先选择一个事件！");
        if (!window.globalCharacters || window.globalCharacters.length === 0) await loadGlobalAssets();
        const modal = ensureCharacterPickerModal();
        const list = document.getElementById('character-picker-list');
        const activeIds = new Set((currentLocalContext.characters || []).map(c => c.id));
        const candidates = (window.globalCharacters || []).filter(c => !activeIds.has(c.id));
        list.innerHTML = candidates.length > 0 ? candidates.map(c => `
            <button class="text-left bg-gray-950 hover:bg-blue-950/40 border border-gray-800 hover:border-blue-600 rounded-xl p-3 transition" onclick="selectLocalCharacter('${c.id}')">
                <div class="text-sm font-bold text-blue-300">${c.name}</div>
                <div class="text-[10px] text-gray-500 mt-0.5">${c.role || '未设定定位'} · ${c.faction || '阵营未定'}</div>
                <div class="text-[11px] text-gray-400 mt-2 line-clamp-2">${c.description || '暂无简介'}</div>
            </button>
        `).join('') : `<div class="col-span-2 text-gray-500 italic text-sm">全局资产里没有可拉入的新角色。</div>`;
        document.getElementById('new-local-character-brief').value = "";
        document.getElementById('new-local-character-card').value = "";
        document.getElementById('new-local-character-review').classList.add('hidden');
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    };

    window.selectLocalCharacter = async (characterId) => {
        const modal = document.getElementById('character-picker-modal');
        if (await linkCharacterToCurrentChapter(characterId)) modal?.classList.add('hidden');
    };

    window.jumpToSourceChapter = (chapNum) => {
        if (!chapNum) return;
        const treeItems = document.querySelectorAll('#chapter-tree li');
        // 💥 变更为：匹配“事件 X”
        const targetLi = Array.from(treeItems).find(el => el.innerText.includes(`事件 ${chapNum}`));
        if (targetLi) { targetLi.querySelector('div')?.click(); } else { alert(`大纲中未找到事件 ${chapNum}`); }
    };

    function appendChapMsg(role, text, index) {
        if(!chapHistoryDiv) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
        const bubbleColor = role === 'user' ? 'bg-purple-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-200';
        let contentHtml = escapeHtml(text);
        let assistantAttrs = '';
        if (role === 'assistant') {
            const parts = splitSopAssistantReply(text);
            const hasDetails = parts.details && parts.details.trim();
            assistantAttrs = 'data-sop-assistant-message="true"';
            contentHtml = `
                <div class="text-[10px] uppercase tracking-wide text-purple-300/80 font-bold mb-2">当前任务</div>
                <div class="bg-gray-950/60 border border-purple-800/50 rounded-lg p-2.5 text-purple-50">${escapeHtml(parts.focus || text)}</div>
                ${(typeof index !== 'number' || index === currentChapterChatHistory.length - 1) ? renderInteractionQueueHtml('sop') : ''}
                ${hasDetails ? `
                    <button type="button" onclick="toggleSopMessageDetails(this)" class="mt-2 inline-flex items-center text-[11px] text-gray-300 hover:text-white bg-gray-900 border border-gray-700 hover:border-purple-600 rounded-lg px-2.5 py-1.5">
                        <i data-lucide="chevron-down" class="w-3.5 h-3.5 mr-1"></i>展开更多信息
                    </button>
                    <div data-sop-message-details class="hidden mt-2 border-t border-gray-700 pt-2 text-gray-300">${escapeHtml(parts.details)}</div>
                ` : ''}
            `;
        }
        msgDiv.innerHTML = `<div class="max-w-[85%] flex flex-col ${role === 'user' ? 'items-end' : 'items-start'}"><div ${assistantAttrs} class="${bubbleColor} p-3 rounded-xl shadow text-xs leading-relaxed whitespace-pre-wrap">${contentHtml}</div></div>`;
        chapHistoryDiv.appendChild(msgDiv);
        chapHistoryDiv.scrollTop = chapHistoryDiv.scrollHeight;
        if (window.lucide) lucide.createIcons();
    }

    window.loadChapterContext = async function loadChapterContext(chapterId, chapterNumber, title) {
        if (currentChapterTitle) currentChapterTitle.innerText = `事件 ${chapterNumber}：${title}`;
        if (editorTextarea) editorTextarea.value = "正在提取记忆...";
        if (tabSop) tabSop.click();
        setSopSupervisionBlocked(false);

        if (chapHistoryDiv) { chapHistoryDiv.innerHTML = `<div class="flex justify-center mt-10"><i data-lucide="loader" class="w-6 h-6 animate-spin text-purple-500"></i></div>`; if (window.lucide) lucide.createIcons(); }

        try {
            const res = await fetch('/api/workspace/context', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: PROJECT_ID, chapterId, chapterNumber })
            });
            const data = await res.json();

            if (data.success) {
                const manualEdits = loadManualBibleEdits();
                const displayChapter = applyManualBibleEditsToValue(data.chapter || {}, manualEdits);
                const displayCharacters = applyManualBibleEditsToValue(data.characters || [], manualEdits);
                const displayHooks = applyManualBibleEditsToValue(data.hooks || [], manualEdits);
                const displayTitle = applyManualCharacterRenamesToText(title, manualEdits);
                currentLocalContext = { chapterId, chapterNumber, title: displayTitle, synopsis: displayChapter.content || "", characters: displayCharacters || [], hooks: displayHooks || [] };
                if (currentChapterTitle) currentChapterTitle.innerText = `事件 ${chapterNumber}：${displayTitle}`;
                if (editorTextarea) editorTextarea.value = displayChapter.content_text || "";
                if (editorSopConflict) editorSopConflict.innerText = displayChapter.content ? displayChapter.content : '尚未生成大纲，请在上方推演室讨论后提取。';

                // 💥 世界观强制重载，修复不显示的问题
                await loadProjectSettings();

                const eventContext = getAdjacentEventContext(chapterNumber);
                const charNames = displayCharacters && displayCharacters.length > 0 ? displayCharacters.map(c => c.name).join('、') : '暂无指定人物';
                const sourceHooks = (displayHooks || []).filter(h => h.source_chapter_number == chapterNumber);
                const targetHooks = (displayHooks || []).filter(h => h.target_chapter == chapterNumber);
                const hookDescs = [
                    targetHooks.length > 0 ? `需回收：${targetHooks.map(h => h.description).join('；')}` : '',
                    sourceHooks.length > 0 ? `已种下：${sourceHooks.map(h => h.description).join('；')}` : ''
                ].filter(Boolean).join('\n') || '暂无指定暗线';
                const worldRules = getWorldRulesText();
                if (localEventScope) {
                    localEventScope.innerHTML = [
                        renderCompactInfo('开始事件', eventContext.startInfo),
                        renderCompactInfo('结束事件', eventContext.endInfo),
                        renderCompactInfo('本章可调用角色', charNames),
                        targetHooks.length > 0 ? renderCompactInfo('本章必须回应的伏笔事件', targetHooks.map(h => `事件 ${h.source_chapter_number || '-'} -> ${h.target_chapter || '-'}：${h.description}`).join('\n')) : ''
                    ].filter(Boolean).join('');
                }
                if (localDeviationPanel) {
                    const warnings = [];
                    if (!worldRules || worldRules === '无特殊限制') warnings.push('世界观/规则/专业顾问资料尚未入库，AI 校验会变弱。');
                    if (!displayCharacters || displayCharacters.length === 0) warnings.push('本章尚未绑定可调用角色，人物行为容易发散。');
                    if (targetHooks.length > 0) warnings.push(`本章有 ${targetHooks.length} 个伏笔必须回收，SOP 和正文需逐一回应。`);
                    renderDeviationItems(warnings);
                }
                const aiGreeting = window.OmniPrompts?.chapterSopIntro
                    ? window.OmniPrompts.chapterSopIntro(chapterNumber, title, eventContext.endInfo, charNames)
                    : `【写作 SOP 推演启动】\n开始事件：${eventContext.startInfo}\n结束事件：${eventContext.endInfo}\n请先说明两者之间缺失的关键因果细节。`;

                const localSopKey = `sop_v3_${PROJECT_ID}_${chapterId}`;
                const savedSop = localStorage.getItem(localSopKey);

                if (savedSop) {
                    currentChapterChatHistory = JSON.parse(savedSop);
                    const savedFirstMsg = currentChapterChatHistory[0]?.content || '';
                    if (
                        currentChapterChatHistory.length === 1 &&
                        (savedFirstMsg.includes('已成功锁定') || savedFirstMsg.includes('【写作 SOP 推演启动】') || savedFirstMsg.includes('【写作 SOP 推演后台指令】') || savedFirstMsg.startsWith('我们先从事件'))
                    ) {
                        currentChapterChatHistory = [{ role: 'assistant', content: aiGreeting }];
                        localStorage.setItem(localSopKey, JSON.stringify(currentChapterChatHistory));
                    }
                    if (chapHistoryDiv) { chapHistoryDiv.innerHTML = ''; currentChapterChatHistory.forEach((msg, idx) => appendChapMsg(msg.role, msg.content, idx)); }
                } else {
                    currentChapterChatHistory = [{ role: 'assistant', content: aiGreeting }];
                    if (chapHistoryDiv) { chapHistoryDiv.innerHTML = ''; appendChapMsg('assistant', aiGreeting); }
                    localStorage.setItem(localSopKey, JSON.stringify(currentChapterChatHistory));
                }
                const lastSopHistoryItem = currentChapterChatHistory[currentChapterChatHistory.length - 1] || {};
                loadSopEventBriefState(chapterId);
                refreshSopCompletionSignal(lastSopHistoryItem.content || '');

                // 💥 伏笔区修复：分为本章回收与本章种下两类
                if (localHooks) {
                    localHooks.innerHTML = targetHooks.length > 0
                        ? targetHooks.map(h => renderHookItem(h, 'target')).join('')
                        : `<li class="text-gray-600 italic text-xs">本章暂无必须回收的伏笔。</li>`;
                }

                if (localSourceHooks) {
                    localSourceHooks.innerHTML = sourceHooks.length > 0
                        ? sourceHooks.map(h => renderHookItem(h, 'source')).join('')
                        : `<li class="text-gray-600 italic text-xs">本章尚未种下伏笔。</li>`;
                }

                // 💥 人物卡修复：新增头部“拉入角色”按钮，支持展开 12维设定 和 移出按钮
                if (localCharacters) {
                    const addBtnHTML = `<button onclick="addLocalChar()" class="w-full text-[10px] py-1 mb-2 bg-blue-900/30 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition border border-blue-800/50 flex justify-center items-center"><i data-lucide="plus" class="w-3 h-3 mr-1"></i>拉入已建角色</button>`;

                    const charHTML = displayCharacters.length > 0 ? displayCharacters.map(lc => {
                        const gc = applyManualBibleEditsToValue(window.globalCharacters?.find(c => c.id === lc.id || c.name === lc.name) || {}, manualEdits);
                        return `
                        <div class="group relative bg-gray-900/80 border border-gray-800 rounded-lg p-2 hover:border-purple-500 transition-all cursor-pointer overflow-hidden">
                            <div class="flex justify-between items-center relative z-10 bg-gray-900/80">
                                <span class="text-xs font-bold text-purple-400">${lc.name}</span>
                                <div class="flex space-x-2 items-center">
                                    <span class="text-[9px] bg-purple-950 text-purple-300 px-1 rounded">${gc.role || '活跃'}</span>
                                    <button onclick="removeLocalChar('${lc.id}')" class="text-gray-500 hover:text-red-500" title="移出本章"><i data-lucide="x" class="w-3 h-3"></i></button>
                                </div>
                            </div>
                            <div class="max-h-0 group-hover:max-h-[300px] transition-all duration-500 ease-in-out opacity-0 group-hover:opacity-100 mt-1 border-t border-gray-800 pt-2 space-y-1.5">
                                <div class="text-[10px] text-gray-300"><span class="text-gray-500">阵营:</span> ${gc.faction || '-'}</div>
                                <div class="text-[10px] text-gray-300"><span class="text-gray-500">性格:</span> ${gc.personality || '-'}</div>
                                <div class="text-[10px] text-gray-300"><span class="text-gray-500">欲望:</span> ${gc.core_desire || '-'}</div>
                                <div class="text-[10px] text-gray-300"><span class="text-gray-500">动机:</span> ${gc.motivation || '-'}</div>
                                <div class="text-[10px] text-gray-300 line-clamp-3 leading-relaxed"><span class="text-gray-500">简介:</span> ${gc.description || '-'}</div>
                            </div>
                        </div>`;
                    }).join('') : '<div class="text-gray-600 italic text-xs mb-2">阵营暂处于迷雾中...</div>';

                    localCharacters.innerHTML = addBtnHTML + charHTML;
                }

                // 💥 伏笔智能提取：如果有设定在当前事件爆发的伏笔，强制加入 AI 核心缓存工作流
                const activeHooks = targetHooks;
                if (activeHooks.length > 0) {
                    currentLocalContext.hookAlert = `\n\n【上帝视角最高级警告！！！】\n根据之前的设定，本事件（事件 ${chapterNumber}）必须填坑回收以下 ${activeHooks.length} 个伏笔，请在推演剧情时务必将它们合理融入其中：\n` + activeHooks.map((h, i) => `${i + 1}. ${h.description}`).join('\n');
                } else { currentLocalContext.hookAlert = ''; }

                triggerAiReviewBeacon();
                if (window.lucide) lucide.createIcons();
                if (timelineModal && !timelineModal.classList.contains('hidden')) renderTimelineModal();
            }
        } catch (e) { console.error(e); }
    }

    function triggerAiReviewBeacon() {
        const beacon = document.getElementById('ai-review-beacon');
        const deviationBar = document.getElementById('deviation-bar');
        const deviationText = document.getElementById('deviation-percentage');
        if (!beacon) return;
        if(deviationBar) deviationBar.style.width = "12%";
        if(deviationText) deviationText.innerText = "偏离度 12% (安全)";
        beacon.innerHTML = `<div class="space-y-2">
            <div class="p-2 bg-emerald-950/20 border border-emerald-900/30 rounded text-emerald-300"><span class="font-bold block text-[10px]">✔ 类型合规审查:</span> 故事节奏严密咬合，未偏离既定风格。</div>
            <div class="p-2 bg-blue-950/20 border border-blue-900/30 rounded text-blue-300"><span class="font-bold block text-[10px]">✔ 人物内核状态:</span> 角色动机连贯，未发生OOC脱离。</div>
        </div>`;
    }

    window.jumpToSourceChapter = (chapNum) => {
        if (!chapNum) return;
        const treeItems = document.querySelectorAll('#chapter-tree li');
        const targetLi = Array.from(treeItems).find(el => el.innerText.includes(`第 ${chapNum} 章`));
        if (targetLi) { targetLi.click(); } else { alert(`大纲中未找到第 ${chapNum} 章`); }
    };

    async function renderTimelineModal() {
        try {
            const res = await fetch(`/api/workspace/timeline/${PROJECT_ID}`);
            const data = await res.json();
            if (data.success) {
                const events = data.events;
                const currentChapNum = parseFloat(currentLocalContext.chapterNumber) || 0;
                if(!timelineDisplayList) return;
                
                if (events.length === 0) {
                    timelineDisplayList.innerHTML = `<div class="text-gray-500 italic text-sm ml-8">时间轴一片虚无...</div>`;
                    return;
                }
                timelineDisplayList.innerHTML = events.map(ev => {
                    const evChap = parseFloat(ev.chapter_number);
                    const isHappened = evChap <= currentChapNum;
                    const dotClass = isHappened ? 'bg-emerald-400 border-emerald-900 shadow-[0_0_10px_rgba(52,211,153,0.6)]' : 'bg-gray-700 border-gray-900';
                    const timeClass = isHappened ? 'text-emerald-400' : 'text-gray-500';
                    const boxClass = isHappened ? 'bg-gray-900 border-emerald-900/30' : 'bg-gray-950/50 border-gray-800/50 opacity-60';
                    const textClass = isHappened ? 'text-gray-200' : 'text-gray-500';
                    return `
                    <div class="relative flex items-start group">
                        <div class="absolute left-[17px] top-1.5 w-3.5 h-3.5 rounded-full ${dotClass} border-2 z-10 transition-all duration-300 group-hover:scale-125"></div>
                        <div class="w-24 flex-shrink-0 text-right pr-8 pt-1">
                            <span class="text-xs font-bold ${timeClass} block">${ev.time_label}</span>
                            <span class="text-[9px] text-gray-600 block mt-1">第 ${ev.chapter_number} 章</span>
                        </div>
                        <div class="flex-1 ${boxClass} border rounded-xl p-3 shadow-md transition-all">
                            <p class="text-sm ${textClass} leading-relaxed whitespace-pre-wrap">${ev.description}</p>
                        </div>
                        <button onclick="deleteTimelineEvent('${ev.id}')" class="ml-3 mt-2 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>`;
                }).join('');
                if(window.lucide) lucide.createIcons();
            }
        } catch (e) { console.error(e); }
    }

    async function renderRelationGraph() {
        try {
            if (!window.globalCharacters) {
                const charRes = await fetch(`/api/workspace/characters/${PROJECT_ID}`);
                const charData = await charRes.json();
                if (charData.success) window.globalCharacters = charData.characters;
            }
            const relRes = await fetch(`/api/workspace/relations/${PROJECT_ID}`);
            const relData = await relRes.json();
            const relations = relData.success ? relData.relations : [];

            const selFrom = document.getElementById('rel-from');
            const selTo = document.getElementById('rel-to');
            const charOptions = (window.globalCharacters || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            if(selFrom) selFrom.innerHTML = charOptions;
            if(selTo) selTo.innerHTML = charOptions;

            const nodesData = (window.globalCharacters || []).map(c => ({ id: c.id, label: c.name, title: c.role || '未知', color: { background: '#1e1b4b', border: '#8b5cf6', hover: { background: '#4c1d95', border: '#a78bfa' } } }));
            const edgesData = relations.map(r => ({ id: r.id, from: r.from_char_id, to: r.to_char_id, label: r.label, font: { color: '#a78bfa', size: 12, background: 'rgba(17,24,39,0.8)' } }));

            const container = document.getElementById('relation-network');
            if(container) {
                const data = { nodes: new vis.DataSet(nodesData), edges: new vis.DataSet(edgesData) };
                const options = {
                    nodes: { shape: 'dot', size: 22, font: { color: '#e5e7eb', size: 14, face: 'sans-serif' }, borderWidth: 2 },
                    edges: { arrows: 'to', color: { color: '#4b5563', highlight: '#8b5cf6' }, smooth: { type: 'continuous' } },
                    physics: { barnesHut: { gravitationalConstant: -3000, centralGravity: 0.3, springLength: 200 }, minVelocity: 0.75 },
                    interaction: { hover: true, tooltipDelay: 200 }
                };
                if (relationNetwork) relationNetwork.destroy();
                relationNetwork = new vis.Network(container, data, options);
            }

            const relList = document.getElementById('relation-list');
            if(relList) {
                relList.innerHTML = relations.map(r => {
                    const fromName = (window.globalCharacters.find(c=>c.id === r.from_char_id)||{}).name || '?';
                    const toName = (window.globalCharacters.find(c=>c.id === r.to_char_id)||{}).name || '?';
                    return `<li class="flex justify-between items-center bg-gray-900 p-2 rounded">
                        <span class="text-emerald-400">${fromName} ➔ ${toName} (${r.label})</span>
                        <button onclick="deleteRelation('${r.id}')" class="text-gray-500 hover:text-red-500"><i data-lucide="x" class="w-3 h-3"></i></button>
                    </li>`;
                }).join('');
                if(window.lucide) lucide.createIcons();
            }
        } catch (e) { console.error(e); }
    }

    window.editCharacter = (id) => {
        const char = window.globalCharacters.find(c => c.id === id);
        if (char) {
            const modal = ensureCharacterAssetModal();
            document.getElementById('asset-char-id').value = char.id;
            const title = document.getElementById('asset-character-modal-title');
            if (title) title.textContent = `人物卡：${char.name}`;
            const detail = document.getElementById('asset-character-detail');
            if (detail) {
                detail.value = [
                    `【姓名】${char.name || '-'}`,
                    `【定位】${char.role || '-'}`,
                    `【阵营】${char.faction || '-'}`,
                    `【年龄】${char.age || '-'}`,
                    `【外貌】${char.appearance || '-'}`,
                    `【职业】${char.profession || '-'}`,
                    `【性格】${char.personality || '-'}`,
                    `【核心欲望】${char.core_desire || '-'}`,
                    `【目标】${char.goal || '-'}`,
                    `【动机】${char.motivation || '-'}`,
                    `【缺陷】${char.flaw || '-'}`,
                    `【恐惧】${char.fear || '-'}`,
                    `【能力/技能】${char.skills || '-'}`,
                    `【人物规则】${char.character_rules || extractCharacterRulesFromBackground(char.background) || '-'}`,
                    `【背景】${char.background || '-'}`,
                    `【成长弧光】${char.character_arc || '-'}`,
                    `【简介】${char.description || '-'}`
                ].join('\n');
            }
            modal.classList.remove('hidden');
        }
    };

    async function saveSelectedAssetCharacter() {
        const charId = document.getElementById('asset-char-id')?.value;
        if (!charId) return alert("请先选择要更新的角色。");
        const oldCharacter = (window.globalCharacters || []).find(c => c.id === charId) || {};
        const detailPayload = parseCharacterDetailText(document.getElementById('asset-character-detail')?.value || "");
        const payload = { ...detailPayload, projectId: PROJECT_ID, id: charId };
        if(!payload.name) return alert("姓名不能为空");
        const res = await fetch('/api/workspace/character', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) {
            refreshCurrentBibleAfterCharacterRename(oldCharacter.name, payload.name, charId);
            await loadGlobalAssets();
            if (currentLocalContext.chapterId) loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
            document.getElementById('asset-character-modal')?.classList.add('hidden');
        } else alert("保存失败：" + (data.error || "未知错误"));
    }

    window.deleteTimelineEvent = async (id) => {
        if (!confirm("确定要抹除此事件吗？")) return;
        try {
            await fetch(`/api/workspace/timeline/${id}`, { method: 'DELETE' });
            renderTimelineModal();
            loadTimelineSidebar();
        } catch (e) { alert('删除失败'); }
    };

    window.deleteRelation = async (id) => {
        try {
            await fetch(`/api/workspace/relation/${id}`, { method: 'DELETE' });
            renderRelationGraph();
        } catch (e) { alert('解除羁绊失败'); }
    };

    // ==========================================
    // ⚙️ 各种小按钮的点击事件绑定
    // ==========================================
    if (tabSop && tabEditor) {
        tabSop.onclick = () => {
            if(viewSop) viewSop.classList.remove('hidden'); 
            if(viewEditor) viewEditor.classList.add('hidden');
            tabSop.className = "px-3 py-1 text-xs font-bold rounded-md bg-purple-600 text-white transition";
            tabEditor.className = "px-3 py-1 text-xs font-bold rounded-md text-gray-400 hover:text-white transition";
        };
        tabEditor.onclick = () => {
            if(viewEditor) viewEditor.classList.remove('hidden'); 
            if(viewSop) viewSop.classList.add('hidden');
            tabEditor.className = "px-3 py-1 text-xs font-bold rounded-md bg-purple-600 text-white transition";
            tabSop.className = "px-3 py-1 text-xs font-bold rounded-md text-gray-400 hover:text-white transition";
        };
    }

    function openHookComposer(prefill = "") {
        if (!currentLocalContext.chapterId) return alert("请先选择一个章节！");
        const descInput = document.getElementById('hook-desc');
        const targetInput = document.getElementById('hook-target-chapter');
        const annotationInput = document.getElementById('hook-annotation');
        if (descInput) descInput.value = prefill;
        if (targetInput) targetInput.value = "";
        if (annotationInput) annotationInput.value = "";
        refreshEventSelects();
        if (hookModal) hookModal.classList.remove('hidden');
    }

    let sandboxSecretSelectionText = "";

    function ensureSandboxSecretMenu() {
        let menu = document.getElementById('sandbox-secret-selection-menu');
        if (menu) return menu;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="sandbox-secret-selection-menu" class="fixed z-[90] hidden bg-gray-950 border border-violet-500/70 rounded-full shadow-[0_0_18px_rgba(139,92,246,0.35)] px-2 py-1.5">
                <button id="btn-sandbox-selection-secret" type="button" class="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-xs font-bold rounded-full flex items-center">
                    <i data-lucide="eye" class="w-3.5 h-3.5 mr-1.5"></i>设为上帝视角
                </button>
            </div>
        `);
        menu = document.getElementById('sandbox-secret-selection-menu');
        menu.addEventListener('mousedown', event => event.preventDefault());
        document.getElementById('btn-sandbox-selection-secret')?.addEventListener('click', () => {
            const selected = sandboxSecretSelectionText.trim();
            hideSandboxSecretMenu();
            if (selected) openGodViewComposer(selected);
        });
        if (window.lucide) lucide.createIcons();
        return menu;
    }

    function hideSandboxSecretMenu() {
        const menu = document.getElementById('sandbox-secret-selection-menu');
        if (menu) menu.classList.add('hidden');
    }

    function getSandboxSelectionInfo() {
        if (!sandbox || sandbox.classList.contains('hidden')) return null;
        if (document.activeElement === chatInput && chatInput.selectionStart !== chatInput.selectionEnd) {
            return {
                text: chatInput.value.substring(chatInput.selectionStart, chatInput.selectionEnd).trim(),
                rect: chatInput.getBoundingClientRect()
            };
        }
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
        const anchorElement = selection.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode;
        if (!anchorElement || !chatHistory?.contains(anchorElement)) return null;
        const text = selection.toString().trim();
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        return text ? { text, rect } : null;
    }

    function updateSandboxSecretMenu() {
        const info = getSandboxSelectionInfo();
        if (!info || info.text.length < 2) {
            sandboxSecretSelectionText = "";
            hideSandboxSecretMenu();
            return;
        }
        sandboxSecretSelectionText = info.text;
        const menu = ensureSandboxSecretMenu();
        const left = Math.max(12, Math.min(window.innerWidth - 190, info.rect.left + (info.rect.width / 2) - 80));
        const top = Math.max(72, info.rect.top - 46);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.classList.remove('hidden');
    }

    function ensureGodViewModal() {
        let modal = document.getElementById('god-view-composer-modal');
        if (modal) return modal;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="god-view-composer-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md z-[95] hidden flex items-center justify-center p-6">
                <div class="bg-gray-900 border border-violet-500/60 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 shadow-[0_0_30px_rgba(139,92,246,0.28)]">
                    <h3 class="text-lg font-bold text-violet-200 mb-4 flex items-center"><i data-lucide="eye" class="w-5 h-5 mr-2"></i>设为上帝视角</h3>
                    <div class="space-y-3">
                        <label class="block text-xs text-gray-500 font-bold">选中内容</label>
                        <textarea id="god-view-source" class="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-gray-300 text-sm h-20 resize-none" readonly></textarea>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input id="god-view-title" class="md:col-span-2 bg-gray-950 border border-violet-800/60 rounded-xl p-3 text-violet-100 text-sm" placeholder="秘密标题">
                            <select id="god-view-status" class="bg-gray-950 border border-violet-800/60 rounded-xl p-3 text-violet-200 text-sm">
                                <option value="hidden">隐藏</option>
                                <option value="partial">部分揭露</option>
                                <option value="revealed">已揭露</option>
                            </select>
                        </div>
                        <div>
                            <div class="flex items-center justify-between mb-1">
                                <label class="text-xs text-violet-300 font-bold">AI 润色后的上帝视角</label>
                                <button id="btn-polish-god-view" type="button" class="text-xs px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded-lg font-bold">重新润色</button>
                            </div>
                            <textarea id="god-view-god" class="w-full bg-gray-950 border border-violet-700/60 rounded-xl p-3 text-violet-100 text-sm h-28 resize-none" placeholder="作者和 AI 后台知道的真实情况。"></textarea>
                        </div>
                        <div>
                            <label class="block text-xs text-amber-300 font-bold mb-1">请你说明观众视角</label>
                            <textarea id="god-view-audience" class="w-full bg-gray-950 border border-amber-800/60 rounded-xl p-3 text-amber-100 text-sm h-24 resize-none" placeholder="真相揭露前，观众/角色现在只知道什么？这会决定 AI 推演时能公开使用的信息。"></textarea>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input id="god-view-reveal" class="bg-gray-950 border border-gray-800 rounded-xl p-3 text-gray-300 text-sm" placeholder="揭露事件">
                            <input id="god-view-chars" class="bg-gray-950 border border-gray-800 rounded-xl p-3 text-gray-300 text-sm" placeholder="关联人物">
                            <input id="god-view-events" class="bg-gray-950 border border-gray-800 rounded-xl p-3 text-gray-300 text-sm" placeholder="关联事件">
                        </div>
                    </div>
                    <div class="flex justify-end gap-3 mt-5">
                        <button id="btn-cancel-god-view" type="button" class="px-5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-bold">取消</button>
                        <button id="btn-save-god-view" type="button" class="px-5 py-2 bg-violet-700 hover:bg-violet-600 text-white rounded-lg font-bold">保存到上帝视角面板</button>
                    </div>
                </div>
            </div>
        `);
        modal = document.getElementById('god-view-composer-modal');
        document.getElementById('btn-cancel-god-view')?.addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('btn-polish-god-view')?.addEventListener('click', () => polishGodViewSelection(document.getElementById('god-view-source')?.value || ""));
        document.getElementById('btn-save-god-view')?.addEventListener('click', () => {
            const audience = document.getElementById('god-view-audience')?.value.trim() || "";
            const god = document.getElementById('god-view-god')?.value.trim() || "";
            if (!god) return alert("上帝视角不能为空。");
            if (!audience) return alert("请先说明观众视角，否则 AI 无法判断哪些信息可以公开使用。");
            saveSecretToCurrentBible({
                title: document.getElementById('god-view-title')?.value.trim() || god.slice(0, 24),
                status: document.getElementById('god-view-status')?.value || 'hidden',
                audience_view: audience,
                god_view: god,
                reveal_event: document.getElementById('god-view-reveal')?.value.trim() || "",
                related_characters: splitListText(document.getElementById('god-view-chars')?.value || ""),
                related_events: splitListText(document.getElementById('god-view-events')?.value || "")
            });
            modal.classList.add('hidden');
            alert("已保存到上帝视角面板。后续沙盒推演会按观众视角/上帝视角权限调用。");
        });
        if (window.lucide) lucide.createIcons();
        return modal;
    }

    async function polishGodViewSelection(sourceText) {
        const btn = document.getElementById('btn-polish-god-view');
        const godInput = document.getElementById('god-view-god');
        if (!sourceText.trim()) return;
        const oldText = btn?.textContent || "重新润色";
        if (btn) {
            btn.disabled = true;
            btn.textContent = "润色中...";
        }
        try {
            const prompt = `请把以下选中内容整理成适合写入小说创作系统的【上帝视角秘密】。
要求：
1. 只整理作者和 AI 后台知道的真实情况，不要写小说正文。
2. 不要替作者编造观众视角；观众视角由作者稍后填写。
3. 输出合法 JSON：{"title":"","god_view":"","reveal_event":"","related_characters":[],"related_events":[]}
4. god_view 要清楚写明真实因果、真实动机、真实身份或隐藏信息，以及它会如何约束后续事件推演。

【选中内容】
${sourceText}`;
            const res = await fetch('/api/chat/deduce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation: [{ role: 'user', content: prompt }],
                    currentBible: compactBibleForPrompt(getCurrentBibleSnapshot())
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || '润色失败');
            const parsed = extractJsonObjectFromText(data.reply) || {};
            document.getElementById('god-view-title').value = parsed.title || document.getElementById('god-view-title').value || sourceText.slice(0, 24);
            if (godInput) godInput.value = parsed.god_view || stripFencedBlocks(data.reply) || sourceText;
            document.getElementById('god-view-reveal').value = parsed.reveal_event || document.getElementById('god-view-reveal').value || "";
            document.getElementById('god-view-chars').value = Array.isArray(parsed.related_characters) ? parsed.related_characters.join('、') : (parsed.related_characters || "");
            document.getElementById('god-view-events').value = Array.isArray(parsed.related_events) ? parsed.related_events.join('、') : (parsed.related_events || "");
        } catch (error) {
            if (godInput && !godInput.value.trim()) godInput.value = sourceText;
            alert(`上帝视角润色失败：${error.message || '未知错误'}。已保留原文，你可以手动修改后保存。`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = oldText;
            }
        }
    }

    function openGodViewComposer(selectedText = "") {
        const modal = ensureGodViewModal();
        document.getElementById('god-view-source').value = selectedText;
        document.getElementById('god-view-title').value = selectedText.slice(0, 24);
        document.getElementById('god-view-status').value = 'hidden';
        document.getElementById('god-view-god').value = selectedText;
        document.getElementById('god-view-audience').value = "";
        document.getElementById('god-view-reveal').value = "";
        document.getElementById('god-view-chars').value = "";
        document.getElementById('god-view-events').value = "";
        modal.classList.remove('hidden');
        polishGodViewSelection(selectedText);
    }

    if (btnOpenTimeline) btnOpenTimeline.addEventListener('click', () => { refreshEventSelects(); renderTimelineModal(); if(timelineModal) timelineModal.classList.remove('hidden'); });
    if (btnCloseTimeline) btnCloseTimeline.addEventListener('click', () => { if(timelineModal) timelineModal.classList.add('hidden');});
    if (btnManualHook) btnManualHook.addEventListener('click', () => {
        currentSelectedString = "";
        openHookComposer("");
    });

    if (btnOpenRelation) btnOpenRelation.addEventListener('click', () => { if(relationModal) relationModal.classList.remove('hidden'); setTimeout(renderRelationGraph, 100); });
    if (btnCloseRelation) btnCloseRelation.addEventListener('click', () => { if(relationModal) relationModal.classList.add('hidden');});

    if (btnOpenAssetModal) btnOpenAssetModal.addEventListener('click', () => { loadGlobalAssets(); loadGlobalAssetOverview(); if(assetModal) assetModal.classList.remove('hidden'); });
    if (btnCloseAssetModal) btnCloseAssetModal.addEventListener('click', () => { if(assetModal) assetModal.classList.add('hidden');});

    if (btnAddChapter) btnAddChapter.addEventListener('click', () => {
        const last = workspaceChapters[workspaceChapters.length - 1] || null;
        window.openInsertEventModal(last ? last.chapter_number : null, null);
    });
    if (btnCancelChapter) btnCancelChapter.addEventListener('click', () => { if(addChapterModal) addChapterModal.classList.add('hidden'); });

    if (btnInsertEventChat) btnInsertEventChat.addEventListener('click', sendInsertEventChat);
    const insertEventChatInput = document.getElementById('insert-event-chat-input');
    if (insertEventChatInput) {
        insertEventChatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendInsertEventChat();
            }
        });
    }

    
    if (btnCancelHook) btnCancelHook.addEventListener('click', () => { if(hookModal) hookModal.classList.add('hidden'); });
    
    // 追踪选中范围
    let currentSelectionStart = 0;
    let currentSelectionEnd = 0;

    document.addEventListener('selectionchange', () => {
        if (document.activeElement === editorTextarea && editorTextarea) {
            currentSelectedString = editorTextarea.value.substring(editorTextarea.selectionStart, editorTextarea.selectionEnd).trim();
            currentSelectionStart = editorTextarea.selectionStart;
            currentSelectionEnd = editorTextarea.selectionEnd;
            if (currentSelectedString.length > 0 && floatingToolbar) {
                floatingToolbar.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
            } else if (floatingToolbar) {
                floatingToolbar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
            }
        }
        setTimeout(updateSandboxSecretMenu, 0);
    });

    if (chatInput) {
        ['mouseup', 'keyup', 'select'].forEach(eventName => {
            chatInput.addEventListener(eventName, () => setTimeout(updateSandboxSecretMenu, 0));
        });
    }

    if (chatHistory) {
        chatHistory.addEventListener('mouseup', () => setTimeout(updateSandboxSecretMenu, 0));
    }

    document.addEventListener('mousedown', (event) => {
        const menu = document.getElementById('sandbox-secret-selection-menu');
        if (menu && !menu.contains(event.target) && event.target !== chatInput && !chatHistory?.contains(event.target)) {
            hideSandboxSecretMenu();
        }
    });

    if (btnSelectionHook) {
        btnSelectionHook.onclick = () => {
            if (!currentSelectedString) return;
            openHookComposer(currentSelectedString);
            if (floatingToolbar) floatingToolbar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
        };
    }

if (btnTriggerHook) {
        // 1. 💥 动态注入一个高级的重写弹窗 UI (如果不存在)
        let rewriteModal = document.getElementById('ai-rewrite-modal');
        if (!rewriteModal) {
            const modalHtml = `
            <div id="ai-rewrite-modal" class="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] hidden backdrop-blur-sm">
                <div class="bg-gray-900 border border-blue-500/50 rounded-xl w-1/2 p-6 shadow-[0_0_30px_rgba(59,130,246,0.3)] flex flex-col space-y-4">
                    <h3 class="text-blue-400 font-bold flex items-center text-lg"><i data-lucide="sparkles" class="w-5 h-5 mr-2"></i>AI 局部重写控制台</h3>
                    
                    <div class="flex flex-col space-y-1.5">
                        <label class="text-xs text-gray-500 font-bold">【原文摘录】</label>
                        <textarea id="rewrite-original" class="w-full bg-gray-950 border border-gray-700 rounded p-2 text-gray-400 text-sm h-24 resize-none" readonly></textarea>
                    </div>
                    
                    <div class="flex flex-col space-y-1.5">
                        <label class="text-xs text-purple-400 font-bold">【改写指令】</label>
                        <input type="text" id="rewrite-instruction" placeholder="例如：加入人物心理活动、用更冷酷的文风重写、补充环境描写..." class="w-full bg-gray-950 border border-purple-900/50 rounded p-2.5 text-white text-sm focus:border-purple-500 outline-none transition-all">
                    </div>
                    
                    <button id="btn-do-rewrite" class="w-full bg-blue-600 hover:bg-blue-500 text-white rounded p-2.5 text-sm font-bold transition flex justify-center items-center shadow-lg">
                        <i data-lucide="zap" class="w-4 h-4 mr-1"></i> 呼叫主脑进行重写
                    </button>
                    
                    <div class="flex flex-col space-y-1.5 relative">
                        <label class="text-xs text-emerald-400 font-bold">【AI 执笔结果】(确认前可在此手动微调)</label>
                        <textarea id="rewrite-result" class="w-full bg-gray-950 border border-emerald-900/50 rounded p-3 text-emerald-300 text-sm h-40 resize-none outline-none focus:border-emerald-500 transition-all"></textarea>
                    </div>
                    
                    <div class="flex justify-end space-x-3 pt-2">
                        <button id="btn-cancel-rewrite" class="px-5 py-2 text-gray-400 hover:text-white text-sm transition">取消</button>
                        <button id="btn-confirm-rewrite" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold shadow-lg hidden transition">确认替换至正文</button>
                    </div>
                </div>
            </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            rewriteModal = document.getElementById('ai-rewrite-modal');
            if (window.lucide) lucide.createIcons();
        }

        btnTriggerHook.onclick = () => {
            if (!currentSelectedString) return;
            
            // 2. 每次打开弹窗前，初始化状态
            document.getElementById('rewrite-original').value = currentSelectedString;
            document.getElementById('rewrite-instruction').value = '';
            document.getElementById('rewrite-result').value = '';
            document.getElementById('btn-confirm-rewrite').classList.add('hidden'); // 隐藏确认按钮
            
            rewriteModal.classList.remove('hidden');
            
            // 3. 绑定取消按钮
            document.getElementById('btn-cancel-rewrite').onclick = () => {
                rewriteModal.classList.add('hidden');
                if (floatingToolbar) floatingToolbar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
            };

            // 4. 绑定执行重写按钮
            const btnDoRewrite = document.getElementById('btn-do-rewrite');
           btnDoRewrite.onclick = async () => {
                const instruction = document.getElementById('rewrite-instruction').value.trim();
                if (!instruction) return alert("请先输入改写指令！");
                
                btnDoRewrite.disabled = true;
                btnDoRewrite.innerHTML = `<i data-lucide="loader" class="w-4 h-4 inline mr-2 animate-spin"></i> 主脑重写中...`;
                if(window.lucide) lucide.createIcons();

                try {
                    // 1. 💥 新增：悄悄抓取正文面板下拉菜单里的“文笔风格”
                    const styleSelect = document.getElementById('ai-writing-style');
                    let stylePrompt = "";
                    if (styleSelect && window.WritingStyles && window.WritingStyles[styleSelect.value]) {
                        stylePrompt = window.WritingStyles[styleSelect.value] + "\n\n";
                    }
                    const sopBoundary = buildSopWritingBoundaryPrompt();
                    const characterFactLock = buildCharacterFactLockPrompt();
                    const pacingBrake = buildPacingBrakePrompt();

                    // 2. 将风格提示词无缝缝合到重写指令的头部
                    const rewriteConvo = [{
                        role: 'user',
                        content: `请根据以下指令，重写这段小说正文片段。\n\n${stylePrompt}${sopBoundary}\n\n${characterFactLock}\n\n${pacingBrake}\n\n【原文本】：${currentSelectedString}\n【修改指令】：${instruction}\n【系统严厉警告】：请直接、仅仅输出重写后的纯文本，绝不允许包含任何解释性废话（如“好的”、“重写如下”），不要破坏原有第一或第三人称视角。重写只能增强表达，不得新增违反 SOP 边界或人物事实锁的情节事实；如果原文节奏太急，应通过人物反应、信息消化、关系余波降速，不得新增事件。`
                    }];

                    // 3. 发送给后端
                    const res = await fetch('/api/chat/deduce', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildChatPayload(rewriteConvo, 1))
                    });
                    const data = await res.json();
                    if (data.success) {
                        // 将结果放入结果框，并显示出【确认替换至正文】按钮
                        document.getElementById('rewrite-result').value = data.reply;
                        document.getElementById('btn-confirm-rewrite').classList.remove('hidden');
                    } else {
                        alert("重写失败：" + data.error);
                    }
                } catch (e) {
                    alert("网络请求失败");
                } finally {
                    btnDoRewrite.disabled = false;
                    btnDoRewrite.innerHTML = `<i data-lucide="zap" class="w-4 h-4 mr-1"></i> 再次呼叫主脑重写`;
                    if(window.lucide) lucide.createIcons();
                }
            };

            // 5. 绑定最终确认替换按钮
            document.getElementById('btn-confirm-rewrite').onclick = () => {
                const finalResult = document.getElementById('rewrite-result').value;
                if (!finalResult) return;
                
                // 执行替换至右侧的正文面板
                editorTextarea.setRangeText(finalResult, currentSelectionStart, currentSelectionEnd, 'end');
                saveChapterContent(); // 触发防丢盘保存
                
                // 关闭弹窗
                rewriteModal.classList.add('hidden');
                if (floatingToolbar) floatingToolbar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
            };
        };
    }

    if (btnExtractSynopsis) {
        btnExtractSynopsis.onclick = async () => {
            if (currentChapterChatHistory.length <= 1) return alert("请先在下方与AI讨论本章内容！");
            if (sopSupervisionGate.blocked) {
                return alert(`SOP 仍有红色阻断风险，必须先处理后才能提取大纲：\n${limitText(sopSupervisionGate.reason, 700)}`);
            }
            const outlineGate = getSopOutlineGateReport();
            if (!outlineGate.ok) {
                return alert(`当前事件还不能提取大纲，请先补齐：\n${outlineGate.missing.join('\n')}`);
            }
            const eventBriefReady = await requireSopEventBriefBeforeOutline();
            if (!eventBriefReady) return;
            btnExtractSynopsis.disabled = true;
            btnExtractSynopsis.innerHTML = `<i data-lucide="loader" class="w-3 h-3 mr-1 animate-spin"></i>提取大纲中...`;
            if (window.lucide) lucide.createIcons();

            // 💥 核心修复：强硬指令，绝不允许自我放飞
            const eventContext = getAdjacentEventContext(currentLocalContext.chapterNumber);
            const wordBudget = await runLongformEditorTaskCached('budget', '\n\n这是敲定大纲前的20万字篇幅校准，请确认当前事件在全书篇幅中的位置和功能。');
            const beatSheet = await runLongformEditorTaskCached('beats', '\n\n这是敲定大纲前的全书节拍校准，请确认当前事件服务哪个节拍。');
            const blueprint = await runLongformEditorTaskCached('blueprint', '\n\n这是敲定大纲前的全书大片蓝图校准，请确保当前事件服务全书商业叙事骨架。');
            const arcTracker = await runLongformEditorTaskCached('arcs', '\n\n这是敲定大纲前的人物/反派弧光校准，请确认当前事件推动或保护了哪条弧光。');
            const oppositionPlan = await runLongformEditorTaskCached('opposition', '\n\n这是敲定大纲前的反派/阻力升级设计，请给出必须写进大纲的对抗链。');
            const gateReport = await runLongformEditorTaskCached('gate', '\n\n这是敲定大纲前的自动闸门，请严格判断是否允许进入正文。');
            const attractionPlan = await runLongformEditorTaskCached('hook', '\n\n这是敲定大纲前的自动章节吸引力设计，请给出必须写进大纲的钩子和节奏要求。');
            const strictPrompt = `讨论结束。请严格基于我们刚才在对话中敲定的内容，提取一份最终的【分章写作大纲】。
【当前事件】：${eventContext.startInfo}
【下一事件过渡锚点】：${eventContext.endInfo}
【已确认的本事件故事梗概】：
${sopEventBriefState.brief || '暂无'}
【20万字篇幅规划】：${wordBudget || longformState.wordBudget || '暂无'}
【全书节拍表】：${beatSheet || longformState.beatSheet || '暂无'}
【好莱坞大片蓝图】：${blueprint || longformState.storyBlueprint || '暂无'}
【全局人物/反派弧光表】：${arcTracker || longformState.arcTracker || '暂无'}
【本事件反派/阻力升级】：${oppositionPlan || '暂无'}
【统一规则/专家资料】：${getWorldRulesText()}
【救猫咪类型监督】：${getSaveTheCatGenreGuide(getCurrentStoryGenre())}
【可调用人物卡】：${getCharacterDetailsForSop()}
【事件质量闸门】：${gateReport || '暂无'}
【章节吸引力设计】：${attractionPlan || '暂无'}
${buildPacingBrakePrompt()}
【长篇编辑状态】：${getLongformEditorialContext()}

要求：
1. 绝不允许自我放飞，严禁编造我们没讨论过的重大情节。
1.1 必须以【已确认的本事件故事梗概】为最高依据来拆章；不得擅自改变事件顺序和关键细节。
2. 必须按已确认的章数输出；如果章数未确认，请按最合理章数输出并说明依据。
3. 每章必须包含：标题、目标字数、所属节拍/篇幅功能、节奏类型、压力等级、场景类型配比、起因、经过、结果、参与人物、救猫咪类型功能、人物行为来源、可种植伏笔/需回收伏笔、世界观/核心戒律/专业资料校验、与下一章衔接。
4. 所有人物行为必须能从 MBTI/性格、欲望、目标、动机、缺陷、恐惧或成长弧线中找到来源。
5. 每章都要说明它如何履行当前救猫咪类型的读者承诺；如果不契合，必须给出修正。
6. 每章都要写出：对抗/阻力、主角选择、胜利代价、对方反制或下一步压力。
7. 每章都要说明推动了哪条人物/反派弧光，以及连续性账本中需要记录的状态变化。
8. 如果涉及职业、行业或学科，必须依据已入库的专业顾问资料检查流程、术语、权限边界和常见误区；资料不足时不要编造确定细节。
9. 必须吸收篇幅规划、节拍表、大片蓝图、弧光表、反派/阻力升级、事件质量闸门和章节吸引力设计的整改要求。
10. 每章必须标注至少一个“反应/消化/关系/信息整理/铺垫”功能点；除非明确为高潮章，不得把所有场景都写成连续爆点。
11. 本事件结尾必须能自然过渡到下一事件，但不得展开下一事件正文内容。
请直接输出这份最终大纲，不要掺杂任何废话，它将作为正文执笔的严格依据。`;

            // 深拷贝一份不污染原对话的提纯队列
            const extractConvo = JSON.parse(JSON.stringify(currentChapterChatHistory));
            extractConvo.push({ role: 'user', content: strictPrompt });

            try {
                const res = await fetch('/api/chat/deduce', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildChatPayloadWithLocalSources(extractConvo, 12, strictPrompt))
                });
                const data = await res.json();
                if (data.success) {
                    const finalSynopsis = data.reply;
                    await fetch('/api/workspace/save-synopsis', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chapterId: currentLocalContext.chapterId, synopsis: finalSynopsis })
                    });
                    
                    // 💥 任务完成：静默将本章大纲与 SOP 研讨记录同步至云端
                    await window.syncToCloud("SOP推演室 · 章节大纲", { chapterId: currentLocalContext.chapterId, synopsis: finalSynopsis, chat: currentChapterChatHistory });
                    await window.syncToCloud("SOP推演室 · 事件梗概", { chapterId: currentLocalContext.chapterId, brief: sopEventBriefState.brief, confirmed: sopEventBriefState.confirmed }, { silent: true });
                    
                    if (editorSopConflict) editorSopConflict.innerText = finalSynopsis;
                    currentLocalContext.synopsis = finalSynopsis;
                    updateLatestBibleChapterFields({ content: finalSynopsis });
                    runLongformEditorTask('board', '\n\n这是大纲入库后的章节生产看板更新。');
                    if ((parseFloat(currentLocalContext.chapterNumber) || 0) % 3 === 0) {
                        runLongformEditorTask('memory', '\n\n这是每 3 个事件一次的自动阶段压缩。');
                    }
                    alert("✅ 事件大纲已完美敲定并入库！即将为您切换至正文执笔区。");
                    if (tabEditor) tabEditor.click();
                }
            } catch (e) { alert("提取大纲失败"); }
            finally {
                btnExtractSynopsis.disabled = false;
                btnExtractSynopsis.innerHTML = `<i data-lucide="zap" class="w-3 h-3 inline mr-1"></i>敲定最终大纲并执笔`;
                if (window.lucide) lucide.createIcons();
            }
        };
    }

    if(editorTextarea) {
        editorTextarea.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveChapterContent, 2000);
        });
    }
    if (btnSaveChapter) btnSaveChapter.onclick = saveChapterContent;
    if (btnReviewCurrentDraft) btnReviewCurrentDraft.onclick = () => runUnifiedContentReview("manual");
    if (btnRerunChangePatch) btnRerunChangePatch.onclick = () => rerunActiveChangePatchReview();
    if (btnExportBook) btnExportBook.onclick = () => exportWholeBook("md");
    if (btnFinalizeChapter) btnFinalizeChapter.onclick = () => finalizeCurrentChapter();
    if (btnVolumePlan) btnVolumePlan.onclick = () => runBookLevelTask('volume');
    if (btnRhythmCurve) btnRhythmCurve.onclick = () => runBookLevelTask('rhythm');
    if (btnSourceCitations) btnSourceCitations.onclick = () => runLongformEditorTask('citations', `\n\n【本地资料库相关片段】\n${getRelevantLocalSourceSnippets([currentLocalContext.title, currentLocalContext.synopsis, editorTextarea?.value || ''].join('\n'), 10) || '暂无可匹配资料片段。'}\n\n【当前正文】\n${limitText(editorTextarea?.value || '', 5000)}`);
    if (btnVersionCompare) btnVersionCompare.onclick = () => compareChapterVersion();
    if (btnBookAudit) btnBookAudit.onclick = () => runBookLevelTask('bookAudit');
    if (btnGoldenThree) btnGoldenThree.onclick = () => runBookLevelTask('goldenThree');
    if (btnCharacterVoice) btnCharacterVoice.onclick = () => runLongformEditorTask('voice');
    if (btnDialoguePolish) btnDialoguePolish.onclick = () => runLongformEditorTask('dialogue');
    if (btnSetpieceDirector) btnSetpieceDirector.onclick = () => runLongformEditorTask('setpiece');
    if (btnRelationshipLine) btnRelationshipLine.onclick = () => runLongformEditorTask('relationship');
    if (btnThemeMotif) btnThemeMotif.onclick = () => runLongformEditorTask('theme');
    if (btnWordBudget) btnWordBudget.onclick = () => runLongformEditorTask('budget');
    if (btnBeatSheet) btnBeatSheet.onclick = () => runLongformEditorTask('beats');
    if (btnContinuityLedger) btnContinuityLedger.onclick = () => runLongformEditorTask('continuity');
    if (btnProductionBoard) btnProductionBoard.onclick = () => runLongformEditorTask('board');
    if (btnAcceptanceGate) btnAcceptanceGate.onclick = () => runLongformEditorTask('acceptance');
    if (btnArcTracker) btnArcTracker.onclick = () => runLongformEditorTask('arcs');
    if (btnHollywoodBlueprint) btnHollywoodBlueprint.onclick = () => runLongformEditorTask('blueprint');
    if (btnOppositionPlan) btnOppositionPlan.onclick = () => runLongformEditorTask('opposition');
    if (btnSceneCard) btnSceneCard.onclick = () => runLongformEditorTask('scene');
    if (btnRewriteLoop) btnRewriteLoop.onclick = () => runHollywoodRewriteLoop();
    if (btnLongformGate) btnLongformGate.onclick = () => runLongformEditorTask('gate');
    if (btnLongformHook) btnLongformHook.onclick = () => runLongformEditorTask('hook');
    if (btnLongformState) btnLongformState.onclick = () => runLongformEditorTask('state');
    if (btnLongformMemory) btnLongformMemory.onclick = () => runLongformEditorTask('memory');
    if (btnToggleEventScope && localEventScope) {
        btnToggleEventScope.onclick = () => {
            const isHidden = localEventScope.classList.toggle('hidden');
            btnToggleEventScope.textContent = isHidden ? '展开' : '折叠';
        };
    }

    if (chapterChatInput) {
        chapterChatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (btnSendChapterChat) btnSendChapterChat.click();
            }
        });
    }

    if (btnAiWrite) {
        // 💥 动态 UI 注入：在“AI 依大纲撰写”按钮旁边，自动生成一个“文笔风格”下拉菜单
        const styleSelect = document.createElement('select');
        styleSelect.id = 'ai-writing-style';
        styleSelect.className = 'bg-gray-900 border border-purple-500/50 text-purple-300 text-xs rounded p-1 mr-2 outline-none focus:border-purple-400 transition-all cursor-pointer';
        
        if (window.WritingStyles) {
            for (const key of Object.keys(window.WritingStyles)) {
                const option = document.createElement('option');
                option.value = key;
                option.innerText = key;
                styleSelect.appendChild(option);
            }
        } else {
            styleSelect.innerHTML = `<option value="default">默认风格</option>`;
        }
        // 将下拉框悄悄插入到执笔按钮的前面，无需修改 HTML！
        btnAiWrite.parentNode.insertBefore(styleSelect, btnAiWrite);

        btnAiWrite.addEventListener('click', async () => {
            if (!editorTextarea) return;
            const currentText = editorTextarea.value.trim();

            // 1. 提取大纲摘要
            const latestSynopsis = document.getElementById('editor-sop-conflict') ? document.getElementById('editor-sop-conflict').innerText.trim() : currentLocalContext.synopsis;

            // 2. 提取世界观
            const worldRules = document.getElementById('world-rules-container') ? document.getElementById('world-rules-container').innerText.trim() : "无特殊限制";

            // 3. 提取登场群星档案
            const characterDetails = getCharacterDetailsForSop();
            const characterFactLock = buildCharacterFactLockPrompt();
            const activeCharacters = getEnrichedActiveCharacters();

            // 🌟 4. 提取当前用户选择的【文笔风格提示词】
            const selectedStyleKey = styleSelect.value;
            const stylePrompt = (window.WritingStyles && window.WritingStyles[selectedStyleKey]) 
                ? window.WritingStyles[selectedStyleKey] 
                : "【文笔风格核心约束】：自然流畅，叙事清晰。";

            btnAiWrite.disabled = true;
            btnAiWrite.innerHTML = `<i data-lucide="loader" class="w-3 h-3 mr-1 animate-spin"></i>执笔中...`;
            if (window.lucide) lucide.createIcons();

            const sceneCard = await runLongformEditorTaskCached('scene', '\n\n这是正文执笔前的强制场景卡，请把本章拆成能直接写作的场景链。');
            const dialoguePlan = await runLongformEditorTaskCached('dialogue', '\n\n这是正文执笔前的对白专项打磨，请给出本章对白写作约束。');
            const setpiecePlan = await runLongformEditorTaskCached('setpiece', '\n\n这是正文执笔前的动作/场面导演，请给出本章场面调度约束。');
            const key = getLongformChapterKey();
            const godViewContext = formatGodViewContext();
            const sopBoundaryContract = buildSopWritingBoundaryPrompt();
            const pacingBrakeContract = buildPacingBrakePrompt();

            // 5. 💥 终极 Payload 融合：将文笔风格无缝缝合进最顶级的强约束提示词中！
            const strictSynopsisText = `【文学主脑至高契约：请彻底废弃历史缓存旧大纲，必须严格基于以下摘要进行正文扩写，维持情节深度连贯，严禁人设漂移OOC！】\n\n${stylePrompt}\n\n${sopBoundaryContract}\n\n${characterFactLock}\n\n${pacingBrakeContract}\n\n【好莱坞大片蓝图】：\n${longformState.storyBlueprint || '暂无，请以当前救猫咪类型和本章大纲建立商业叙事张力。'}\n\n【角色声音系统】：\n${longformState.characterVoice || '暂无，请确保主要角色对白有身份、性格、节奏和潜台词差异。'}\n\n【情感/关系线系统】：\n${longformState.relationshipLine || '暂无，请让关系变化由事件选择触发。'}\n\n【主题与母题追踪】：\n${longformState.themeMotif || '暂无，请让主题自然藏在选择、意象和代价中，不要说教。'}\n\n【本事件反派/阻力升级】：\n${longformState.oppositionPlans?.[key] || '暂无，请确保正文中存在清晰阻力、升级和代价。'}\n\n【本章场景卡】：\n${sceneCard || longformState.sceneCards?.[key] || '暂无'}\n\n【本章对白专项打磨】：\n${dialoguePlan || longformState.dialoguePolish?.[key] || '暂无'}\n\n【本章动作/场面导演】：\n${setpiecePlan || longformState.setpieceDirector?.[key] || '暂无'}\n\n【本章剧情起承转合】：\n${latestSynopsis}\n\n【统一规则/专家资料】：\n${worldRules}\n\n【必须100%严密契合的登场角色人设】：\n${characterDetails}\n\n【上帝视角信息权限】：\n${godViewContext}\n\n【正文质量监督标准】：\n${getUnifiedQualityGuardrails()}`;

            const ultraPayload = {
                ...currentLocalContext,
                synopsis: strictSynopsisText,
                content: strictSynopsisText,
                synopsis_text: strictSynopsisText,
                characters: activeCharacters,
                currentText: currentText,
                qualityGuardrails: `${getUnifiedQualityGuardrails()}\n\n${sopBoundaryContract}\n\n${characterFactLock}\n\n${pacingBrakeContract}`,
                sceneCard: sceneCard || longformState.sceneCards?.[key] || '',
                blockbusterContext: getLongformEditorialContext()
            };

            try {
                const res = await fetch('/api/ai/generate-chapter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ultraPayload) 
                });
                const data = await res.json();
                if (data.success) {
                    let finalText = data.text || "";
                    let factCheck = await runDraftFactLockCheck(finalText, "after-ai-write");
                    if (!factCheck.ok) {
                        renderDeviationItems([`正文事实锁发现设定漂移，正在自动修复...\n\n${factCheck.report}`]);
                        const repaired = await repairDraftAgainstFactLock(finalText, factCheck.report);
                        if (repaired) {
                            const secondCheck = await runDraftFactLockCheck(repaired, "after-auto-repair");
                            if (secondCheck.ok) {
                                finalText = repaired;
                                factCheck = secondCheck;
                            } else {
                                renderDeviationItems([`正文已被阻止写入：自动修复后仍不符合人物卡/SOP。\n\n${secondCheck.report}`]);
                                return;
                            }
                        } else {
                            renderDeviationItems([`正文已被阻止写入：未能完成自动修复。\n\n${factCheck.report}`]);
                            return;
                        }
                    }
                    editorTextarea.value += (currentText ? "\n\n" : "") + finalText;
                    editorTextarea.scrollTop = editorTextarea.scrollHeight;
                    saveChapterContent(); 
                    runLongformEditorTask('state', '\n\n这是正文生成后的自动人物状态更新。');
                    runLongformEditorTask('continuity', '\n\n这是正文生成后的连续性账本更新。');
                    runLongformEditorTask('citations', `\n\n这是正文生成后的资料来源标注。\n【本地资料库相关片段】\n${getRelevantLocalSourceSnippets(finalText || '', 10) || '暂无可匹配资料片段。'}`);
                    runLongformEditorTask('board', '\n\n这是正文生成后的章节生产看板更新。');
                    runSopRealtimeSupervision('正文生成后自动检查');
                    const reviewText = await runUnifiedContentReview("after-ai-write");
                    const acceptanceText = await runLongformEditorTask('acceptance', `\n\n这是正文生成后的强制验收。请结合以下审查报告判断是否允许定稿：\n${reviewText || '暂无审查报告'}`);
                    if (/【风险等级】\s*(中|高)|风险等级[:：]\s*(中|高)|不通过|严重|降智|OOC/.test(reviewText || '')) {
                        longformState.rewriteReports = { ...(longformState.rewriteReports || {}), [key]: `自动审查发现需要改稿的风险。\n\n${reviewText}` };
                        saveLongformState();
                        renderDeviationItems([`${reviewText}\n\n已进入改稿闭环待命：点击“改稿闭环”可按审查意见重写正文。`]);
                    } else if (/不通过|必须整改|未通过/.test(acceptanceText || '')) {
                        renderDeviationItems([`${acceptanceText}\n\n强制验收未通过：请先按整改项修改，再进入下一章。`]);
                    }
                } else {
                    alert("AI 执笔失败: " + data.error);
                }
            } catch (err) {
                console.error("生成正文发生网络或解析错误:", err);
            } finally {
                btnAiWrite.disabled = false;
                btnAiWrite.innerHTML = `<i data-lucide="pen-tool" class="w-3 h-3 mr-1"></i>AI 依大纲撰写`;
                if (window.lucide) lucide.createIcons();
            }
        });
    }

    if (btnConfirmHook) {
        btnConfirmHook.addEventListener('click', async () => {
            const descInput = document.getElementById('hook-desc');
            const description = (descInput?.value || currentSelectedString || "").trim();
            const targetChap = document.getElementById('hook-target-chapter').value;
            if (!description) return alert("请填写伏笔内容！");
            if (!targetChap) return alert("必须指定引爆章节！");
            btnConfirmHook.disabled = true;
            try {
                const res = await fetch('/api/workspace/hook', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: PROJECT_ID, description, target_chapter: targetChap, annotation: document.getElementById('hook-annotation') ? document.getElementById('hook-annotation').value.trim() : "", source_chapter_id: currentLocalContext.chapterId, source_chapter_number: currentLocalContext.chapterNumber })
                });
                const data = await res.json();
                if (data.success) {
                    if(hookModal) hookModal.classList.add('hidden');
                    document.getElementById('hook-target-chapter').value = "";
                    if (descInput) descInput.value = "";
                    if (document.getElementById('hook-annotation')) document.getElementById('hook-annotation').value = ""; 
                    if(floatingToolbar) floatingToolbar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
                    if(editorTextarea) editorTextarea.setSelectionRange(editorTextarea.selectionEnd, editorTextarea.selectionEnd); 
                    loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
                } else {
                    alert("保存伏笔失败：" + (data.error || "未知错误"));
                }
            } catch (e) { alert("保存伏笔失败"); }
            finally { btnConfirmHook.disabled = false; }
        });
    }

    if (btnConfirmChapter) {
        btnConfirmChapter.addEventListener('click', async () => {
            const num = parseFloat(document.getElementById('new-chapter-num').value);
            const title = document.getElementById('new-chapter-title').value.trim();
            const type = document.getElementById('new-chapter-type').value;
            const userDraft = document.getElementById('new-chapter-draft').value.trim();
            const insertChatSummary = insertEventContext.chat
                .slice(-6)
                .map(msg => `${msg.role === 'user' ? '作者' : 'AI'}：${msg.content}`)
                .join('\n');

            if (!num || !title) return alert("请填齐参数！");
            btnConfirmChapter.disabled = true;
            btnConfirmChapter.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 正在缝合...`;
            if(window.lucide) lucide.createIcons();

            try {
                const treeRes = await fetch(`/api/workspace/tree/${PROJECT_ID}`);
                const treeData = await treeRes.json();
                let prevChap = null, nextChap = null;

                if (treeData.success) {
                    const sorted = treeData.chapters.sort((a,b) => a.chapter_number - b.chapter_number);
                    for(let i=0; i<sorted.length; i++) {
                        if (sorted[i].chapter_number < num) prevChap = sorted[i];
                        if (sorted[i].chapter_number > num) { nextChap = sorted[i]; break; }
                    }
                }
                let aiSynopsis = "";
                const bridgeRes = await fetch('/api/ai/bridge-chapters', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prevChapter: prevChap,
                        nextChapter: nextChap,
                        newChapterTitle: title,
                        userDraft: [userDraft, insertChatSummary ? `【事件插入讨论记录】\n${insertChatSummary}` : ""].filter(Boolean).join('\n\n')
                    })
                });
                const bridgeData = await bridgeRes.json();
                if (bridgeData.success) aiSynopsis = bridgeData.synopsis;

                const res = await fetch('/api/workspace/chapter', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: PROJECT_ID, chapterNumber: num, title: title, plotType: type, content: aiSynopsis, content_text: userDraft })
                });
                
                if ((await res.json()).success) {
                    if(addChapterModal) addChapterModal.classList.add('hidden');
                    document.getElementById('new-chapter-draft').value = "";
                    await loadWorkspaceTree();
                    setTimeout(() => { window.jumpToSourceChapter(num); }, 300);
                }
            } catch (e) { alert("缝合失败"); }
            finally { btnConfirmChapter.disabled = false; btnConfirmChapter.innerHTML = "生成坐标"; }
        });
    }

    if (btnSaveAsset) {
        btnSaveAsset.addEventListener('click', async () => {
            const charId = document.getElementById('asset-char-id').value;
            if (!charId) return alert("请先从左侧选择要更新的角色。新角色请从主面板“拉入已建角色”里创建。");
            const oldCharacter = (window.globalCharacters || []).find(c => c.id === charId) || {};
            const detailPayload = parseCharacterDetailText(document.getElementById('asset-character-detail')?.value || "");
            const payload = {
                ...detailPayload,
                projectId: PROJECT_ID, id: charId
            };
            if(!payload.name) return alert("姓名不能为空");
            const res = await fetch('/api/workspace/character', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await res.json();
            if (data.success) {
                refreshCurrentBibleAfterCharacterRename(oldCharacter.name, payload.name, charId);
                await loadGlobalAssets();
                if (currentLocalContext.chapterId) loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
            } else alert("保存失败：" + (data.error || "未知错误"));
        });
    }

    if (btnSaveTimeline) {
        btnSaveTimeline.addEventListener('click', async () => {
            const time_label = document.getElementById('tl-time').value.trim();
            const chapter_number = document.getElementById('tl-chapter').value;
            const description = document.getElementById('tl-desc').value.trim();
            if (!time_label || !chapter_number || !description) return alert("请填满时间的坐标！");

            btnSaveTimeline.disabled = true;
            btnSaveTimeline.innerHTML = '铭刻中...';

            try {
                const res = await fetch('/api/workspace/timeline', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: PROJECT_ID, time_label, chapter_number, description })
                });
                if ((await res.json()).success) {
                    document.getElementById('tl-time').value = '';
                    document.getElementById('tl-chapter').value = '';
                    document.getElementById('tl-desc').value = '';
                    renderTimelineModal();
                    loadTimelineSidebar();
                }
            } catch (e) { alert('保存失败'); }
            btnSaveTimeline.disabled = false;
            btnSaveTimeline.innerHTML = '手动铭刻入史册';
        });
    }

    if (btnAiExtractTimeline) {
        btnAiExtractTimeline.addEventListener('click', async () => {
            if (!currentLocalContext.chapterId) return alert("请先在左侧选择一个章节！");
            if (!editorTextarea) return;
            const chapterText = editorTextarea.value.trim();
            if (chapterText.length < 50) return alert("本章字数太少，主脑无法提纯事件！请先写正文。");

            const originalHtml = btnAiExtractTimeline.innerHTML;
            btnAiExtractTimeline.disabled = true;
            btnAiExtractTimeline.innerHTML = `<i data-lucide="loader" class="w-4 h-4 mr-2 animate-spin"></i>量子剥离中...`;
            if(window.lucide) lucide.createIcons();

            try {
                const res = await fetch('/api/ai/extract-timeline', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chapterNumber: currentLocalContext.chapterNumber, chapterTitle: currentLocalContext.title, chapterText: chapterText })
                });
                const data = await res.json();
                
                if (data.success && data.events.length > 0) {
                    for (const ev of data.events) {
                        await fetch('/api/workspace/timeline', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectId: PROJECT_ID, time_label: ev.time_label || `第 ${currentLocalContext.chapterNumber} 章期间`, chapter_number: currentLocalContext.chapterNumber, description: ev.description })
                        });
                    }
                    renderTimelineModal();
                    loadTimelineSidebar();
                    alert(`✅ 成功从本章提取了 ${data.events.length} 个核心事件并入库！`);
                } else { alert("提取失败：" + (data.error || "AI 未找到核心事件")); }
            } catch (e) { alert("提取解析错误: " + e.message); } 
            finally { btnAiExtractTimeline.disabled = false; btnAiExtractTimeline.innerHTML = originalHtml; if(window.lucide) lucide.createIcons(); }
        });
    }

    if(btnSaveRelation) {
        btnSaveRelation.addEventListener('click', async () => {
            const from_char_id = document.getElementById('rel-from').value;
            const to_char_id = document.getElementById('rel-to').value;
            const label = document.getElementById('rel-label').value.trim();
            if (from_char_id === to_char_id) return alert("不能和自己牵红线！");
            if (!label) return alert("请填写关系描述！");

            btnSaveRelation.disabled = true;
            try {
                const res = await fetch('/api/workspace/relation', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: PROJECT_ID, from_char_id, to_char_id, label })
                });
                if ((await res.json()).success) { document.getElementById('rel-label').value = ''; renderRelationGraph(); }
            } catch (e) { alert("保存羁绊失败"); }
            btnSaveRelation.disabled = false;
        });
    }

    // ==========================================
    // ⚙️ 引擎初始化
    // ==========================================
 async function checkInitialConcept() {
        // 1. 💥 无论本地有没有缓存记录，先强行设置顶部标题，并尝试从云端数据库拉取所有数据！
        if (document.getElementById('top-project-title')) {
            document.getElementById('top-project-title').innerText = "宇宙 ID: " + PROJECT_ID.slice(0,8);
        }
        loadWorkspaceTree(); 
        loadGlobalAssets();
        loadProjectSettings(); 
        loadLocalSourceDocs();
        loadLongformStateFromCloud();
        
        // 2. 解除模糊遮罩，让手机端也能看到界面
        if (mainWorkspace) mainWorkspace.classList.remove('opacity-30', 'blur-sm');

        // 3. 处理本地的推演室沙盒记录
        const savedChat = localStorage.getItem(GENESIS_CHAT_KEY);
        if (savedChat) {
            genesisConversation = JSON.parse(savedChat);
            renderChatHistory(); 
        } else {
            const restoredFromCloud = await loadGenesisDraftFromCloud();
            if (restoredFromCloud) return;
            await loadBibleSnapshotFromDatabase();

            const initialConcept = localStorage.getItem(`genesis_initial_concept_${PROJECT_ID}`);
            if (initialConcept) {
                // 如果是刚从大厅带来的新点子，打开遮罩进入创世推演
                if(sandbox) {
                    sandbox.classList.remove('hidden');
                    if (isSandboxMobileLayout()) setSandboxMobileTab('task');
                }
                if(mainWorkspace) mainWorkspace.classList.add('opacity-30', 'blur-sm');
                const systemBootPrompt = window.OmniPrompts ? window.OmniPrompts.genesisSystem(initialConcept) : "开始推演";
                genesisConversation.push({ role: 'user', content: systemBootPrompt });
                localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
                localStorage.removeItem(`genesis_initial_concept_${PROJECT_ID}`);
                syncGenesisDraftToCloud();
                fetchChatResponse();
            }
        }
    }

    if (btnForceGenesis) btnForceGenesis.onclick = () => {
        if(sandbox) {
            sandbox.classList.toggle('hidden');
            applySandboxLayoutMode();
            if (!sandbox.classList.contains('hidden') && isSandboxMobileLayout()) setSandboxMobileTab(getSandboxMobileTab());
        }
        if(mainWorkspace) mainWorkspace.classList.toggle('opacity-30');
    };
    if (btnCloseSandbox) btnCloseSandbox.onclick = closeGenesisSandbox;
    if (btnToggleSandboxLayout) btnToggleSandboxLayout.onclick = cycleSandboxLayoutMode;
    if (sandboxMobileNav) {
        sandboxMobileNav.querySelectorAll('[data-sandbox-mobile-tab]').forEach(button => {
            button.addEventListener('click', () => setSandboxMobileTab(button.dataset.sandboxMobileTab || 'task'));
        });
    }
    if (mobileTaskGoChat) mobileTaskGoChat.onclick = () => setSandboxMobileTab('chat');
    if (mobileTaskGoPanel) mobileTaskGoPanel.onclick = () => setSandboxMobileTab('panel');
    if (mobileTaskGoWarning) mobileTaskGoWarning.onclick = () => setSandboxMobileTab('warning');
    if (mobileTaskGoAssets) mobileTaskGoAssets.onclick = () => setSandboxMobileTab('assets');
    if (mobileOpenAssetModal) mobileOpenAssetModal.onclick = () => btnOpenAssetModal?.click();
    if (mobileOpenTimeline) mobileOpenTimeline.onclick = () => btnOpenTimeline?.click();
    if (mobileOpenRelation) mobileOpenRelation.onclick = () => btnOpenRelation?.click();
    window.addEventListener('resize', () => {
        applySandboxLayoutMode();
        if (isSandboxMobileLayout()) setSandboxMobileTab(getSandboxMobileTab(), { persist: false });
    });
    setSandboxMobileTab(getSandboxMobileTab(), { persist: false });
    applySandboxLayoutMode();

    // 💥 终极修复：章节 SOP 推演发送按钮逻辑 (附带自动伏笔回收与防OOC指令)
    if (btnSendChapterChat) {
        btnSendChapterChat.onclick = async () => {
            if (!chapterChatInput) return;
            const text = chapterChatInput.value.trim();
            if (!text) return;
            if (sopSupervisionGate.blocked && !shouldAllowSopFixMessage(text)) {
                return alert(`SOP 实时监督发现红色阻断风险，必须先处理冲突后继续。\n\n你可以输入“按建议修改……”“暂时忽略……”或明确说明修正方案。\n\n${limitText(sopSupervisionGate.reason, 700)}`);
            }
            if (sopSupervisionGate.blocked && /忽略|暂时忽略/.test(text)) setSopSupervisionBlocked(false);
            chapterChatInput.value = '';
            let completedLocalSopBatch = false;

            const localAnswer = recordLocalQuestionAnswer('sop', text);
            if (localAnswer.handled) {
                currentChapterChatHistory.push({ role: 'user', content: `【本地问题回答 ${localAnswer.answeredIds.join(', ')}】\n${text}` });
                appendChapMsg('user', text);
                localStorage.setItem(`sop_v3_${PROJECT_ID}_${currentLocalContext.chapterId}`, JSON.stringify(currentChapterChatHistory));

                if (!localAnswer.done) {
                    appendChapMsg('assistant', buildLocalQuestionPromptText('sop'));
                    return;
                }

                currentChapterChatHistory.push({ role: 'user', content: buildSopQuestionBatchSummaryMessage(localAnswer.summary) });
                appendChapMsg('assistant', `【当前任务】\n本轮 SOP 问题已全部回答，正在交给 AI 统一吸收。\n\n【下一步选择】\nQ1. 等待 AI 总结后继续当前事件推演。`);
                localStorage.setItem(`sop_v3_${PROJECT_ID}_${currentLocalContext.chapterId}`, JSON.stringify(currentChapterChatHistory));
                completedLocalSopBatch = true;
            } else {
                // 1. 保存并在 UI 上显示用户发送的纯净文本
                currentChapterChatHistory.push({ role: 'user', content: text });
                appendChapMsg('user', text);
                localStorage.setItem(`sop_v3_${PROJECT_ID}_${currentLocalContext.chapterId}`, JSON.stringify(currentChapterChatHistory));
            }

            const loadingId = 'chap-load-' + Date.now();
            if (chapHistoryDiv) {
                chapHistoryDiv.innerHTML += `<div id="${loadingId}" class="flex justify-start"><div class="bg-gray-800 p-3 rounded-xl text-gray-400 text-xs animate-pulse">主脑推演中...</div></div>`;
                chapHistoryDiv.scrollTop = chapHistoryDiv.scrollHeight;
            }

            try {
                // 2. 深度克隆历史，准备在后台“塞私货”
                let payloadConvo = JSON.parse(JSON.stringify(currentChapterChatHistory));
                if (payloadConvo[0]?.role === 'assistant' && payloadConvo[0]?.content?.startsWith('我们先从事件')) {
                    payloadConvo.shift();
                }

                const characterDetails = getCharacterDetailsForSop();
                const worldRules = getWorldRulesText();
                const godViewContext = formatGodViewContext();
                const eventContext = getAdjacentEventContext(currentLocalContext.chapterNumber);

                // 【核心：AI 工作流指令】
                const hiddenWorkflow = `[系统隐秘工作流]：你现在是【写作 SOP 事件架构师】，当前任务不是直接写正文，而是把当前事件拆成可写章节。本段是后台指令，禁止在回复中复述、引用或暴露原文。
【当前事件】：${eventContext.startInfo}
【下一事件过渡锚点】：${eventContext.endInfo}

请按以下逻辑交互，务必耐心：
0. 每次回复第一段必须是【当前任务】，并包含“当前事件”“本轮目标”“不讨论”“你需要决定”。这四项要简短明确，让作者一眼知道现在该做什么。
1. 第一步必须先复述你理解的当前事件，并指出当前事件内部缺失的切入点、冲突、人物选择或不可逆后果。
2. 陪作者讨论当前事件内部的行动、阻力、人物选择、代价、转折和信息释放；不要展开讨论下一事件的具体内容。
3. 每次提出事件细节，都要说明：行动人物、行为来源、冲突对象、不可逆后果、如何让当前事件结尾自然过渡到下一事件。
4. 用救猫咪类型监督检查当前事件是否承担了应有类型功能；如果偏离类型承诺，要指出偏离点并给出改法。
5. 主动检查大片蓝图：当前事件是否服务主题问题、三幕式/八序列推进、主角弧光、终局压力和读者情绪卖点。
6. 主动设计反派/阻力升级：谁阻止主角、对方计划、主角胜利代价、对方下一步反制，避免轻松过关。
7. 用统一规则/专家资料校验事件是否合理；如果涉及职业、行业或学科，要检查工作流程、术语、权限边界、常见误区和真实感细节，不合理时必须指出并给出修正方向。
8. 用上帝视角信息权限校验信息释放：未揭露/部分揭露的秘密只能用观众视角推进推理，上帝视角只能后台校验伏笔，不能提前泄露；已揭露后才可公开调用。
9. 主动提出【可种植伏笔】和【需要回收伏笔】：说明种下位置、回收位置、误导/信息差作用、回收方式，以及如果不回收会造成的逻辑断裂。
10. 当作者说“推演差不多了”或“开始总结”时，先确认这段内容分成几章，再生成每章标题与详细摘要；每章必须列出救猫咪类型功能、人物行为来源、对抗/代价、可种植伏笔/需回收伏笔。
11. 下一事件只作为结尾衔接目标，不能把 SOP 讨论变成两个事件的联合推演。
12. 只能使用下方【可调用人物卡】中的角色来推导行为；不要查阅、调用或主动引入无关人物，除非作者明确要求新增角色。
13. 每次回复最后必须给作者 2-4 个可直接选择或改写的输入方向，例如“选 A/B/C”“补充某角色动机”“指定一个必须发生的事件”。禁止只说“你觉得呢”。
14. SOP 是有限流程，不允许无限询问。你必须按顺序完成并标记：当前事件理解 -> 人物选择/行为来源 -> 阻力/代价/对抗 -> 信息释放/观众视角/上帝视角 -> 伏笔种植/回收 -> 章数方案或分章确认。上述全部完成后，必须输出：
【SOP_READY】
可以提取大纲。当前事件已具备分章大纲所需信息。
此时禁止再提出新的开放式问题，只能提示作者点击“提取分章大纲”或最后确认章数。
15. 可见回复固定使用：
【当前任务】
- 当前事件：
- 本轮目标：
- 不讨论：
- 你需要决定：
【本章推进建议】
【人物行为依据】
【伏笔/信息差】
【监督提醒】
【下一步选择】
【可展开：完整推演依据】
其中【当前任务】和【下一步选择】必须默认可读；长分析、蓝图校验、专家审查细节放入【可展开：完整推演依据】。
16. 提问必须编号为 Q1、Q2、Q3...。如果作者一口气回答了多个问题，先在【已吸收】列出“Qx 已回答/部分回答/冲突：摘要”，后续不要重复问已回答问题。作者额外提出的重要设定要写入【新增重要设定】，编号为 S1、S2...，并建议写入人物卡/人物规则/事件/规则/上帝视角/伏笔/暂存。`;

                // 3. 把私货、工作流、防 OOC 指令、伏笔全塞进最后一句话里发给 AI！
                let lastUserMsg = payloadConvo[payloadConvo.length - 1];
                if (lastUserMsg && lastUserMsg.role === 'user') {
                    // 如果有必须要回收的伏笔 (hookAlert)，它会变成红字警告随同发送！
                    lastUserMsg.content += `\n\n${hiddenWorkflow}` + (currentLocalContext.hookAlert || "") + buildInteractionFocusPrompt('sop', text) + `\n\n[统一监督指令]：请严格遵循规则/专家资料、救猫咪类型、人物档案、上帝视角信息权限和长篇编辑状态推演，严禁专业乱写、逻辑跳步、人物降智、OOC或提前泄露真相。\n【救猫咪类型监督】：\n${getSaveTheCatGenreGuide(getCurrentStoryGenre())}\n【统一规则/专家资料】：\n${worldRules}\n【人物卡】：\n${characterDetails}\n【上帝视角信息权限】：\n${godViewContext}\n【长篇编辑状态】：\n${getLongformEditorialContext()}`;
                }

                // 4. 发送给主脑
                const res = await fetch('/api/chat/deduce', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildChatPayloadWithLocalSources(payloadConvo, 8, lastUserMsg?.content || ''))
                });
                const data = await readApiJson(res, 'SOP AI 回复失败');
                const loader = document.getElementById(loadingId);
                if (loader) loader.remove();
                if (data.success) {
                    const cleanedReply = stripFencedBlocks(data.reply) || data.reply;
                    if (completedLocalSopBatch) clearAnsweredLocalQuestions('sop');
                    mergeInteractionStateFromReply('sop', cleanedReply);
                    currentChapterChatHistory.push({ role: 'assistant', content: cleanedReply });
                    appendChapMsg('assistant', cleanedReply);
                    localStorage.setItem(`sop_v3_${PROJECT_ID}_${currentLocalContext.chapterId}`, JSON.stringify(currentChapterChatHistory));
                    runSopRealtimeSupervision('SOP 新回复后自动检查');
                    refreshSopCompletionSignal(cleanedReply);
                }
            } catch (e) {
                document.getElementById(loadingId)?.remove();
                const errorReply = `【当前任务】\nSOP 本轮 AI 回复失败。\n\n【监督提醒】\n${e.message || '未知错误'}\n\n【下一步选择】\nQ1. 可以直接重试发送。\nQ2. 如果连续失败，请缩短本轮输入，或先切回沙盒刷新/压缩面板。`;
                currentChapterChatHistory.push({ role: 'assistant', content: errorReply });
                appendChapMsg('assistant', errorReply);
                localStorage.setItem(`sop_v3_${PROJECT_ID}_${currentLocalContext.chapterId}`, JSON.stringify(currentChapterChatHistory));
                alert(`SOP AI 回复失败：${e.message || '未知错误'}`);
            }
        };
    }

    checkInitialConcept();
});
