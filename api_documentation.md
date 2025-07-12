# WhatsApp Gateway API Documentation

This document provides detailed, developer-focused instructions for using the API. For interactive testing, we recommend using the **API Control Center** on the Admin Dashboard.

## Making API Requests

### Base URLs

**Important:** The base URL format depends on your deployment environment:

| Environment | V1 API Base URL | Legacy API Base URL |
|------------|-----------------|---------------------|
| **Local Development** | `http://localhost:3000/api/v1` | `http://localhost:3000/api` |
| **cPanel (HTTP)** | `http://yourdomain.com/api/v1` | `http://yourdomain.com/api` |
| **cPanel (HTTPS)** | `https://yourdomain.com/api/v1` | `https://yourdomain.com/api` |
| **Custom Port** | `http://yourdomain.com:8080/api/v1` | `http://yourdomain.com:8080/api` |

**Note for cPanel users:** Most cPanel deployments use standard HTTP/HTTPS ports (80/443), so you don't need to specify a port in your API calls. Just use your domain name directly.

### Content-Type
For most endpoints, you will be sending data in JSON format. Ensure your requests include the `Content-Type: application/json` header. For file uploads, the API expects `multipart/form-data`.

---

## Authentication

All API requests to the `/api/v1/*` endpoints **must** be authenticated using a Bearer Token, with these exceptions:
- `POST /api/v1/sessions` - Requires Master API Key OR admin authentication
- `GET /api/v1/sessions` - Lists all sessions (public endpoint)

The token is unique per session and is returned when you create a session. You can also view tokens in the Admin Dashboard.

**Header Format:** `Authorization: Bearer <your_api_token>`

*Legacy endpoints at `/api/*` do not require authentication.*

**cURL Example (for any authenticated V1 request):**
```bash
curl ... -H "Authorization: Bearer your_api_token"
```

---

## V1 API Endpoints

**About the Examples:** Most examples in this documentation use `localhost:3000` for local development. If you're using cPanel or a production deployment:
- Replace `http://localhost:3000` with `https://yourdomain.com`
- No port number is needed for standard HTTP/HTTPS deployments
- Use HTTPS for production environments for better security

### **Session Management**

#### Create Session
Creates a new WhatsApp session with a unique ID. **Requires Master API Key OR admin dashboard authentication.**

**`POST /sessions`**

**Authentication:**
- **Via API**: Include `X-Master-Key` header with your master API key
- **Via Dashboard**: Automatic when logged in as admin

**Request Body (JSON):**
```json
{
    "sessionId": "mySession"
}
```

**Success Response (JSON):**
```json
{
    "status": "success",
    "message": "Session mySession created.",
    "token": "your-bearer-token-for-this-session"
}
```

**Note:** Save the returned token - it's required for all other API calls for this session.

**cURL Example (API Access):**
```bash
curl -X POST 'http://localhost:3000/api/v1/sessions' \
-H 'X-Master-Key: your-master-api-key-from-env' \
-H 'Content-Type: application/json' \
-d '{
    "sessionId": "mySession"
}'
```

#### List Sessions
Retrieves all sessions with their current status. **No authentication required.**

**`GET /sessions`**

**Success Response (JSON):**
```json
[
    {
        "sessionId": "mySession",
        "status": "CONNECTED",
        "detail": "Connected as John Doe",
        "qr": null,
        "token": "session-token-here"
    },
    {
        "sessionId": "anotherSession",
        "status": "DISCONNECTED",
        "detail": "Connection closed.",
        "qr": null,
        "token": "another-token-here"
    }
]
```

**cURL Example:**
```bash
curl -X GET 'http://localhost:3000/api/v1/sessions'
```

#### Delete Session
Deletes a specific session and all its data. **Requires authentication.**

**`DELETE /sessions/:sessionId`**

**cURL Example:**
```bash
curl -X DELETE 'http://localhost:3000/api/v1/sessions/mySession' \
-H 'Authorization: Bearer your_api_token'
```

---

### **Webhook Management**

#### Set Webhook URL
Configures or updates the URL where the server will send event notifications for a specific session.

**`POST /webhook`**

**Request Body (JSON):**
```json
{
    "sessionId": "mySession",
    "url": "https://your-webhook-receiver.com/events"
}
```

**cURL Example:**
```bash
curl -X POST 'http://localhost:3000/api/v1/webhook' \
-H 'Authorization: Bearer your_api_token' \
-H 'Content-Type: application/json' \
-d '{
    "sessionId": "mySession",
    "url": "https://your-webhook-receiver.com/events"
}'
```

#### Get Webhook URL
Retrieves the configured webhook URL for a specific session.

**`GET /webhook?sessionId=<your_session_id>`**

**Success Response (JSON):**
```json
{
    "status": "success",
    "sessionId": "mySession",
    "url": "https://your-webhook-receiver.com/events"
}
```

**cURL Example:**
```bash
curl -X GET 'http://localhost:3000/api/v1/webhook?sessionId=mySession' \
-H 'Authorization: Bearer your_api_token'
```

#### Delete Webhook
Removes the webhook URL for a specific session. No events will be sent until a new webhook is set.

**`DELETE /webhook`**

**Request Body (JSON):**
```json
{
    "sessionId": "mySession"
}
```

**cURL Example:**
```bash
curl -X DELETE 'http://localhost:3000/api/v1/webhook' \
-H 'Authorization: Bearer your_api_token' \
-H 'Content-Type: application/json' \
-d '{
    "sessionId": "mySession"
}'
```

---

### **Media Management**

#### Upload Media
Uploads an image or document to the server's `media` directory. The server returns a `mediaId` which can be used to send the file in a subsequent API call.

**File Restrictions:**
- **Allowed types:** JPEG, PNG, PDF only
- **Maximum size:** 5MB
- **MIME types:** `image/jpeg`, `image/png`, `application/pdf`

**`POST /media`**

**Request Body (form-data):**
- `file`: The media file to upload (must be JPEG, PNG, or PDF; max 5MB).

**Success Response (JSON):**
```json
{
    "status": "success",
    "message": "File uploaded successfully.",
    "mediaId": "f7e3e7a0-5e7a-4b0f-8b9a-9e7d6e6e2c3d.jpg",
    "url": "/media/f7e3e7a0-5e7a-4b0f-8b9a-9e7d6e6e2c3d.jpg"
}
```

**Error Response (JSON):**
```json
{
    "status": "error",
    "message": "Invalid file type. Only JPEG, PNG, and PDF allowed."
}
```

**cURL Example:**
```bash
# Replace /path/to/your/file.jpg with the actual file path
curl -X POST 'http://localhost:3000/api/v1/media' \
-H 'Authorization: Bearer your_api_token' \
-F 'file=@/path/to/your/file.jpg'
```
---

### **Message Management**

#### Send Messages
A powerful and flexible endpoint to send various types of messages. You must specify the `sessionId` as a query parameter. You can send a single message (as a JSON object) or multiple messages in a batch (as a JSON array).

**`POST /messages?sessionId=<your_session_id>`**

**Common Body Fields (JSON):**
- `recipient_type` (string, required): `individual` or `group`.
- `to` (string, required): The phone number (e.g., `628123...`) or group ID (e.g., `12036..._us`).
- `type` (string, required): `text`, `image`, or `document`.

**Type-Specific Fields:**
- **If `type` is `text`:**
  - `text` (object):
    - `body` (string, required): The message content.
- **If `type` is `image`:**
  - `image` (object):
    - `link` (string): HTTP/HTTPS URL of the image to send.
    - **OR** `id` (string): The `mediaId` of a previously uploaded image.
    - `caption` (string, optional): The image caption.
- **If `type` is `document`:**
  - `document` (object):
    - `link` (string): HTTP/HTTPS URL of the document.
    - **OR** `id` (string): The `mediaId` of a previously uploaded document.
    - `mimetype` (string, required): The MIME type of the document (e.g., `application/pdf`).
    - `filename` (string, optional): The name of the file to be displayed.

**cURL Example (Single Text Message):**
```bash
curl -X POST 'http://localhost:3000/api/v1/messages?sessionId=mySession' \
-H 'Authorization: Bearer your_api_token' \
-H 'Content-Type: application/json' \
-d '{
    "recipient_type": "individual",
    "to": "6281234567890",
    "type": "text",
    "text": { "body": "Hello from the API!" }
}'
```

**cURL Example (Bulk Mixed Messages):**
```bash
curl -X POST 'http://localhost:3000/api/v1/messages?sessionId=mySession' \
-H 'Authorization: Bearer your_api_token' \
-H 'Content-Type: application/json' \
-d '[
    {
        "recipient_type": "individual",
        "to": "6281234567890",
        "type": "text",
        "text": { "body": "First message" }
    },
    {
        "recipient_type": "individual",
        "to": "6289876543210",
        "type": "image",
        "image": {
            "link": "https://picsum.photos/200",
            "caption": "This is a test image."
        }
    }
]'
```

**cURL Example (Text + Image + Document Combo):**
```bash
# Send text, image, and document to the same recipient in one request
curl -X POST 'http://localhost:3000/api/v1/messages?sessionId=mySession' \
-H 'Authorization: Bearer your_api_token' \
-H 'Content-Type: application/json' \
-d '[
    {
        "recipient_type": "individual",
        "to": "6281234567890",
        "type": "text",
        "text": { "body": "Here are the files you requested:" }
    },
    {
        "recipient_type": "individual",
        "to": "6281234567890",
        "type": "image",
        "image": {
            "link": "https://example.com/chart.png",
            "caption": "Q4 Sales Chart"
        }
    },
    {
        "recipient_type": "individual",
        "to": "6281234567890",
        "type": "document",
        "document": {
            "link": "https://example.com/report.pdf",
            "mimetype": "application/pdf",
            "filename": "Q4_Report_2023.pdf"
        }
    }
]'
```

#### Delete Message
Deletes a message that you have previously sent. You must provide the session ID, the recipient's JID, and the ID of the message to be deleted.

**`DELETE /message`**

**Request Body (JSON):**
```json
{
    "sessionId": "mySession",
    "remoteJid": "6281234567890@s.whatsapp.net",
    "messageId": "3EB0D8E8D8F9A7B6"
}
```

**cURL Example:**
```bash
curl -X DELETE 'http://localhost:3000/api/v1/message' \
-H 'Authorization: Bearer your_api_token' \
-H 'Content-Type: application/json' \
-d '{
    "sessionId": "mySession",
    "remoteJid": "6281234567890@s.whatsapp.net",
    "messageId": "3EB0D8E8D8F9A7B6"
}'
```

---

## Campaign Management API

The Campaign Management API allows you to create and manage bulk WhatsApp messaging campaigns. All campaign endpoints require authentication.

### Create Campaign
Creates a new WhatsApp campaign with recipients, message templates, and scheduling options.

**`POST /campaigns`**

**Request Body (JSON):**
```json
{
    "name": "Marketing Campaign Q1",
    "sessionId": "mySession",
    "scheduledAt": "2024-02-01T10:00:00Z",
    "message": {
        "type": "text",
        "content": "Hi {{Name}}, check out our new products at {{Company}}!"
    },
    "recipients": [
        {
            "number": "+1234567890",
            "name": "John Doe",
            "jobTitle": "CEO",
            "companyName": "ABC Corp"
        }
    ],
    "settings": {
        "delayBetweenMessages": 3000
    }
}
```

### List Campaigns
Retrieves all campaigns (filtered by user role).

**`GET /campaigns`**

**Success Response (JSON):**
```json
[
    {
        "id": "campaign_1234567890",
        "name": "Marketing Campaign Q1",
        "status": "scheduled",
        "createdBy": "admin@example.com",
        "createdAt": "2024-01-15T08:00:00Z",
        "recipientCount": 150,
        "statistics": {
            "sent": 0,
            "failed": 0,
            "total": 150
        }
    }
]
```

### Campaign Actions
Control campaign execution with these endpoints:

- **Start/Send**: `POST /campaigns/{id}/send`
- **Pause**: `POST /campaigns/{id}/pause`
- **Resume**: `POST /campaigns/{id}/resume`
- **Retry Failed**: `POST /campaigns/{id}/retry`
- **Clone**: `POST /campaigns/{id}/clone`
- **Delete**: `DELETE /campaigns/{id}`

### CSV Template Download
Download a CSV template for bulk recipient upload.

**`GET /campaigns/csv-template`**

**Success Response:** CSV file download with sample data

**cURL Example:**
```bash
curl -X GET 'http://localhost:3000/api/v1/campaigns/csv-template' \
-H 'Authorization: Bearer your_api_token' \
-o whatsapp_campaign_template.csv
```

### Preview CSV Upload
Upload and preview a CSV file before creating a campaign.

**`POST /campaigns/preview-csv`**

**Request Body (multipart/form-data):**
- `file`: CSV file with recipients

**Success Response (JSON):**
```json
{
    "success": true,
    "recipients": [
        {
            "number": "+1234567890",
            "name": "John Doe",
            "jobTitle": "CEO",
            "companyName": "ABC Corp"
        }
    ],
    "errors": []
}
```

### Export Campaign Results
Export campaign results and recipient status as CSV.

**`GET /campaigns/{id}/export`**

**Success Response:** CSV file download with campaign results

**cURL Example:**
```bash
curl -X GET 'http://localhost:3000/api/v1/campaigns/campaign_123/export' \
-H 'Authorization: Bearer your_api_token' \
-o campaign_results.csv
```

---

## Legacy API Endpoints

These endpoints are provided for backward compatibility. They are simpler but less flexible and do **not** require token authentication.

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

**cURL Example:**
```bash
curl -X POST 'http://localhost:3000/api/send-message' \
-H 'Content-Type: application/json' \
-d '{
    "sessionId": "mySession",
    "number": "6281234567890",
    "message": "This is a legacy message."
}'
```

#### Send Text (Form Data)

**`POST /message`**

**Request Body (form-data):**
- `phone`: The recipient's phone number.
- `message`: The text message content.
- `sessionId` (optional): The session to use. Defaults to `putra`.

**cURL Example:**
```bash
curl -X POST 'http://localhost:3000/api/message' \
-F 'phone=6281234567890' \
-F 'message=Hello from a form' \
-F 'sessionId=mySession'
```

