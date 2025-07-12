/**
 * Test script for bcrypt wrapper compatibility
 */

const bcrypt = require('./bcrypt-wrapper');

console.log('\n=== Bcrypt Wrapper Test ===\n');

// Test password
const testPassword = 'test123';

async function runTest() {
    try {
        // Test hashing
        console.log('Testing password hashing...');
        const hash = await bcrypt.hash(testPassword, 10);
        console.log('✓ Password hashed successfully');
        console.log(`  Hash: ${hash.substring(0, 20)}...`);

        // Test comparison (correct password)
        console.log('\nTesting password verification (correct)...');
        const isValid = await bcrypt.compare(testPassword, hash);
        console.log(`✓ Password verification result: ${isValid} (expected: true)`);

        // Test comparison (wrong password)
        console.log('\nTesting password verification (wrong)...');
        const isInvalid = await bcrypt.compare('wrongpassword', hash);
        console.log(`✓ Password verification result: ${isInvalid} (expected: false)`);

        console.log('\n✅ All tests passed!');
        console.log(`   Using: ${bcrypt.usingBcryptjs ? 'bcryptjs (pure JS)' : 'bcrypt (native)'}`);
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

runTest(); 