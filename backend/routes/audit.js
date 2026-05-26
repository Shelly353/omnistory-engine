const express = require('express');
const router = express.Router();
const { listByProject } = require('../lib/repositories');
const { supabase, memory, enrichDbError } = require('../lib/db');

router.get('/projects/:projectId/audit', async (req, res, next) => {
  try {
    const findings = await listByProject('audit_findings', req.params.projectId);
    res.json({ success: true, findings });
  } catch (err) {
    next(err);
  }
});

router.get('/projects/:projectId/proposed-facts', async (req, res, next) => {
  try {
    const facts = await listByProject('proposed_facts', req.params.projectId);
    res.json({ success: true, facts });
  } catch (err) {
    next(err);
  }
});

router.post('/proposed-facts/:factId/:action', async (req, res, next) => {
  try {
    const status = req.params.action === 'accept' ? 'accepted' : 'rejected';
    if (supabase) {
      const { data, error } = await supabase.from('proposed_facts').update({ status }).eq('id', req.params.factId).select().single();
      if (error) throw enrichDbError(error, 'proposed_facts');
      return res.json({ success: true, fact: data });
    }
    const fact = memory.proposed_facts.find(item => item.id === req.params.factId);
    if (fact) fact.status = status;
    res.json({ success: true, fact });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
