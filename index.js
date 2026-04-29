const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

let clientStatus = 'Disconnected';
let lastQR = '';
let db;

// Load Config
let config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Initialize Database
async function initDb() {
    db = await open({
        filename: './database.db',
        driver: sqlite3.Database
    });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            name TEXT,
            last_msg_received INTEGER,
            last_followup_sent INTEGER,
            followup_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active'
        )
    `);
    console.log('Database initialized');
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
        
        await db.run(
            `INSERT INTO contacts (id, name, last_msg_received, status) 
             VALUES (?, ?, ?, 'active') 
             ON CONFLICT(id) DO UPDATE SET last_msg_received = ?, status = 'active'`,
            [msg.from, contact.pushname || 'Unknown', timestamp, timestamp]
        );
        console.log(`Updated contact: ${msg.from}`);
    }
});

// Follow-up Engine
async function checkFollowUps() {
    if (clientStatus !== 'Connected') return;

    console.log('Running follow-up check...');
    const now = Math.floor(Date.now() / 1000);
    const delaySeconds = config.followUpDays * 24 * 60 * 60;

    const pending = await db.all(
        `SELECT * FROM contacts 
         WHERE status = 'active' 
         AND last_msg_received < ? 
         AND (last_followup_sent IS NULL OR last_followup_sent < last_msg_received)`,
        [now - delaySeconds]
    );

    for (const contact of pending) {
        try {
            await client.sendMessage(contact.id, config.followUpMessage);
            await db.run(
                `UPDATE contacts SET last_followup_sent = ?, followup_count = followup_count + 1 WHERE id = ?`,
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
    const contacts = await db.all('SELECT * FROM contacts ORDER BY last_msg_received DESC LIMIT 50');
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

// Start Everything
initDb().then(() => {
    client.initialize();
    app.listen(port, () => {
        console.log(`Dashboard running at http://localhost:${port}`);
    });
    // Check for follow-ups every hour
    setInterval(checkFollowUps, config.checkIntervalMinutes * 60 * 1000);
});
