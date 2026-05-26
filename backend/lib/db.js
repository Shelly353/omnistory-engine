const supabase = require('./supabaseClient');

const memory = {
  projects: [],
  story_bibles: [],
  canon_facts: [],
  characters: [],
  secrets: [],
  foreshadowing_hooks: [],
  story_events: [],
  chapter_contracts: [],
  chapters: [],
  state_snapshots: [],
  state_transitions: [],
  proposed_facts: [],
  audit_findings: [],
  generation_runs: []
};

function id() {
  return crypto.randomUUID();
}

async function insert(table, row) {
  if (supabase) {
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  }
  const item = { id: id(), created_at: new Date().toISOString(), ...row };
  memory[table].push(item);
  return item;
}

async function insertMany(table, rows) {
  if (!rows.length) return [];
  if (supabase) {
    const { data, error } = await supabase.from(table).insert(rows).select();
    if (error) throw error;
    return data || [];
  }
  return rows.map(row => {
    const item = { id: id(), created_at: new Date().toISOString(), ...row };
    memory[table].push(item);
    return item;
  });
}

async function select(table, predicate = () => true, orderKey = '') {
  if (supabase) throw new Error('Use query builder for Supabase select');
  const rows = memory[table].filter(predicate);
  if (orderKey) rows.sort((a, b) => Number(a[orderKey] || 0) - Number(b[orderKey] || 0));
  return rows;
}

async function update(table, predicate, patch) {
  if (supabase) throw new Error('Use query builder for Supabase update');
  const rows = memory[table].filter(predicate);
  rows.forEach(row => Object.assign(row, patch, { updated_at: new Date().toISOString() }));
  return rows;
}

async function deleteByProject(table, projectId) {
  if (supabase) {
    const { error } = await supabase.from(table).delete().eq('project_id', projectId);
    if (error) throw error;
    return;
  }
  memory[table] = memory[table].filter(row => row.project_id !== projectId);
}

module.exports = { supabase, memory, insert, insertMany, select, update, deleteByProject };
