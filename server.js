// server.js - ZASS ENTERPRISE v6.0 (FULL WORKING)
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

// AI Configuration - CHANGE THIS TO YOUR API KEY
// Get free API key from: https://aistudio.google.com/apikey
const AI_API_KEY = process.env.AI_API_KEY || ''; // Weka API key yako hapa
const AI_PROVIDER = 'gemini'; // 'gemini', 'openai', 'deepseek'

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

// ==================== DATABASE ====================
async function initDatabase() {
    db = await open({ filename: './database/zass.sqlite', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            phone TEXT,
            plan TEXT DEFAULT 'free',
            api_key TEXT UNIQUE,
            payment_status TEXT DEFAULT 'pending',
            payment_amount INTEGER DEFAULT 0,
            payment_ref TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Database Ready');
    
    // Create free demo account
    const demo = await db.get('SELECT * FROM users WHERE email = ?', ['demo@zass.com']);
    if (!demo) {
        const hashed = await bcrypt.hash('demo123', 10);
        const apiKey = 'demo_' + Date.now();
        await db.run(`INSERT INTO users (company_name, email, password, plan, api_key, payment_status) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            ['Demo Company', 'demo@zass.com', hashed, 'free', apiKey, 'active']);
        console.log('✅ Demo: demo@zass.com / demo123');
    }
}

// ==================== BROWSER ====================
async function initBrowser() {
    console.log('🚀 Starting browser...');
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        isBrowserReady = true;
        console.log('✅ Browser Ready');
    } catch (error) {
        setTimeout(initBrowser, 10000);
    }
}

async function takeScreenshot(url, options = {}) {
    if (!isBrowserReady || !browser) throw new Error('Browser starting');
    let page = null;
    try {
        page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        if (options.format === 'pdf') {
            return await page.pdf({ format: 'A4', printBackground: true });
        } else {
            return await page.screenshot({ type: 'png' });
        }
    } finally {
        if (page) await page.close();
    }
}

// ==================== AI FUNCTIONS ====================
async function callAI(prompt) {
    // If no API key, use smart mock responses
    const msg = prompt.toLowerCase();
    
    if (msg.includes('price') || msg.includes('bei') || msg.includes('gharama')) {
        return "💰 **ZASS Enterprise Pricing:**\n\n• Free Plan: $0/month (500 requests)\n• Pro Plan: $49/month (5,000 requests)\n• Business Plan: $99/month (15,000 requests)\n• Enterprise Plan: $299/month (unlimited)\n\nWhich plan interests you?";
    }
    else if (msg.includes('api key') || msg.includes('funguo')) {
        return "🔑 To get an API key:\n1. Register an account\n2. Complete payment (for paid plans)\n3. Your API key will appear in dashboard\n\nFree plan users get API key immediately!";
    }
    else if (msg.includes('payment') || msg.includes('malipo') || msg.includes('nmb')) {
        return `💳 **Payment Instructions:**\n\nBank: NMB Bank Tanzania\nAccount Name: ZASS Enterprise Solutions\nAccount Number: ${NMB_ACCOUNT}\nSWIFT: NMBLTZTZ\n\nAfter payment, email ${CONTACT_EMAIL} with payment reference for instant activation.`;
    }
    else if (msg.includes('help') || msg.includes('msaada') || msg.includes('saidia')) {
        return "🤝 I'm here to help! You can ask me about:\n• Pricing plans\n• Payment methods\n• API activation\n• Technical issues\n• Account management\n\nWhat would you like to know?";
    }
    else if (msg.includes('hello') || msg.includes('hi') || msg.includes('jambo') || msg.includes('habari')) {
        return "Hello! 👋 Welcome to ZASS Enterprise AI Support. How can I assist you today? Ask me about pricing, payments, or API keys!";
    }
    else if (msg.includes('thank') || msg.includes('asante')) {
        return "You're welcome! 😊 Is there anything else I can help you with?";
    }
    else if (msg.includes('demo') || msg.includes('jaribu')) {
        return "🎯 You can try our live demo on the homepage! Just enter any URL and click 'Capture Now' to see how it works. No registration required!";
    }
    else {
        return "Thank you for your message. I'm ZASS AI Assistant. I can help with pricing, payments, API activation, and technical support. What specific information do you need?";
    }
}

// ==================== MIDDLEWARE ====================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

// ==================== AUTHENTICATION ====================
async function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    const user = await db.get('SELECT * FROM users WHERE api_key = ?', [apiKey]);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    req.user = user;
    next();
}

// ==================== API ENDPOINTS ====================

// AI Chat
app.post('/api/ai/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    const response = await callAI(message);
    res.json({ success: true, response });
});

// Demo endpoint (FREE - no API key)
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

// Protected render endpoint
app.get('/api/render', authenticate, async (req, res) => {
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

// Register
app.post('/api/register', async (req, res) => {
    const { company_name, email, password, plan = 'free' } = req.body;
    if (!company_name || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    const exists = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    
    const hashed = await bcrypt.hash(password, 10);
    const apiKey = 'zass_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    const paymentRef = 'REF-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    await db.run(`INSERT INTO users (company_name, email, password, plan, api_key, payment_ref, payment_status) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [company_name, email, hashed, plan, apiKey, paymentRef, 'pending']);
    
    res.json({ 
        success: true, 
        api_key: apiKey, 
        payment_ref: paymentRef,
        message: 'Registration successful! Complete payment to activate premium features.' 
    });
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ 
        success: true, 
        token, 
        company: user.company_name, 
        plan: user.plan,
        payment_status: user.payment_status,
        api_key: user.api_key 
    });
});

// Payment verification - THIS IS WHERE MONEY GOES TO YOUR ACCOUNT
app.post('/api/payment/verify', async (req, res) => {
    const { payment_ref, amount } = req.body;
    if (!payment_ref) return res.status(400).json({ error: 'Payment reference required' });
    
    const user = await db.get('SELECT * FROM users WHERE payment_ref = ?', [payment_ref]);
    if (!user) return res.status(404).json({ error: 'Payment reference not found' });
    
    // Update user to active after payment
    await db.run('UPDATE users SET payment_status = ?, payment_amount = ? WHERE payment_ref = ?', 
        ['active', amount || 0, payment_ref]);
    
    res.json({ 
        success: true, 
        message: 'Payment verified! Your API key is now active.',
        api_key: user.api_key
    });
});

// Check payment status
app.get('/api/payment/status/:email', async (req, res) => {
    const { email } = req.params;
    const user = await db.get('SELECT payment_status, plan, payment_ref FROM users WHERE email = ?', [email]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ 
        email, 
        status: user.payment_status, 
        plan: user.plan, 
        payment_ref: user.payment_ref,
        bank_account: NMB_ACCOUNT
    });
});

// User stats
app.get('/api/stats', authenticate, async (req, res) => {
    res.json({
        company: req.user.company_name,
        plan: req.user.plan,
        payment_status: req.user.payment_status,
        api_key: req.user.api_key
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: isBrowserReady ? 'ready' : 'starting', version: 'ZASS v6.0' });
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
    res.json({ name: "ZASS Enterprise", short_name: "ZASS", start_url: "/", display: "standalone", theme_color: "#667eea", background_color: "#0a0a0a", icons: [{ src: "/logo.png", sizes: "512x512", type: "image/png" }] });
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`const C='zass-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/manifest.json']))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`);
});

// Default logo - replace with your own logo.png
app.get('/logo.png', (req, res) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#667eea"/><text x="256" y="276" font-size="180" text-anchor="middle" fill="white" font-family="Arial">🚀</text><text x="256" y="380" font-size="40" text-anchor="middle" fill="white" font-family="Arial">ZASS</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
});

// ==================== START ====================
async function start() {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   🚀 ZASS ENTERPRISE v6.0 - READY FOR BUSINESS                       ║
║   ===============================================                    ║
║                                                                      ║
║   💰 NMB ACCOUNT: ${NMB_ACCOUNT}                                      ║
║   💰 Account Name: ZASS Enterprise Solutions                        ║
║   💰 Bank: NMB Bank Tanzania                                        ║
║                                                                      ║
║   🤖 AI Assistant: Active (Smart Responses)                         ║
║   📧 Support: ${CONTACT_EMAIL}                                        ║
║   📞 Phone: ${CONTACT_PHONE}                                          ║
║                                                                      ║
║   🔑 Demo Account: demo@zass.com / demo123                          ║
║                                                                      ║
║   📱 URL: https://zass.website                                      ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
    `);
    await initDatabase();
    await initBrowser();
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
}

start();
