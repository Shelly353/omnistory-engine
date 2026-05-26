require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { aiRateLimit, requireAccessToken, warnIfAccessTokenMissing } = require('./security');

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
  res.status(500).json({ success: false, error: err.message || '服务器错误' });
});

app.listen(port, () => {
  warnIfAccessTokenMissing();
  console.log(`Novel Workflow Studio listening on http://localhost:${port}`);
});
