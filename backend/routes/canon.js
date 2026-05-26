const express = require('express');
const router = express.Router({ mergeParams: true });
const { insert } = require('../lib/db');
const { getCanon } = require('../lib/canonService');

router.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, canon: await getCanon(req.params.projectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const fact = await insert('canon_facts', {
      project_id: req.params.projectId,
      fact_type: req.body.fact_type || 'manual',
      subject: req.body.subject || '',
      predicate: req.body.predicate || '',
      object: req.body.object || '',
      scope: req.body.scope || 'global',
      source: 'manual',
      status: 'active'
    });
    res.json({ success: true, fact });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
