# Super Simple Web WhatsApp Gateway using Baileys Library

This project implements a simple WhatsApp gateway using the `@whiskeysockets/baileys` library. It allows you to generate QR codes for WhatsApp Web authentication and send messages (including images) through WhatsApp.

## Author

- Creator: Alucard0x1
- Contact: [Telegram @Alucard0x1](https://t.me/Alucard0x1)

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [Examples](#examples)

## Features

- Generate QR codes for WhatsApp Web authentication
- Send text messages
- Send images with captions
- Support for multiple sessions

## Prerequisites

- Node.js (v14 or higher recommended)
- npm (Node Package Manager)

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/Alucard0x1/super-simple-web-whatsapp-gateway.git
   ```

2. Navigate to the project directory:
   ```
   cd super-simple-web-whatsapp-gateway
   ```

3. Install the dependencies:
   ```
   npm install
   ```

## Usage

To start the server, run:

```
node server.js
```

The server will start running on `http://localhost:3000` (or the port specified in your environment variables).

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/qr-code/:sessionId` | GET | Generate a QR code for WhatsApp Web authentication |
| `/send-message` | POST | Send a message (text or image) to a WhatsApp number |

## Examples

### Generating a QR Code

To generate a QR code for a new session:

```bash
curl http://localhost:3000/qr-code/session1
```

This will start the QR code generation process for a session with ID "session1". You'll need to scan this QR code with your WhatsApp mobile app to authenticate.

### Sending a Text Message

To send a text message:

```bash
curl -X POST http://localhost:3000/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session1",
    "number": "1234567890",
    "message": "Hello, this is a test message!"
  }'
```

### Sending an Image with Caption

To send an image with a caption:

```bash
curl -X POST http://localhost:3000/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session1",
    "number": "1234567890",
    "message": "Check out this image!",
    "imagePath": "/path/to/your/image.jpg"
  }'
```

Note: Make sure to replace `/path/to/your/image.jpg` with the actual path to the image file on your server.

## Important Notes

- Ensure that you have the necessary permissions to use WhatsApp's services through this gateway.
- The `number` in the send-message endpoint should be the full phone number including the country code, without any plus sign or spaces.
- This server supports multiple sessions. Each session is identified by a unique `sessionId`.
- Authentication data for each session is stored in separate folders named `auth_info_[sessionId]`.

## Error Handling

- If you try to generate a QR code for a session that's already initialized, you'll receive a "Client already initialized" message.
- If you try to send a message using a non-existent session ID, you'll get a "Client with session ID '[sessionId]' not found" error.

## Contributions

Contributions, issues, and feature requests are welcome.

## License

This project is licensed under the MIT License.
