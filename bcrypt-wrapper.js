/**
 * Bcrypt compatibility wrapper
 * Tries to use bcrypt (faster, but requires Python/build tools)
 * Falls back to bcryptjs (pure JS, works everywhere but slightly slower)
 */

let bcryptModule;
let usingBcryptjs = false;

try {
    // Try to load bcrypt first (better performance)
    bcryptModule = require('bcrypt');
    console.log('✓ Using bcrypt (native implementation)');
} catch (error) {
    // Fall back to bcryptjs if bcrypt is not available
    try {
        bcryptModule = require('bcryptjs');
        usingBcryptjs = true;
        console.log('✓ Using bcryptjs (pure JavaScript implementation)');
    } catch (error2) {
        console.error('❌ Neither bcrypt nor bcryptjs could be loaded!');
        console.error('Please install one of them:');
        console.error('  npm install bcrypt (requires Python)');
        console.error('  npm install bcryptjs (pure JavaScript)');
        process.exit(1);
    }
}

// Export the module with additional info
module.exports = bcryptModule;
module.exports.usingBcryptjs = usingBcryptjs; 