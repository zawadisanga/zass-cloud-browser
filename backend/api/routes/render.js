// backend/api/routes/render.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { browserPool } = require('../../workers/browser-pool');

const router = express.Router();

// Rate limiting for render endpoint
const renderLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many render requests, please slow down' }
});

router.use(renderLimiter);

// GET /api/render - Take screenshot or PDF
router.get('/', async (req, res) => {
    const { url, format = 'png', fullPage = 'true', width, height, quality } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    // Validate URL
    try {
        new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    try {
        const result = await browserPool.execute(url, {
            format,
            fullPage: fullPage === 'true',
            width: parseInt(width),
            height: parseInt(height),
            quality: parseInt(quality)
        });
        
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('X-Cache', result.fromCache ? 'HIT' : 'MISS');
        res.setHeader('X-Workers-Available', browserPool.available.length);
        
        if (format === 'pdf') {
            res.setHeader('Content-Disposition', `inline; filename="screenshot-${Date.now()}.pdf"`);
        }
        
        res.send(result.data);
    } catch (error) {
        console.error('Render error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/render/stats - Get pool statistics
router.get('/stats', (req, res) => {
    res.json(browserPool.getStats());
});

module.exports = router;
