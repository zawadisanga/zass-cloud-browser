// server.js - ZASS ENTERPRISE ULTIMATE v5.0 (FIXED)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { chromium } = require('playwright');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'zass-enterprise-secret-2026';
const CONTACT_EMAIL = 'citytechuk@gmail.com';
const CONTACT_PHONE = '+25576323348';
const NMB_ACCOUNT = '5161480052318274';

// Directories
['./database', './logs', './temp'].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

let db;
let browser = null;
let isBrowserReady = false;
let browserStats = { requests: 0, cacheHits: 0, errors: 0, startTime: Date.now() };
let screenshotCache = new Map();

// ==================== DATABASE ====================
async function initDatabase() {
    db = await open({ filename: './database/zass_enterprise.sqlite', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            phone TEXT,
            plan TEXT DEFAULT 'startup',
            api_key TEXT UNIQUE,
            payment_status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Database Ready');
    
    // Create demo account
    const demo = await db.get('SELECT * FROM users WHERE email = ?', ['demo@enterprise.com']);
    if (!demo) {
        const hashed = await bcrypt.hash('Enterprise2026!', 10);
        const apiKey = 'demo_key_' + Date.now();
        await db.run(`INSERT INTO users (company_name, email, password, plan, api_key, payment_status) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            ['Demo Company', 'demo@enterprise.com', hashed, 'business', apiKey, 'active']);
        console.log('✅ Demo account created: demo@enterprise.com / Enterprise2026!');
    }
}

// ==================== BROWSER ====================
async function initBrowser() {
    console.log('🚀 Starting browser...');
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        isBrowserReady = true;
        console.log('✅ Browser Ready');
    } catch (error) {
        setTimeout(initBrowser, 10000);
    }
}

async function takeScreenshot(url, options = {}) {
    browserStats.requests++;
    const cacheKey = `${url}:${options.format || 'png'}`;
    if (screenshotCache.has(cacheKey)) {
        browserStats.cacheHits++;
        return screenshotCache.get(cacheKey);
    }
    if (!isBrowserReady || !browser) throw new Error('Browser starting');
    
    let page = null;
    try {
        page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(2000);
        
        let result;
        if (options.format === 'pdf') {
            result = await page.pdf({ format: 'A4', printBackground: true });
        } else {
            result = await page.screenshot({ type: 'png' });
        }
        screenshotCache.set(cacheKey, result);
        setTimeout(() => screenshotCache.delete(cacheKey), 3600000);
        return result;
    } finally {
        if (page) await page.close();
    }
}

// ==================== MIDDLEWARE ====================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

// ==================== AUTHENTICATION ====================
async function authenticateAPIKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    const user = await db.get('SELECT * FROM users WHERE api_key = ?', [apiKey]);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    req.user = user;
    next();
}

// ==================== API ENDPOINTS ====================

// Demo endpoint (NO API KEY NEEDED)
app.get('/api/demo', async (req, res) => {
    const { url, format = 'png' } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });
    try {
        const result = await takeScreenshot(url, { format });
        res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'image/png');
        res.send(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enterprise render endpoint
app.get('/api/enterprise/render', authenticateAPIKey, async (req, res) => {
    const { url, format = 'png' } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });
    try {
        const result = await takeScreenshot(url, { format });
        res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'image/png');
        res.send(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Register endpoint
app.post('/api/enterprise/register', async (req, res) => {
    const { company_name, email, password, phone, plan = 'startup' } = req.body;
    if (!company_name || !email || !password) {
        return res.status(400).json({ error: 'Company name, email, and password required' });
    }
    
    const exists = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    
    const hashed = await bcrypt.hash(password, 10);
    const apiKey = 'zass_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    
    await db.run(`INSERT INTO users (company_name, email, password, phone, plan, api_key, payment_status) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [company_name, email, hashed, phone || '', plan, apiKey, 'active']);
    
    res.json({ success: true, api_key: apiKey, plan: plan, message: 'Registration successful!' });
});

// Login endpoint
app.post('/api/enterprise/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user.id, email: user.email, company: user.company_name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ 
        success: true, 
        token, 
        company: user.company_name, 
        plan: user.plan, 
        paymentStatus: user.payment_status, 
        apiKey: user.api_key 
    });
});

// Payment status endpoint
app.get('/api/payment/status/:email', async (req, res) => {
    const { email } = req.params;
    const user = await db.get('SELECT payment_status, plan FROM users WHERE email = ?', [email]);
    if (!user) return res.status(404).json({ error: 'Client not found' });
    res.json({ email, status: user.payment_status, plan: user.plan });
});

// Stats endpoint
app.get('/api/enterprise/stats', authenticateAPIKey, async (req, res) => {
    res.json({
        plan: req.user.plan,
        monthlyLimit: req.user.plan === 'startup' ? 5000 : req.user.plan === 'business' ? 15000 : 50000,
        usedRequests: Math.floor(Math.random() * 500),
        totalRequests: Math.floor(Math.random() * 2000),
        todayRequests: Math.floor(Math.random() * 50)
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: isBrowserReady ? 'ready' : 'starting', uptime: process.uptime() });
});

// ==================== FRONTEND PAGES ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// PWA Files
app.get('/manifest.json', (req, res) => {
    res.json({ name: "ZASS Enterprise", short_name: "ZASS", start_url: "/", display: "standalone", theme_color: "#667eea", background_color: "#0a0a0a", icons: [{ src: "/zas.png", sizes: "512x512", type: "image/png" }] });
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`const C='zass-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/manifest.json']))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`);
});

app.get('/zas.png', (req, res) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#667eea"/><text x="256" y="276" font-size="200" text-anchor="middle" fill="white" font-family="Arial">🏢</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
});

// ==================== START SERVER ====================
async function start() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🏢 ZASS ENTERPRISE ULTIMATE v5.0                          ║
║   =======================================                   ║
║                                                              ║
║   ✅ Demo Account: demo@enterprise.com / Enterprise2026!    ║
║   💰 NMB Account: ${NMB_ACCOUNT}                              ║
║   📧 Contact: ${CONTACT_EMAIL}                                ║
║                                                              ║
║   📱 URL: https://zass.website                              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
    await initDatabase();
    await initBrowser();
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
}

start();
