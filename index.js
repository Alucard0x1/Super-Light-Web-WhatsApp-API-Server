const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode-terminal');
const Boom = require('@hapi/boom');
const fs = require('fs');
const path = require('path'); // Import path module

const app = express();
const mediaDir = path.resolve('./media');
const clients = {}; // Stores active Baileys socket instances
const authFolders = {}; // Stores paths to auth folders, primarily for cleanup reference

console.log(`Media directory set to: ${mediaDir}`);
if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
    console.log(`Created media directory: ${mediaDir}`);
}


app.use(bodyParser.json());

// This function is not used in the provided snippet, but if it were, logging would be similar to generateQR
// const initializeClient = async (sessionId) => { ... };

// Function to generate QR code and initialize client (renamed from the old generateQR for clarity if needed, but keeping as is)
// This function is primarily for setting up event handlers, actual QR is in the endpoint.
const setupEventHandlers = async (sock, sessionId) => {
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log(`[Conn /${sessionId}] Connection update:`, JSON.stringify(update));

    if (qr) {
        // QR will be handled by the /qr-code endpoint's specific connection.update
        // This global handler should not interfere with per-request QR logic
        console.log(`[Conn /${sessionId}] QR code received in global handler (should be handled by endpoint specific listener): ${qr}`);
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output &&
                              lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
      console.log(`[Conn /${sessionId}] Connection closed. Reason: ${lastDisconnect?.error?.message}, Should Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        // Potentially attempt to re-establish connection if needed, or rely on endpoint calls
        // For now, this global handler won't auto-reconnect to avoid conflicts with endpoint logic
        console.log(`[Conn /${sessionId}] Reconnect logic would be here if globally managed.`);
      } else if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
        console.log(`[Conn /${sessionId}] Logout detected.`);
        if (authFolders[sessionId]) {
          try {
            fs.rmSync(authFolders[sessionId], { recursive: true, force: true });
            console.log(`[Conn /${sessionId}] Cleaned up auth folder ${authFolders[sessionId]} due to logout.`);
          } catch (e) {
            console.error(`[Conn /${sessionId}] Error removing auth folder ${authFolders[sessionId]} during logout:`, e.message);
          }
          delete authFolders[sessionId];
        }
        delete clients[sessionId];
        console.log(`[Conn /${sessionId}] Session removed from clients and authFolders objects.`);
      }
    } else if (connection === 'open') {
      console.log(`[Conn /${sessionId}] Connection opened.`);
      clients[sessionId] = sock; // Store the active connection
      // Ensure authFolders entry is also present if connection opens successfully
      if (!authFolders[sessionId]) {
        // This might happen if state was loaded without explicit call to useMultiFileAuthState in this exact flow
        // Or if it's a reconnect where auth_info_sessionId was already known
        console.warn(`[Conn /${sessionId}] Auth folder path was not in authFolders map, attempting to set default path.`);
        authFolders[sessionId] = `./auth_info_${sessionId}`; // Default path structure
      }
    }
  });

  sock.ev.on('creds.update', async (auth) => {
    // This uses the saveCreds from useMultiFileAuthState which should be passed or accessible
    // In the /qr-code endpoint, saveCreds is scoped locally. This global handler needs a strategy.
    // For now, we assume saveCreds is part of the auth state passed to makeWASocket,
    // and Baileys handles it internally with useMultiFileAuthState.
    console.log(`[Creds /${sessionId}] Credentials updated. Baileys will save them if configured with useMultiFileAuthState.`);
  });
};


// Endpoint to generate QR code
app.get('/qr-code/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  console.log(`[QR /${sessionId}] Request received`);
  let responseSent = false;

  if (clients[sessionId] && clients[sessionId].ws && clients[sessionId].ws.socket && clients[sessionId].ws.socket.readyState === 1) { // 1 for WebSocket.OPEN
    console.log(`[QR /${sessionId}] Client already connected`);
    return res.status(200).json({ status: "connected", sessionId: sessionId, message: "Session already connected." });
  }

  // If a session entry exists but not fully connected (e.g. in a connecting/disconnecting state from a previous attempt)
  if (clients[sessionId]) {
    console.warn(`[QR /${sessionId}] Existing client found but not connected. Attempting to re-initialize.`);
    // Clean up previous instance before creating a new one to avoid conflicts
    try {
        await clients[sessionId].logout(); // Attempt graceful logout
    } catch (e) {
        console.warn(`[QR /${sessionId}] Error logging out existing semi-active client: ${e.message}. Proceeding with new init.`);
    }
    clients[sessionId].ev.removeAllListeners(); // Remove all listeners from the old instance
    delete clients[sessionId];
  }


  let sock; // Declare sock here to be accessible in timeout and final cleanup

  console.log(`[QR /${sessionId}] Setting QR generation timeout: 30s`);
  const qrTimeout = setTimeout(() => {
    if (!responseSent) {
      responseSent = true;
      console.warn(`[QR /${sessionId}] QR code generation timed out`);
      if (sock) {
        console.log(`[QR /${sessionId}] Attempting to end socket connection due to timeout.`);
        sock.end(new Boom.Boom('QR Generation Timeout', { statusCode: DisconnectReason.timedOut }));
        // sock.ev.removeAllListeners(); // Clean listeners on timeout related end
      }
      res.status(500).json({ error: 'QR code generation timed out' });
    }
  }, 30000); // 30 seconds timeout

  try {
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${sessionId}`);
    authFolders[sessionId] = `./auth_info_${sessionId}`; // Store path for potential cleanup
    console.log(`[QR /${sessionId}] Using multi-file auth state from ${authFolders[sessionId]}`);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We handle QR via API
    });
    clients[sessionId] = sock; // Store the new socket instance temporarily or permanently if connection succeeds

    // Attach global handlers (like creds.update, general connection close not tied to this request)
    // This was `setupEventHandlers(sock, sessionId);` - but this adds general handlers.
    // The request-specific QR logic needs its own connection.update listener.

    // Global event handlers (like main connection close, creds update)
    // These are longer-lived than the per-request QR logic.
    // sock.ev.removeAllListeners('connection.update'); // Remove any existing general listeners to avoid double processing for this phase
    // sock.ev.removeAllListeners('creds.update'); // if we are re-attaching saveCreds here

    sock.ev.on('connection.update', (update) => {
      // This is the request-specific connection update handler for QR generation
      const { connection, lastDisconnect, qr } = update;
      console.log(`[QR /${sessionId}] Endpoint-specific connection update:`, JSON.stringify({ connection, lastDisconnect: lastDisconnect?.error?.message, qr: !!qr }));


      if (qr) {
        if (!responseSent) {
          clearTimeout(qrTimeout);
          responseSent = true;
          console.log(`[QR /${sessionId}] QR string generated and sent`);
          res.status(200).json({ qrString: qr });
        } else {
            console.log(`[QR /${sessionId}] QR received but response already sent.`);
        }
      }

      if (connection === 'open') {
        clients[sessionId] = sock; // Confirm storage of the active connection
        authFolders[sessionId] = `./auth_info_${sessionId}`; // Ensure auth folder is tracked

        if (!responseSent) {
            clearTimeout(qrTimeout);
            responseSent = true;
            console.log(`[QR /${sessionId}] Client connected using saved credentials (or connected before QR was scanned).`);
            res.status(200).json({ message: 'Client connected successfully. No QR code needed or already scanned.', status: "connected" });
        }
        // Setup long-term handlers after successful connection from QR flow
        setupEventHandlers(sock, sessionId); // This will re-attach general handlers including connection.update
        sock.ev.on('creds.update', saveCreds); // Ensure this specific saveCreds is used
      } else if (connection === 'close') {
        if (!responseSent) {
          clearTimeout(qrTimeout);
          responseSent = true;
          const errorReason = lastDisconnect?.error?.message || 'Unknown error during connection closure.';
          let statusCode = lastDisconnect?.error?.output?.statusCode || 500;

          console.error(`[QR /${sessionId}] Connection closed before QR could be scanned or session established. Reason: ${errorReason}, Status Code: ${statusCode}`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log(`[QR /${sessionId}] Logout detected during initial connection phase.`);
            if (authFolders[sessionId]) {
                try {
                    fs.rmSync(authFolders[sessionId], { recursive: true, force: true });
                    console.log(`[QR /${sessionId}] Cleaned up auth folder ${authFolders[sessionId]} due to logout.`);
                } catch(e) {
                    console.error(`[QR /${sessionId}] Error removing auth folder ${authFolders[sessionId]}: ${e.message}`);
                }
                delete authFolders[sessionId];
            }
          }
          // Remove from clients if it was a failed attempt
          if (clients[sessionId] === sock) delete clients[sessionId];

          res.status(statusCode === DisconnectReason.restartRequired ? 503 : typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600 ? statusCode : 500)
             .json({ error: 'Failed to establish session.', details: errorReason });
        }
        // Clean up listeners specific to this QR attempt if sock exists
        sock?.ev?.removeAllListeners('connection.update');
      }
    });
    // Moved saveCreds to be attached after connection 'open' or if using global setupEventHandlers
    // sock.ev.on('creds.update', saveCreds); // This saveCreds is from this specific useMultiFileAuthState

  } catch (error) {
    clearTimeout(qrTimeout);
    console.error(`[QR /${sessionId}] Error: `, error.message, error.stack);
    if (!responseSent) {
      responseSent = true;
      res.status(500).json({ error: 'Internal server error during QR generation.', details: error.message });
    }
    // Clean up if socket was partially initialized
    if (sock && clients[sessionId] === sock) { // ensure we only delete if it's the same socket
        delete clients[sessionId];
    }
    if (sock) sock.ev.removeAllListeners(); // remove all listeners on this sock instance
  }
});

// Endpoint to list all sessions and their statuses
app.get('/sessions', async (req, res) => {
  console.log('[Sessions] Request received to list all sessions');
  let sessionStatuses = [];
  const processedSessionIds = new Set();

  try {
    const entries = fs.readdirSync('.', { withFileTypes: true });
    const authFolderNames = entries
      .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('auth_info_'))
      .map(dirent => dirent.name);
    console.log(`[Sessions] Found ${authFolderNames.length} potential auth folders.`);

    for (const folderName of authFolderNames) {
      const sessionId = folderName.substring('auth_info_'.length);
      if (sessionId) {
        const sock = clients[sessionId];
        if (sock && sock.ws && sock.ws.socket && sock.ws.socket.readyState === 1) {
          sessionStatuses.push({ sessionId: sessionId, status: "connected" });
        } else {
          sessionStatuses.push({
            sessionId: sessionId,
            status: "disconnected",
            detail: "Session data found on disk, but not actively connected. May require QR scan."
          });
        }
        processedSessionIds.add(sessionId);
      }
    }

    console.log(`[Sessions] Found ${Object.keys(clients).length} in-memory clients.`);
    for (const sessionId in clients) {
      if (!processedSessionIds.has(sessionId)) {
        const sock = clients[sessionId];
        // This case implies a client is in memory but has no corresponding auth_info_ folder (or folder was processed differently)
        if (sock && sock.ws && sock.ws.socket && sock.ws.socket.readyState === 1) {
          sessionStatuses.push({ sessionId: sessionId, status: "connected", detail: "In-memory client, auth folder status unknown or processed." });
        } else {
          sessionStatuses.push({
            sessionId: sessionId,
            status: "disconnected",
            detail: "In-memory client, but not connected. Auth folder status unknown or processed.",
            reason: sock?.lastDisconnect?.error?.message || "Unknown"
          });
        }
      }
    }
    console.log(`[Sessions] Sending session statuses:`, JSON.stringify(sessionStatuses));
    res.status(200).json(sessionStatuses);
  } catch (error) {
    console.error('[Sessions] Error:', error.message, error.stack);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

// Endpoint to get session status
app.get('/session/:sessionId/status', async (req, res) => {
  const { sessionId } = req.params;
  console.log(`[Status /${sessionId}] Request received`);
  const sock = clients[sessionId];
  const authFolderPath = authFolders[sessionId] || `./auth_info_${sessionId}`;
  let result;

  try {
    if (sock && sock.ws && sock.ws.socket && sock.ws.socket.readyState === 1) {
      result = { status: "connected", sessionId: sessionId };
    } else if (sock) {
      const reason = sock.lastDisconnect?.error?.message || "Client instance exists but not connected.";
      result = { status: "disconnected", sessionId: sessionId, reason: reason };
    } else {
      if (fs.existsSync(authFolderPath)) {
        result = { status: "disconnected", sessionId: sessionId, reason: "Session data found on disk but not actively connected. May need QR scan." };
      } else {
        result = { status: "not_found", sessionId: sessionId, message: "Session not found. No active connection and no saved session data." };
        console.log(`[Status /${sessionId}] Sending status (404): `, JSON.stringify(result));
        return res.status(404).json(result);
      }
    }
    console.log(`[Status /${sessionId}] Sending status: `, JSON.stringify(result));
    res.status(200).json(result);
  } catch (error) {
    console.error(`[Status /${sessionId}] Error:`, error.message, error.stack);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

// Endpoint to delete session
app.delete('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  console.log(`[Delete /${sessionId}] Request received`);
  const sock = clients[sessionId];
  const authFolderPath = authFolders[sessionId] || `./auth_info_${sessionId}`;

  let sessionInMemory = !!sock;
  let authFolderExists = fs.existsSync(authFolderPath);

  if (!sessionInMemory && !authFolderExists) {
    console.warn(`[Delete /${sessionId}] Session not found for deletion (neither in memory nor on disk).`);
    return res.status(404).json({ error: `Session '${sessionId}' not found.` });
  }

  try {
    if (sock) {
      console.log(`[Delete /${sessionId}] Attempting Baileys logout.`);
      sock.ev.removeAllListeners(); // Remove all event listeners to prevent interference during logout/cleanup
      try {
        await sock.logout(); // This should trigger the 'connection.update' with DisconnectReason.loggedOut
        console.log(`[Delete /${sessionId}] Baileys logout successful.`);
      } catch (logoutError) {
        console.warn(`[Delete /${sessionId}] Error during Baileys logout (may be normal if already disconnected): `, logoutError.message);
      }
      delete clients[sessionId];
      console.log(`[Delete /${sessionId}] Session removed from in-memory clients.`);
    }

    if (authFolderExists) {
      fs.rmSync(authFolderPath, { recursive: true, force: true });
      console.log(`[Delete /${sessionId}] Auth folder ${authFolderPath} deleted.`);
      if (authFolders[sessionId]) {
        delete authFolders[sessionId];
        console.log(`[Delete /${sessionId}] Session removed from authFolders map.`);
      }
    } else {
      console.log(`[Delete /${sessionId}] Auth folder for session ${sessionId} not found or already deleted.`);
    }
    
    console.log(`[Delete /${sessionId}] Session deleted successfully.`);
    return res.status(200).json({ message: `Session '${sessionId}' logged out and associated data deleted successfully.` });

  } catch (error) {
    console.error(`[Delete /${sessionId}] Error:`, error.message, error.stack);
    res.status(500).json({ error: `Failed to delete session '${sessionId}'.`, details: error.message });
  }
});

// Endpoint to send message
app.post('/send-message', async (req, res) => {
  const { sessionId, number, message, imagePath } = req.body;
  console.log(`[SendMsg /${sessionId}] Request received for number: ${number}`);

  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    const err = "'sessionId' is required and must be a non-empty string.";
    console.warn(`[SendMsg /${sessionId}] Input validation error: ${err}`);
    return res.status(400).json({ error: err });
  }
  // ... (other validations with logging) ...
  if (!number || typeof number !== 'string' || !/^\d+$/.test(number)) {
    const err = "Valid 'number' (digits only string) is required.";
    console.warn(`[SendMsg /${sessionId}] Input validation error: ${err}`);
    return res.status(400).json({ error: err });
  }
  if (!message && !imagePath) {
    const err = "Either 'message' or 'imagePath' must be provided.";
    console.warn(`[SendMsg /${sessionId}] Input validation error: ${err}`);
    return res.status(400).json({ error: err });
  }


  const sock = clients[sessionId];
  if (!sock || !(sock.ws && sock.ws.socket && sock.ws.socket.readyState === 1)) {
    console.warn(`[SendMsg /${sessionId}] Client not found or not connected.`);
    return res.status(404).json({ error: `Client with session ID '${sessionId}' not found or not connected.` });
  }

  try {
    const currentMessage = (imagePath && (message === null || message === undefined)) ? '' : message;
    const fullNumber = `${number}@s.whatsapp.net`;
    console.log(`[SendMsg /${sessionId}] Attempting to send message to ${fullNumber}`);

    if (imagePath) {
      const absoluteImagePath = path.resolve(mediaDir, imagePath);
      console.log(`[SendMsg /${sessionId}] Resolved image path: ${absoluteImagePath}`);

      if (!absoluteImagePath.startsWith(mediaDir + path.sep)) {
        const err = 'Invalid image path. Path traversal attempt detected.';
        console.warn(`[SendMsg /${sessionId}] Image error: ${err}`);
        return res.status(400).json({ error: err });
      }
      if (!fs.existsSync(absoluteImagePath)) {
        const err = `Image not found: ${imagePath}`;
        console.warn(`[SendMsg /${sessionId}] Image error: ${err}`);
        return res.status(400).json({ error: err });
      }
      // try { fs.accessSync(absoluteImagePath, fs.constants.R_OK); } catch (e) { ... } // Already good

      const buffer = fs.readFileSync(absoluteImagePath);
      await sock.sendMessage(fullNumber, { image: buffer, caption: currentMessage });
    } else {
      await sock.sendMessage(fullNumber, { text: currentMessage });
    }
    console.log(`[SendMsg /${sessionId}] Message sent successfully to ${fullNumber}`);
    res.status(200).json({ message: 'Message sent successfully' });
  } catch (error) {
    console.error(`[SendMsg /${sessionId}] Error sending message:`, error.message, error.stack);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

module.exports = { app, sessions: clients, authFolders }; // Export app and sessions for testing or direct manipulation if needed

app.get('/sessions/connected-phones', (req, res) => {
  console.log('[ConnectedPhones] Request received to list all connected phone numbers');
  const connectedPhones = [];
  for (const sessionId in clients) {
    const sock = clients[sessionId];
    // Check if socket exists, is connected, and has user info
    if (sock && sock.ws && sock.ws.socket && sock.ws.socket.readyState === 1 && sock.user && sock.user.id) {
      // sock.user.id is typically like '1234567890:1@s.whatsapp.net' or '1234567890@s.whatsapp.net'
      const fullId = sock.user.id;
      const phoneNumber = fullId.split(':')[0].split('@')[0]; // Extracts the number part
      if (phoneNumber) {
        connectedPhones.push({ sessionId: sessionId, phoneNumber: phoneNumber });
      }
    }
  }
  console.log('[ConnectedPhones] Sending connected phone numbers:', JSON.stringify(connectedPhones));
  res.status(200).json(connectedPhones);
});
