# Bcrypt Compatibility System

## Overview

This application includes a smart bcrypt compatibility layer that automatically selects the best bcrypt implementation for your environment:

- **bcrypt** (native C++ binding) - Used on Windows, Mac, and Linux with build tools
- **bcryptjs** (pure JavaScript) - Used on cPanel and environments without Python/build tools

## How It Works

The `bcrypt-compat.js` module automatically detects which implementation is available:

1. First tries to load `bcrypt` (faster, native implementation)
2. If that fails, falls back to `bcryptjs` (pure JavaScript, works everywhere)
3. Both provide identical functionality and API

## Performance

- **bcrypt (native)**: ~2-3x faster for hashing operations
- **bcryptjs**: Slightly slower but 100% compatible everywhere

For typical authentication use cases, the performance difference is negligible (a few milliseconds).

## Installation

### Option 1: Standard Install
```bash
npm install
```
This installs all dependencies. On cPanel, bcrypt installation will fail silently and bcryptjs will be used.

### Option 2: Smart Install (Recommended)
```bash
npm run install:smart
```
This runs an intelligent installer that handles both environments gracefully.

### Option 3: Manual cPanel Install
```bash
# Install core dependencies first
npm install bcryptjs
npm install --production
```

## Troubleshooting

### "Cannot find module 'bcrypt'" or "Cannot find module 'bcryptjs'"

Run:
```bash
npm install bcryptjs
npm install
```

### Want to force a specific implementation?

Edit `bcrypt-compat.js` and change the require statement:
```javascript
// Force bcryptjs only
module.exports = require('bcryptjs');

// Force bcrypt only (will fail on cPanel)
module.exports = require('bcrypt');
```

## Environment Detection

The compatibility layer logs which implementation it's using:
```
[bcrypt-compat] Using native bcrypt (better performance)
// or
[bcrypt-compat] Using bcryptjs (pure JavaScript implementation)
```

This message appears when the server starts. 