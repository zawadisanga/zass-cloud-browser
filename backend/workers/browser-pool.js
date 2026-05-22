// backend/workers/browser-pool.js
const { chromium } = require('playwright-core');
const { getRedis } = require('../config/redis');

class BrowserPool {
    constructor(options = {}) {
        this.maxWorkers = options.maxWorkers || parseInt(process.env.MAX_WORKERS) || 5;
        this.available = [];
        this.busy = new Set();
        this.waitingQueue = [];
        this.stats = {
            totalRequests: 0,
            cacheHits: 0,
            errors: 0,
            startTime: Date.now()
        };
        
        // Auto-scale every 30 seconds
        setInterval(() => this.autoScale(), 30000);
    }
    
    async init() {
        for (let i = 0; i < this.maxWorkers; i++) {
            this.available.push(await this.createBrowser());
        }
        console.log(`✅ Initialized ${this.maxWorkers} browser workers`);
    }
    
    async createBrowser() {
        return await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--memory-pressure-off',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
    }
    
    async autoScale() {
        const queueLength = this.waitingQueue.length;
        const totalWorkers = this.available.length + this.busy.size;
        
        if (queueLength > 5 && totalWorkers < 20) {
            const newWorker = await this.createBrowser();
            this.available.push(newWorker);
            console.log(`📈 Scaled up: +1 worker (total: ${totalWorkers + 1})`);
        } else if (queueLength === 0 && totalWorkers > this.maxWorkers) {
            // Scale down
            const worker = this.available.pop();
            if (worker) await worker.close();
            console.log(`📉 Scaled down: -1 worker (total: ${totalWorkers - 1})`);
        }
    }
    
    async execute(url, options = {}) {
        this.stats.totalRequests++;
        const redis = getRedis();
        
        // Check cache
        const cacheKey = `screenshot:${url}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached && !options.skipCache) {
                this.stats.cacheHits++;
                return { 
                    data: Buffer.from(cached, 'base64'), 
                    fromCache: true,
                    contentType: options.format === 'pdf' ? 'application/pdf' : 'image/png'
                };
            }
        } catch (err) {
            console.log('Cache error:', err.message);
        }
        
        let browser = await this.acquire();
        let page = null;
        
        try {
            page = await browser.newPage();
            await page.setViewportSize({ 
                width: parseInt(options.width) || 1920, 
                height: parseInt(options.height) || 1080 
            });
            
            await page.goto(url, { 
                waitUntil: 'networkidle',
                timeout: options.timeout || 30000 
            });
            
            let result;
            if (options.format === 'pdf') {
                result = await page.pdf({ 
                    format: options.paperFormat || 'A4',
                    printBackground: true 
                });
            } else {
                result = await page.screenshot({ 
                    fullPage: options.fullPage !== false,
                    type: options.type || 'png',
                    quality: options.quality || 90
                });
            }
            
            // Store in cache (1 hour)
            await redis.setex(cacheKey, 3600, result.toString('base64'));
            
            return { 
                data: result, 
                fromCache: false,
                contentType: options.format === 'pdf' ? 'application/pdf' : 'image/png'
            };
        } catch (error) {
            this.stats.errors++;
            throw error;
        } finally {
            if (page) await page.close();
            this.release(browser);
        }
    }
    
    async acquire() {
        if (this.available.length > 0) {
            const browser = this.available.pop();
            this.busy.add(browser);
            return browser;
        }
        
        return new Promise((resolve) => {
            this.waitingQueue.push(resolve);
        });
    }
    
    release(browser) {
        this.busy.delete(browser);
        if (this.waitingQueue.length > 0) {
            const resolve = this.waitingQueue.shift();
            resolve(browser);
        } else {
            this.available.push(browser);
        }
    }
    
    async closeAll() {
        const allBrowsers = [...this.available, ...this.busy];
        for (const browser of allBrowsers) {
            await browser.close();
        }
        console.log('All browsers closed');
    }
    
    getStats() {
        return {
            ...this.stats,
            uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
            workers: {
                available: this.available.length,
                busy: this.busy.size,
                waiting: this.waitingQueue.length,
                total: this.available.length + this.busy.size
            }
        };
    }
}

const browserPool = new BrowserPool();
module.exports = { browserPool, BrowserPool };
