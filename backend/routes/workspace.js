// backend/routes/workspace.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const CLOUD_STATE_TABLE = 'workspace_cloud_state';
const CLOUD_STATE_SETUP_SQL = `create table if not exists public.workspace_cloud_state (
  project_id uuid not null,
  data_type text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (project_id, data_type)
);`;
const CHAPTER_CHARACTER_TABLE = 'chapter_characters';
const CHAPTER_CHARACTER_SETUP_SQL = `create table if not exists public.chapter_characters (
  chapter_id uuid not null,
  character_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (chapter_id, character_id)
);`;
const CHAPTER_CHARACTER_CLOUD_TYPE = '章节人物关联';

function isMissingCloudStateTable(error) {
    return error && (error.code === '42P01' || String(error.message || '').includes(CLOUD_STATE_TABLE));
}

function isMissingChapterCharacterTable(error) {
    return error && (error.code === '42P01' || String(error.message || '').includes(CHAPTER_CHARACTER_TABLE));
}

function textMentionsCharacter(text, characterName) {
    if (!text || !characterName) return false;
    return String(text).includes(String(characterName));
}

async function loadChapterCharacterCloudMap(projectId) {
    const { data, error } = await supabase
        .from(CLOUD_STATE_TABLE)
        .select('payload')
        .eq('project_id', projectId)
        .eq('data_type', CHAPTER_CHARACTER_CLOUD_TYPE)
        .maybeSingle();
    if (error) {
        if (isMissingCloudStateTable(error)) return {};
        throw error;
    }
    return data?.payload || {};
}

async function saveChapterCharacterCloudMap(projectId, payload) {
    const { error } = await supabase.from(CLOUD_STATE_TABLE).upsert({
        project_id: projectId,
        data_type: CHAPTER_CHARACTER_CLOUD_TYPE,
        payload,
        updated_at: new Date().toISOString()
    }, { onConflict: 'project_id,data_type' });
    if (error) throw error;
}

// 0. 跨设备工作区快照：保存
router.post('/cloud-sync', async (req, res) => {
    const { projectId, type = 'default', data = {} } = req.body;
    if (!projectId) return res.status(400).json({ success: false, error: '缺少 projectId' });

    try {
        if (!String(type).endsWith('::backup')) {
            const { data: previousState } = await supabase
                .from(CLOUD_STATE_TABLE)
                .select('payload, updated_at')
                .eq('project_id', projectId)
                .eq('data_type', type)
                .maybeSingle();

            if (previousState?.payload) {
                const backupType = `${type}::backup`;
                const { data: backupState } = await supabase
                    .from(CLOUD_STATE_TABLE)
                    .select('payload')
                    .eq('project_id', projectId)
                    .eq('data_type', backupType)
                    .maybeSingle();
                const items = Array.isArray(backupState?.payload?.items) ? backupState.payload.items : [];
                const latestPayload = items[0]?.payload ? JSON.stringify(items[0].payload) : '';
                const previousPayload = JSON.stringify(previousState.payload);
                if (latestPayload !== previousPayload) {
                    await supabase.from(CLOUD_STATE_TABLE).upsert({
                        project_id: projectId,
                        data_type: backupType,
                        payload: {
                            items: [
                                { saved_at: new Date().toISOString(), source_updated_at: previousState.updated_at, payload: previousState.payload },
                                ...items
                            ].slice(0, 5)
                        },
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'project_id,data_type' });
                }
            }
        }

        const { error } = await supabase.from(CLOUD_STATE_TABLE).upsert({
            project_id: projectId,
            data_type: type,
            payload: data,
            updated_at: new Date().toISOString()
        }, { onConflict: 'project_id,data_type' });

        if (error) {
            if (isMissingCloudStateTable(error)) {
                return res.status(501).json({ success: false, error: '云端快照表尚未创建', setupSql: CLOUD_STATE_SETUP_SQL });
            }
            throw error;
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 0. 跨设备工作区快照：读取
router.get('/cloud-sync/:projectId', async (req, res) => {
    const { projectId } = req.params;
    const { type = 'default' } = req.query;

    try {
        const { data, error } = await supabase
            .from(CLOUD_STATE_TABLE)
            .select('payload, updated_at')
            .eq('project_id', projectId)
            .eq('data_type', type)
            .maybeSingle();

        if (error) {
            if (isMissingCloudStateTable(error)) {
                return res.status(501).json({ success: false, error: '云端快照表尚未创建', setupSql: CLOUD_STATE_SETUP_SQL });
            }
            throw error;
        }

        res.json({ success: true, payload: data?.payload || null, updated_at: data?.updated_at || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 1. 获取大纲树
router.get('/tree/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('chapters').select('id, chapter_number, title, plot_type, content').eq('project_id', req.params.projectId).order('chapter_number', { ascending: true });
        if (error) throw error;
        res.json({ success: true, chapters: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 2. 获取单章上下文 (含角色和伏笔)
router.post('/context', async (req, res) => {
    const { projectId, chapterId, chapterNumber } = req.body;
    try {
        const { data: chapter, error: chapErr } = await supabase.from('chapters').select('*').eq('id', chapterId).single();
        if (chapErr) throw chapErr;

        const { data: allCharacters, error: charErr } = await supabase.from('characters').select('*').eq('project_id', projectId);
        if (charErr) throw charErr;

        const { data: chapters } = await supabase
            .from('chapters')
            .select('id, chapter_number, title, content, content_text')
            .eq('project_id', projectId)
            .order('chapter_number', { ascending: true });
        const sortedChapters = chapters || [];
        const currentIndex = sortedChapters.findIndex(ch => Number(ch.chapter_number) === Number(chapterNumber));
        const nextChapter = currentIndex >= 0 ? sortedChapters[currentIndex + 1] : null;
        const eventScope = [chapter, nextChapter].filter(Boolean);

        let linkedCharacterIds = new Set();
        const scopedChapterIds = eventScope.map(ch => ch.id).filter(Boolean);
        if (scopedChapterIds.length > 0) {
            const { data: links, error: linkErr } = await supabase
                .from(CHAPTER_CHARACTER_TABLE)
                .select('character_id')
                .in('chapter_id', scopedChapterIds);
            if (linkErr && !isMissingChapterCharacterTable(linkErr)) throw linkErr;
            if (isMissingChapterCharacterTable(linkErr)) {
                const cloudMap = await loadChapterCharacterCloudMap(projectId);
                scopedChapterIds.forEach(id => (cloudMap[id] || []).forEach(charId => linkedCharacterIds.add(charId)));
            } else {
                linkedCharacterIds = new Set((links || []).map(link => link.character_id));
            }
        }

        const eventText = eventScope
            .map(ch => [ch.title, ch.content, ch.content_text].filter(Boolean).join('\n'))
            .join('\n');
        const characters = (allCharacters || []).filter(char =>
            linkedCharacterIds.has(char.id) || textMentionsCharacter(eventText, char.name)
        );

        const { data: hooks } = await supabase
            .from('foreshadowing_hooks')
            .select('*')
            .eq('project_id', projectId)
            .or(`target_chapter.eq.${chapterNumber},source_chapter_number.eq.${chapterNumber}`)
            .order('target_chapter', { ascending: true });

        res.json({ success: true, chapter, characters: characters || [], hooks: hooks || [] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/context/character', async (req, res) => {
    const { projectId, chapterId, characterId } = req.body;
    if (!chapterId || !characterId) return res.status(400).json({ success: false, error: '缺少 chapterId 或 characterId' });

    try {
        const { error } = await supabase.from(CHAPTER_CHARACTER_TABLE).upsert({
            chapter_id: chapterId,
            character_id: characterId
        }, { onConflict: 'chapter_id,character_id' });

        if (error) {
            if (isMissingChapterCharacterTable(error)) {
                if (!projectId) return res.status(400).json({ success: false, error: '缺少 projectId，无法使用云端兜底保存章节人物关联' });
                const cloudMap = await loadChapterCharacterCloudMap(projectId);
                const current = new Set(cloudMap[chapterId] || []);
                current.add(characterId);
                cloudMap[chapterId] = Array.from(current);
                await saveChapterCharacterCloudMap(projectId, cloudMap);
                return res.json({ success: true, fallback: 'cloud_state' });
            }
            throw error;
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/context/character/:chapterId/:characterId', async (req, res) => {
    const { chapterId, characterId } = req.params;
    const { projectId } = req.query;

    try {
        const { error } = await supabase
            .from(CHAPTER_CHARACTER_TABLE)
            .delete()
            .eq('chapter_id', chapterId)
            .eq('character_id', characterId);

        if (error) {
            if (isMissingChapterCharacterTable(error)) {
                if (!projectId) return res.status(400).json({ success: false, error: '缺少 projectId，无法使用云端兜底移除章节人物关联' });
                const cloudMap = await loadChapterCharacterCloudMap(projectId);
                cloudMap[chapterId] = (cloudMap[chapterId] || []).filter(id => id !== characterId);
                await saveChapterCharacterCloudMap(projectId, cloudMap);
                return res.json({ success: true, fallback: 'cloud_state' });
            }
            throw error;
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 3. 保存单章正文
router.post('/save', async (req, res) => {
    const { chapterId, content_text } = req.body;
    try {
        const { error } = await supabase.from('chapters').update({ content_text }).eq('id', chapterId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 4. 新增章节
router.post('/chapter', async (req, res) => {
    const { projectId, chapterNumber, title, plotType, content, content_text } = req.body;
    try {
        const { error } = await supabase.from('chapters').insert([{
            project_id: projectId, chapter_number: chapterNumber, title, plot_type: plotType, content, content_text
        }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 5. 种植伏笔
router.post('/hook', async (req, res) => {
    const { projectId, id, description, target_chapter, annotation, source_chapter_id, source_chapter_number } = req.body;
    try {
        const payload = { project_id: projectId, description, target_chapter, annotation };
        if (source_chapter_id !== undefined) payload.source_chapter_id = source_chapter_id;
        if (source_chapter_number !== undefined) payload.source_chapter_number = source_chapter_number;
        const { error } = id
            ? await supabase.from('foreshadowing_hooks').update(payload).eq('id', id)
            : await supabase.from('foreshadowing_hooks').insert([payload]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/hooks/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('foreshadowing_hooks')
            .select('*')
            .eq('project_id', req.params.projectId)
            .order('source_chapter_number', { ascending: true });
        if (error) throw error;
        res.json({ success: true, hooks: data || [] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 6. 全局资产：获取角色
router.get('/characters/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('characters').select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: true });
        if (error) throw error;
        res.json({ success: true, characters: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 7. 全局资产：保存角色
router.post('/character', async (req, res) => {
    const { projectId, id, name, role, faction, description, age, appearance, profession, personality, core_desire, goal, motivation, flaw, fear, skills, background, character_arc } = req.body;
    try {
        const payload = { name, role, faction, description, age, appearance, profession, personality, core_desire, goal, motivation, flaw, fear, skills, background, character_arc };
        let error;
        if (id) {
            const { error: updateError } = await supabase.from('characters').update(payload).eq('id', id);
            error = updateError;
        } else {
            const { error: insertError } = await supabase.from('characters').insert([{ project_id: projectId, ...payload }]);
            error = insertError;
        }
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 8. 绝对时间轴：获取
router.get('/timeline/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('timeline_events').select('*').eq('project_id', req.params.projectId).order('chapter_number', { ascending: true });
        if (error) throw error;
        res.json({ success: true, events: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 8. 绝对时间轴：保存
router.post('/timeline', async (req, res) => {
    const { projectId, id, time_label, chapter_number, description } = req.body;
    try {
        const payload = { project_id: projectId, time_label, chapter_number: parseFloat(chapter_number), description };
        const { error } = id
            ? await supabase.from('timeline_events').update(payload).eq('id', id)
            : await supabase.from('timeline_events').insert([payload]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 8. 绝对时间轴：删除
router.delete('/timeline/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('timeline_events').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 9. 物理关系网：获取
router.get('/relations/:projectId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('character_relations').select('*').eq('project_id', req.params.projectId);
        if (error) throw error;
        res.json({ success: true, relations: data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 9. 物理关系网：保存
router.post('/relation', async (req, res) => {
    const { projectId, from_char_id, to_char_id, label } = req.body;
    try {
        const { error } = await supabase.from('character_relations').insert([{ project_id: projectId, from_char_id, to_char_id, label }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 9. 物理关系网：删除
router.delete('/relation/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('character_relations').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 10. 保存单章推演后的叙事大纲
router.post('/save-synopsis', async (req, res) => {
    const { chapterId, synopsis } = req.body;
    try {
        const { error } = await supabase.from('chapters').update({ content: synopsis }).eq('id', chapterId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
