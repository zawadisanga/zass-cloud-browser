// server.js - HII NI APP KAMILI, HAUHITAJI NCHINGINE!
const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { chromium } = require('playwright');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(morgan('short'));
app.use(express.json({ limit: '50mb' }));
app.use(express.static('frontend/public'));

// Browser pool simple (no Redis, no Go - rahisi!)
let availableBrowsers = [];
let busyBrowsers = new Set();
let maxWorkers = parseInt(process.env.MAX_WORKERS) || 3;
let stats = { requests: 0, cacheHits: 0, errors: 0 };
let cache = new Map(); // Simple memory cache

// Create browsers on startup
async function initBrowsers() {
    console.log(`Starting ${maxWorkers} browser workers...`);
    for (let i = 0; i < maxWorkers; i++) {
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        availableBrowsers.push(browser);
    }
    console.log(`✅ ${maxWorkers} browsers ready!`);
}

// Get a browser from pool
async function getBrowser() {
    if (availableBrowsers.length > 0) {
        const browser = availableBrowsers.pop();
        busyBrowsers.add(browser);
        return browser;
    }
    // Wait for browser to be free
    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            if (availableBrowsers.length > 0) {
                clearInterval(checkInterval);
                const browser = availableBrowsers.pop();
                busyBrowsers.add(browser);
                resolve(browser);
            }
        }, 100);
    });
}

// Return browser to pool
function returnBrowser(browser) {
    busyBrowsers.delete(browser);
    availableBrowsers.push(browser);
}

// Take screenshot
async function takeScreenshot(url, format = 'png') {
    stats.requests++;
    
    // Check cache
    const cacheKey = `${url}:${format}`;
    if (cache.has(cacheKey)) {
        stats.cacheHits++;
        return cache.get(cacheKey);
    }
    
    const browser = await getBrowser();
    let page = null;
    
    try {
        page = await browser.newPage();
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        let result;
        if (format === 'pdf') {
            result = await page.pdf({ format: 'A4' });
        } else {
            result = await page.screenshot({ fullPage: true, type: 'png' });
        }
        
        // Cache for 1 hour
        cache.set(cacheKey, result);
        setTimeout(() => cache.delete(cacheKey), 3600000);
        
        return result;
    } catch (error) {
        stats.errors++;
        throw error;
    } finally {
        if (page) await page.close();
        returnBrowser(browser);
    }
}

// Rate limiter
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many requests, slow down!' }
});

// Routes
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        workers: {
            available: availableBrowsers.length,
            busy: busyBrowsers.size,
            total: maxWorkers
        },
        stats: stats,
        uptime: process.uptime()
    });
});

app.get('/api/render', limiter, async (req, res) => {
    const { url, format = 'png' } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        const result = await takeScreenshot(url, format);
        
        if (format === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.send(result);
        } else {
            res.setHeader('Content-Type', 'image/png');
            res.send(result);
        }
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/batch', limiter, async (req, res) => {
    const { urls, format = 'png' } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: 'URLs array required' });
    }
    
    const results = [];
    for (const url of urls.slice(0, 10)) { // Max 10 per batch
        try {
            const data = await takeScreenshot(url, format);
            results.push({ url, success: true, data: data.toString('base64') });
        } catch (error) {
            results.push({ url, success: false, error: error.message });
        }
    }
    
    res.json({ results, total: results.length });
});

app.get('/api/stats', (req, res) => {
    res.json({
        ...stats,
        workers: {
            available: availableBrowsers.length,
            busy: busyBrowsers.size
        },
        cacheSize: cache.size,
        uptime: process.uptime()
    });
});

// Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/public/dashboard.html'));
});

// Start server
initBrowsers().then(() => {
    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════╗
║   🚀 ZASS CLOUD BROWSER READY          ║
║   =============================         ║
║   Port: ${PORT}                          ║
║   Dashboard: http://localhost:${PORT}    ║
║   Health: http://localhost:${PORT}/health ║
║   Workers: ${maxWorkers}                   ║
╚════════════════════════════════════════╝
        `);
    });
});
