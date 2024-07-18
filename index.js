const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode-terminal');
const Boom = require('@hapi/boom');
const fs = require('fs');

const app = express();
const clients = {};

app.use(bodyParser.json());

const authFolders = {};

// Function to generate QR code and initialize client
const generateQR = async (sessionId) => {
  const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${sessionId}`);
  authFolders[sessionId] = `./auth_info_${sessionId}`;

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output &&
                              lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
      console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
      if (shouldReconnect) {
        generateQR(sessionId);  // reconnect if not logged out
      }
    } else if (connection === 'open') {
      console.log('opened connection for session:', sessionId);
      clients[sessionId] = sock;  // store the connection for future use
    }
  });

  sock.ev.on('creds.update', saveCreds);
};

// Endpoint to generate QR code
app.get('/qr-code/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  if (clients[sessionId]) {
    return res.status(200).send('Client already initialized');
  }

  await generateQR(sessionId);

  res.status(200).send(`Generating QR code for session '${sessionId}'...`);
});

// Endpoint to send message
app.post('/send-message', async (req, res) => {
  const { sessionId, number, message, imagePath } = req.body;
  const sock = clients[sessionId];

  if (!sock) {
    return res.status(404).send(`Client with session ID '${sessionId}' not found`);
  }

  try {
    if (imagePath) {
      // Sending an image
      const buffer = fs.readFileSync(imagePath);
      await sock.sendMessage(`${number}@s.whatsapp.net`, { image: buffer, caption: message });
    } else {
      // Sending a text message
      await sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
    }
    res.status(200).send('Message sent successfully');
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send('Failed to send message');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
