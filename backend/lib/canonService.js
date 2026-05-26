const { insertMany } = require('./db');
const { listByProject } = require('./repositories');
const { cleanText } = require('./normalize');

function factsFromBible(projectId, bible = {}) {
  const facts = [];
  (bible.rules || []).forEach(rule => {
    facts.push({
      project_id: projectId,
      fact_type: 'world_rule',
      subject: '世界规则',
      predicate: '必须遵守',
      object: String(rule),
      source: 'story_bible',
      status: 'active'
    });
  });
  (bible.main_characters || []).forEach((char, index) => {
    const name = cleanText(char.name, index === 0 ? '主角' : `角色${index + 1}`);
    facts.push({
      project_id: projectId,
      fact_type: 'character_identity',
      subject: name,
      predicate: '身份',
      object: char.identity || char.role || '未定',
      source: 'story_bible',
      status: 'active'
    });
    if (char.limits) {
      facts.push({
        project_id: projectId,
        fact_type: 'character_limit',
        subject: name,
        predicate: '限制',
        object: char.limits,
        source: 'story_bible',
        status: 'active'
      });
    }
  });
  (bible.core_secrets || []).forEach((secret, index) => {
    facts.push({
      project_id: projectId,
      fact_type: 'core_secret',
      subject: cleanText(secret.title || secret.name, `未命名秘密${index + 1}`),
      predicate: '上帝视角',
      object: secret.god_view || '',
      source: 'story_bible',
      status: 'active'
    });
  });
  return facts;
}

async function createCanonFromBible(projectId, bible) {
  const facts = factsFromBible(projectId, bible);
  return insertMany('canon_facts', facts);
}

async function getCanon(projectId) {
  return listByProject('canon_facts', projectId);
}

function findCanonConflicts(text = '', canonFacts = []) {
  const findings = [];
  const content = String(text);
  canonFacts.forEach(fact => {
    if (fact.fact_type === 'character_identity' && fact.subject && fact.object) {
      const subjectMentioned = content.includes(fact.subject);
      if (subjectMentioned && /前任|退休|辞职|转行|不是/.test(content) && !content.includes(fact.object)) {
        findings.push({
          type: 'canon_conflict',
          severity: 'blocking',
          message: `正文可能改写了 ${fact.subject} 的身份。Canon 设定为：${fact.object}`,
          suggested_fix: `保留 ${fact.subject} 的 Canon 身份：${fact.object}。`
        });
      }
    }
  });
  return findings;
}

module.exports = { createCanonFromBible, getCanon, findCanonConflicts };
