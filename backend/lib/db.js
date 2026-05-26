const supabase = require('./supabaseClient');
const fs = require('fs');
const path = require('path');

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

function isMissingTableError(error) {
  const message = String(error?.message || '');
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /schema cache/i.test(message)
    || /Could not find the table/i.test(message)
    || /relation .* does not exist/i.test(message);
}

function enrichDbError(error, table) {
  if (!isMissingTableError(error)) return error;
  const enriched = new Error(`Supabase 尚未创建表 public.${table}，或 Data API schema cache 尚未刷新。请在 Supabase SQL Editor 执行仓库中的 supabase/schema.sql，然后等待 10-30 秒或重启 Render 服务。原始错误：${error.message}`);
  enriched.code = error.code;
  enriched.setupRequired = true;
  enriched.table = table;
  return enriched;
}

function readSetupSql() {
  return fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
}

async function insert(table, row) {
  if (supabase) {
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) throw enrichDbError(error, table);
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
    if (error) throw enrichDbError(error, table);
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
    if (error) throw enrichDbError(error, table);
    return;
  }
  memory[table] = memory[table].filter(row => row.project_id !== projectId);
}

module.exports = { supabase, memory, insert, insertMany, select, update, deleteByProject, enrichDbError, readSetupSql };
