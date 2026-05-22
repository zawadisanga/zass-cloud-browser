// backend/api/routes/batch.js
const express = require('express');
const { browserPool } = require('../../workers/browser-pool');

const router = express.Router();

// POST /api/batch - Process multiple URLs
router.post('/', async (req, res) => {
    const { urls, format = 'png', fullPage = true } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: 'URLs array is required' });
    }
    
    if (urls.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 URLs per batch request' });
    }
    
    const startTime = Date.now();
    const results = await Promise.allSettled(
        urls.map(url => browserPool.execute(url, { format, fullPage }))
    );
    
    const response = results.map((result, i) => ({
        url: urls[i],
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value.data.toString('base64') : null,
        error: result.status === 'rejected' ? result.reason.message : null,
        fromCache: result.status === 'fulfilled' ? result.value.fromCache : false
    }));
    
    res.json({
        batchId: Date.now(),
        total: urls.length,
        successful: response.filter(r => r.success).length,
        failed: response.filter(r => !r.success).length,
        processingTime: Date.now() - startTime,
        results: response
    });
});

module.exports = router;
