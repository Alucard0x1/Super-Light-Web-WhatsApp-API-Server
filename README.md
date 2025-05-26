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
  - [Generate QR Code](#generate-qr-code)
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
    The server will return a JSON object containing a QR code string.
2.  **Scan QR Code:**
    Convert the received `qrString` into a scannable QR code image (using any QR code generation tool or library) and scan it with your WhatsApp mobile application (Linked Devices -> Link a device).
3.  **Send Messages:**
    Once the session is active (QR scanned, connection open), you can send messages using `POST /send-message`. Include the `sessionId` in your request body.
4.  **Delete Session (Optional):**
    When a session is no longer needed, or if you want to re-authenticate, you can delete it using `DELETE /session/:sessionId`. This logs out the session from WhatsApp and removes its authentication data from the server.

## API Endpoints

This section details the available API endpoints. All responses are in JSON format.

---

### Generate QR Code

**`GET /qr-code/:sessionId`**

Initiates a new WhatsApp session or retrieves connection status for an existing one. If a new session, it provides a QR code string for authentication.

**Request Format:**

*   **Path Parameters:**
    *   `sessionId` (string, required): A unique identifier for the session (e.g., `mySession1`, `userA_whatsapp`).

**Success Responses:**

*   **`200 OK`** - QR code generated (for new sessions needing authentication):
    ```json
    {
      "qrString": "2@t1H...the_full_qr_string...J+g=="
    }
    ```
    *(Note: You need to convert this string into a scannable QR code image).*

*   **`200 OK`** - Client already initialized and connected (session is active):
    ```json
    {
      "message": "Client already initialized and connected"
    }
    ```

*   **`200 OK`** - Client connected using saved credentials (no QR needed):
    ```json
    {
      "message": "Client connected using saved credentials. No QR code generated."
    }
    ```

**Error Responses:**

*   **`500 Internal Server Error`** - QR code generation timed out:
    ```json
    {
      "error": "QR code generation timed out"
    }
    ```
*   **`500 Internal Server Error`** - Failed during QR generation or connection:
    ```json
    {
      "error": "Failed to generate QR code or connection closed.",
      "details": "Specific error message from Baileys or system"
    }
    ```
*   **`401 Unauthorized`** - Session logged out (e.g., by external action):
    ```json
    {
      "error": "Failed to generate QR code or connection closed.",
      "details": "Connection Failure: logged out"
    }
    ```

---

### Send Message

**`POST /send-message`**

Sends a message (text or image with caption) to a specified WhatsApp number using an active session.

**Request Format:**

*   **Headers:**
    *   `Content-Type: application/json`
*   **Body (JSON):**
    *   `sessionId` (string, required): The ID of an active, authenticated session. Must be a non-empty string.
    *   `number` (string, required): The recipient's WhatsApp number. Must be a string containing only digits (e.g., `1234567890`, `6281234567890`).
    *   `message` (string): The text message or caption for an image. Must be a string if provided. Either `message` or `imagePath` (or both) must be provided.
    *   `imagePath` (string, optional): Relative path to an image file within the server's `media` directory (e.g., `photo.jpg`, `promotion/banner.png`). Must be a string if provided. Either `message` or `imagePath` (or both) must be provided.

**Success Response:**

*   **`200 OK`**:
    ```json
    {
      "message": "Message sent successfully"
    }
    ```

**Error Responses:**

*   **`400 Bad Request`** - Input validation errors:
    ```json
    { "error": "'sessionId' is required and must be a non-empty string." }
    ```
    ```json
    { "error": "'number' is required and must be a string." }
    ```
    ```json
    { "error": "Invalid 'number' format. Must be digits only." }
    ```
    ```json
    { "error": "Either 'message' or 'imagePath' must be provided." }
    ```
    ```json
    { "error": "'message' must be a string." }
    ```
    ```json
    { "error": "'imagePath' must be a string." }
    ```
*   **`400 Bad Request`** - Invalid image path or file accessibility issue (these remain from previous step):
    ```json
    { "error": "Invalid image path. Path traversal attempt detected." }
    ```
    ```json
    { "error": "Image not found: non_existent_image.jpg" }
    ```
    ```json
    { "error": "Image not accessible: unreadable_image.jpg" }
    ```
*   **`404 Not Found`** - Client session not found or not active:
    ```json
    {
      "error": "Client with session ID 'yourSessionId' not found"
    }
    ```
*   **`500 Internal Server Error`** - General failure during message sending:
    ```json
    {
      "error": "Failed to send message",
      "details": "Specific error from Baileys or system"
    }
    ```

---

### Delete Session

**`DELETE /session/:sessionId`**

Logs out an active WhatsApp session, deletes its authentication data from the server, and clears the session instance.

**Request Format:**

*   **Path Parameters:**
    *   `sessionId` (string, required): The unique identifier for the session to be deleted.

**Success Response:**

*   **`200 OK`**:
    ```json
    {
      "message": "Session 'yourSessionId' logged out and associated data deleted successfully."
    }
    ```

**Error Responses:**

*   **`404 Not Found`** - Session does not exist (neither active nor any stored data):
    ```json
    {
      "error": "Session 'yourSessionId' not found."
    }
    ```
*   **`500 Internal Server Error`** - Failure during session deletion process:
    ```json
    {
      "error": "Failed to delete session 'yourSessionId'.",
      "details": "Specific error message"
    }
    ```

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
