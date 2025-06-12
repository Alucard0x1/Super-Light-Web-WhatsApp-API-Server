# WhatsApp Gateway API using @whiskeysockets/baileys

This project implements a simple WhatsApp gateway API using the `@whiskeysockets/baileys` library. It allows you to programmatically manage WhatsApp sessions, generate QR codes for authentication, send messages (text and images), and delete sessions.

## Author

- Creator: Alucard0x1
- Contact: [Telegram @Alucard0x1](https://t.me/Alucard0x1)

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Session Management Workflow](#session-management-workflow)
- [API Endpoints](#api-endpoints)
  - [Generate QR Code / Get Session Status](#generate-qr-code--get-session-status)
  - [Get Specific Session Status](#get-specific-session-status)
  - [List All Sessions](#list-all-sessions)
  - [Send Message](#send-message)
  - [Delete Session](#delete-session)
- [Important Notes](#important-notes)
- [Contributions](#contributions)
- [License](#license)

## Features

- Generate QR codes for WhatsApp Web authentication via API.
- Send text messages.
- Send images with captions (from a designated server-side directory).
- Support for multiple, named sessions.
- Session deletion and cleanup.
- API endpoints to check session status.

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

## Session Management Workflow

Here's the typical lifecycle for managing a WhatsApp session with this API:

1.  **Initiate Session & Get QR Code:**
    Make a `GET` request to `/qr-code/:sessionId` (e.g., `/qr-code/mySession1`).
    If the session is new or disconnected, the server will return a JSON object containing a QR code string. If already connected, it will confirm this.
2.  **Scan QR Code (if provided):**
    Convert the received `qrString` into a scannable QR code image and scan it with your WhatsApp mobile application (Linked Devices -> Link a device).
3.  **Check Session Status (Optional):**
    Use `GET /session/:sessionId/status` or `GET /sessions` to monitor the connection status.
4.  **Send Messages:**
    Once the session is active, you can send messages using `POST /send-message`. Include the `sessionId` in your request body.
5.  **Delete Session (Optional):**
    When a session is no longer needed, use `DELETE /session/:sessionId`.

## API Endpoints

This section details the available API endpoints. All responses are in JSON format.

---

### Generate QR Code / Get Session Status
**`GET /qr-code/:sessionId`**

Initiates a new WhatsApp session or retrieves connection status. If a new session needs authentication, it provides a QR code string. If the session is already active and connected, it confirms this.

**Request Format:**
*   **Path Parameters:**
    *   `sessionId` (string, required): A unique identifier for the session.

**Success Responses:**
*   **`200 OK`** - QR code generated (for new/disconnected sessions needing authentication):
    ```json
    {
      "qrString": "2@t1H...the_full_qr_string...J+g=="
    }
    ```
    *(Note: You need to convert this string into a scannable QR code image).*
*   **`200 OK`** - Client already initialized and connected:
    ```json
    {
      "status": "connected",
      "sessionId": "yourSessionId"
    }
    ```
*   **`200 OK`** - Client connected using saved credentials (no QR needed at this moment):
    ```json
    {
      "message": "Client connected using saved credentials. No QR code generated."
    }
    ```

**Error Responses:** (Refer to original README for detailed error examples, they remain similar)
*   `500 Internal Server Error` (e.g., QR timeout, connection failure)
*   `401 Unauthorized` (e.g., logged out)

---

### Get Specific Session Status
**`GET /session/:sessionId/status`**

Retrieves the current connection status of a specific WhatsApp session.

**Request Format:**
*   **Path Parameters:**
    *   `sessionId` (string, required): The unique identifier for the session.

**Possible Responses:**
*   **`200 OK`** - Session is actively connected:
    ```json
    {
      "status": "connected",
      "sessionId": "yourSessionId"
    }
    ```
*   **`200 OK`** - Session is disconnected (client instance might exist or only auth data found):
    ```json
    {
      "status": "disconnected",
      "sessionId": "yourSessionId",
      "reason": "Connection Failure: net::ERR_INTERNET_DISCONNECTED"
    }
    ```
    *(Note: The `reason` can vary, e.g., "Session data found but not actively connected. May need QR scan.")*
*   **`404 Not Found`** - Session not found (no active client and no saved session data):
    ```json
    {
      "status": "not_found",
      "sessionId": "yourSessionId",
      "message": "Session not found. No active connection and no saved session data."
    }
    ```
*   **`500 Internal Server Error`** - Unexpected error.

---

### List All Sessions
**`GET /sessions`**

Lists all available sessions, including those with only persisted authentication data and their current statuses.

**Request Format:**
*   None (no parameters or body).

**Success Response:**
*   **`200 OK`**:
    ```json
    [
      {
        "sessionId": "session1",
        "status": "connected"
      },
      {
        "sessionId": "session2",
        "status": "disconnected",
        "detail": "Session data found, but not actively connected. May require QR scan via /qr-code/:sessionId"
      },
      {
        "sessionId": "anotherOne",
        "status": "disconnected",
        "detail": "Client instance exists but not connected.",
        "reason": "Connection Failure: timed out"
      }
    ]
    ```
    *(Note: The structure for "disconnected" sessions may vary slightly based on whether only auth data is found or an actual client instance exists but is not connected).*

**Error Responses:**
*   **`500 Internal Server Error`** - Unexpected error during retrieval.

---

### Send Message

**`POST /send-message`**

Sends a message (text or image with caption) to a specified WhatsApp number using an active session. (Documentation for request body, success and error responses remains largely the same as in the original README).

**Request Format:**
*   **Headers:** `Content-Type: application/json`
*   **Body (JSON):**
    *   `sessionId` (string, required)
    *   `number` (string, required, digits only)
    *   `message` (string, optional if imagePath provided)
    *   `imagePath` (string, optional if message provided, relative to `media` dir)

**Success Response:**
*   **`200 OK`**: `{"message": "Message sent successfully"}`

**Error Responses:** (Input validation, 404 for session not found, 500 for send failure - refer to original for examples)

---

### Delete Session

**`DELETE /session/:sessionId`**

Logs out an active WhatsApp session, deletes its authentication data from the server, and clears the session instance. (Documentation for path parameters, success and error responses remains largely the same as in the original README).

**Request Format:**
*   **Path Parameters:** `sessionId` (string, required)

**Success Response:**
*   **`200 OK`**: `{"message": "Session 'yourSessionId' logged out and associated data deleted successfully."}`

**Error Responses:** (404 for session not found, 500 for deletion failure - refer to original for examples)

## Important Notes

-   **Phone Number Format:** When sending messages, the `number` field should be the full phone number including the country code, but without any `+` sign, spaces, or leading zeros that are not part of the standard international format (e.g., for Indonesia, use `62...` not `08...`).
-   **Session IDs (`sessionId`):** Choose descriptive and unique IDs for your sessions. These are used in URLs and request bodies to identify which WhatsApp account to use.
-   **Authentication Data:** Session authentication data is stored locally in folders named `auth_info_[sessionId]` in the project's root directory. Deleting a session via the API will remove the corresponding folder.
-   **Media Directory for Images:** To send images, create a directory named `media` in the root of the project. The `imagePath` value in the `/send-message` endpoint must be a path relative to this `media` directory (e.g., if your image is at `./media/cats/fluffy.jpg`, `imagePath` should be `cats/fluffy.jpg`).
-   **Permissions:** Ensure your use of this gateway complies with WhatsApp's terms of service.

## Contributions

Contributions, issues, and feature requests are welcome. Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License.
