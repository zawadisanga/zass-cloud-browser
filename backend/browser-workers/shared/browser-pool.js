// backend/browser-workers/shared/browser-pool.js
const { chromium } = require('playwright-core');
const redis = require('redis');

class EnterpriseBrowserPool {
    constructor(options = {}) {
        this.maxWorkers = options.maxWorkers || 10;
        this.available = [];
        this.busy = new Set();
        this.waitingQueue = [];
        this.redis = redis.createClient({ url: process.env.REDIS_URL });
        this.stats = { totalRequests: 0, cacheHits: 0, errors: 0 };
        
        // Auto-scale based on load
        setInterval(() => this.autoScale(), 30000);
    }
    
    async init() {
        await this.redis.connect();
        for (let i = 0; i < this.maxWorkers; i++) {
            this.available.push(await this.createBrowser());
        }
        console.log(`Initialized ${this.maxWorkers} browser workers`);
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
                '--max_old_space_size=512'
            ]
        });
    }
    
    async autoScale() {
        const queueLength = this.waitingQueue.length;
        if (queueLength > 5 && this.available.length + this.busy.size < 20) {
            const newWorker = await this.createBrowser();
            this.available.push(newWorker);
            console.log(`Scaled up: +1 worker (total: ${this.available.length + this.busy.size})`);
        }
    }
    
    async execute(url, options = {}) {
        this.stats.totalRequests++;
        
        // Check cache first
        const cacheKey = `screenshot:${url}`;
        const cached = await this.redis.get(cacheKey);
        if (cached && !options.skipCache) {
            this.stats.cacheHits++;
            return { data: cached, fromCache: true };
        }
        
        let browser = await this.acquire();
        let page = null;
        
        try {
            page = await browser.newPage();
            await page.setViewportSize({ width: 1920, height: 1080 });
            await page.goto(url, { 
                waitUntil: 'networkidle',
                timeout: options.timeout || 30000 
            });
            
            let result;
            if (options.format === 'pdf') {
                result = await page.pdf({ format: 'A4' });
            } else {
                result = await page.screenshot({ 
                    fullPage: options.fullPage || true,
                    type: options.type || 'png'
                });
            }
            
            // Store in cache
            await this.redis.setEx(cacheKey, 3600, result.toString('base64'));
            
            return { data: result, fromCache: false };
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
}

module.exports = EnterpriseBrowserPool;
