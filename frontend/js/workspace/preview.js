// frontend/js/workspace/preview.js
window.OmniWorkspacePreview = (() => {
    function getNarrativeLogic(bible) {
        const chapters = bible?.chapters || [];
        const logic = bible?.narrative_logic || {};
        const presentationOrder = Array.isArray(logic.presentation_order) && logic.presentation_order.length > 0
            ? logic.presentation_order
            : chapters.map((chapter, index) => ({
                order: index + 1,
                source_chapter_number: chapter.chapter_number || index + 1,
                title: chapter.title || '',
                purpose: '按真实时间线推进',
                transition: ''
            }));

        return {
            mode: logic.mode || '顺叙',
            description: logic.description || '',
            presentation_order: presentationOrder
        };
    }

    function escapePreviewValue(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    function getCharacterEventCount(character, bible) {
        const name = String(character?.name || '').trim();
        if (!name) return 0;
        const eventTexts = [
            ...(bible?.chapters || []).map(ch => `${ch.title || ''}\n${ch.content || ''}`),
            ...(bible?.timeline || []).map(t => `${t.time_label || ''}\n${t.description || ''}`)
        ];
        return eventTexts.filter(text => String(text || '').includes(name)).length;
    }

    function getCharacterUsageStyle(count) {
        if (count <= 0) return { border: 'border-red-700/70', badge: 'bg-red-950 text-red-300 border-red-800', label: '未绑定事件' };
        if (count === 1) return { border: 'border-orange-600/70', badge: 'bg-orange-950 text-orange-300 border-orange-800', label: '一次性风险' };
        if (count === 2) return { border: 'border-yellow-600/70', badge: 'bg-yellow-950 text-yellow-300 border-yellow-800', label: '需再复用' };
        return { border: 'border-blue-800/60', badge: 'bg-blue-950 text-blue-300 border-blue-800', label: '已复用' };
    }

    function splitReferenceMaterials(rules = '') {
        const text = String(rules || '');
        const marker = '【参考资料摘录】';
        const index = text.indexOf(marker);
        if (index === -1) return { rules: text, materials: '' };
        return {
            rules: text.slice(0, index).trim(),
            materials: text.slice(index + marker.length).trim()
        };
    }

    function renderCharacterCard(c = {}, bible = {}) {
        const eventCount = getCharacterEventCount(c, bible);
        const usage = getCharacterUsageStyle(eventCount);
        return `
            <div class="prev-char-item group relative bg-gray-900 rounded-lg border ${usage.border} hover:border-blue-500 transition-all duration-300" data-original-name="${escapePreviewValue(c.name || '')}">
                <div class="flex space-x-2 p-2 relative z-10 bg-gray-900 rounded-lg">
                    <input type="text" class="w-1/6 bg-gray-950 border border-gray-600 rounded-md p-2 text-white text-xs char-name" value="${escapePreviewValue(c.name || '')}" placeholder="姓名">
                    <input type="text" class="w-1/6 bg-gray-950 border border-gray-600 rounded-md p-2 text-blue-300 text-xs char-role" value="${escapePreviewValue(c.role || '')}" placeholder="定位">
                    <input type="text" class="w-1/6 bg-gray-950 border border-gray-600 rounded-md p-2 text-yellow-300 text-xs char-faction" value="${escapePreviewValue(c.faction || '')}" placeholder="阵营">
                    <input type="text" class="flex-1 bg-gray-950 border border-gray-600 rounded-md p-2 text-gray-300 text-xs char-desc" value="${escapePreviewValue(c.description || '')}" placeholder="一句话简介">
                    <span class="shrink-0 text-[10px] px-2 py-1 rounded border ${usage.badge}" title="当前人物出现在事件/时间轴中的次数">${usage.label} · ${eventCount}</span>
                    <button type="button" onclick="removeSandboxPreviewItem(this)" class="shrink-0 text-red-300 hover:text-white hover:bg-red-700 border border-red-900/60 rounded px-2" title="删除人物"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </div>
                <div class="max-h-0 overflow-hidden group-hover:max-h-[800px] transition-all duration-500 ease-in-out opacity-0 group-hover:opacity-100 px-3 pb-3">
                    <div class="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-700">
                        <div><label class="text-[9px] text-gray-500">年龄</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-age" value="${escapePreviewValue(c.age || '')}"></div>
                        <div><label class="text-[9px] text-gray-500">外貌特征</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-app" value="${escapePreviewValue(c.appearance || '')}"></div>
                        <div><label class="text-[9px] text-gray-500">职业</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-prof" value="${escapePreviewValue(c.profession || '')}"></div>
                        <div class="col-span-3"><label class="text-[9px] text-gray-500">性格 (MBTI)</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-pers" value="${escapePreviewValue(c.personality || '')}"></div>
                        <div class="col-span-3"><label class="text-[9px] text-gray-500">核心欲望 (Want) & 目标 (Goal)</label><div class="flex space-x-2"><input type="text" class="w-1/2 bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-desire" value="${escapePreviewValue(c.core_desire || '')}"><input type="text" class="w-1/2 bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-goal" value="${escapePreviewValue(c.goal || '')}"></div></div>
                        <div class="col-span-3"><label class="text-[9px] text-gray-500">动机 (Motivation)</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-motiv" value="${escapePreviewValue(c.motivation || '')}"></div>
                        <div class="col-span-3"><label class="text-[9px] text-gray-500">缺陷 (Flaw) & 恐惧 (Fear)</label><div class="flex space-x-2"><input type="text" class="w-1/2 bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-flaw" value="${escapePreviewValue(c.flaw || '')}"><input type="text" class="w-1/2 bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-fear" value="${escapePreviewValue(c.fear || '')}"></div></div>
                        <div class="col-span-3"><label class="text-[9px] text-gray-500">能力/技能</label><input type="text" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white char-skills" value="${escapePreviewValue(c.skills || '')}"></div>
                        <div class="col-span-3"><label class="text-[9px] text-gray-500">重要经历</label><textarea class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white h-12 resize-none char-bg">${escapePreviewValue(c.background || '')}</textarea></div>
                        <div class="col-span-3"><label class="text-[9px] text-gray-500 font-bold text-purple-400">角色成长弧光</label><textarea class="w-full bg-gray-950 border border-purple-900/50 rounded p-1.5 text-xs text-white h-12 resize-none char-arc">${escapePreviewValue(c.character_arc || '')}</textarea></div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderHumanPreview(container, bible) {
        if (!container) return;

        const genreOptions = ["屋里有鬼", "金羊毛", "神灯出窍", "面临困境", "成长仪式", "伙伴情谊", "推理侦探", "愚者成功", "进退两难", "超级英雄", "未分类/其他"];
        const genreSelectHTML = genreOptions.map(g => `<option value="${g}" ${bible.genre === g ? 'selected' : ''}>${g}</option>`).join('');
        const narrativeLogic = getNarrativeLogic(bible);
        const splitRules = splitReferenceMaterials(bible.rules || '');
        const narrativeModes = ["顺叙", "倒叙", "双线叙事", "多视角", "框架叙事", "非线性", "其他"];
        const narrativeModeHTML = narrativeModes.map(m => `<option value="${m}" ${narrativeLogic.mode === m ? 'selected' : ''}>${m}</option>`).join('');

        let html = `
            <div class="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border border-gray-800 rounded-xl p-2 mb-4 grid grid-cols-3 gap-2">
                <button type="button" data-sandbox-module-button="events" onclick="switchSandboxModule('events')" class="sandbox-module-btn py-2 rounded-lg text-xs font-bold border border-purple-900/50 text-purple-300 bg-purple-950/30">事件讨论</button>
                <button type="button" data-sandbox-module-button="characters" onclick="switchSandboxModule('characters')" class="sandbox-module-btn py-2 rounded-lg text-xs font-bold border border-gray-800 text-gray-400 bg-gray-900">人物设定</button>
                <button type="button" data-sandbox-module-button="rules" onclick="switchSandboxModule('rules')" class="sandbox-module-btn py-2 rounded-lg text-xs font-bold border border-gray-800 text-gray-400 bg-gray-900">规则/专家</button>
            </div>

            <div class="sandbox-module" data-sandbox-module="rules">
            <div class="bg-gray-800/50 p-5 rounded-xl border border-cyan-800/70">
                <h4 class="text-cyan-400 font-bold mb-3 flex items-center"><i data-lucide="shield-alert" class="w-4 h-4 mr-2"></i>规则最高权限与专家系统</h4>
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
                        <textarea id="prev-rules" class="w-full bg-gray-900 border border-gray-600 rounded-lg p-2.5 text-cyan-300 text-sm h-32 focus:border-cyan-500 transition" placeholder="规则拥有最高权限。这里写你的具体设定即可：朝代/年代、是否架空、律所/医院/官府/军队等特殊规则。历史、法律、医疗、警务等专家基础审查标准已在后台内置。">${escapePreviewValue(splitRules.rules)}</textarea>
                    </div>
                    <div class="relative group/field">
                        <label class="text-[10px] text-gray-500 font-bold uppercase mb-1 block">参考资料摘录</label>
                        <textarea id="prev-source-materials" class="w-full bg-gray-900 border border-gray-600 rounded-lg p-2.5 text-amber-200 text-sm h-28 focus:border-amber-500 transition" placeholder="把 PDF/网页/TXT/图片 OCR 后的关键资料粘贴成短摘录。建议每条注明来源、时代/领域、可用于哪些事件，以及哪些内容不能乱写。">${escapePreviewValue(splitRules.materials || bible.source_materials || '')}</textarea>
                    </div>
                    <div class="bg-gray-950 border border-amber-900/40 rounded-xl p-3">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-amber-300 text-xs font-bold flex items-center"><i data-lucide="folder-open" class="w-3 h-3 mr-1"></i>本地资料库</span>
                            <div class="flex gap-2">
                                <button type="button" onclick="openLocalSourceQa()" class="text-[10px] px-2 py-1 bg-cyan-900/30 text-cyan-200 border border-cyan-800 rounded hover:bg-cyan-700 hover:text-white">问资料</button>
                                <label class="text-[10px] px-2 py-1 bg-amber-900/30 text-amber-200 border border-amber-800 rounded hover:bg-amber-700 hover:text-white cursor-pointer">
                                    选择文件
                                    <input id="local-source-files" type="file" multiple class="hidden" onchange="ingestLocalSourceFiles(this.files); this.value='';">
                                </label>
                            </div>
                        </div>
                        <div class="text-[10px] text-gray-500 mb-2 leading-relaxed">资料只保存在本机浏览器，不上传云端。点“问资料”可让 AI 只根据本地命中片段回答。支持 TXT/MD/HTML/CSV/JSON、PDF，以及图片 OCR。</div>
                        <div id="local-source-list" class="space-y-1.5 text-xs text-amber-100/80"></div>
                    </div>
                    <div class="bg-gray-950 border border-yellow-900/40 rounded-xl p-3">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-yellow-400 text-xs font-bold flex items-center"><i data-lucide="siren" class="w-3 h-3 mr-1"></i>规则最高权限审查</span>
                            <button type="button" onclick="runSandboxRuleAudit()" class="text-[10px] px-2 py-1 bg-yellow-900/30 text-yellow-300 border border-yellow-800 rounded hover:bg-yellow-700 hover:text-white">手动检测</button>
                        </div>
                        <div id="sandbox-rule-alarm" class="text-xs text-yellow-200/80 whitespace-pre-wrap leading-relaxed">规则审查会在刷新面板或手动检测时运行。</div>
                    </div>
                </div>
            </div>
            </div>

            <div class="sandbox-module hidden" data-sandbox-module="characters">
            <div class="bg-gray-800/50 p-5 rounded-xl border border-gray-700 mt-6">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="text-blue-400 font-bold flex items-center"><i data-lucide="users" class="w-4 h-4 mr-2"></i>2. 登场群星 (表头：姓名/定位/阵营/一句话简介)</h4>
                    <button type="button" onclick="addSandboxCharacter()" class="text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold flex items-center"><i data-lucide="user-plus" class="w-3 h-3 mr-1"></i>新增人物</button>
                </div>
                <div class="text-[10px] text-gray-500 mb-2 italic">提示：鼠标悬停展开 12 维设定。角色参与事件少于 3 次会标色提醒，避免沦为一次性人物。</div>
                <div class="space-y-2 mb-6" id="prev-chars-list">
                    ${(bible.characters||[]).map(c => renderCharacterCard(c, bible)).join('')}
                </div>

                <h4 class="text-emerald-400 font-bold mb-3 flex items-center"><i data-lucide="network" class="w-4 h-4 mr-2"></i>3. 人物情感羁绊 (表头：发起人 ➔ 接收人 | 羁绊类型)</h4>
                <div class="space-y-2" id="prev-rels-list">
                    ${(bible.relations||[]).map(r => `
                        <div class="flex space-x-3 items-center prev-rel-item bg-gray-900 p-2 rounded-lg border border-gray-700">
                            <input type="text" class="w-1/3 bg-gray-950 border border-gray-600 rounded-md p-2 text-white text-xs text-center rel-from" value="${escapePreviewValue(r.from_name || '')}" placeholder="发起人">
                            <span class="text-gray-500 font-bold">➔</span>
                            <input type="text" class="w-1/3 bg-gray-950 border border-gray-600 rounded-md p-2 text-white text-xs text-center rel-to" value="${escapePreviewValue(r.to_name || '')}" placeholder="接收人">
                            <input type="text" class="w-1/3 bg-gray-950 border border-gray-600 rounded-md p-2 text-emerald-300 font-bold text-xs text-center rel-label" value="${escapePreviewValue(r.label || '')}" placeholder="羁绊关系">
                            <button type="button" onclick="removeSandboxPreviewItem(this)" class="text-red-300 hover:text-white hover:bg-red-700 border border-red-900/60 rounded px-2 self-stretch" title="删除羁绊"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                        </div>
                    `).join('')}
                </div>
            </div>
            </div>

            <div class="sandbox-module hidden" data-sandbox-module="events">
            <div class="bg-gray-800/50 p-5 rounded-xl border border-gray-700 mt-6">
                <h4 class="text-indigo-400 font-bold mb-3 flex items-center"><i data-lucide="clock" class="w-4 h-4 mr-2"></i>4. 细密时间轴事件 (表头：时间标度 | 所属章节 | 事件描述)</h4>
                <div class="space-y-2" id="prev-tl-list">
                    ${(bible.timeline||[]).map(t => `
                        <div class="flex space-x-2 prev-tl-item bg-gray-900 p-2 rounded-lg border border-gray-700">
                            <input type="text" class="w-1/4 bg-gray-950 border border-gray-600 rounded-md p-2 text-indigo-300 font-bold text-xs tl-time" value="${escapePreviewValue(t.time_label || '')}" placeholder="时间标度">
                            <input type="number" class="w-16 bg-gray-950 border border-gray-600 rounded-md p-2 text-white text-xs text-center tl-chap" value="${t.chapter_number || 1}" placeholder="发生章">
                            <input type="text" class="flex-1 bg-gray-950 border border-gray-600 rounded-md p-2 text-gray-300 text-xs tl-desc" value="${escapePreviewValue(t.description || '')}" placeholder="事件描述">
                            <button type="button" onclick="removeSandboxPreviewItem(this)" class="text-red-300 hover:text-white hover:bg-red-700 border border-red-900/60 rounded px-2" title="删除时间轴事件"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="bg-gray-800/50 p-5 rounded-xl border border-gray-700 mt-6">
                <h4 class="text-amber-400 font-bold mb-3 flex items-center"><i data-lucide="route" class="w-4 h-4 mr-2"></i>5. 叙事逻辑与呈现顺序</h4>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                        <label class="text-[10px] text-gray-500 font-bold uppercase mb-1 block">叙事结构</label>
                        <select id="prev-narrative-mode" class="w-full bg-gray-900 border border-gray-600 rounded-lg p-2.5 text-amber-300 text-sm focus:border-amber-500 transition">${narrativeModeHTML}</select>
                    </div>
                    <div class="md:col-span-2">
                        <label class="text-[10px] text-gray-500 font-bold uppercase mb-1 block">结构理由</label>
                        <textarea id="prev-narrative-desc" class="w-full bg-gray-900 border border-gray-600 rounded-lg p-2.5 text-gray-200 text-sm h-20 focus:border-amber-500 transition" placeholder="说明为什么采用这种叙事结构，以及它如何服务人物弧线、悬念和信息释放。">${escapePreviewValue(narrativeLogic.description)}</textarea>
                    </div>
                </div>
                <div class="text-[10px] text-gray-500 mb-2 italic">这里决定 SOP 之后创建大纲和写作的阅读顺序；时间轴仍保留真实发生顺序。</div>
                <div class="space-y-2" id="prev-narrative-order-list">
                    ${narrativeLogic.presentation_order.map(item => `
                        <div class="prev-narrative-item bg-gray-900 p-2 rounded-lg border border-gray-700">
                            <div class="flex space-x-2 items-center mb-2">
                                <span class="text-gray-500 font-bold text-xs pl-1">读者第</span>
                                <input type="number" class="w-14 bg-gray-950 border border-gray-600 rounded-md p-1.5 text-white text-xs text-center nar-order" value="${item.order || 1}">
                                <span class="text-gray-500 font-bold text-xs">段</span>
                                <span class="text-gray-500 text-xs">取自原第</span>
                                <input type="number" class="w-14 bg-gray-950 border border-gray-600 rounded-md p-1.5 text-white text-xs text-center nar-source" value="${item.source_chapter_number || item.chapter_number || 1}">
                                <span class="text-gray-500 text-xs">章</span>
                                <input type="text" class="flex-1 bg-gray-950 border border-gray-600 rounded-md p-2 text-amber-300 font-bold text-xs nar-title" value="${escapePreviewValue(item.title)}" placeholder="呈现标题">
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <input type="text" class="bg-gray-950 border border-gray-600 rounded-md p-2 text-gray-300 text-xs nar-purpose" value="${escapePreviewValue(item.purpose)}" placeholder="叙事作用：悬念/对照/信息差/情绪推进">
                                <input type="text" class="bg-gray-950 border border-gray-600 rounded-md p-2 text-gray-300 text-xs nar-transition" value="${escapePreviewValue(item.transition)}" placeholder="与下一段的衔接方式">
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="bg-gray-800/50 p-5 rounded-xl border border-gray-700 mt-6">
                <h4 class="text-pink-400 font-bold mb-3 flex items-center"><i data-lucide="book" class="w-4 h-4 mr-2"></i>6. 预设章节大纲 (表头：章节号 | 标题 | 核心梗概)</h4>
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
            </div>
        `;
        container.innerHTML = html;
        const activeModule = localStorage.getItem('omnistory_sandbox_module') || 'events';
        window.switchSandboxModule(activeModule);
        if(window.lucide) lucide.createIcons();
    }

    window.switchSandboxModule = (moduleName) => {
        localStorage.setItem('omnistory_sandbox_module', moduleName);
        document.querySelectorAll('[data-sandbox-module]').forEach(el => {
            el.classList.toggle('hidden', el.dataset.sandboxModule !== moduleName);
        });
        document.querySelectorAll('[data-sandbox-module-button]').forEach(btn => {
            const active = btn.dataset.sandboxModuleButton === moduleName;
            btn.classList.toggle('bg-purple-950/30', active);
            btn.classList.toggle('text-purple-300', active);
            btn.classList.toggle('border-purple-900/50', active);
            btn.classList.toggle('bg-gray-900', !active);
            btn.classList.toggle('text-gray-400', !active);
            btn.classList.toggle('border-gray-800', !active);
        });
    };

    window.addSandboxCharacter = () => {
        const list = document.getElementById('prev-chars-list');
        if (!list) return;
        list.insertAdjacentHTML('beforeend', renderCharacterCard({
            description: '先写一句话：这个人物为什么参与当前事件，以及后续还能在哪两个事件中复用。'
        }, { chapters: [], timeline: [] }));
        if (window.lucide) lucide.createIcons();
        const latest = list.lastElementChild;
        latest?.querySelector('.char-name')?.focus();
    };

    window.removeSandboxPreviewItem = (button) => {
        const item = button?.closest('.prev-char-item, .prev-rel-item, .prev-tl-item, .prev-chap-item, .prev-narrative-item');
        if (!item) return;
        if (item.classList.contains('prev-char-item') && window.getSandboxCharacterDeleteWarning) {
            const warning = window.getSandboxCharacterDeleteWarning(item);
            if (warning && !confirm(warning)) return;
        } else if (!confirm('确认删除这一条设定吗？')) return;
        item.remove();
        document.getElementById('human-preview-container')?.dispatchEvent(new Event('input', { bubbles: true }));
    };

    return {
        renderHumanPreview
    };
})();
