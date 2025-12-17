# cPanel Deployment Guide

Complete guide for deploying the WhatsApp API Server to cPanel.

## Quick Start Checklist

### Pre-Deployment
- [ ] Download code from GitHub
- [ ] Create `.env` file from `.env.example`
- [ ] Set these required values:
  ```
  NODE_ENV=production
  ADMIN_DASHBOARD_PASSWORD=your_secure_password
  TOKEN_ENCRYPTION_KEY=<64 hex characters>
  SESSION_SECRET=<32+ characters>
  MAX_SESSIONS=3
  ```
- [ ] Delete `node_modules/` and `.git/` folders

### Generate Keys
```bash
# TOKEN_ENCRYPTION_KEY (64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# SESSION_SECRET (32 chars)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

---

## Step-by-Step Deployment

### 1. Upload Files
1. ZIP your project folder (without `node_modules`)
2. Go to cPanel → File Manager
3. Create folder: `whatsapp-api`
4. Upload and extract the ZIP

### 2. Create Node.js App
1. Go to cPanel → **Setup Node.js App**
2. Click **Create Application**
3. Configure:
   | Setting | Value |
   |---------|-------|
   | Node.js version | 18+ (or 16 minimum) |
   | Application root | `whatsapp-api` |
   | Startup file | `index.js` |

4. Add Environment Variables:
   ```
   NODE_ENV=production
   NODE_OPTIONS=--max-old-space-size=1024
   ADMIN_DASHBOARD_PASSWORD=your_password
   TOKEN_ENCRYPTION_KEY=your_64_char_key
   SESSION_SECRET=your_32_char_key
   MAX_SESSIONS=3
   COOKIE_SECURE=true  # Set to true only if using HTTPS
   ```

### 3. Install Dependencies
```bash
# Via Terminal:
cd ~/whatsapp-api
npm install --production

# Or click "Run NPM Install" in Node.js manager
```

### 4. Create Required Directories
```bash
mkdir -p logs sessions media auth_info_baileys data
chmod 755 logs sessions media auth_info_baileys data
```

### 5. Start Application
**Option A: Using the Automated Script (Recommended)**
```bash
# This script handles directories, checks PM2, and starts the app safely
chmod +x start-production.sh
./start-production.sh
```

**Option B: Manual Start**
- Click **Start** in cPanel Node.js manager
- Or use PM2 manually: `pm2 start ecosystem.config.js`

### 6. Access Dashboard
```
https://yourdomain.com/admin/dashboard.html
```

---

## Troubleshooting

### Memory Issues

| Problem | Solution |
|---------|----------|
| Out of memory | Set `MAX_SESSIONS=2` in `.env` |
| App crashes | Add `NODE_OPTIONS=--max-old-space-size=768` |
| Slow performance | Reduce concurrent sessions |

### Common Issues

| Problem | Solution |
|---------|----------|
| App won't start | Check Node.js version ≥ 16 |
| Can't login | Verify `ADMIN_DASHBOARD_PASSWORD` |
| No QR code | Refresh page, check session status |
| 502 Bad Gateway | Restart app in cPanel |

### Emergency Commands
```bash
# Stop application
pm2 stop whatsapp-api

# View logs
pm2 logs whatsapp-api --lines 100

# Restart with lower memory
pm2 restart whatsapp-api --max-memory-restart 512M
```

---

## Post-Deployment Checklist

- [ ] Test login at `/admin/login.html`
- [ ] Create a test WhatsApp session
- [ ] Scan QR code with phone
- [ ] Send a test message
- [ ] Check logs for errors
- [ ] Set up monitoring (UptimeRobot, etc.)

---

## First Login

1. Use **password only** (no email) with `ADMIN_DASHBOARD_PASSWORD`
2. Create an admin user after login
3. Use email/password for future logins

---

## Support

If issues persist:
1. Check hosting provider memory limits
2. Consider VPS instead of shared hosting
3. Reduce `MAX_SESSIONS` further
