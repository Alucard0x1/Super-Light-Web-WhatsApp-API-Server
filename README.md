# Super-Light-Web-WhatsApp-API-Server

A powerful, lightweight, and multi-session WhatsApp API server using the `@whiskeysockets/baileys` library. This project provides a complete solution for programmatic WhatsApp messaging, featuring a rich RESTful API and an interactive web dashboard for easy management and testing.

## Author

-   Creator: Alucard0x1
-   Contact: [Telegram @Alucard0x1](https://t.me/Alucard0x1)

## Table of Contents

-   [Features](#features)
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
-   **Persistent Sessions:** Sessions automatically reconnect after a server restart.
-   **Interactive Web Dashboard:** A user-friendly interface to manage sessions and test the API.
    -   Create, delete, and view the status of all sessions.
    -   Generate and scan QR codes for authentication.
    -   View a live stream of server logs.
-   **Full-Featured API Control Center:**
    -   Visually test all API features directly from the dashboard.
    -   Send text, images, and documents.
    -   Upload media and see a preview before sending.
    -   Dynamically generated `cURL` examples for every action.
-   **Rich RESTful API (v1):**
    -   Secure endpoints with bearer token authentication.
    -   Endpoints for sending messages (text, image, document), uploading media, and deleting messages.
    -   Send media by uploading a file or providing a direct URL.
-   **Webhook Support:**
    -   Configure a webhook URL to receive events for new messages and session status changes.
-   **Legacy API Support:** Includes backward-compatible endpoints for easier migration from older systems.

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

All API requests to the `/api/v1/*` endpoints must be authenticated using a Bearer Token in the `Authorization` header. Your token is printed to the console when the server starts.

**Header Format:** `Authorization: Bearer <your_api_token>`

*Legacy endpoints do not require this token.*

---

### V1 API Endpoints

**Base URL:** `/api/v1`

| Method | Endpoint        | Description                                      |
| :----- | :-------------- | :----------------------------------------------- |
| `POST` | `/webhook`      | Set the webhook URL for receiving events.        |
| `POST` | `/media`        | Upload an image or document for later use.       |
| `POST` | `/messages`     | Send a text, image, or document message.         |
| `DELETE`| `/message`      | Deletes a message that you have previously sent. |

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
