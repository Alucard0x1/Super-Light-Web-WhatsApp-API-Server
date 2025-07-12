#!/usr/bin/env node

/**
 * Smart dependency installer for WhatsApp API Server
 * Handles both local development (with bcrypt) and cPanel deployment (bcryptjs only)
 */

const { execSync } = require('child_process');
const os = require('os');

console.log('🚀 WhatsApp API Server - Smart Dependency Installer');
console.log('===================================================');
console.log(`Platform: ${os.platform()}`);
console.log(`Node version: ${process.version}`);
console.log('');

// First, install all regular dependencies
console.log('📦 Installing core dependencies...');
try {
    execSync('npm install --production', { stdio: 'inherit' });
    console.log('✅ Core dependencies installed successfully');
} catch (error) {
    console.error('❌ Failed to install core dependencies');
    process.exit(1);
}

// Try to install optional bcrypt
console.log('\n🔧 Attempting to install native bcrypt for better performance...');
try {
    execSync('npm install bcrypt@5.1.1', { stdio: 'inherit' });
    console.log('✅ Native bcrypt installed successfully (better performance)');
} catch (error) {
    console.log('⚠️  Native bcrypt installation failed (this is normal on cPanel)');
    console.log('✅ Will use bcryptjs instead (pure JavaScript, slightly slower but works everywhere)');
}

console.log('\n✨ Installation complete!');
console.log('\nYour application will automatically use:');
console.log('- bcrypt (native) on systems where it\'s available');
console.log('- bcryptjs (pure JS) on systems like cPanel where bcrypt can\'t compile');
console.log('\nBoth provide the same functionality!'); 