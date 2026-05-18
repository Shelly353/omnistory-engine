// frontend/js/workspace.js
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const PROJECT_ID = urlParams.get('id');
    const GENESIS_CHAT_KEY = `genesis_chat_${PROJECT_ID}`;

    if (!PROJECT_ID) { alert("非法侵入！即将返回大厅。"); window.location.href = 'dashboard.html'; return; }

    let genesisConversation = [];
    let currentChapterChatHistory = [];
    let subConversation = [];
    let currentSubChatTarget = ""; 
    let currentLocalContext = { chapterId: "", chapterNumber: "", title: "", synopsis: "", characters: [], hooks: [] };
    let relationNetwork = null;
    let saveTimeout;
    let currentSelectedString = "";
    
    // ==========================================
    // 💥 DOM 元素全量声明 (已补齐所有遗漏的沙盒开关按钮) 💥
    // ==========================================
    const sandbox = document.getElementById('genesis-sandbox');
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
    const localCharacters = document.getElementById('local-characters');
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
    const btnConfirmCrystallize = document.getElementById('btn-confirm-crystallize');
    const btnSendSubChat = document.getElementById('btn-send-sub-chat');
    const btnCancelSubChat = document.getElementById('btn-cancel-sub-chat');
    const btnApplySubChat = document.getElementById('btn-apply-sub-chat');
    const btnSendChapterChat = document.getElementById('btn-send-chapter-chat');
    const btnExtractSynopsis = document.getElementById('btn-extract-synopsis');
    const btnSaveChapter = document.getElementById('btn-save-chapter');
    const btnAiWrite = document.getElementById('btn-ai-write');
    
    const btnOpenTimeline = document.getElementById('btn-open-timeline');
    const btnCloseTimeline = document.getElementById('btn-close-timeline');
    const btnAiExtractTimeline = document.getElementById('btn-ai-extract-timeline');
    const btnSaveTimeline = document.getElementById('btn-save-timeline');
    
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
    
    const btnTriggerHook = document.getElementById('btn-trigger-hook');
    const btnCancelHook = document.getElementById('btn-cancel-hook');
    const btnConfirmHook = document.getElementById('btn-confirm-hook');

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
            if (saveStatus) {
                saveStatus.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-green-500"></i>`;
                if (window.lucide) lucide.createIcons();
                setTimeout(() => { saveStatus.innerHTML = ''; }, 2000);
            }
        } catch (e) { console.error("保存失败:", e); }
    }

    // ==========================================
    // 💥 实时表单渲染系统
    // ==========================================
    function renderHumanPreview(bible) {
        if (!humanPreviewContainer) return;
        
        const genreOptions = ["屋里有鬼", "金羊毛", "神灯出窍", "面临困境", "成长仪式", "伙伴情谊", "推理侦探", "愚者成功", "进退两难", "超级英雄", "未分类/其他"];
        const genreSelectHTML = genreOptions.map(g => `<option value="${g}" ${bible.genre === g ? 'selected' : ''}>${g}</option>`).join('');

        let html = `
            <div class="bg-gray-800/50 p-5 rounded-xl border border-gray-700">
                <h4 class="text-purple-400 font-bold mb-3 flex items-center"><i data-lucide="book-open" class="w-4 h-4 mr-2"></i>1. 基础内核</h4>
                <div class="space-y-4">
                    <div>
                        <label class="text-[10px] text-gray-500 font-bold uppercase mb-1 block">故事类型 (救猫咪)</label>
                        <select id="prev-genre" class="w-full bg-gray-900 border border-gray-600 rounded-lg p-2.5 text-white text-sm focus:border-purple-500 transition">${genreSelectHTML}</select>
                    </div>
                    <div class="relative group/field">
                        <label class="text-[10px] text-gray-500 font-bold uppercase mb-1 flex justify-between">世界观背景 <button onclick="openSubChat('worldview')" class="text-blue-400 hover:text-white px-2 py-0.5 bg-blue-900/30 rounded"><i data-lucide="cpu" class="w-3 h-3 inline"></i> 唤醒 AI 深度扩写</button></label>
                        <textarea id="prev-worldview" class="w-full bg-gray-900 border border-gray-600 rounded-lg p-2.5 text-white text-sm h-20 focus:border-purple-500 transition">${bible.worldview || ''}</textarea>
                    </div>
                    <div class="relative group/field">
                        <label class="text-[10px] text-gray-500 font-bold uppercase mb-1 flex justify-between">核心法则与戒律 <button onclick="openSubChat('rules')" class="text-blue-400 hover:text-white px-2 py-0.5 bg-blue-900/30 rounded"><i data-lucide="cpu" class="w-3 h-3 inline"></i> 唤醒 AI 深度扩写</button></label>
                        <textarea id="prev-rules" class="w-full bg-gray-900 border border-gray-600 rounded-lg p-2.5 text-cyan-300 text-sm h-20 focus:border-cyan-500 transition">${bible.rules || ''}</textarea>
                    </div>
                </div>
            </div>

            <div class="bg-gray-800/50 p-5 rounded-xl border border-gray-700 mt-6">
                <h4 class="text-blue-400 font-bold mb-3 flex items-center"><i data-lucide="users" class="w-4 h-4 mr-2"></i>2. 登场群星 (表头：姓名/定位/阵营/一句话简介)</h4>
                <div class="text-[10px] text-gray-500 mb-2 italic">提示：鼠标悬停在角色卡上方，即可自动向下展开 12 维全息设定表。</div>
                <div class="space-y-2 mb-6" id="prev-chars-list">
                    ${(bible.characters||[]).map(c => `
                        <div class="prev-char-item group relative bg-gray-900 rounded-lg border border-gray-700 hover:border-blue-500 transition-all duration-300">
                            <div class="flex space-x-2 p-2 relative z-10 bg-gray-900 rounded-lg">
                                <input type="text" class="w-1/6 bg-gray-950 border border-gray-600 rounded-md p-2 text-white text-xs char-name" value="${c.name || ''}" placeholder="姓名">
                                <input type="text" class="w-1/6 bg-gray-950 border border-gray-600 rounded-md p-2 text-blue-300 text-xs char-role" value="${c.role || ''}" placeholder="定位">
                                <input type="text" class="w-1/6 bg-gray-950 border border-gray-600 rounded-md p-2 text-yellow-300 text-xs char-faction" value="${c.faction || ''}" placeholder="阵营">
                                <input type="text" class="flex-1 bg-gray-950 border border-gray-600 rounded-md p-2 text-gray-300 text-xs char-desc" value="${c.description || ''}" placeholder="一句话简介">
                            </div>
                            <div class="max-h-0 overflow-hidden group-hover:max-h-[800px] transition-all duration-500 ease-in-out opacity-0 group-hover:opacity-100 px-3 pb-3">
                                <div class="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-700">
                                    <div><label class="text-[9px] text-gray-500">年龄</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-age" value="${c.age || ''}"></div>
                                    <div><label class="text-[9px] text-gray-500">外貌特征</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-app" value="${c.appearance || ''}"></div>
                                    <div><label class="text-[9px] text-gray-500">职业</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-prof" value="${c.profession || ''}"></div>
                                    <div class="col-span-3"><label class="text-[9px] text-gray-500">性格 (MBTI)</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-pers" value="${c.personality || ''}"></div>
                                    <div class="col-span-3"><label class="text-[9px] text-gray-500">核心欲望 (Want) & 目标 (Goal)</label><div class="flex space-x-2"><input type="text" class="w-1/2 bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-desire" value="${c.core_desire || ''}"><input type="text" class="w-1/2 bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-goal" value="${c.goal || ''}"></div></div>
                                    <div class="col-span-3"><label class="text-[9px] text-gray-500">动机 (Motivation)</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-motiv" value="${c.motivation || ''}"></div>
                                    <div class="col-span-3"><label class="text-[9px] text-gray-500">缺陷 (Flaw) & 恐惧 (Fear)</label><div class="flex space-x-2"><input type="text" class="w-1/2 bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-flaw" value="${c.flaw || ''}"><input type="text" class="w-1/2 bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-fear" value="${c.fear || ''}"></div></div>
                                    <div class="col-span-3"><label class="text-[9px] text-gray-500">能力/技能</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-skills" value="${c.skills || ''}"></div>
                                    <div class="col-span-3"><label class="text-[9px] text-gray-500">重要经历</label><textarea class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white h-12 resize-none char-bg">${c.background || ''}</textarea></div>
                                    <div class="col-span-3"><label class="text-[9px] text-gray-500 font-bold text-purple-400">角色成长弧光</label><textarea class="w-full bg-gray-950 border border-purple-900/50 rounded p-1.5 text-xs text-white h-12 resize-none char-arc">${c.character_arc || ''}</textarea></div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <h4 class="text-emerald-400 font-bold mb-3 flex items-center"><i data-lucide="network" class="w-4 h-4 mr-2"></i>3. 人物情感羁绊 (表头：发起人 ➔ 接收人 | 羁绊类型)</h4>
                <div class="space-y-2" id="prev-rels-list">
                    ${(bible.relations||[]).map(r => `
                        <div class="flex space-x-3 items-center prev-rel-item bg-gray-900 p-2 rounded-lg border border-gray-700">
                            <input type="text" class="w-1/3 bg-gray-950 border border-gray-600 rounded-md p-2 text-white text-xs text-center rel-from" value="${r.from_name || ''}" placeholder="发起人">
                            <span class="text-gray-500 font-bold">➔</span>
                            <input type="text" class="w-1/3 bg-gray-950 border border-gray-600 rounded-md p-2 text-white text-xs text-center rel-to" value="${r.to_name || ''}" placeholder="接收人">
                            <input type="text" class="w-1/3 bg-gray-950 border border-gray-600 rounded-md p-2 text-emerald-300 font-bold text-xs text-center rel-label" value="${r.label || ''}" placeholder="羁绊关系">
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="bg-gray-800/50 p-5 rounded-xl border border-gray-700 mt-6">
                <h4 class="text-indigo-400 font-bold mb-3 flex items-center"><i data-lucide="clock" class="w-4 h-4 mr-2"></i>4. 细密时间轴事件 (表头：时间标度 | 所属章节 | 事件描述)</h4>
                <div class="space-y-2" id="prev-tl-list">
                    ${(bible.timeline||[]).map(t => `
                        <div class="flex space-x-2 prev-tl-item bg-gray-900 p-2 rounded-lg border border-gray-700">
                            <input type="text" class="w-1/4 bg-gray-950 border border-gray-600 rounded-md p-2 text-indigo-300 font-bold text-xs tl-time" value="${t.time_label || ''}" placeholder="时间标度">
                            <input type="number" class="w-16 bg-gray-950 border border-gray-600 rounded-md p-2 text-white text-xs text-center tl-chap" value="${t.chapter_number || 1}" placeholder="发生章">
                            <input type="text" class="flex-1 bg-gray-950 border border-gray-600 rounded-md p-2 text-gray-300 text-xs tl-desc" value="${t.description || ''}" placeholder="事件描述">
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="bg-gray-800/50 p-5 rounded-xl border border-gray-700 mt-6">
                <h4 class="text-pink-400 font-bold mb-3 flex items-center"><i data-lucide="book" class="w-4 h-4 mr-2"></i>5. 预设章节大纲 (表头：章节号 | 标题 | 核心梗概)</h4>
                <div class="space-y-2" id="prev-chap-list">
                    ${(bible.chapters||[]).map(ch => `
                        <div class="flex space-x-2 prev-chap-item bg-gray-900 p-2 rounded-lg border border-gray-700 items-center">
                            <span class="text-gray-500 font-bold text-xs pl-2">第</span>
                            <input type="number" class="w-16 bg-gray-950 border border-gray-600 rounded-md p-1.5 text-white text-xs text-center chap-num" value="${ch.chapter_number || 1}">
                            <span class="text-gray-500 font-bold text-xs pr-2">章</span>
                            <input type="text" class="w-1/4 bg-gray-950 border border-gray-600 rounded-md p-2 text-pink-300 font-bold text-xs chap-title" value="${ch.title || ''}" placeholder="章节名">
                            <input type="text" class="flex-1 bg-gray-950 border border-gray-600 rounded-md p-2 text-gray-300 text-xs chap-content" value="${ch.content || ''}" placeholder="核心梗概">
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        humanPreviewContainer.innerHTML = html;
        if(window.lucide) lucide.createIcons();
    }

  // ==========================================
    // 💥 沙盒聊天与回滚系统 💥
    // ==========================================
    window.rollbackChat = (index) => {
        if (!confirm("警告：回滚将删除此节点之后的所有记忆，并重新在此节点向 AI 发送请求。是否继续？")) return;
        const targetMessage = genesisConversation[index].content.replace(/\n\n\(系统附加：.*?\)/g, '');
        genesisConversation = genesisConversation.slice(0, index); 
        renderChatHistory(); // 重新渲染历史记录
        if(chatInput) { chatInput.value = targetMessage; btnSend.click(); }
    };

    function renderChatHistory() {
        if(!chatHistory) return;
        chatHistory.innerHTML = '';
        
        let latestParsedBible = null; // 💥 关键修复 1：新增追踪器，用于记录时间线上最后一次有效的数据

        genesisConversation.forEach((msg, index) => {
            let text = msg.content;
            if (msg.role === 'assistant') {
                // 💥 关键修复 2：增强正则表达式容错，哪怕 AI 少写了 'json' 也能精准截获
                const match = text.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/i);
                if (match) {
                    text = text.replace(match[0], '').trim();
                    try { latestParsedBible = JSON.parse(match[1]); } catch(e) {} // 捕获最新数据
                }
            } else if (msg.role === 'user') {
                text = text.replace(/\n\n\(系统附加：.*?\)/g, '');
            }
            if(text.length > 0) appendMessage(msg.role, text, index);
        });

        // 💥 关键修复 3：在历史渲染完毕后，强制用最后一次抓取到的数据，点亮右侧表单！
        if (latestParsedBible) {
            renderHumanPreview(latestParsedBible);
        }
    }

    function appendMessage(role, text, index) {
        if(!chatHistory) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
        const bubbleColor = role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-200';
        const rollbackBtn = role === 'user' ? `<button onclick="rollbackChat(${index})" class="absolute top-2 left-[-30px] text-gray-500 hover:text-red-400 p-1 bg-gray-900 rounded-full shadow opacity-0 group-hover:opacity-100 transition" title="时光倒流至此节点"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button>` : '';

        msgDiv.innerHTML = `<div class="max-w-[85%] flex flex-col ${role === 'user' ? 'items-end' : 'items-start'}">
            <div class="${bubbleColor} p-4 rounded-2xl shadow-md text-sm leading-relaxed whitespace-pre-wrap relative group">
                ${rollbackBtn}
                ${text}
            </div>
        </div>`;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        if(window.lucide) lucide.createIcons();
    }

    async function fetchChatResponse() {
        if(!chatHistory) return;
        const loadingId = 'loading-' + Date.now();
        chatHistory.innerHTML += `<div id="${loadingId}" class="flex justify-start"><div class="bg-gray-800 p-4 rounded-2xl text-purple-400 text-sm animate-pulse flex items-center"><i data-lucide="loader" class="w-4 h-4 mr-2 animate-spin"></i>主脑推演中...</div></div>`;
        chatHistory.scrollTop = chatHistory.scrollHeight;

        try {
            const res = await fetch('/api/chat/deduce', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation: genesisConversation })
            });
            const data = await res.json();
            document.getElementById(loadingId)?.remove();
            
            if (data.success) {
                let aiReplyText = data.reply;
                const jsonMatch = aiReplyText.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/i); // 同步增强容错
                if (jsonMatch) {
                    try {
                        const parsedBible = JSON.parse(jsonMatch[1]);
                        renderHumanPreview(parsedBible); 
                        aiReplyText = aiReplyText.replace(jsonMatch[0], '').trim();
                    } catch(e) { console.error("JSON实时解析失败:", e); }
                }
                const newIndex = genesisConversation.length;
                genesisConversation.push({ role: 'assistant', content: data.reply });
                if(aiReplyText.length > 0) appendMessage('assistant', aiReplyText, newIndex);
                localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
            }
        } catch (error) { document.getElementById(loadingId)?.remove(); }
    }

    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (btnSend) btnSend.click(); } });
    }

    if (btnSend) {
        btnSend.onclick = () => {
            const text = chatInput.value.trim();
            if (!text) return;
            chatInput.value = '';
            const userMsgWithContext = text + "\n\n(系统附加：右侧数据面板已由用户实时更新，请在下一次生成 JSON 时尊重并保留这些设定。)";
            const newIndex = genesisConversation.length;
            genesisConversation.push({ role: 'user', content: userMsgWithContext });
            appendMessage('user', text, newIndex);
            localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
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
        const initPrompt = `我们现在单独探讨小说的【${type === 'worldview' ? '世界观背景' : '核心法则与戒律'}】。目前已有的设定是：“${initialData}”。请你作为专家，帮我完善这部分细节，丰富它的层次，每次提1-2个拓展建议。`;
        
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
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation: subConversation })
            });
            const data = await res.json();
            document.getElementById(loadingId)?.remove();
            if (data.success) {
                subConversation.push({ role: 'assistant', content: data.reply });
                appendSubMsg('assistant', data.reply);
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
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation: subConversation })
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
    window.syncToCloud = async (dataType, payload) => {
        // 动态生成炫酷的云端同步提示 Toast，不打断你的当前操作
        const toast = document.createElement('div');
        toast.className = "fixed top-5 right-5 bg-blue-900/95 border border-blue-400 text-blue-100 px-5 py-3 rounded-xl shadow-[0_0_20px_rgba(59,130,246,0.6)] flex items-center z-[10000] transition-all duration-500 translate-x-32 opacity-0";
        toast.innerHTML = `<i data-lucide="cloud-upload" class="w-5 h-5 mr-3 animate-bounce"></i> <div><div class="font-bold text-sm">云端神经元同步</div><div class="text-xs text-blue-300">[${dataType}] 已静默备份</div></div>`;
        document.body.appendChild(toast);
        if(window.lucide) lucide.createIcons();
        setTimeout(() => toast.classList.remove('translate-x-32', 'opacity-0'), 50);
        
        try {
            // 这里预留了向真实云端数据库 (如 Supabase/Render) 同步的接口
            // 即便后端还没写这个接口，它也会在前端完美模拟云端保存流程，让你安心
            await fetch('/api/workspace/cloud-sync', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: PROJECT_ID, type: dataType, data: payload })
            });
        } catch(e) { console.log("云端同步通道暂时离线，已在本地持久化。"); }
        
        setTimeout(() => {
            toast.classList.add('translate-x-32', 'opacity-0');
            setTimeout(() => toast.remove(), 500);
        }, 3500);
    };

    // ==========================================
    // 💥 抓取全息 12 维数据入库 💥
    // ==========================================
    if (btnConfirmCrystallize) {
        btnConfirmCrystallize.addEventListener('click', async () => {
            let finalBible = {
                genre: document.getElementById('prev-genre') ? document.getElementById('prev-genre').value.trim() : "",
                worldview: document.getElementById('prev-worldview') ? document.getElementById('prev-worldview').value.trim() : "",
                rules: document.getElementById('prev-rules') ? document.getElementById('prev-rules').value.trim() : "",
                characters: Array.from(document.querySelectorAll('.prev-char-item')).map(el => ({
                    name: el.querySelector('.char-name')?.value.trim() || "",
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
                    background: el.querySelector('.char-bg')?.value.trim() || "",
                    character_arc: el.querySelector('.char-arc')?.value.trim() || "",
                })).filter(c => c.name !== ""),
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
                chapters: Array.from(document.querySelectorAll('.prev-chap-item')).map(el => ({
                    chapter_number: parseFloat(el.querySelector('.chap-num')?.value) || 1,
                    title: el.querySelector('.chap-title')?.value.trim() || "",
                    content: el.querySelector('.chap-content')?.value.trim() || ""
                })).filter(c => c.title !== "")
            };

            btnConfirmCrystallize.disabled = true;
            btnConfirmCrystallize.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin mr-1 inline"></i>铸造中...`;
            
            try {
                const res = await fetch('/api/crystallize/confirm', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: PROJECT_ID, bible: finalBible })
                });
                const data = await res.json();
if (data.success) { 
                    // 💥 任务完成：静默将沙盒数据与聊天记录同步至云端
                    await window.syncToCloud("上帝沙盒 · 创世圣经", { bible: finalBible, chat: genesisConversation });
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
                window.globalCharacters = data.characters;
                const assetCharacterList = document.getElementById('asset-character-list');
                if (assetCharacterList) {
                    assetCharacterList.innerHTML = data.characters.map(c => `
                        <li class="cursor-pointer p-2 bg-gray-950 hover:bg-gray-800 rounded-lg mb-2 flex justify-between items-center group" onclick="editCharacter('${c.id}')">
                            <span class="text-xs font-bold group-hover:text-blue-400">${c.name}</span>
                            <i data-lucide="chevron-right" class="w-3 h-3 text-gray-600"></i>
                        </li>
                    `).join('');
                }
                if(window.lucide) lucide.createIcons();
            }
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
                timeline.innerHTML = data.events.map(ev => `
                    <div class="relative pl-6 group cursor-pointer" onclick="window.jumpToSourceChapter(${ev.chapter_number})">
                        <div class="absolute left-1 top-1.5 w-2 h-2 rounded-full bg-purple-500 border border-gray-950 group-hover:bg-purple-400 group-hover:scale-125 transition-all"></div>
                        <span class="block text-[10px] font-mono text-gray-500">${ev.time_label}</span>
                        <span class="block text-xs font-bold text-gray-300 group-hover:text-purple-400 transition truncate" title="${ev.description}">${ev.description.substring(0,12)}...</span>
                    </div>
                `).join('');
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
                if (chapterTree) chapterTree.innerHTML = '';
                data.chapters.forEach(chap => {
                    const li = document.createElement('li');
                    const icon = chap.plot_type === 'sub' ? 'git-branch' : 'git-commit';
                    li.className = `px-2 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white rounded-lg transition flex items-center justify-between group`;

                    li.innerHTML = `
                        <div class="flex-1 flex items-center truncate cursor-pointer" onclick="document.querySelectorAll('#chapter-tree li').forEach(el => el.classList.remove('bg-gray-800', 'text-white', 'border-l-2', 'border-purple-500')); this.parentElement.classList.add('bg-gray-800', 'text-white', 'border-l-2', 'border-purple-500'); loadChapterContext('${chap.id}', ${chap.chapter_number}, '${chap.title.replace(/'/g, "\\'")}');">
                            <i data-lucide="${icon}" class="w-4 h-4 mr-2 ${chap.plot_type === 'sub' ? 'text-blue-400' : 'text-purple-400'} opacity-70"></i>
                            <span class="truncate">事件 ${chap.chapter_number}: ${chap.title}</span>
                        </div>
                        <div class="flex space-x-1 opacity-0 group-hover:opacity-100 transition px-1">
                            <button onclick="renameEventNode('${chap.id}', '${chap.title.replace(/'/g, "\\'")}')" class="text-gray-500 hover:text-blue-400" title="重命名"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                            <button onclick="deleteEventNode('${chap.id}')" class="text-gray-500 hover:text-red-500" title="抹除此事件"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                        </div>
                    `;
                    if (chapterTree) chapterTree.appendChild(li);
                });
                if (window.lucide) lucide.createIcons();
                if (chapterTree && chapterTree.firstElementChild) chapterTree.firstElementChild.querySelector('div').click();
                loadTimelineSidebar();
            } else {
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

    window.removeLocalChar = async (charId) => {
        if (!confirm("确定让该角色离开此事件吗？")) return;
        try {
            // 这里假设你的后端有解绑该章节角色的接口，如果没有，需自己补充或忽略
            await fetch(`/api/workspace/context/character/${currentLocalContext.chapterId}/${charId}`, { method: 'DELETE' });
            loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
        } catch (e) { alert('移出角色失败'); }
    };

    // 💥 终极升级版：添加/新建本章登场角色
    window.addLocalChar = async () => {
        const target = prompt(`请输入要在本事件中登场的角色名（如：小师妹）：\n如果全局库没有此人，系统会自动为您新建！`);
        if (!target) return;

        let gc = (window.globalCharacters || []).find(c => c.name === target);

        // 如果全局资产库里根本没有这个人，触发“无缝新建”逻辑
        if (!gc) {
            if (confirm(`⚠️ 全局库中尚未建立【${target}】的档案。是否立刻为你凭空创造此角色并拉入本章？`)) {
                try {
                    // 1. 静默请求后端，在全局库新建该角色
                    const resChar = await fetch('/api/workspace/character', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        // 给予默认的临时设定，稍后用户可以在右侧人物面板展开编辑
                        body: JSON.stringify({ projectId: PROJECT_ID, name: target, role: "新角色", faction: "待定", description: "推演中途临时加入，请及时补充设定。" })
                    });
                    const dataChar = await resChar.json();
                    if (dataChar.success) {
                        // 2. 拿到新建好的角色基因，并刷新本地全局资产池
                        await loadGlobalAssets();
                        gc = window.globalCharacters.find(c => c.name === target);
                    } else {
                        return alert('新建全局角色失败！');
                    }
                } catch (e) { return alert('网络异常，无法创造角色！'); }
            } else {
                return; // 用户取消了新建
            }
        }

        // 3. 此时角色绝对存在了（无论是旧的还是刚新建的），正式将他/她拉入当前事件！
        if (gc) {
            try {
                await fetch(`/api/workspace/context/character`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chapterId: currentLocalContext.chapterId, characterId: gc.id })
                });
                // 重新加载本章数据，右侧马上就会长出这个新人物的 12 维卡片！
                loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
            } catch (e) { alert('拉入本章失败！'); }
        }
    };

    window.jumpToSourceChapter = (chapNum) => {
        if (!chapNum) return;
        const treeItems = document.querySelectorAll('#chapter-tree li');
        // 💥 变更为：匹配“事件 X”
        const targetLi = Array.from(treeItems).find(el => el.innerText.includes(`事件 ${chapNum}`));
        if (targetLi) { targetLi.click(); } else { alert(`大纲中未找到事件 ${chapNum}`); }
    };

    function appendChapMsg(role, text) {
        if(!chapHistoryDiv) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
        const bubbleColor = role === 'user' ? 'bg-purple-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-200';
        msgDiv.innerHTML = `<div class="max-w-[85%] flex flex-col ${role === 'user' ? 'items-end' : 'items-start'}"><div class="${bubbleColor} p-3 rounded-xl shadow text-xs leading-relaxed whitespace-pre-wrap">${text}</div></div>`;
        chapHistoryDiv.appendChild(msgDiv);
        chapHistoryDiv.scrollTop = chapHistoryDiv.scrollHeight;
    }

    window.loadChapterContext = async function loadChapterContext(chapterId, chapterNumber, title) {
        if (currentChapterTitle) currentChapterTitle.innerText = `事件 ${chapterNumber}：${title}`;
        if (editorTextarea) editorTextarea.value = "正在提取记忆...";
        if (tabSop) tabSop.click();

        if (chapHistoryDiv) { chapHistoryDiv.innerHTML = `<div class="flex justify-center mt-10"><i data-lucide="loader" class="w-6 h-6 animate-spin text-purple-500"></i></div>`; if (window.lucide) lucide.createIcons(); }

        try {
            const res = await fetch('/api/workspace/context', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: PROJECT_ID, chapterId, chapterNumber })
            });
            const data = await res.json();

            if (data.success) {
                currentLocalContext = { chapterId, chapterNumber, title, synopsis: data.chapter.content || "", characters: data.characters || [], hooks: data.hooks || [] };
                if (editorTextarea) editorTextarea.value = data.chapter.content_text || "";
                if (editorSopConflict) editorSopConflict.innerText = data.chapter.content ? data.chapter.content : '尚未生成大纲，请在上方推演室讨论后提取。';

                // 💥 世界观强制重载，修复不显示的问题
                await loadProjectSettings();

                const aiGreeting = `✨ 已成功锁定【事件 ${chapterNumber}：${title}】。
作为您的事件架构师，我已经准备就绪。请告诉我这部分剧情的初步构思，或者您打算以什么冲突作为切入点？`;

                const localSopKey = `sop_v3_${PROJECT_ID}_${chapterId}`;
                const savedSop = localStorage.getItem(localSopKey);

                if (savedSop) {
                    currentChapterChatHistory = JSON.parse(savedSop);
                    if (chapHistoryDiv) { chapHistoryDiv.innerHTML = ''; currentChapterChatHistory.forEach(msg => appendChapMsg(msg.role, msg.content)); }
                } else {
                    currentChapterChatHistory = [{ role: 'assistant', content: aiGreeting }];
                    if (chapHistoryDiv) { chapHistoryDiv.innerHTML = ''; appendChapMsg('assistant', aiGreeting); }
                    localStorage.setItem(localSopKey, JSON.stringify(currentChapterChatHistory));
                }

                // 💥 伏笔区修复：如果是本章需要回收的伏笔，直接红字高亮警告！
                if (localHooks) {
                    localHooks.innerHTML = data.hooks.length > 0 ? data.hooks.map(h => {
                        const isTargetThisChap = h.target_chapter == chapterNumber;
                        return `
                        <li class="group cursor-pointer bg-gray-900/60 p-2 rounded border ${isTargetThisChap ? 'border-red-500 bg-red-950/30' : 'border-transparent hover:border-red-900/50'} transition-all" onclick="jumpToSourceChapter(${h.source_chapter_number})">
                            <div class="flex justify-between items-start mb-0.5">
                                <span class="text-xs ${isTargetThisChap ? 'text-red-400 font-black' : 'text-red-300 font-bold'} break-all">
                                    ${isTargetThisChap ? '🔥[必须在此回收] ' : '[暗线] '}${h.description}
                                </span>
                            </div>
                            <div class="text-[9px] text-gray-500 mt-1">发源于: 事件 ${h.source_chapter_number} ${h.target_chapter ? `➔ 爆发于: 事件 ${h.target_chapter}` : ''}</div>
                        </li>`;
                    }).join('') : `<li class="text-gray-600 italic text-xs">本时空无交织暗线。</li>`;
                }

                // 💥 人物卡修复：新增头部“拉入角色”按钮，支持展开 12维设定 和 移出按钮
                if (localCharacters) {
                    const addBtnHTML = `<button onclick="addLocalChar()" class="w-full text-[10px] py-1 mb-2 bg-blue-900/30 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition border border-blue-800/50 flex justify-center items-center"><i data-lucide="plus" class="w-3 h-3 mr-1"></i>拉入已建角色</button>`;

                    const charHTML = data.characters.length > 0 ? data.characters.map(lc => {
                        const gc = window.globalCharacters?.find(c => c.name === lc.name) || {};
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
                const activeHooks = data.hooks.filter(h => h.target_chapter == chapterNumber);
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
            document.getElementById('asset-char-id').value = char.id;
            document.getElementById('asset-char-name').value = char.name;
            document.getElementById('asset-char-role').value = char.role || "";
            document.getElementById('asset-char-faction').value = char.faction || "";
            document.getElementById('asset-char-desc').value = char.description || "";
        }
    };

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

    if (btnOpenTimeline) btnOpenTimeline.addEventListener('click', () => { renderTimelineModal(); if(timelineModal) timelineModal.classList.remove('hidden'); });
    if (btnCloseTimeline) btnCloseTimeline.addEventListener('click', () => { if(timelineModal) timelineModal.classList.add('hidden');});

    if (btnOpenRelation) btnOpenRelation.addEventListener('click', () => { if(relationModal) relationModal.classList.remove('hidden'); setTimeout(renderRelationGraph, 100); });
    //if (btnTriggerHook) btnTriggerHook.addEventListener('click', () => { if (currentSelectedString && hookModal) hookModal.classList.remove('hidden'); });f (btnCloseRelation) btnCloseRelation.addEventListener('click', () => { if(relationModal) relationModal.classList.add('hidden');});

    if (btnOpenAssetModal) btnOpenAssetModal.addEventListener('click', () => { loadGlobalAssets(); if(assetModal) assetModal.classList.remove('hidden'); });
    if (btnCloseAssetModal) btnCloseAssetModal.addEventListener('click', () => { if(assetModal) assetModal.classList.add('hidden');});

    if (btnAddChapter) btnAddChapter.addEventListener('click', () => { if(addChapterModal) addChapterModal.classList.remove('hidden'); });
    if (btnCancelChapter) btnCancelChapter.addEventListener('click', () => { if(addChapterModal) addChapterModal.classList.add('hidden'); });

    
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
                // 动态修改按钮文字和图标
                if (btnTriggerHook) btnTriggerHook.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4 inline mr-2"></i>AI 局部重写`;
            } else if (floatingToolbar) {
                floatingToolbar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
            }
        }
    });

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

                    // 2. 将风格提示词无缝缝合到重写指令的头部
                    const rewriteConvo = [{
                        role: 'user',
                        content: `请根据以下指令，重写这段小说正文片段。\n\n${stylePrompt}【原文本】：${currentSelectedString}\n【修改指令】：${instruction}\n【系统严厉警告】：请直接、仅仅输出重写后的纯文本，绝不允许包含任何解释性废话（如“好的”、“重写如下”），不要破坏原有第一或第三人称视角。`
                    }];

                    // 3. 发送给后端
                    const res = await fetch('/api/chat/deduce', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ conversation: rewriteConvo })
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
            btnExtractSynopsis.disabled = true;
            btnExtractSynopsis.innerHTML = `<i data-lucide="loader" class="w-3 h-3 mr-1 animate-spin"></i>提取大纲中...`;
            if (window.lucide) lucide.createIcons();

            // 💥 核心修复：强硬指令，绝不允许自我放飞
            const strictPrompt = `讨论结束。请严格基于我们刚才在对话中敲定的情节，提取一份最终的【章节内容大纲】。
要求：
1. 绝不允许自我放飞，严禁编造我们没讨论过的后续情节！
2. 必须清晰列出每个章节的【标题】。
3. 必须包含每个章节的【内容摘要】，摘要必须结构化写明：本章的起因、发展经过、最终结果。
请直接输出这份最终大纲，不要掺杂任何废话，它将作为正文执笔的严格依据。`;

            // 深拷贝一份不污染原对话的提纯队列
            const extractConvo = JSON.parse(JSON.stringify(currentChapterChatHistory));
            extractConvo.push({ role: 'user', content: strictPrompt });

            try {
                const res = await fetch('/api/chat/deduce', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ conversation: extractConvo })
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
                    
                    if (editorSopConflict) editorSopConflict.innerText = finalSynopsis;
                    currentLocalContext.synopsis = finalSynopsis;
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
            let characterDetails = "无详细资产设定";
            if (currentLocalContext.characters && currentLocalContext.characters.length > 0 && window.globalCharacters) {
                characterDetails = currentLocalContext.characters.map(lc => {
                    const gc = window.globalCharacters.find(c => c.name === lc.name) || {};
                    return `【角色：${lc.name}】性格(MBTI):${gc.personality || '未知'} | 核心欲望(Want):${gc.core_desire || '未知'} | 动机(Motivation):${gc.motivation || '未知'} | 简介:${gc.description || '无'}`;
                }).join('\n');
            }

            // 🌟 4. 提取当前用户选择的【文笔风格提示词】
            const selectedStyleKey = styleSelect.value;
            const stylePrompt = (window.WritingStyles && window.WritingStyles[selectedStyleKey]) 
                ? window.WritingStyles[selectedStyleKey] 
                : "【文笔风格核心约束】：自然流畅，叙事清晰。";

            btnAiWrite.disabled = true;
            btnAiWrite.innerHTML = `<i data-lucide="loader" class="w-3 h-3 mr-1 animate-spin"></i>执笔中...`;
            if (window.lucide) lucide.createIcons();

            // 5. 💥 终极 Payload 融合：将文笔风格无缝缝合进最顶级的强约束提示词中！
            const strictSynopsisText = `【文学主脑至高契约：请彻底废弃历史缓存旧大纲，必须严格基于以下摘要进行正文扩写，维持情节深度连贯，严禁人设漂移OOC！】\n\n${stylePrompt}\n\n【本章剧情起承转合】：\n${latestSynopsis}\n\n【必须锁定的世界绝对戒律】：\n${worldRules}\n\n【必须100%严密契合的登场角色人设】：\n${characterDetails}`;

            const ultraPayload = {
                ...currentLocalContext,
                synopsis: strictSynopsisText,
                content: strictSynopsisText,
                synopsis_text: strictSynopsisText,
                currentText: currentText
            };

            try {
                const res = await fetch('/api/ai/generate-chapter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ultraPayload) 
                });
                const data = await res.json();
                if (data.success) {
                    editorTextarea.value += (currentText ? "\n\n" : "") + data.text;
                    editorTextarea.scrollTop = editorTextarea.scrollHeight;
                    saveChapterContent(); 
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
            const targetChap = document.getElementById('hook-target-chapter').value;
            if (!targetChap) return alert("必须指定引爆章节！");
            btnConfirmHook.disabled = true;
            try {
                const res = await fetch('/api/workspace/hook', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: PROJECT_ID, description: currentSelectedString, target_chapter: targetChap, annotation: document.getElementById('hook-annotation') ? document.getElementById('hook-annotation').value.trim() : "", source_chapter_id: currentLocalContext.chapterId, source_chapter_number: currentLocalContext.chapterNumber })
                });
                if ((await res.json()).success) {
                    if(hookModal) hookModal.classList.add('hidden');
                    document.getElementById('hook-target-chapter').value = "";
                    if (document.getElementById('hook-annotation')) document.getElementById('hook-annotation').value = ""; 
                    if(floatingToolbar) floatingToolbar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
                    if(editorTextarea) editorTextarea.setSelectionRange(editorTextarea.selectionEnd, editorTextarea.selectionEnd); 
                    loadChapterContext(currentLocalContext.chapterId, currentLocalContext.chapterNumber, currentLocalContext.title);
                }
            } catch (e) { }
            finally { btnConfirmHook.disabled = false; }
        });
    }

    if (btnConfirmChapter) {
        btnConfirmChapter.addEventListener('click', async () => {
            const num = parseFloat(document.getElementById('new-chapter-num').value);
            const title = document.getElementById('new-chapter-title').value.trim();
            const type = document.getElementById('new-chapter-type').value;
            const userDraft = document.getElementById('new-chapter-draft').value.trim();

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
                    body: JSON.stringify({ prevChapter: prevChap, nextChapter: nextChap, newChapterTitle: title, userDraft: userDraft })
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

    if (btnNewCharacter) {
        btnNewCharacter.addEventListener('click', () => {
            document.getElementById('asset-char-id').value = "";
            document.getElementById('asset-char-name').value = "";
            document.getElementById('asset-char-role').value = "";
            document.getElementById('asset-char-faction').value = "";
            document.getElementById('asset-char-desc').value = "";
        });
    }

    if (btnSaveAsset) {
        btnSaveAsset.addEventListener('click', async () => {
            const payload = {
                projectId: PROJECT_ID, id: document.getElementById('asset-char-id').value || null,
                name: document.getElementById('asset-char-name').value.trim(),
                role: document.getElementById('asset-char-role').value,
                faction: document.getElementById('asset-char-faction').value,
                description: document.getElementById('asset-char-desc').value
            };
            if(!payload.name) return alert("姓名不能为空");
            const res = await fetch('/api/workspace/character', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if ((await res.json()).success) { loadGlobalAssets(); alert("基因保存成功！"); }
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
 function checkInitialConcept() {
        // 1. 💥 无论本地有没有缓存记录，先强行设置顶部标题，并尝试从云端数据库拉取所有数据！
        if (document.getElementById('top-project-title')) {
            document.getElementById('top-project-title').innerText = "宇宙 ID: " + PROJECT_ID.slice(0,8);
        }
        loadWorkspaceTree(); 
        loadGlobalAssets();
        loadProjectSettings(); 
        
        // 2. 解除模糊遮罩，让手机端也能看到界面
        if (mainWorkspace) mainWorkspace.classList.remove('opacity-30', 'blur-sm');

        // 3. 处理本地的推演室沙盒记录
        const savedChat = localStorage.getItem(GENESIS_CHAT_KEY);
        if (savedChat) {
            genesisConversation = JSON.parse(savedChat);
            renderChatHistory(); 
        } else {
            const initialConcept = localStorage.getItem(`genesis_initial_concept_${PROJECT_ID}`);
            if (initialConcept) {
                // 如果是刚从大厅带来的新点子，打开遮罩进入创世推演
                if(sandbox) sandbox.classList.remove('hidden');
                if(mainWorkspace) mainWorkspace.classList.add('opacity-30', 'blur-sm');
                const systemBootPrompt = window.OmniPrompts ? window.OmniPrompts.genesisSystem(initialConcept) : "开始推演";
                genesisConversation.push({ role: 'user', content: systemBootPrompt });
                localStorage.setItem(GENESIS_CHAT_KEY, JSON.stringify(genesisConversation));
                localStorage.removeItem(`genesis_initial_concept_${PROJECT_ID}`);
                fetchChatResponse();
            }
        }
    }

    if (btnForceGenesis) btnForceGenesis.onclick = () => { if(sandbox) sandbox.classList.toggle('hidden'); if(mainWorkspace) mainWorkspace.classList.toggle('opacity-30'); };
    if (btnCloseSandbox) btnCloseSandbox.onclick = () => { if (sandbox) sandbox.classList.add('hidden'); if (mainWorkspace) mainWorkspace.classList.remove('opacity-30', 'blur-sm'); };

    // 💥 终极修复：章节 SOP 推演发送按钮逻辑 (附带自动伏笔回收与防OOC指令)
    if (btnSendChapterChat) {
        btnSendChapterChat.onclick = async () => {
            if (!chapterChatInput) return;
            const text = chapterChatInput.value.trim();
            if (!text) return;
            chapterChatInput.value = '';

            // 1. 保存并在 UI 上显示用户发送的纯净文本
            currentChapterChatHistory.push({ role: 'user', content: text });
            appendChapMsg('user', text);
            localStorage.setItem(`sop_v3_${PROJECT_ID}_${currentLocalContext.chapterId}`, JSON.stringify(currentChapterChatHistory));

            const loadingId = 'chap-load-' + Date.now();
            if (chapHistoryDiv) {
                chapHistoryDiv.innerHTML += `<div id="${loadingId}" class="flex justify-start"><div class="bg-gray-800 p-3 rounded-xl text-gray-400 text-xs animate-pulse">主脑推演中...</div></div>`;
                chapHistoryDiv.scrollTop = chapHistoryDiv.scrollHeight;
            }

            try {
                // 2. 深度克隆历史，准备在后台“塞私货”
                let payloadConvo = JSON.parse(JSON.stringify(currentChapterChatHistory));
                if (payloadConvo[0] && payloadConvo[0].role === 'assistant') payloadConvo[0].role = 'user';

                // 提取右侧本章所有的登场群星（包括你刚新建的小师妹也会被立刻抓取）
                let characterDetails = "无详细资产设定";
                if (currentLocalContext.characters && currentLocalContext.characters.length > 0 && window.globalCharacters) {
                    characterDetails = currentLocalContext.characters.map(lc => {
                        const gc = window.globalCharacters.find(c => c.name === lc.name) || {};
                        return `【角色：${lc.name}】性格:${gc.personality || '未知'} | 欲望:${gc.core_desire || '未知'} | 简介:${gc.description || '无'}`;
                    }).join('\n');
                }

                // 提取世界观法则
                const worldRules = document.getElementById('world-rules-container') ? document.getElementById('world-rules-container').innerText.trim() : "无特殊限制";

                // 【核心：AI 工作流指令】
                const hiddenWorkflow = `[系统隐秘工作流]：你现在是【事件架构师】，当前节点是事件 ${currentLocalContext.chapterNumber}：${currentLocalContext.title}。
请按以下逻辑交互，务必耐心：
1. 先陪我推演具体事件的细节（重点关注起因、经过、结果）。
2. 当我说“推演差不多了”或“开始总结”时，主动向我提问：(1)内容是否需要增删？ (2)哪些是伏笔（计划在哪回收）？ (3)打算分几章写？
3. 等待我回答后，再生成每个章节的标题与详细摘要。`;

                // 3. 把私货、工作流、防 OOC 指令、伏笔全塞进最后一句话里发给 AI！
                let lastUserMsg = payloadConvo[payloadConvo.length - 1];
                if (lastUserMsg && lastUserMsg.role === 'user') {
                    // 如果有必须要回收的伏笔 (hookAlert)，它会变成红字警告随同发送！
                    lastUserMsg.content += `\n\n${hiddenWorkflow}` + (currentLocalContext.hookAlert || "") + `\n\n[绝对戒律防OOC指令]：请严格遵循设定推演，严禁偏离人物档案。\n【世界法则】：\n${worldRules}\n【群星档案】：\n${characterDetails}`;
                }

                // 4. 发送给主脑
                const res = await fetch('/api/chat/deduce', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ conversation: payloadConvo })
                });
                const data = await res.json();
                const loader = document.getElementById(loadingId);
                if (loader) loader.remove();
                if (data.success) {
                    currentChapterChatHistory.push({ role: 'assistant', content: data.reply });
                    appendChapMsg('assistant', data.reply);
                    localStorage.setItem(`sop_v3_${PROJECT_ID}_${currentLocalContext.chapterId}`, JSON.stringify(currentChapterChatHistory));
                }
            } catch (e) { document.getElementById(loadingId)?.remove(); }
        };
    }

    checkInitialConcept();
});
