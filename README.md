# Super-Light-Web-WhatsApp-API-Server

A powerful, lightweight, and multi-session WhatsApp API server using the `@whiskeysockets/baileys` library. This project provides a complete solution for programmatic WhatsApp messaging, featuring a rich RESTful API and an interactive web dashboard for easy management and testing.

## Author

-   Creator: Alucard0x1
-   Contact: [Telegram @Alucard0x1](https://t.me/Alucard0x1)

## Table of Contents

-   [Features](#features)
-   [Security](#security)
-   [Prerequisites](#prerequisites)
-   [Installation](#installation)
-   [Usage](#usage)
-   [Admin Dashboard](#admin-dashboard)
-   [API Documentation](#api-documentation)
    -   [Authentication](#authentication)
    -   [V1 API Endpoints](#v1-api-endpoints)
    -   [Legacy API Endpoints](#legacy-api-endpoints)
-   [Important Notes](#important-notes)
-   [Contributions](#contributions)
-   [License](#license)

## Features

-   **Multi-Session Management:** Run multiple WhatsApp accounts from a single server.
-   **Multi-User System:** Role-based access control with Admin and User roles.
    -   User authentication with email/password
    -   Session ownership tracking
    -   Activity logging and audit trail
    -   Admin can manage all users and monitor all activities
    -   Users can only manage their own sessions
-   **Persistent Sessions:** Sessions automatically reconnect after a server restart.
-   **Interactive Web Dashboard:** A user-friendly interface to manage sessions and test the API.
    -   Create, delete, and view the status of all sessions.
    -   Generate and scan QR codes for authentication.
    -   View a live stream of server logs.
    -   User management interface (Admin only)
    -   Activity monitoring dashboard
-   **Full-Featured API Control Center:**
    -   Visually test all API features directly from the dashboard.
    -   Send text, images, and documents.
    -   **NEW:** Send Text + Image + Document together in one request.
    -   Upload media and see a preview before sending.
    -   Dynamically generated `cURL` examples for every action.
-   **Rich RESTful API (v1):**
    -   Secure endpoints with bearer token authentication.
    -   Endpoints for sending messages (text, image, document), uploading media, and deleting messages.
    -   Send media by uploading a file or providing a direct URL.
    -   Support for large files up to 25MB (images, documents, PDFs, Word, Excel)
-   **Webhook Support:**
    -   Configure a webhook URL to receive events for new messages and session status changes.
-   **Legacy API Support:** Includes backward-compatible endpoints for easier migration from older systems.

## Security

### 🔒 Token Encryption (Level 1 - Implemented)

Session tokens are now encrypted using AES-256-CBC encryption for enhanced security:

-   **Automatic Migration:** Existing plain JSON tokens are automatically encrypted on first run
-   **Secure Storage:** Tokens stored in `session_tokens.enc` with restricted file permissions
-   **Environment Configuration:** Encryption key stored in `.env` file (never commit this!)

#### Quick Setup:

1. Generate a secure encryption key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Add to your `.env` file:
   ```env
   TOKEN_ENCRYPTION_KEY=your_generated_64_character_hex_key
   ```

3. Test encryption:
   ```bash
   node test-encryption.js
   ```

For advanced security options (token hashing, JWT, database storage), see [SECURITY_IMPROVEMENTS.md](SECURITY_IMPROVEMENTS.md).

## Multi-User System

The application now includes a comprehensive multi-user system with role-based access control:

### User Roles

-   **Admin**: Full system access
    -   Can create, update, and delete users
    -   Can view and manage all sessions
    -   Can monitor all user activities
    -   Can delete system logs
    
-   **User**: Limited access
    -   Can only view and manage their own sessions
    -   Cannot delete system logs
    -   Cannot access user management

### Initial Setup

1. On first run, a default admin account is created:
   - Email: `admin@localhost`
   - Password: Value of `ADMIN_DASHBOARD_PASSWORD` from `.env`

2. Admin users can create additional users through:
   - Web interface: `/admin/users.html`
   - API: `POST /api/v1/users` (requires admin role)

### User Authentication

Users can log in using:
- Email and password (for multi-user system)
- Legacy admin password (for backward compatibility)

### Activity Logging

All user actions are logged and encrypted:
- Login attempts
- Session creation/deletion
- Message sending
- User management actions

Admins can view all activities at `/admin/activities.html`

## Prerequisites

-   Node.js (v16 or higher recommended)
-   npm (Node Package Manager)

## Installation

1.  Clone this repository:
    ```bash
    git clone https://github.com/Alucard0x1/Super-Light-Web-WhatsApp-API-Server.git
    ```
2.  Navigate to the project directory:
    ```bash
    cd Super-Light-Web-WhatsApp-API-Server
    ```
3.  Install the dependencies:
    ```bash
    npm install
    ```
    
    **For cPanel or environments without Python:**
    ```bash
    npm run install:smart
    ```
    This will automatically handle bcrypt compatibility issues.

## Usage

### For Production

To start the server, run:

```bash
node index.js
```

### For Development

To start the server with `nodemon` (which automatically restarts on file changes):

```bash
npm run dev
```

The server will start on `http://localhost:3000` (or the port specified in your `PORT` environment variable).

## 🚀 Deployment

### cPanel Hosting

For detailed instructions on deploying to cPanel hosting:

📖 **[Complete cPanel Deployment Guide](CPANEL_DEPLOYMENT_GUIDE.md)** - Step-by-step guide for beginners
⚡ **[cPanel Quick Start](CPANEL_QUICK_START.md)** - Quick reference for experienced users

Key requirements for cPanel:
- Node.js 14+ support
- At least 1GB RAM
- Set `MAX_SESSIONS=5` for optimal performance

### Other Deployment Options

- **VPS/Cloud**: Use the production scripts (`start-production.sh` or `start-production.bat`)
- **PM2**: Configuration included in `ecosystem.config.js`
- **Docker**: Coming soon

## Admin Dashboard

Access the dashboard by navigating to `/admin/dashboard.html` in your browser (e.g., `http://localhost:3000/admin/dashboard.html`).

The dashboard is the central hub for managing your WhatsApp gateway. It allows you to:
-   **Create new sessions:** Simply enter a unique ID and click "Create".
-   **Monitor session status:** See at a glance which sessions are connected, disconnected, or require a QR scan.
-   **Authenticate sessions:** Click "Get QR" to generate a code, then scan it with your WhatsApp mobile app.
-   **Test all API functionality:** Use the "API Control Center" to send messages, upload files with previews, and see example API calls in real-time.
-   **View live logs:** See a stream of events from the server to monitor activity and debug issues.

## API Documentation

For complete, interactive testing and usage examples, please use the **API Control Center** on the Admin Dashboard. A summary of the API structure is provided below.

### Authentication

All API requests to the `/api/v1/*` endpoints must be authenticated using a Bearer Token in the `Authorization` header, **except for**:
- `POST /api/v1/sessions` - Requires Master API Key (see below) OR admin dashboard login
- `GET /api/v1/sessions` - Lists all sessions (public information)

**Session Creation Authentication:**
- **Via API**: Requires `X-Master-Key` header with the master API key from `.env`
- **Via Admin Dashboard**: No API key needed when logged in as admin

Your session token is returned when creating a session and also displayed in the dashboard.

**Header Formats:**
- Session operations: `Authorization: Bearer <your_session_token>`
- Create session (API): `X-Master-Key: <your_master_api_key>`

*Legacy endpoints do not require authentication.*

---

### V1 API Endpoints

**Base URL:** `/api/v1`

| Method | Endpoint        | Description                                      | Auth Required |
| :----- | :-------------- | :----------------------------------------------- | :------------ |
| `POST` | `/sessions`     | Create a new WhatsApp session.                   | Master Key†   |
| `GET`  | `/sessions`     | List all sessions with their status.             | No            |
| `DELETE`| `/sessions/:sessionId` | Delete a specific session.                | Yes           |
| `POST` | `/webhook`      | Set webhook URL for a specific session.          | Yes           |
| `GET`  | `/webhook?sessionId=xxx` | Get webhook URL for a session.        | Yes           |
| `DELETE`| `/webhook`     | Remove webhook URL for a session.                | Yes           |
| `POST` | `/media`        | Upload media file (images/documents, max 25MB).  | Yes           |
| `POST` | `/messages?sessionId=xxx` | Send text/image/document messages.    | Yes           |
| `DELETE`| `/message`      | Delete a previously sent message.                | Yes           |

† Master API Key required for API access. Admin dashboard users can create sessions without the key.

*For detailed request/response formats, please refer to the `api_documentation.md` file or use the API Control Center on the dashboard.*

---

### Legacy API Endpoints

**Base URL:** `/api`

| Method | Endpoint        | Description                                      |
| :----- | :-------------- | :----------------------------------------------- |
| `POST` | `/send-message` | (JSON body) Send a simple text message.          |
| `POST` | `/message`      | (Form-data body) Send a simple text message.     |

## Important Notes

-   **Phone Number Format:** When sending messages, use the full international phone number format (e.g., `6281234567890`) without any `+`, spaces, or leading zeros.
-   **Session Data:** Authentication data for each session is stored in the `auth_info_baileys` directory. Deleting a session via the dashboard or API will remove its corresponding folder.
-   **Media Storage:** Uploaded files are stored in the `media` directory in the project root.
-   **Terms of Service:** Ensure your use of this gateway complies with WhatsApp's terms of service.

## Contributions

Contributions, issues, and feature requests are welcome. Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License.
