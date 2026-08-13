const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Configuration
const BASE_URL = 'http://localhost:3000';
const USERNAME = 'admin'; // email 'admin' for legacy login
const PASSWORD = '123';

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

async function checkRoute(method, url, description, expectedStatus = 200, expectedType = null) {
    process.stdout.write(`Testing [${method}] ${url} (${description})... `);
    try {
        const response = await client.request({
            method,
            url
        });

        if (response.status === expectedStatus) {
            if (expectedType && !response.headers['content-type'].includes(expectedType)) {
                console.log(`❌ FAIL - Incorrect Content-Type. Expected ${expectedType}, got ${response.headers['content-type']}`);
                return false;
            }
            console.log('✅ PASS');
            return true;
        } else {
            console.log(`❌ FAIL - Status ${response.status} (Expected ${expectedStatus})`);
            return false;
        }
    } catch (error) {
        console.log(`❌ FAIL - Error: ${error.message}`);
        return false;
    }
}

async function runTests() {
    console.log('=== Checking All Web App Routes ===');

    if (!await login()) return;

    console.log('\n--- UI Pages (HTML) ---');
    await checkRoute('GET', '/admin/dashboard.html', 'Dashboard Page', 200, 'text/html');
    await checkRoute('GET', '/admin/campaigns.html', 'Campaigns Page', 200, 'text/html');
    await checkRoute('GET', '/admin/users.html', 'Users Page', 200, 'text/html');
    await checkRoute('GET', '/admin/activities.html', 'Activities Page', 200, 'text/html');

    // Check Redirects (e.g. root)
    // Assuming root redirects to login or dashboard? not specified, skipping.

    console.log('\n--- API Endpoints (Data) ---');
    await checkRoute('GET', '/admin/me', 'Current User Info', 200, 'application/json');
    await checkRoute('GET', '/api/v1/sessions', 'API: List Sessions', 200, 'application/json');
    await checkRoute('GET', '/api/v1/campaigns', 'API: List Campaigns', 200, 'application/json');
    await checkRoute('GET', '/api/v1/users', 'API: List Users', 200, 'application/json');
    await checkRoute('GET', '/api/v1/activities?limit=10', 'API: List Activities', 200, 'application/json');
    await checkRoute('GET', '/api/v1/activities/summary?days=7', 'API: Activities Summary', 200, 'application/json');

    console.log('\n=== Route Check Complete ===');
}

runTests();
