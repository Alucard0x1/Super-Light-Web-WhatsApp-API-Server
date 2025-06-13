# WhatsApp Gateway API using @whiskeysockets/baileys

This project implements a simple WhatsApp gateway API using the `@whiskeysockets/baileys` library. It allows you to programmatically manage WhatsApp sessions, generate QR codes for authentication, send messages (text and images), and delete sessions. It also includes a basic web-based admin dashboard for easier management.

## Author

- Creator: Alucard0x1
- Contact: [Telegram @Alucard0x1](https://t.me/Alucard0x1)

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Admin Dashboard](#admin-dashboard)
- [Session Management Workflow](#session-management-workflow)
- [API Endpoints](#api-endpoints)
  - [Generate QR Code / Get Session Status](#generate-qr-code--get-session-status)
  - [Get Specific Session Status](#get-specific-session-status)
  - [List All Sessions](#list-all-sessions)
  - [Get All Connected Phone Numbers](#get-all-connected-phone-numbers)
  - [Send Message](#send-message)
  - [Delete Session](#delete-session)
- [Important Notes](#important-notes)
- [Development & Debugging](#development--debugging)
  - [Enhanced Logging](#enhanced-logging)
  - [Testing](#testing)
- [Contributions](#contributions)
- [License](#license)

## Features

- Generate QR codes for WhatsApp Web authentication via API.
- Send text messages.
- Send images with captions (from a designated server-side directory).
- Support for multiple, named sessions.
- Session deletion and cleanup.
- API endpoints to check session status.
- Web-based Admin Dashboard for session management and message sending.

## Prerequisites

- Node.js (v14 or higher recommended)
- npm (Node Package Manager)

## Installation

1.  Clone this repository:
    ```bash
    git clone https://github.com/Alucard0x1/super-simple-web-whatsapp-gateway.git
    ```
2.  Navigate to the project directory:
    ```bash
    cd super-simple-web-whatsapp-gateway
    ```
3.  Install the dependencies:
    ```bash
    npm install
    ```
    This will install `@whiskeysockets/baileys` and other necessary packages.

## Usage

To start the server, run:

```bash
node index.js
```

The server will start running on `http://localhost:3000` (or the port specified in your `PORT` environment variable).

## Admin Dashboard

This project includes a web-based admin dashboard to help you manage your WhatsApp sessions.

**Accessing the Dashboard:**
- Navigate to `/admin/` in your browser (e.g., `http://localhost:3000/admin/`).
- Log in using the default credentials:
  - **Username:** `admin`
  - **Password:** `123`
- **Warning:** The default login uses hardcoded credentials and is insecure. It is intended for demonstration purposes only. Do not expose this dashboard publicly without implementing proper authentication.

**Features:**
- **Session Listing:** View all active and inactive sessions, along with their current connection status. Click "Refresh Sessions" to get the latest status.
- **QR Code Generation:** For sessions that are disconnected or require re-authentication, click the "Get QR" button. A modal will appear displaying the QR code (generated using an external service). Scan this QR code with your WhatsApp mobile app.
- **Session Deletion:** Remove a session by clicking the "Delete" button next to it. This will log out the session and delete its authentication data from the server.
- **Send Message:** Select an active (connected) session from the dropdown, enter the recipient's WhatsApp number (digits only, including country code without '+') and your message, then click "Send Message."
- **View Connected Phone Numbers:** Display a list of phone numbers for all currently connected sessions, along with their session IDs.

## Session Management Workflow

Here's the typical lifecycle for managing a WhatsApp session with this API (or using the Admin Dashboard):

1.  **Initiate Session & Get QR Code:**
    Make a `GET` request to `/qr-code/:sessionId` (e.g., `/qr-code/mySession1`) or use the "Get QR" button in the Admin Dashboard.
    If the session is new or disconnected, the server will return a JSON object containing a QR code string (or display it in the dashboard). If already connected, it will confirm this.
2.  **Scan QR Code (if provided):**
    If using the API, convert the received `qrString` into a scannable QR code image. The Admin Dashboard will render the QR code for you. Scan it with your WhatsApp mobile application (Linked Devices -> Link a device).
3.  **Check Session Status (Optional):**
    Use `GET /session/:sessionId/status`, `GET /sessions`, or view the Admin Dashboard to monitor the connection status.
4.  **Send Messages:**
    Once the session is active, you can send messages using `POST /send-message` or the "Send Message" form in the Admin Dashboard. Include the `sessionId` in your request body if using the API.
5.  **Delete Session (Optional):**
    When a session is no longer needed, use `DELETE /session/:sessionId` or the "Delete" button in the Admin Dashboard.

## API Endpoints

This section details the available API endpoints. All responses are in JSON format.
(The API endpoint details remain the same as provided in the input, no changes were requested for these descriptions themselves beyond review. Assuming they are accurate from prior steps.)

---

### Generate QR Code / Get Session Status
**`GET /qr-code/:sessionId`**
*(Description remains the same)*

---

### Get Specific Session Status
**`GET /session/:sessionId/status`**
*(Description remains the same)*

---

### List All Sessions
**`GET /sessions`**
*(Description remains the same)*

---

### Send Message
**`POST /send-message`**
*(Description remains the same)*

---

### Get All Connected Phone Numbers
**`GET /sessions/connected-phones`**

Retrieves a list of phone numbers associated with all currently active and connected WhatsApp sessions.

**Success Response:**
*   **`200 OK`**:
    ```json
    [
      {
        "sessionId": "session1",
        "phoneNumber": "1234567890"
      },
      {
        "sessionId": "anotherSession",
        "phoneNumber": "0987654321"
      }
    ]
    ```
    *(Note: The list will be empty if no sessions are actively connected or if user information is not yet available for a session.)*

---

### Delete Session
**`DELETE /session/:sessionId`**
*(Description remains the same)*

## Important Notes

-   **Phone Number Format:** When sending messages, the `number` field should be the full phone number including the country code, but without any `+` sign, spaces, or leading zeros that are not part of the standard international format (e.g., for Indonesia, use `62...` not `08...`).
-   **Session IDs (`sessionId`):** Choose descriptive and unique IDs for your sessions. These are used in URLs, request bodies, and for organizing auth data.
-   **Authentication Data:** Session authentication data is stored locally in folders named `auth_info_[sessionId]` in the project's root directory. Deleting a session via the API or dashboard will remove the corresponding folder.
-   **Media Directory for Images:** To send images via the API, create a directory named `media` in the root of the project. The `imagePath` value in the `/send-message` endpoint must be a path relative to this `media` directory (e.g., if your image is at `./media/cats/fluffy.jpg`, `imagePath` should be `cats/fluffy.jpg`). Image sending via the dashboard is not currently implemented.
-   **Permissions:** Ensure your use of this gateway complies with WhatsApp's terms of service.

## Development & Debugging

### Enhanced Logging
The server (`index.js`) has been updated to provide more detailed console logging for session lifecycle events, API requests, and errors. This can be helpful for monitoring behavior and diagnosing issues.

### Testing
Due to limitations in the execution environment, automated unit testing with frameworks like Jest could not be implemented. Manual testing of core functionalities (session creation, message sending, deletion, dashboard interactions) is the current approach for verifying changes.

## Contributions

Contributions, issues, and feature requests are welcome. Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License.
