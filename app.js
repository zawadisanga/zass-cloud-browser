// backend/api-server/app.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const EnterpriseBrowserPool = require('../shared/browser-pool');

const app = express();
const browserPool = new EnterpriseBrowserPool({ maxWorkers: 10 });

app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.static('frontend/public'));

// Rate limiting per user
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date(),
        stats: browserPool.stats,
        workers: browserPool.available.length + browserPool.busy.size
    });
});

// Render screenshot
app.get('/api/render', async (req, res) => {
    const { url, format = 'png', fullPage = true } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    try {
        const result = await browserPool.execute(url, { format, fullPage, type: format });
        
        if (format === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="render.pdf"');
            res.send(result.data);
        } else {
            res.setHeader('Content-Type', 'image/png');
            res.send(result.data);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Batch render multiple URLs
app.post('/api/batch', async (req, res) => {
    const { urls, format = 'png' } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: 'URLs array is required' });
    }
    
    const results = await Promise.allSettled(
        urls.map(url => browserPool.execute(url, { format }))
    );
    
    res.json(results.map((r, i) => ({
        url: urls[i],
        success: r.status === 'fulfilled',
        data: r.status === 'fulfilled' ? r.value.data.toString('base64') : null,
        error: r.status === 'rejected' ? r.reason.message : null
    })));
});

// Get statistics
app.get('/api/stats', (req, res) => {
    res.json({
        ...browserPool.stats,
        workers: {
            available: browserPool.available.length,
            busy: browserPool.busy.size,
            waiting: browserPool.waitingQueue.length,
            total: browserPool.available.length + browserPool.busy.size
        },
        uptime: process.uptime()
    });
});

// Clear cache
app.delete('/api/cache/:url?', async (req, res) => {
    if (req.params.url) {
        await browserPool.redis.del(`screenshot:${req.params.url}`);
        res.json({ message: 'Cache cleared for specific URL' });
    } else {
        await browserPool.redis.flushAll();
        res.json({ message: 'Entire cache cleared' });
    }
});

browserPool.init().then(() => {
    const port = process.env.PORT || 5000;
    app.listen(port, () => {
        console.log(`🚀 ZASS Cloud Browser API running on port ${port}`);
        console.log(`📊 Stats endpoint: http://localhost:${port}/api/stats`);
        console.log(`🎨 Dashboard: http://localhost:${port}/dashboard.html`);
    });
});
