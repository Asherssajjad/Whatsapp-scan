const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

let clientStatus = 'Disconnected';
let lastQR = '';
let pool;

// Load Config
let config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Initialize Database
async function initDb() {
    // Railway automatically provides process.env.DATABASE_URL when linked
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
        console.warn("WARNING: No DATABASE_URL found. Using local postgres string if applicable.");
    }

    pool = new Pool({
        connectionString: connectionString || 'postgresql://postgres:postgres@localhost:5432/whatsapp',
        ssl: connectionString && !connectionString.includes('localhost') ? { rejectUnauthorized: false } : false
    });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            name TEXT,
            last_msg_received BIGINT,
            last_followup_sent BIGINT,
            followup_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active'
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            contact_id TEXT,
            body TEXT,
            timestamp BIGINT,
            is_from_me BOOLEAN
        )
    `);
    console.log('PostgreSQL Database initialized');
}

// WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', async (qr) => {
    lastQR = await QRCode.toDataURL(qr);
    qrcodeTerminal.generate(qr, { small: true });
    clientStatus = 'Waiting for Scan';
});

client.on('ready', () => {
    clientStatus = 'Connected';
    lastQR = '';
    console.log('WhatsApp Client Ready');
});

client.on('message', async (msg) => {
    // Only track private chats (not groups)
    if (!msg.from.includes('@g.us')) {
        const timestamp = Math.floor(Date.now() / 1000);
        const contact = await msg.getContact();
        
        await pool.query(
            `INSERT INTO contacts (id, name, last_msg_received, status) 
             VALUES ($1, $2, $3, 'active') 
             ON CONFLICT(id) DO UPDATE SET last_msg_received = $4, status = 'active'`,
            [msg.from, contact.pushname || 'Unknown', timestamp, timestamp]
        );
        
        await pool.query(
            `INSERT INTO messages (id, contact_id, body, timestamp, is_from_me) 
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
            [msg.id._serialized, msg.from, msg.body, timestamp, false]
        );
        console.log(`Updated contact: ${msg.from}`);
    }
});

// Track outgoing messages (manual or automated)
client.on('message_create', async (msg) => {
    if (msg.fromMe && !msg.to.includes('@g.us')) {
        const timestamp = Math.floor(Date.now() / 1000);
        await pool.query(
            `INSERT INTO messages (id, contact_id, body, timestamp, is_from_me) 
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
            [msg.id._serialized, msg.to, msg.body, timestamp, true]
        );
    }
});

// Follow-up Engine
async function checkFollowUps() {
    if (clientStatus !== 'Connected') return;

    console.log('Running follow-up check...');
    const now = Math.floor(Date.now() / 1000);
    const delaySeconds = config.followUpDays * 24 * 60 * 60;

    const res = await pool.query(
        `SELECT * FROM contacts 
         WHERE status = 'active' 
         AND last_msg_received < $1 
         AND (last_followup_sent IS NULL OR last_followup_sent < last_msg_received)`,
        [now - delaySeconds]
    );
    const pending = res.rows;

    for (const contact of pending) {
        try {
            await client.sendMessage(contact.id, config.followUpMessage);
            await pool.query(
                `UPDATE contacts SET last_followup_sent = $1, followup_count = followup_count + 1 WHERE id = $2`,
                [now, contact.id]
            );
            console.log(`Follow-up sent to: ${contact.id}`);
            // Small delay to prevent bans
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (err) {
            console.error(`Failed to send follow-up to ${contact.id}:`, err);
        }
    }
}

// Routes
app.get('/', async (req, res) => {
    let contacts = [];
    try {
        const result = await pool.query('SELECT * FROM contacts ORDER BY last_msg_received DESC LIMIT 50');
        contacts = result.rows;
    } catch (e) {
        console.error('Error fetching contacts:', e);
    }
    res.render('index', { 
        status: clientStatus, 
        qr: lastQR, 
        config, 
        contacts 
    });
});

app.post('/update-config', (req, res) => {
    config.followUpMessage = req.body.message;
    config.followUpDays = parseInt(req.body.days);
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
    res.redirect('/');
});

app.get('/chat/:id', async (req, res) => {
    const contactId = req.params.id;
    try {
        const contactRes = await pool.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
        const contact = contactRes.rows[0];
        if (!contact) return res.redirect('/');
        
        const msgRes = await pool.query('SELECT * FROM messages WHERE contact_id = $1 ORDER BY timestamp ASC', [contactId]);
        res.render('chat', { 
            status: clientStatus, 
            contact, 
            messages: msgRes.rows 
        });
    } catch (e) {
        console.error('Error fetching chat:', e);
        res.redirect('/');
    }
});

app.post('/chat/:id/send', async (req, res) => {
    const contactId = req.params.id;
    const message = req.body.message;
    if (clientStatus === 'Connected' && message) {
        try {
            await client.sendMessage(contactId, message);
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    }
    res.redirect(`/chat/${contactId}`);
});

// Start Everything
initDb().then(() => {
    client.initialize();
    app.listen(port, () => {
        console.log(`Dashboard running at http://localhost:${port}`);
    });
    // Check for follow-ups every hour
    setInterval(checkFollowUps, config.checkIntervalMinutes * 60 * 1000);
});
