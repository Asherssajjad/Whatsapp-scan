# Requirements: WhatsApp Follow-up Bot

## Functional Requirements
1. **Authentication**:
   - The bot must generate a QR code in the terminal or via a simple web interface for initial WhatsApp Web login.
   - The session should be persistent (no need to scan every time).

2. **Contact Identification**:
   - The bot must detect and store contacts who send a message to the institute's number.
   - It should track the timestamp of the last message received or sent.

3. **Follow-up Logic**:
   - The bot should check for contacts who haven't been messaged in X days (default: 2 days).
   - It should send a follow-up message to these contacts.
   - It should avoid messaging the same contact too frequently.

4. **Deployment (Railway)**:
   - Must include a `Dockerfile` or configuration for Railway.
   - Must handle Puppeteer/Chromium dependencies in the cloud environment.

## Non-Functional Requirements
- **Reliability**: Must handle disconnections and reconnect automatically.
- **Safety**: Implement delays between messages to mimic human behavior and avoid bans.
- **Scalability**: Handle 100+ active follow-up threads.

## User Interface
- Terminal-based QR code for setup.
- Log output to track sent messages.
