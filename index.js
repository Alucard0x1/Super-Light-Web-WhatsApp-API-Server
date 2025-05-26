const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode-terminal');
const Boom = require('@hapi/boom');
const fs = require('fs');
const path = require('path'); // Import path module

const app = express();
const mediaDir = path.resolve('./media'); // Define mediaDir
const clients = {};

app.use(bodyParser.json());

const authFolders = {};

// Function to generate QR code and initialize client
const generateQR = async (sessionId) => {
  const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${sessionId}`);
  authFolders[sessionId] = `./auth_info_${sessionId}`;

  const sock = makeWASocket({
    printQRInTerminal: false, // Set to false
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
      } else if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode === DisconnectReason.loggedOut) {
        // If logged out, remove the auth folder
        if (authFolders[sessionId]) {
          fs.rmSync(authFolders[sessionId], { recursive: true, force: true });
          delete authFolders[sessionId];
          console.log(`Removed auth folder for session ${sessionId} due to logout.`);
        }
        delete clients[sessionId]; // Remove client instance on logout
      }
    } else if (connection === 'open') {
      console.log('opened connection for session:', sessionId);
      clients[sessionId] = sock;  // store the connection for future use
    }
  });

  sock.ev.on('creds.update', saveCreds);
  return sock; // Return the socket for the new endpoint logic
};

// Endpoint to generate QR code
app.get('/qr-code/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  let responseSent = false;

  if (clients[sessionId] && clients[sessionId].ws && clients[sessionId].ws.socket && clients[sessionId].ws.socket.readyState === 1) { // 1 for WebSocket.OPEN
    return res.status(200).json({ message: 'Client already initialized and connected' });
  }

  const qrTimeout = setTimeout(() => {
    if (!responseSent) {
      responseSent = true;
      res.status(500).json({ error: 'QR code generation timed out' });
    }
    // Attempt to close the socket if it exists and connection wasn't established
    if (sock && sock.ws && sock.ws.socket && sock.ws.socket.readyState !== 1) {
        sock.end(new Error('QR Timeout'));
    }
  }, 30000); // 30 seconds timeout

  let sock; // Declare sock here to be accessible in timeout

  try {
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${sessionId}`);
    authFolders[sessionId] = `./auth_info_${sessionId}`;

    sock = makeWASocket({ // Assign to the outer sock
      auth: state,
      printQRInTerminal: false,
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (!responseSent) {
          clearTimeout(qrTimeout);
          responseSent = true;
          res.status(200).json({ qrString: qr });
        }
      }

      if (connection === 'open') {
        if (!responseSent) { // If connected without QR (e.g. using saved creds)
            clearTimeout(qrTimeout);
            responseSent = true;
            // This means we are already connected, no QR to show.
            // The initial check for `clients[sessionId]` should ideally catch this if the session is truly active.
            // However, if `clients[sessionId]` was cleared but auth files exist, Baileys might auto-reconnect.
            res.status(200).json({ message: 'Client connected using saved credentials. No QR code generated.' });
        }
        console.log('opened connection for session:', sessionId);
        clients[sessionId] = sock;
      } else if (connection === 'close') {
        clearTimeout(qrTimeout);
        if (!responseSent) {
          responseSent = true;
          const errorReason = lastDisconnect?.error?.message || 'Unknown error during connection closure.';
          let statusCode = 500;
          if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
            statusCode = 401; // Unauthorized or similar
             if (authFolders[sessionId]) {
                fs.rmSync(authFolders[sessionId], { recursive: true, force: true });
                delete authFolders[sessionId];
                console.log(`Removed auth folder for session ${sessionId} due to logout in QR endpoint.`);
            }
            delete clients[sessionId];
          }
          res.status(statusCode).json({ error: 'Failed to generate QR code or connection closed.', details: errorReason });
        }
        // Clean up client if connection closed before it was stored or if error
        if (clients[sessionId] === sock) { // ensure we only delete if it's the same socket
            delete clients[sessionId];
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (error) {
    clearTimeout(qrTimeout);
    if (!responseSent) {
      responseSent = true;
      console.error('Error in /qr-code endpoint:', error);
      res.status(500).json({ error: 'Internal server error during QR generation.', details: error.message });
    }
  }
});

// Endpoint to delete session
app.delete('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const sock = clients[sessionId];
  const authFolderPath = authFolders[sessionId] || `./auth_info_${sessionId}`; // Get path from memory or reconstruct

  let sessionExists = !!sock; // Check if socket exists
  let authFolderExists = fs.existsSync(authFolderPath); // Check if auth folder exists

  if (!sessionExists && !authFolderExists) {
    return res.status(404).json({ error: `Session '${sessionId}' not found.` });
  }

  try {
    if (sock) {
      console.log(`Attempting to logout session: ${sessionId}`);
      // It's possible sock.logout() might throw if connection is already dead
      // or if it's in a weird state.
      try {
        await sock.logout(); // This should trigger the 'connection.update' with DisconnectReason.loggedOut
        console.log(`Session ${sessionId} logged out successfully from Baileys.`);
      } catch (logoutError) {
        console.warn(`Error during sock.logout() for session ${sessionId}, possibly already disconnected:`, logoutError.message);
        // Even if logout fails, proceed to clean up local data as the session might be invalid anyway.
      }
      delete clients[sessionId]; // Explicitly remove from clients object
    }

    // Delete the authentication folder
    if (authFolderExists) {
      fs.rmSync(authFolderPath, { recursive: true, force: true });
      console.log(`Authentication folder ${authFolderPath} deleted.`);
      delete authFolders[sessionId]; // Also remove from authFolders tracking object
    } else {
      // If sock didn't exist but we are here, it means authFolder might still exist (e.g. server restart)
      // but if we already checked and it doesn't, this is fine.
      // If sock existed but folder doesn't, it's an inconsistent state but we cleaned the sock.
      console.log(`Authentication folder for session ${sessionId} not found or already deleted.`);
    }
    
    // If either the socket existed or the folder existed, we've performed an action.
    return res.status(200).json({ message: `Session '${sessionId}' logged out and associated data deleted successfully.` });

  } catch (error) {
    console.error(`Error deleting session ${sessionId}:`, error);
    // Preserve existing client and authFolder data if error occurs mid-process?
    // For now, assume if error, something went wrong, but some cleanup might have happened.
    res.status(500).json({ error: `Failed to delete session '${sessionId}'.`, details: error.message });
  }
});

// Endpoint to send message
app.post('/send-message', async (req, res) => {
  const { sessionId, number, message, imagePath } = req.body;

  // Input Validation
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return res.status(400).json({ error: "'sessionId' is required and must be a non-empty string." });
  }
  if (!number || typeof number !== 'string') {
    return res.status(400).json({ error: "'number' is required and must be a string." });
  }
  if (!/^\d+$/.test(number)) {
    return res.status(400).json({ error: "Invalid 'number' format. Must be digits only." });
  }
  if (!message && !imagePath) {
    return res.status(400).json({ error: "Either 'message' or 'imagePath' must be provided." });
  }
  if (message !== undefined && message !== null && typeof message !== 'string') {
    return res.status(400).json({ error: "'message' must be a string." });
  }
  if (imagePath !== undefined && imagePath !== null && typeof imagePath !== 'string') {
    return res.status(400).json({ error: "'imagePath' must be a string." });
  }
  
  // Now that basic input validation has passed, check for the client
  const sock = clients[sessionId];
  if (!sock) {
    return res.status(404).json({ error: `Client with session ID '${sessionId}' not found` });
  }

  try {
    // Ensure message is at least an empty string if imagePath is provided and message is null/undefined
    const currentMessage = (imagePath && (message === null || message === undefined)) ? '' : message;

    if (imagePath) {
      const absoluteImagePath = path.resolve(mediaDir, imagePath);

      // Security Check: Ensure the path is within mediaDir
      if (!absoluteImagePath.startsWith(mediaDir + path.sep)) {
        return res.status(400).json({ error: 'Invalid image path. Path traversal attempt detected.' });
      }

      // File Existence & Accessibility Check
      if (!fs.existsSync(absoluteImagePath)) {
        return res.status(400).json({ error: `Image not found: ${imagePath}` });
      }
      try {
        fs.accessSync(absoluteImagePath, fs.constants.R_OK);
      } catch (e) {
        return res.status(400).json({ error: `Image not accessible: ${imagePath}` });
      }

      const buffer = fs.readFileSync(absoluteImagePath);
      await sock.sendMessage(`${number}@s.whatsapp.net`, { image: buffer, caption: currentMessage });
    } else {
      // Sending a text message (message must be present here due to earlier check)
      await sock.sendMessage(`${number}@s.whatsapp.net`, { text: currentMessage });
    }
    res.status(200).json({ message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
