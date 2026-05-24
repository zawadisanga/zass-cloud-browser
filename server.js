// server.js - ZASS ENTERPRISE with REAL PAYMENT SYSTEM
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
const nodemailer = require('nodemailer');

// ==================== CONFIGURATION ====================
const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'zass-enterprise-secret-2026';
const CONTACT_EMAIL = 'citytechuk@gmail.com';
const CONTACT_PHONE = '+25576323348';
const NMB_ACCOUNT = '5161480052318274';
const NMB_ACCOUNT_NAME = 'ZASS Enterprise Solutions';
const NMB_BANK = 'NMB Bank Tanzania';
const NMB_SWIFT = 'NMBLTZTZ';

// Pricing Plans (USD & TZS)
const PRICING_PLANS = {
    free: { usd: 0, tzs: 0, requests: 500, name: 'Free' },
    pro: { usd: 49, tzs: 127400, requests: 5000, name: 'Pro' },
    business: { usd: 99, tzs: 257400, requests: 15000, name: 'Business' },
    enterprise: { usd: 299, tzs: 777400, requests: -1, name: 'Enterprise' }
};

// Email configuration (for payment notifications)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: CONTACT_EMAIL,
        pass: process.env.EMAIL_PASSWORD || '' // Weka password yako ya Gmail app
    }
});

// Directories
['./database', './logs', './temp', './invoices'].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

let db;
let browser = null;
let isBrowserReady = false;

// ==================== DATABASE ====================
async function initDatabase() {
    db = await open({ filename: './database/zass_payments.sqlite', driver: sqlite3.Database });
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
            payment_ref TEXT UNIQUE,
            payment_date DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id TEXT UNIQUE,
            user_email TEXT,
            amount INTEGER,
            currency TEXT,
            payment_ref TEXT,
            status TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Payment Database Ready');
    console.log(`💰 NMB Account: ${NMB_ACCOUNT}`);
    console.log(`🏦 Bank: ${NMB_BANK}`);
    
    // Create demo account
    const demo = await db.get('SELECT * FROM users WHERE email = ?', ['demo@zass.com']);
    if (!demo) {
        const hashed = await bcrypt.hash('demo123', 10);
        const apiKey = 'demo_' + Date.now();
        await db.run(`INSERT INTO users (company_name, email, password, plan, api_key, payment_status, payment_ref) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['Demo Company', 'demo@zass.com', hashed, 'free', apiKey, 'active', 'DEMO-001']);
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

// ==================== MIDDLEWARE ====================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

async function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    const user = await db.get('SELECT * FROM users WHERE api_key = ?', [apiKey]);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    if (user.payment_status !== 'active' && user.plan !== 'free') {
        return res.status(402).json({ error: 'Payment required. Please complete payment to activate your API key.' });
    }
    req.user = user;
    next();
}

// ==================== PAYMENT ENDPOINTS (PESA ZA KWELI) ====================

// Generate payment reference
app.post('/api/payment/initiate', async (req, res) => {
    const { email, plan } = req.body;
    if (!email || !plan) return res.status(400).json({ error: 'Email and plan required' });
    if (!PRICING_PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
    
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(404).json({ error: 'User not found. Please register first.' });
    
    const planData = PRICING_PLANS[plan];
    const paymentRef = 'ZASS-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    
    await db.run('UPDATE users SET plan = ?, payment_ref = ?, payment_amount = ? WHERE email = ?',
        [plan, paymentRef, planData.usd, email]);
    
    // Send email notification to admin
    try {
        await transporter.sendMail({
            from: CONTACT_EMAIL,
            to: CONTACT_EMAIL,
            subject: `💰 New Payment Request - ${paymentRef}`,
            html: `
                <h2>New Payment Request</h2>
                <p><strong>Company:</strong> ${user.company_name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Plan:</strong> ${plan} - $${planData.usd}</p>
                <p><strong>Payment Reference:</strong> ${paymentRef}</p>
                <p><strong>Bank:</strong> ${NMB_BANK}</p>
                <p><strong>Account:</strong> ${NMB_ACCOUNT}</p>
                <p><strong>Account Name:</strong> ${NMB_ACCOUNT_NAME}</p>
            `
        });
    } catch(e) { console.log('Email error:', e.message); }
    
    res.json({
        success: true,
        payment_ref: paymentRef,
        amount_usd: planData.usd,
        amount_tzs: planData.tzs,
        currency: 'USD/TZS',
        bank_details: {
            bank: NMB_BANK,
            account_name: NMB_ACCOUNT_NAME,
            account_number: NMB_ACCOUNT,
            swift_code: NMB_SWIFT
        },
        instructions: `Make payment of $${planData.usd} (TZS ${planData.tzs.toLocaleString()}) to NMB Account ${NMB_ACCOUNT}. Use payment reference: ${paymentRef}`,
        contact: CONTACT_EMAIL
    });
});

// Verify payment (Admin or Automatic)
app.post('/api/payment/verify', async (req, res) => {
    const { payment_ref, transaction_id, amount } = req.body;
    if (!payment_ref) return res.status(400).json({ error: 'Payment reference required' });
    
    const user = await db.get('SELECT * FROM users WHERE payment_ref = ?', [payment_ref]);
    if (!user) return res.status(404).json({ error: 'Payment reference not found' });
    
    const transactionId = transaction_id || 'TXN-' + Date.now();
    const planData = PRICING_PLANS[user.plan];
    
    // Update user payment status
    await db.run('UPDATE users SET payment_status = ?, payment_date = CURRENT_TIMESTAMP WHERE payment_ref = ?', 
        ['active', payment_ref]);
    
    // Record transaction
    await db.run('INSERT INTO transactions (transaction_id, user_email, amount, currency, payment_ref, status) VALUES (?, ?, ?, ?, ?, ?)',
        [transactionId, user.email, amount || planData.usd, 'USD', payment_ref, 'completed']);
    
    // Send confirmation email
    try {
        await transporter.sendMail({
            from: CONTACT_EMAIL,
            to: user.email,
            subject: `✅ Payment Confirmed - ZASS Enterprise ${user.plan} Plan`,
            html: `
                <h2>Payment Confirmed!</h2>
                <p>Dear ${user.company_name},</p>
                <p>Your payment for the <strong>${user.plan}</strong> plan has been confirmed.</p>
                <p><strong>Your API Key:</strong> <code>${user.api_key}</code></p>
                <p><strong>Plan:</strong> ${user.plan} - $${planData.usd}/month</p>
                <p><strong>Requests:</strong> ${planData.requests === -1 ? 'Unlimited' : planData.requests + ' per month'}</p>
                <p>You can now start using the ZASS Enterprise API.</p>
                <p><a href="https://zass.website/dashboard">Go to Dashboard →</a></p>
            `
        });
    } catch(e) { console.log('Email error:', e.message); }
    
    res.json({
        success: true,
        message: 'Payment verified successfully! Your API key is now active.',
        api_key: user.api_key,
        plan: user.plan
    });
});

// Check payment status
app.get('/api/payment/status/:email', async (req, res) => {
    const { email } = req.params;
    const user = await db.get('SELECT payment_status, plan, payment_ref, payment_amount FROM users WHERE email = ?', [email]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        email,
        status: user.payment_status,
        plan: user.plan,
        payment_ref: user.payment_ref,
        amount: user.payment_amount,
        bank_account: NMB_ACCOUNT
    });
});

// ==================== AI CHAT (Gemini) ====================
async function callGeminiAI(prompt) {
    const AI_API_KEY = process.env.AI_API_KEY || '';
    if (AI_API_KEY) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${AI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `You are ZASS AI Assistant. Be friendly and helpful. Respond to: ${prompt}` }] }]
                })
            });
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || getSmartResponse(prompt);
        } catch(e) { return getSmartResponse(prompt); }
    }
    return getSmartResponse(prompt);
}

function getSmartResponse(prompt) {
    const msg = prompt.toLowerCase();
    if (msg.includes('price') || msg.includes('bei')) {
        return "💰 **ZASS Pricing:**\n• Free: $0/mo (500 requests)\n• Pro: $49/mo (5,000 requests)\n• Business: $99/mo (15,000 requests)\n• Enterprise: $299/mo (unlimited)\n\nWhich plan interests you?";
    }
    else if (msg.includes('payment') || msg.includes('malipo')) {
        return `💳 **Payment Instructions:**\nBank: NMB Bank Tanzania\nAccount: ${NMB_ACCOUNT}\nAccount Name: ${NMB_ACCOUNT_NAME}\nSWIFT: ${NMB_SWIFT}\n\nAfter payment, email ${CONTACT_EMAIL} with payment reference for activation.`;
    }
    else if (msg.includes('help')) {
        return "🤝 I can help with: Pricing, Payments, API Keys, Technical Support. What do you need?";
    }
    return "Hello! I'm ZASS AI Assistant. How can I help you today?";
}

// ==================== API ENDPOINTS ====================

// AI Chat
app.post('/api/ai/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    const response = await callGeminiAI(message);
    res.json({ success: true, response });
});

// Demo (Free - No API Key)
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

// Protected Render
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
    const { company_name, email, password, phone, plan = 'free' } = req.body;
    if (!company_name || !email || !password) {
        return res.status(400).json({ error: 'Company name, email, and password required' });
    }
    
    const exists = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    
    const hashed = await bcrypt.hash(password, 10);
    const apiKey = 'zass_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    const paymentRef = plan === 'free' ? 'FREE-' + Date.now() : 'PAY-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const paymentStatus = plan === 'free' ? 'active' : 'pending';
    
    await db.run(`INSERT INTO users (company_name, email, password, phone, plan, api_key, payment_ref, payment_status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [company_name, email, hashed, phone || '', plan, apiKey, paymentRef, paymentStatus]);
    
    res.json({ 
        success: true, 
        api_key: apiKey, 
        payment_ref: paymentRef,
        plan: plan,
        payment_required: plan !== 'free',
        message: plan === 'free' ? 'Free account created! You can start using the API immediately.' : 'Registration successful! Please complete payment to activate your account.'
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

// User stats
app.get('/api/stats', authenticate, async (req, res) => {
    const planData = PRICING_PLANS[req.user.plan];
    res.json({
        company: req.user.company_name,
        plan: req.user.plan,
        requests_limit: planData.requests,
        payment_status: req.user.payment_status,
        api_key: req.user.api_key
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: isBrowserReady ? 'ready' : 'starting', version: 'ZASS Payment v1.0' });
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
    res.send(`const C='zass-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/manifest.json']))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`);
});

app.get('/logo.png', (req, res) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#667eea"/><text x="256" y="276" font-size="180" text-anchor="middle" fill="white" font-family="Arial">💰</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
});

// ==================== START ====================
async function start() {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   💰 ZASS ENTERPRISE - REAL PAYMENT SYSTEM                          ║
║   ===============================================                    ║
║                                                                      ║
║   🏦 NMB BANK ACCOUNT: ${NMB_ACCOUNT}                                 ║
║   🏦 Account Name: ${NMB_ACCOUNT_NAME}                               ║
║   🏦 SWIFT: ${NMB_SWIFT}                                              ║
║                                                                      ║
║   💵 Pricing:                                                        ║
║   • Free: $0/mo (500 requests)                                      ║
║   • Pro: $49/mo (5,000 requests)                                    ║
║   • Business: $99/mo (15,000 requests)                              ║
║   • Enterprise: $299/mo (unlimited)                                 ║
║                                                                      ║
║   🔑 Demo: demo@zass.com / demo123                                  ║
║   📧 Support: ${CONTACT_EMAIL}                                        ║
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
