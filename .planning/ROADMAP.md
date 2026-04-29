# Roadmap: WhatsApp Follow-up Bot

## Phase 1: Foundation & Authentication
- [ ] Initialize Node.js project.
- [ ] Set up `whatsapp-web.js` and local authentication.
- [ ] Implement QR code display in terminal.
- [ ] Ensure session persistence.

## Phase 2: Contact Tracking & Storage
- [ ] Set up a local database (SQLite) or JSON storage.
- [ ] Implement a listener for incoming messages to register new contacts.
- [ ] Track message timestamps.

## Phase 3: Follow-up Engine
- [ ] Implement the scheduler to check for pending follow-ups.
- [ ] Add rate limiting and human-like delays.
- [ ] Configure the follow-up message content.

## Phase 4: Railway Deployment
- [ ] Create `Dockerfile` with Puppeteer dependencies.
- [ ] Configure Railway environment variables.
- [ ] Test deployment and persistence in the cloud.
