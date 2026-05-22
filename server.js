// server.js - HII NDIO ENTRY POINT KUU
require('dotenv').config();
const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

// Import modules
const { initRedis } = require('./backend/config/redis');
const { browserPool } = require('./backend/workers/browser-pool');
const renderRoutes = require('./backend/api/routes/render');
const batchRoutes = require('./backend/api/routes/batch');
const healthRoutes = require('./backend/api/routes/health');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('frontend/public'));

// API Routes
app.use('/api/render', renderRoutes);
app.use('/api/batch', batchRoutes);
app.use('/health', healthRoutes);

// Serve dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/public/dashboard.html'));
});

// Start server
async function startServer() {
    try {
        // Initialize Redis
        await initRedis();
        console.log('✅ Redis connected');
        
        // Initialize browser pool
        await browserPool.init();
        console.log(`✅ Browser pool initialized with ${browserPool.maxWorkers} workers`);
        
        // Start Express server
        app.listen(PORT, () => {
            console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 ZASS CLOUD BROWSER ENTERPRISE                          ║
║   =====================================                      ║
║                                                              ║
║   Server:    http://localhost:${PORT}                         ║
║   Dashboard: http://localhost:${PORT}/dashboard.html          ║
║   Health:    http://localhost:${PORT}/health                  ║
║   Stats:     http://localhost:${PORT}/api/render/stats        ║
║                                                              ║
║   Workers:   ${browserPool.maxWorkers} ready                    ║
║   Redis:     Connected                                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    await browserPool.closeAll();
    process.exit(0);
});
