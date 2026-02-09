#!/usr/bin/env node
/**
 * Fix script for better-sqlite3 binding issues
 * Run: node fix-sqlite3.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔧 better-sqlite3 Fix Script\n');

// Helper to run commands
function run(command, description) {
    console.log(`\n📌 ${description}...`);
    try {
        execSync(command, { stdio: 'inherit' });
        console.log('✅ Success');
        return true;
    } catch (error) {
        console.log('❌ Failed');
        return false;
    }
}

// Check Node.js version
console.log(`Node.js version: ${process.version}`);

// Check if better-sqlite3 exists
const sqlitePath = path.join(__dirname, 'node_modules', 'better-sqlite3');
if (!fs.existsSync(sqlitePath)) {
    console.log('\n⚠️  better-sqlite3 not found. Running npm install...');
    if (!run('npm install', 'Installing dependencies')) {
        console.error('\n❌ Failed to install dependencies');
        process.exit(1);
    }
}

// Check for prebuilt binaries
console.log('\n📦 Checking for prebuilt binaries...');
try {
    const sqlite3 = require('better-sqlite3');
    const db = new sqlite3(':memory:');
    db.exec('SELECT 1');
    db.close();
    console.log('✅ better-sqlite3 is working correctly!');
    process.exit(0);
} catch (error) {
    console.log('❌ better-sqlite3 bindings not found or broken');
    console.log(`   Error: ${error.message}\n`);
}

// Try to rebuild
console.log('\n🔨 Attempting to rebuild better-sqlite3...');

// Method 1: npm rebuild
if (run('npm rebuild better-sqlite3 --build-from-source', 'Rebuilding better-sqlite3')) {
    // Test again
    try {
        delete require.cache[require.resolve('better-sqlite3')];
        const sqlite3 = require('better-sqlite3');
        const db = new sqlite3(':memory:');
        db.close();
        console.log('\n✅ better-sqlite3 rebuilt successfully!');
        process.exit(0);
    } catch (e) {
        console.log('\n⚠️  Rebuild completed but module still not working');
    }
}

// Method 2: Clean reinstall
console.log('\n🧹 Attempting clean reinstall...');
const nodeModulesPath = path.join(__dirname, 'node_modules');
const packageLockPath = path.join(__dirname, 'package-lock.json');

try {
    if (fs.existsSync(nodeModulesPath)) {
        console.log('Removing node_modules...');
        fs.rmSync(nodeModulesPath, { recursive: true, force: true });
    }
    if (fs.existsSync(packageLockPath)) {
        console.log('Removing package-lock.json...');
        fs.rmSync(packageLockPath);
    }
    
    if (!run('npm install', 'Reinstalling dependencies')) {
        throw new Error('npm install failed');
    }
    
    // Test again
    delete require.cache[require.resolve('better-sqlite3')];
    const sqlite3 = require('better-sqlite3');
    const db = new sqlite3(':memory:');
    db.close();
    console.log('\n✅ better-sqlite3 fixed successfully!');
    process.exit(0);
} catch (error) {
    console.log(`\n❌ Clean reinstall failed: ${error.message}`);
}

// Platform-specific instructions
console.log('\n' + '='.repeat(60));
console.log('MANUAL FIX REQUIRED');
console.log('='.repeat(60));

const platform = process.platform;

if (platform === 'linux') {
    console.log(`
Your system appears to be missing build tools.

Try running these commands:

  # Install build tools
  sudo apt-get update
  sudo apt-get install -y build-essential python3

  # Or for CentOS/RHEL/Fedora:
  sudo yum groupinstall "Development Tools"
  sudo yum install python3

  # Then rebuild
  npm rebuild better-sqlite3
`);
} else if (platform === 'win32') {
    console.log(`
Your system appears to be missing build tools.

Try one of these options:

  Option 1 - Install windows-build-tools:
    npm install --global windows-build-tools
    npm rebuild better-sqlite3

  Option 2 - Install Visual Studio Build Tools:
    Download from: https://visualstudio.microsoft.com/downloads/
    Install "Desktop development with C++" workload

  Option 3 - Use prebuilt binaries (no compiler needed):
    npm install better-sqlite3@latest --build-from-source=false
`);
} else if (platform === 'darwin') {
    console.log(`
Your system appears to be missing build tools.

Try running these commands:

  # Install Xcode Command Line Tools
  xcode-select --install

  # Then rebuild
  npm rebuild better-sqlite3
`);
}

console.log(`
For more help, see:
  https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md
`);

process.exit(1);
