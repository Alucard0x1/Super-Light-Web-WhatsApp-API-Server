# Super-Light-Web-WhatsApp-API-Server

A powerful, lightweight, multi-session, and enterprise-grade WhatsApp API server powered by `@whiskeysockets/baileys`. This project provides a complete solution for programmatic WhatsApp messaging, automated campaign dispatches, live customer support chat inbox, auto-reply keyword engines, group participant scraping, and a rich Web Admin Suite.

## Author

- **Creator**: Alucard0x1
- **Contact**: [Telegram @Alucard0x1](https://t.me/Alucard0x1)

---

## Table of Contents

- [Features](#features)
- [Web Admin Suite](#web-admin-suite)
- [Security & Encryption](#security--encryption)
- [Multi-User System](#multi-user-system)
- [Incoming Media Auto-Downloader](#incoming-media-auto-downloader)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage & Running](#usage--running)
- [Unit Testing](#unit-testing)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **Multi-Session Management**: Run and manage multiple WhatsApp accounts simultaneously from a single server.
- **Persistent Connection Engine**: Automatic background socket reconnection after server restarts or network interruptions.
- **Live Support Inbox**: Interactive 2-way live chat thread interface with session scoping and multi-media support.
- **Auto-Reply Keyword Engine**: Rule-based automated responses supporting `exact`, `contains`, `startsWith`, and `regex` matching.
- **Broadcast Campaigns & Spintax**: Multi-recipient messaging with dynamic Spintax variations (`{Hi|Hello|Hey}`) and variable placeholders (`{name}`, `{number}`).
- **Group Participant Scraper**: Scrape joined WhatsApp groups, filter participants, export to CSV/JSON, or convert directly into campaign target lists.
- **Analytics & Throughput Dashboard**: Live delivery metrics, message throughput, active session stats, and trend analytics.
- **System Log History**: Persistent log database storing system events, debug traces, and security logs with search & severity filters.
- **Automatic Media Downloader**: Automatically downloads incoming WhatsApp images, videos, audio voice notes, documents, and stickers directly to local disk (`/media/`).
- **RESTful API (v1)**: Full JSON REST API for seamless integration with external CRM, ERP, and automation tools.

---

## Web Admin Suite

Access the Admin Dashboard by navigating to `http://localhost:3000/admin/dashboard.html` in your browser.

| Tool / Module | Web URL | Description |
| :--- | :--- | :--- |
| **Main Dashboard** | `/admin/dashboard.html` | Central hub for session lifecycle, QR code scanning, and live log stream. |
| **API Control Center** | `/admin/dashboard.html#api-control-center` | Interactive visual API testing tool with button feedback and dynamic `cURL` generators. |
| **Live Support Inbox** | `/admin/inbox.html` | 2-way real-time chat interface with active session selection & media player controls. |
| **Auto-Replies Engine** | `/admin/auto-replies.html` | Rule configuration, session scope, and interactive keyword match sandbox. |
| **Campaign Dispatcher** | `/admin/campaigns.html` | Campaign builder with Spintax support, delay scheduling, and progress tracking. |
| **Group Scraper** | `/admin/group-scraper.html` | Group discovery, participant scraping, and list export. |
| **Analytics Dashboard** | `/admin/analytics.html` | Message statistics, active session breakdown, and throughput performance. |
| **System Log History** | `/admin/system-logs.html` | Searchable log archive with level filtering (`INFO`, `WARN`, `ERROR`). |
| **User Management** | `/admin/users.html` | Admin control panel for managing system users and roles. |
| **Activity Audit Logs** | `/admin/activities.html` | User audit log tracking logins, campaign creations, and session changes. |

---

## Security & Encryption

### 🔒 Encryption Standard
- **AES-256-CBC Encryption**: Session tokens and sensitive state files are encrypted using AES-256-CBC.
- **File Permissions**: Restricted file permissions applied to `session_tokens.enc`.
- **Environment Isolation**: Master keys and dashboard credentials configured via `.env`.

#### Setup Security Keys:
```bash
# Generate a secure 64-character hex encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `.env`:
```env
TOKEN_ENCRYPTION_KEY=your_generated_64_character_hex_key
MASTER_API_KEY=your_master_api_key
```

---

## Multi-User System

- **Admin Role**: Full system access (session creation/deletion, user management, audit logs, log clearing).
- **User Role**: Restricted to managing owned sessions and viewing authorized campaigns.

Initial Default Admin Account:
- **Email**: `admin@localhost`
- **Password**: Value of `ADMIN_DASHBOARD_PASSWORD` in `.env` (default: `admin123`)

---

## Incoming Media Auto-Downloader

All incoming media messages sent to any connected WhatsApp session are automatically downloaded by Baileys and stored locally in the `/media/` folder:

- 📷 **Images**: Saved as `.jpg` and rendered inline in Live Inbox.
- 📹 **Videos**: Saved as `.mp4` and played using inline HTML5 `<video controls>`.
- 🎵 **Voice Notes / Audio**: Saved as `.mp3` and played using inline HTML5 `<audio controls>`.
- 📄 **Documents**: Saved with original extension and downloadable via 1-click links.
- 😊 **Stickers**: Saved as `.webp` and rendered inline.

---

## Prerequisites

- **Node.js**: v18.0.0 or higher recommended
- **npm**: v8.0.0 or higher

---

## Installation

1. **Clone Repository**:
   ```bash
   git clone https://github.com/Alucard0x1/Super-Light-Web-WhatsApp-API-Server.git
   cd Super-Light-Web-WhatsApp-API-Server
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

   *For cPanel or environments without Python build tools:*
   ```bash
   npm run fix:sqlite
   ```

---

## Usage & Running

### Production Mode
```bash
node -r dotenv/config index.js
```

### Development Mode (Auto-Reload)
```bash
npm run dev
```

The server starts at `http://localhost:3000`.

---

## Unit Testing

The repository features a 100% automated **Jest Unit Test Suite** covering models, utility engines, and database configurations.

Run all unit tests:
```bash
npm test
```

Test Coverage Includes:
- **AutoReply Model**: Rule creation, keyword matching (`exact`, `contains`, `startsWith`), and session scope.
- **ChatMessage Model**: Conversation saving, chat history retrieval, and unread counts.
- **Spintax Parser**: Multi-choice parsing `{A|B|C}` and variable substitution (`{name}`, `{number}`).
- **Response Utilities**: Standardized JSON API formatting.
- **Crypto & Database**: AES-256 encryption & SQLite schema initialization.

---

## API Documentation

### Authentication
Include the Bearer Token in your HTTP `Authorization` header for `/api/v1/*` endpoints:
```http
Authorization: Bearer <your_session_token>
```

### V1 API Summary Table

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/sessions` | Create a new WhatsApp session. | Master Key |
| `GET` | `/api/v1/sessions` | List active sessions and statuses. | Bearer / Cookie |
| `DELETE` | `/api/v1/sessions/:id` | Delete a specific session. | Bearer / Cookie |
| `POST` | `/api/v1/messages` | Send text/image/document message. | Bearer Token |
| `GET` | `/api/v1/chats` | Get active conversation threads for session. | Bearer / Cookie |
| `GET` | `/api/v1/chats/:jid/messages` | Get message history for a contact. | Bearer / Cookie |
| `POST` | `/api/v1/chats/:jid/send` | Send live inbox reply (text/media). | Bearer / Cookie |
| `GET` | `/api/v1/auto-replies` | Get all auto-reply rules. | Bearer / Cookie |
| `POST` | `/api/v1/auto-replies` | Create auto-reply rule. | Bearer / Cookie |
| `POST` | `/api/v1/auto-replies/test` | Test keyword matching in sandbox. | Bearer / Cookie |
| `GET` | `/api/v1/recipient-lists` | Get recipient lists. | Bearer / Cookie |
| `POST` | `/api/v1/recipient-lists` | Create a recipient list. | Bearer / Cookie |
| `GET` | `/api/v1/campaigns` | Get campaigns list. | Bearer / Cookie |
| `POST` | `/api/v1/campaigns` | Create a broadcast campaign. | Bearer / Cookie |
| `POST` | `/api/v1/campaigns/:id/send` | Dispatch a broadcast campaign. | Bearer / Cookie |
| `GET` | `/api/v1/sessions/:id/groups` | Scrape joined WhatsApp groups. | Bearer / Cookie |
| `GET` | `/api/v1/groups/:jid/participants` | Get group participant list. | Bearer / Cookie |
| `GET` | `/api/v1/analytics/stats` | Get server metrics & throughput stats. | Bearer / Cookie |
| `GET` | `/api/v1/system-logs` | Query persistent log history. | Bearer / Cookie |

---

## Troubleshooting

### Native SQLite Binding Error
If you encounter `better-sqlite3` build issues:
```bash
npm run fix:sqlite
```

---

## License

This project is licensed under the **MIT License**. Created by **Alucard0x1**.
