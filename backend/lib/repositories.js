const { supabase, memory, enrichDbError } = require('./db');

async function listByProject(table, projectId, order = '') {
  if (supabase) {
    let query = supabase.from(table).select('*').eq('project_id', projectId);
    if (order) query = query.order(order, { ascending: true });
    const { data, error } = await query;
    if (error) throw enrichDbError(error, table);
    return data || [];
  }
  const rows = memory[table].filter(row => row.project_id === projectId);
  if (order) rows.sort((a, b) => Number(a[order] || 0) - Number(b[order] || 0));
  return rows;
}

async function getProject(projectId) {
  if (supabase) {
    const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
    if (error) throw enrichDbError(error, 'projects');
    return data;
  }
  return memory.projects.find(project => project.id === projectId) || null;
}

async function getChapter(chapterId) {
  if (supabase) {
    const { data, error } = await supabase.from('chapters').select('*').eq('id', chapterId).single();
    if (error) throw enrichDbError(error, 'chapters');
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
    if (error) throw enrichDbError(error, 'chapter_contracts');
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
    if (error) throw enrichDbError(error, 'chapters');
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
    if (error) throw enrichDbError(error, 'chapters');
    return data;
  }
  const found = memory.chapters.find(chapter => chapter.id === chapterId);
  Object.assign(found, patch, { updated_at: new Date().toISOString() });
  return found;
}

async function getEvent(eventId) {
  if (supabase) {
    const { data, error } = await supabase.from('story_events').select('*').eq('id', eventId).maybeSingle();
    if (error) throw enrichDbError(error, 'story_events');
    return data;
  }
  return memory.story_events.find(event => event.id === eventId) || null;
}

async function getCharacter(characterId) {
  if (supabase) {
    const { data, error } = await supabase.from('characters').select('*').eq('id', characterId).maybeSingle();
    if (error) throw enrichDbError(error, 'characters');
    return data;
  }
  return memory.characters.find(character => character.id === characterId) || null;
}

async function patchEvent(eventId, patch) {
  if (supabase) {
    const { data, error } = await supabase
      .from('story_events')
      .update(patch)
      .eq('id', eventId)
      .select()
      .single();
    if (error) throw enrichDbError(error, 'story_events');
    return data;
  }
  const found = memory.story_events.find(event => event.id === eventId);
  if (!found) return null;
  Object.assign(found, patch);
  return found;
}

async function deleteEvent(eventId) {
  if (supabase) {
    const { error } = await supabase.from('story_events').delete().eq('id', eventId);
    if (error) throw enrichDbError(error, 'story_events');
    return;
  }
  memory.story_events = memory.story_events.filter(event => event.id !== eventId);
}

async function patchCharacter(characterId, patch) {
  if (supabase) {
    const { data, error } = await supabase
      .from('characters')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', characterId)
      .select()
      .single();
    if (error) throw enrichDbError(error, 'characters');
    return data;
  }
  const found = memory.characters.find(character => character.id === characterId);
  if (!found) return null;
  Object.assign(found, patch, { updated_at: new Date().toISOString() });
  return found;
}

async function deleteCharacter(characterId) {
  if (supabase) {
    const { error } = await supabase.from('characters').delete().eq('id', characterId);
    if (error) throw enrichDbError(error, 'characters');
    return;
  }
  memory.characters = memory.characters.filter(character => character.id !== characterId);
}

async function upsertContract(row) {
  if (supabase) {
    const { data, error } = await supabase
      .from('chapter_contracts')
      .upsert(row, { onConflict: 'project_id,chapter_number' })
      .select()
      .single();
    if (error) throw enrichDbError(error, 'chapter_contracts');
    return data;
  }
  let found = memory.chapter_contracts.find(item => item.project_id === row.project_id && item.chapter_number === row.chapter_number);
  if (found) Object.assign(found, row);
  else {
    found = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
    memory.chapter_contracts.push(found);
  }
  return found;
}

module.exports = {
  listByProject,
  getProject,
  getChapter,
  getEvent,
  getCharacter,
  getContractForChapter,
  upsertContract,
  upsertChapter,
  patchChapter,
  patchEvent,
  deleteEvent,
  patchCharacter,
  deleteCharacter
};
