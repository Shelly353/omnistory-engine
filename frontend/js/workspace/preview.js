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

    function renderHumanPreview(container, bible) {
        if (!container) return;

        const genreOptions = ["屋里有鬼", "金羊毛", "神灯出窍", "面临困境", "成长仪式", "伙伴情谊", "推理侦探", "愚者成功", "进退两难", "超级英雄", "未分类/其他"];
        const genreSelectHTML = genreOptions.map(g => `<option value="${g}" ${bible.genre === g ? 'selected' : ''}>${g}</option>`).join('');
        const narrativeLogic = getNarrativeLogic(bible);
        const narrativeModes = ["顺叙", "倒叙", "双线叙事", "多视角", "框架叙事", "非线性", "其他"];
        const narrativeModeHTML = narrativeModes.map(m => `<option value="${m}" ${narrativeLogic.mode === m ? 'selected' : ''}>${m}</option>`).join('');

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
        `;
        container.innerHTML = html;
        if(window.lucide) lucide.createIcons();
    }

    return {
        renderHumanPreview
    };
})();
