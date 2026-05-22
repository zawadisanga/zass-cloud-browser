// backend/api/routes/health.js
const express = require('express');
const { getRedis } = require('../../config/redis');
const { browserPool } = require('../../workers/browser-pool');

const router = express.Router();

router.get('/', async (req, res) => {
    let redisStatus = 'unknown';
    try {
        const redis = getRedis();
        await redis.ping();
        redisStatus = 'connected';
    } catch {
        redisStatus = 'disconnected';
    }
    
    const stats = browserPool.getStats();
    
    res.json({
        status: redisStatus === 'connected' && stats.workers.total > 0 ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: {
            redis: redisStatus,
            browsers: {
                status: stats.workers.total > 0 ? 'ready' : 'no_workers',
                ...stats.workers
            }
        },
        stats: {
            totalRequests: stats.totalRequests,
            cacheHits: stats.cacheHits,
            errors: stats.errors,
            uptime: stats.uptime,
            cacheHitRate: stats.totalRequests > 0 
                ? ((stats.cacheHits / stats.totalRequests) * 100).toFixed(2) 
                : 0
        }
    });
});

module.exports = router;
