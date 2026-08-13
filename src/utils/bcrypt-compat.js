// Bcrypt compatibility layer
// Tries to use bcrypt (faster, native) if available, falls back to bcryptjs (pure JS)

let bcrypt;

try {
    // Try to load native bcrypt first
    bcrypt = require('bcrypt');
    console.log('[bcrypt-compat] Using native bcrypt (better performance)');
} catch (error) {
    try {
        // Fall back to bcryptjs if bcrypt is not available
        bcrypt = require('bcryptjs');
        console.log('[bcrypt-compat] Using bcryptjs (pure JavaScript implementation)');
    } catch (error2) {
        console.error('[bcrypt-compat] ERROR: Neither bcrypt nor bcryptjs is installed!');
        console.error('[bcrypt-compat] Please run: npm install bcryptjs');
        process.exit(1);
    }
}

module.exports = bcrypt; 