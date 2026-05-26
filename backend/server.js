require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { aiRateLimit, requireAccessToken, warnIfAccessTokenMissing } = require('./security');
const { readSetupSql } = require('./lib/db');
const supabase = require('./lib/supabaseClient');

const projects = require('./routes/projects');
const bible = require('./routes/bible');
const canon = require('./routes/canon');
const planning = require('./routes/planning');
const chapters = require('./routes/chapters');
const audit = require('./routes/audit');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'novel-workflow-studio' });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'novel-workflow-studio', compatibility: 'omnistory' });
});

app.get('/api/setup/sql', (req, res) => {
  res.type('text/plain').send(readSetupSql());
});

app.get('/api/diagnostics/supabase', async (req, res) => {
  const url = process.env.SUPABASE_URL || '';
  const info = {
    configured: Boolean(url && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)),
    url,
    ref: url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || '',
    keySource: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SUPABASE_SERVICE_ROLE_KEY' : (process.env.SUPABASE_ANON_KEY ? 'SUPABASE_ANON_KEY' : '')
  };
  const checks = {};
  if (supabase) {
    for (const table of ['projects', 'story_bibles', 'chapters']) {
      const { error } = await supabase.from(table).select('id').limit(1);
      checks[table] = error ? { ok: false, code: error.code, message: error.message } : { ok: true };
    }
  }
  res.json({ success: true, supabase: { ...info, url: info.url ? info.url.replace(/\/$/, '') : '' }, checks });
});

app.use('/api', requireAccessToken);
app.use('/api', aiRateLimit);
app.use('/api/projects', projects);
app.use('/api/projects/:projectId/bible', bible);
app.use('/api/projects/:projectId/canon', canon);
app.use('/api/projects/:projectId', planning);
app.use('/api/chapters', chapters);
app.use('/api', audit);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.setupRequired ? 501 : 500).json({
    success: false,
    error: err.message || '服务器错误',
    setupRequired: Boolean(err.setupRequired),
    setupSqlPath: err.setupRequired ? '/api/setup/sql' : undefined,
    table: err.table
  });
});

app.listen(port, () => {
  warnIfAccessTokenMissing();
  console.log(`Novel Workflow Studio listening on http://localhost:${port}`);
});
