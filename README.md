# WhatsApp Follow-up Bot

A WhatsApp chatbot for institutes to automatically follow up with contacts.

## Setup Instructions

1.  **Install Dependencies**:
    Run the following command in your terminal:
    ```bash
    npm install
    ```

2.  **Run the Bot**:
    Start the bot with:
    ```bash
    npm start
    ```

3.  **Scan QR Code**:
    A QR code will appear in your terminal. Scan it with your WhatsApp mobile app (Linked Devices > Link a Device).

## Features
- **Persistent Session**: You only need to scan the QR code once.
- **Auto Follow-up**: (Coming soon in Phase 3) Automatically sends messages to contacts after 2 days of inactivity.

## Deployment on Railway
This bot is configured to run on Railway. You will need to add a `Dockerfile` (which we will create in Phase 4) and ensure the environment has the necessary dependencies for Puppeteer.
