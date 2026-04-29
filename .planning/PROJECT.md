# Project: WhatsApp Follow-up Bot

## Overview
A WhatsApp chatbot designed for an institute to automatically follow up with contacts who have previously initiated contact. The bot will scan a QR code for authentication and schedule follow-ups at regular intervals.

## Objectives
- Automate follow-up messages to 100+ contacts.
- Authenticate via QR code scan (whatsapp-web.js).
- Schedule follow-ups (e.g., every 2 days).
- Deploy and run on Railway.

## Tech Stack
- **Language**: JavaScript (Node.js)
- **Library**: `whatsapp-web.js`
- **Deployment**: Railway
- **Storage**: SQLite or JSON for tracking follow-ups.

## Key Features
- QR Code generation for WhatsApp Web authentication.
- Contact tracking (storing contacts who message first).
- Automated follow-up scheduler.
- Rate limiting to prevent WhatsApp bans.
