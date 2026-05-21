// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { aiRateLimit, requireAiAccessToken, warnIfAiTokenMissing } = require('./security');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const frontendDir = path.join(__dirname, '../frontend');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

// 1. 中间件
app.set('trust proxy', 1);
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    }
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(frontendDir, 'dashboard.html'));
});

// 2. 静态文件托管 (让浏览器能访问 frontend 里的 HTML 和 JS)
app.use(express.static(frontendDir));

// 3. 挂载 API 路由 (我们先挂载一个测试接口)
app.get('/api/health', (req, res) => {
    res.json({ status: 'Engine V2 is Online', version: '2.0.0' });
});

// 👇 确保这两行存在且没有被 // 注释掉！
app.use('/api/projects', requireAiAccessToken, require('./routes/projects'));
app.use('/api/workspace', requireAiAccessToken, require('./routes/workspace'));
app.use('/api/chat', aiRateLimit, requireAiAccessToken, require('./routes/chat'));
app.use('/api/crystallize/preview', aiRateLimit);
app.use('/api/crystallize', requireAiAccessToken, require('./routes/crystallize'));
app.use('/api/ai', aiRateLimit, requireAiAccessToken, require('./routes/ai'));

app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            success: false,
            error: '请求内容太长，请缩短对话或正文后重试。'
        });
    }
    next(err);
});

// 未来这里会挂载 projects.js, ai.js 等等...

// 4. 启动引擎
const server = app.listen(Number(PORT), HOST, () => {
    const address = server.address();
    warnIfAiTokenMissing();
    console.log(`\n=========================================`);
    console.log(`🚀 OmniStory Engine V2 is ALIVE!`);
    console.log(`🌌 宇宙大厅入口: http://${HOST}:${PORT}/`);
    console.log(`🔌 Listening address: ${JSON.stringify(address)}`);
    console.log(`=========================================\n`);
});

server.on('error', (error) => {
    console.error('❌ Server failed to listen:', error);
    process.exit(1);
});
