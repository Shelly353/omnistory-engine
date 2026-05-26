const { supabase, memory } = require('./db');

async function listByProject(table, projectId, order = '') {
  if (supabase) {
    let query = supabase.from(table).select('*').eq('project_id', projectId);
    if (order) query = query.order(order, { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
  const rows = memory[table].filter(row => row.project_id === projectId);
  if (order) rows.sort((a, b) => Number(a[order] || 0) - Number(b[order] || 0));
  return rows;
}

async function getProject(projectId) {
  if (supabase) {
    const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
    if (error) throw error;
    return data;
  }
  return memory.projects.find(project => project.id === projectId) || null;
}

async function getChapter(chapterId) {
  if (supabase) {
    const { data, error } = await supabase.from('chapters').select('*').eq('id', chapterId).single();
    if (error) throw error;
    return data;
  }
  return memory.chapters.find(chapter => chapter.id === chapterId) || null;
}

async function getContractForChapter(projectId, chapterNumber) {
  if (supabase) {
    const { data, error } = await supabase
      .from('chapter_contracts')
      .select('*')
      .eq('project_id', projectId)
      .eq('chapter_number', chapterNumber)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  return memory.chapter_contracts.find(item => item.project_id === projectId && item.chapter_number === chapterNumber) || null;
}

async function upsertChapter(row) {
  if (supabase) {
    const { data, error } = await supabase
      .from('chapters')
      .upsert(row, { onConflict: 'project_id,chapter_number' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  let found = memory.chapters.find(item => item.project_id === row.project_id && item.chapter_number === row.chapter_number);
  if (found) Object.assign(found, row, { updated_at: new Date().toISOString() });
  else {
    found = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
    memory.chapters.push(found);
  }
  return found;
}

async function patchChapter(chapterId, patch) {
  if (supabase) {
    const { data, error } = await supabase
      .from('chapters')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', chapterId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const found = memory.chapters.find(chapter => chapter.id === chapterId);
  Object.assign(found, patch, { updated_at: new Date().toISOString() });
  return found;
}

module.exports = {
  listByProject,
  getProject,
  getChapter,
  getContractForChapter,
  upsertChapter,
  patchChapter
};
