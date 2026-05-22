// backend/config/redis.js
const Redis = require('ioredis');

let redisClient = null;

async function initRedis() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
            if (times > 3) {
                console.log('Redis connection failed after 3 retries');
                return null;
            }
            return Math.min(times * 100, 3000);
        }
    });
    
    redisClient.on('connect', () => console.log('Redis connecting...'));
    redisClient.on('ready', () => console.log('Redis ready'));
    redisClient.on('error', (err) => console.error('Redis error:', err));
    
    return redisClient;
}

function getRedis() {
    if (!redisClient) {
        throw new Error('Redis not initialized');
    }
    return redisClient;
}

module.exports = { initRedis, getRedis };
