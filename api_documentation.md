# WhatsApp Gateway API Documentation

This document provides instructions for using the API of the WhatsApp Gateway.

## Authentication

All API requests to the `/api/v1/*` endpoints must be authenticated using a Bearer Token. The token must be included in the `Authorization` header of your request.

**Header Format:**
`Authorization: Bearer <your_api_token>`

Your API token is displayed in the console when the server starts. *Legacy endpoints do not require this token.*

---

## V1 API Endpoints

The base URL for all v1 endpoints is: `http://<your_server_address>:<port>/api/v1`

### **Webhook Management**

#### Set Webhook URL
Configures the URL where the server will send events (like new messages or session status changes).

**`POST /webhook`**

**Request Body (JSON):**
```json
{
    "url": "https://your-webhook-receiver.com/events"
}
```

---

### **Media Management**

#### Upload Media
Uploads an image or document to the server's `media` directory. The server returns a `mediaId` which can be used to send the file later.

**`POST /media`**

**Request Body (form-data):**
- `file`: The media file to upload.

**Success Response (JSON):**
```json
{
    "status": "success",
    "message": "File uploaded successfully.",
    "mediaId": "f7e3e7a0-5e7a-4b0f-8b9a-9e7d6e6e2c3d.jpg",
    "url": "/media/f7e3e7a0-5e7a-4b0f-8b9a-9e7d6e6e2c3d.jpg"
}
```

---

### **Message Management**

#### Send Messages
A flexible endpoint to send various types of messages. You can send a single message (as a JSON object) or multiple messages in a batch (as a JSON array).

**`POST /messages?sessionId=<your_session_id>`**

**Common Body Fields (JSON):**

- `recipient_type` (string, required): `individual` or `group`.
- `to` (string, required): The phone number or group ID.
- `type` (string, required): `text`, `image`, or `document`.

**Type-Specific Fields:**

- **If `type` is `text`:**
  - `text` (object):
    - `body` (string, required): The message content.
- **If `type` is `image`:**
  - `image` (object):
    - `link` (string): URL of the image to send.
    - **OR** `id` (string): The `mediaId` of a previously uploaded image.
    - `caption` (string, optional): The image caption.
- **If `type` is `document`:**
  - `document` (object):
    - `link` (string): URL of the document.
    - **OR** `id` (string): The `mediaId` of a previously uploaded document.
    - `mimetype` (string, required): The MIME type of the document (e.g., `application/pdf`).
    - `filename` (string, optional): The name of the file.

**Example: Sending a Bulk Message with Mixed Types**
```json
[
    {
        "recipient_type": "individual",
        "to": "6281234567890",
        "type": "text",
        "text": { "body": "Hello from the API!" }
    },
    {
        "recipient_type": "group",
        "to": "120363041234567890@g.us",
        "type": "image",
        "image": {
            "link": "https://example.com/image.jpg",
            "caption": "Check out this image!"
        }
    },
    {
        "recipient_type": "individual",
        "to": "6289876543210",
        "type": "document",
        "document": {
            "id": "f7e3e7a0-5e7a-4b0f-8b9a-9e7d6e6e2c3d.pdf",
            "mimetype": "application/pdf",
            "filename": "MyReport.pdf"
        }
    }
]
```

#### Delete Message
Deletes a message that you have previously sent.

**`DELETE /message`**

**Request Body (JSON):**
```json
{
    "sessionId": "mySession",
    "remoteJid": "6281234567890@s.whatsapp.net",
    "messageId": "3EB0D8E8D8F9A7B6"
}
```

---

## Legacy API Endpoints

These endpoints are provided for backward compatibility. They are simpler but less flexible.

**Base URL:** `http://<your_server_address>:<port>/api`

#### Send Text (JSON)

**`POST /send-message`**

**Request Body (JSON):**
```json
{
    "sessionId": "mySession",
    "number": "6281234567890",
    "message": "This is a legacy message."
}
```

#### Send Text (Form Data)

**`POST /message`**

**Request Body (form-data):**
- `phone`: The recipient's phone number.
- `message`: The text message content.
- `sessionId` (optional): The session to use. Defaults to `putra`.

