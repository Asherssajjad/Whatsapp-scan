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
app.use(express.json());

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

client.on('ready', async () => {
    clientStatus = 'Connected';
    lastQR = '';
    console.log('WhatsApp Client Ready');
    
    // Note: we moved past chat fetching to the manual 'Sync Chats' button to prevent startup timeouts
    console.log('Bot is ready and listening for new messages.');
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
        
        let msgRes = await pool.query('SELECT * FROM messages WHERE contact_id = $1 ORDER BY timestamp ASC', [contactId]);
        
        // Lazy load messages from WhatsApp if none exist in database
        if (msgRes.rows.length === 0 && clientStatus === 'Connected') {
            try {
                const chat = await client.getChatById(contactId);
                const pastMsgs = await chat.fetchMessages({ limit: 20 });
                for (const m of pastMsgs) {
                    await pool.query(
                        `INSERT INTO messages (id, contact_id, body, timestamp, is_from_me) 
                         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
                        [m.id._serialized, contactId, m.body, m.timestamp, m.fromMe]
                    );
                }
                msgRes = await pool.query('SELECT * FROM messages WHERE contact_id = $1 ORDER BY timestamp ASC', [contactId]);
            } catch (err) {
                console.error("Failed to lazy load messages:", err);
            }
        }

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

app.post('/toggle-status/:id', async (req, res) => {
    const contactId = req.params.id;
    try {
        const contactRes = await pool.query('SELECT status FROM contacts WHERE id = $1', [contactId]);
        if (contactRes.rows.length > 0) {
            const newStatus = contactRes.rows[0].status === 'active' ? 'paused' : 'active';
            await pool.query('UPDATE contacts SET status = $1 WHERE id = $2', [newStatus, contactId]);
            return res.json({ success: true, status: newStatus });
        }
    } catch (e) {
        console.error('Error toggling status:', e);
    }
    res.json({ success: false });
});

app.post('/bulk-send', async (req, res) => {
    const { contactIds, message } = req.body;
    if (clientStatus === 'Connected' && message && Array.isArray(contactIds)) {
        let sentCount = 0;
        for (const id of contactIds) {
            try {
                await client.sendMessage(id, message);
                sentCount++;
                // 2-second delay between bulk messages to avoid bans
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
                console.error(`Bulk send failed for ${id}:`, err);
            }
        }
        return res.json({ success: true, sentCount });
    }
    res.json({ success: false });
});

app.post('/api/sync-chats', async (req, res) => {
    if (clientStatus !== 'Connected') return res.json({ success: false, error: 'WhatsApp not connected' });
    
    try {
        const chats = await client.getChats();
        const now = Math.floor(Date.now() / 1000);
        let loadedCount = 0;
        
        for (const chat of chats) {
            if (!chat.isGroup && chat.id._serialized.endsWith('@c.us')) {
                const timestamp = chat.timestamp || now;
                await pool.query(
                    `INSERT INTO contacts (id, name, last_msg_received, status) 
                     VALUES ($1, $2, $3, 'paused') 
                     ON CONFLICT(id) DO NOTHING`,
                    [chat.id._serialized, chat.name || 'Unknown User', timestamp]
                );
                loadedCount++;
            }
        }
        res.json({ success: true, count: loadedCount });
    } catch (err) {
        console.error('Sync failed:', err);
        res.json({ success: false, error: err.message });
    }
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
