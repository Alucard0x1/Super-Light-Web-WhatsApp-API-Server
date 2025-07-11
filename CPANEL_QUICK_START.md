# 🚀 cPanel Quick Start Guide - WhatsApp API Server

## 📝 Pre-Deployment Checklist

- [ ] Download code from GitHub
- [ ] Create `.env` file from `.env.example`
- [ ] Set `ADMIN_DASHBOARD_PASSWORD` in `.env`
- [ ] Generate 64-char `TOKEN_ENCRYPTION_KEY`
- [ ] Generate 32-char `SESSION_SECRET`
- [ ] Delete `node_modules` folder
- [ ] Delete `.git` folder

## 🔧 cPanel Setup Steps

### 1️⃣ Upload Files
```
cPanel → File Manager → Create folder "whatsapp-api" → Upload all files
```

### 2️⃣ Create Node.js App
```
cPanel → Setup Node.js App → Create Application
- Node.js version: 14+
- Application root: whatsapp-api
- Startup file: index.js
- Click "Create"
```

### 3️⃣ Set Environment Variables
Add these in Node.js app settings:
```
NODE_ENV=production
ADMIN_DASHBOARD_PASSWORD=your_password
TOKEN_ENCRYPTION_KEY=your_64_char_key
SESSION_SECRET=your_32_char_key
MAX_SESSIONS=5
```

### 4️⃣ Install & Start
```bash
# In cPanel Terminal:
cd ~/whatsapp-api
npm install --production

# Or click "Run NPM Install" in Node.js manager
# Then click "Start"
```

### 5️⃣ Access Dashboard
```
https://yourdomain.com/admin/dashboard.html
```

## 🆘 Quick Fixes

| Problem | Solution |
|---------|----------|
| Out of memory | Set `MAX_SESSIONS=3` |
| App won't start | Check Node.js version ≥ 14 |
| Can't login | Check `ADMIN_DASHBOARD_PASSWORD` |
| No QR code | Refresh page (F5) |

## 📞 First Login
1. Use password only (no email)
2. Create admin user after login
3. Use email/password for future logins

---
*Full guide: [CPANEL_DEPLOYMENT_GUIDE.md](CPANEL_DEPLOYMENT_GUIDE.md)* 