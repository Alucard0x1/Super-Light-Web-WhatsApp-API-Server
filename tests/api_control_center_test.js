const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Configuration
const BASE_URL = 'http://localhost:3000';
const TARGET_NUMBER = '6283865213518';
const USERNAME = 'admin';
const PASSWORD = '123'; // Assuming default, change if needed

// Setup Axios with Cookie Support
const jar = new CookieJar();
const client = wrapper(axios.create({
    baseURL: BASE_URL,
    jar,
    validateStatus: () => true // Don't throw on error status
}));

async function login() {
    console.log('--- Logging in ---');
    const response = await client.post('/admin/login', {
        email: USERNAME,
        password: PASSWORD
    });

    if (response.status === 200 && response.data.status === 'success') {
        console.log('✅ Login successful');
        return true;
    } else {
        console.error('❌ Login failed:', response.data);
        return false;
    }
}

async function getConnectedSession() {
    console.log('\n--- Fetching Sessions ---');
    const response = await client.get('/api/v1/sessions');

    if (response.status !== 200) {
        console.error('❌ Failed to fetch sessions:', response.data);
        return null;
    }

    const sessions = response.data.data;
    const connectedSession = sessions.find(s => s.status === 'CONNECTED');

    if (connectedSession) {
        console.log(`✅ Found connected session: ${connectedSession.sessionId}`);
        return connectedSession;
    } else {
        console.error('❌ No CONNECTED session found. Please connect a session in the dashboard first.');
        return null;
    }
}

async function sendTextMessage(sessionId, token) {
    console.log('\n--- Testing Text Message ---');
    const payload = {
        recipient_type: 'individual',
        to: TARGET_NUMBER,
        type: 'text',
        text: { body: '🤖 Unit Test: Text Message from API Control Center' }
    };

    const response = await client.post(`/api/v1/messages?sessionId=${sessionId}`, payload, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 200 && response.data[0].status === 'success') {
        console.log('✅ Text message sent successfully');
        return true;
    } else {
        console.error('❌ Text message failed:', response.data);
        return false;
    }
}

async function sendImageMessage(sessionId, token) {
    console.log('\n--- Testing Image Message ---');
    const payload = {
        recipient_type: 'individual',
        to: TARGET_NUMBER,
        type: 'image',
        image: {
            link: 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png',
            caption: '🤖 Unit Test: Image Message'
        }
    };

    const response = await client.post(`/api/v1/messages?sessionId=${sessionId}`, payload, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 200 && response.data[0].status === 'success') {
        console.log('✅ Image message sent successfully');
        return true;
    } else {
        console.error('❌ Image message failed:', response.data);
        return false;
    }
}

async function sendDocumentMessage(sessionId, token) {
    console.log('\n--- Testing Document Message ---');
    const payload = {
        recipient_type: 'individual',
        to: TARGET_NUMBER,
        type: 'document',
        document: {
            link: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
            filename: 'test-document.pdf',
            mimetype: 'application/pdf'
        }
    };

    const response = await client.post(`/api/v1/messages?sessionId=${sessionId}`, payload, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 200 && response.data[0].status === 'success') {
        console.log('✅ Document message sent successfully');
        return true;
    } else {
        console.error('❌ Document message failed:', response.data);
        return false;
    }
}

async function sendComboMessage(sessionId, token) {
    console.log('\n--- Testing Combo Message ---');
    const payloads = [
        {
            recipient_type: 'individual',
            to: TARGET_NUMBER,
            type: 'text',
            text: { body: '🤖 Unit Test: Combo - Part 1 (Text)' }
        },
        {
            recipient_type: 'individual',
            to: TARGET_NUMBER,
            type: 'image',
            image: {
                link: 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png',
                caption: '🤖 Unit Test: Combo - Part 2 (Image)'
            }
        }
    ];

    const response = await client.post(`/api/v1/messages?sessionId=${sessionId}`, payloads, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 200 && Array.isArray(response.data) && response.data.every(r => r.status === 'success')) {
        console.log('✅ Combo message sent successfully');
        return true;
    } else {
        console.error('❌ Combo message failed:', response.data);
        return false;
    }
}

async function runTests() {
    console.log('=== API Control Center Unit Tests ===');
    console.log(`Target: ${TARGET_NUMBER}`);

    if (!await login()) return;

    const session = await getConnectedSession();
    if (!session) return;

    const { sessionId, token } = session;
    console.log(`Using Session: ${sessionId} | Token: ${token.substring(0, 10)}...`);

    const textSuccess = await sendTextMessage(sessionId, token);
    await new Promise(r => setTimeout(r, 1000));

    let imageSuccess = false;
    if (textSuccess) {
        imageSuccess = await sendImageMessage(sessionId, token);
        await new Promise(r => setTimeout(r, 1000));
    }

    let docSuccess = false;
    if (imageSuccess) {
        docSuccess = await sendDocumentMessage(sessionId, token);
        await new Promise(r => setTimeout(r, 1000));
    }

    let comboSuccess = false;
    if (docSuccess) {
        comboSuccess = await sendComboMessage(sessionId, token);
    }

    console.log('\n=== Test Summary ===');
    console.log(`Text: ${textSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`Image: ${imageSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`Document: ${docSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`Combo: ${comboSuccess ? 'PASS' : 'FAIL'}`);
}

runTests();
