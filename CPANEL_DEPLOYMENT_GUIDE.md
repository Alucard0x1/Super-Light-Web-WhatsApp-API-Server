# 📱 WhatsApp API Server - Complete cPanel Deployment Guide for Beginners

This guide will walk you through deploying the Super Light Web WhatsApp API Server on cPanel hosting, step by step. No prior experience required!

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Preparing Your Files](#preparing-your-files)
3. [Uploading to cPanel](#uploading-to-cpanel)
4. [Setting Up Node.js Application](#setting-up-nodejs-application)
5. [Configuring Environment Variables](#configuring-environment-variables)
6. [Installing Dependencies](#installing-dependencies)
7. [Starting Your Application](#starting-your-application)
8. [Setting Up Domain/Subdomain](#setting-up-domain-subdomain)
9. [Testing Your Installation](#testing-your-installation)
10. [Troubleshooting Common Issues](#troubleshooting-common-issues)

---

## 1. Prerequisites

Before starting, make sure you have:

✅ **cPanel hosting account** with:
- Node.js support (version 14 or higher)
- At least 1GB RAM allocated
- Terminal/SSH access (optional but helpful)

✅ **The following information from your hosting provider:**
- cPanel login URL (usually `https://yourdomain.com:2083`)
- cPanel username and password

✅ **Downloaded the application files** from:
- https://github.com/Alucard0x1/Super-Light-Web-WhatsApp-API-Server

---

## 2. Preparing Your Files

### Step 1: Download the Application

1. Go to https://github.com/Alucard0x1/Super-Light-Web-WhatsApp-API-Server
2. Click the green **"Code"** button
3. Select **"Download ZIP"**
4. Extract the ZIP file on your computer

### Step 2: Create Production Configuration

1. In the extracted folder, find the file `.env.example`
2. Create a copy and rename it to `.env`
3. Open `.env` in a text editor (like Notepad)
4. Update these important settings:

```env
# REQUIRED: Set a strong password for admin dashboard
ADMIN_DASHBOARD_PASSWORD=your_strong_password_here

# REQUIRED: Generate a random key (use a password generator)
TOKEN_ENCRYPTION_KEY=generate_64_character_random_string_here

# REQUIRED: Generate another random string
SESSION_SECRET=generate_32_character_random_string_here

# Set your domain (replace with your actual domain)
BASE_URL=https://yourdomain.com

# Limit sessions for cPanel (recommended: 5)
MAX_SESSIONS=5

# Optional: API Master Key (for external API access)
MASTER_API_KEY=another_random_string_if_needed
```

💡 **Tips for generating random strings:**
- Use an online password generator
- Or use this site: https://passwordsgenerator.net/
- Make them long and complex

### Step 3: Remove Unnecessary Files

Delete these files to reduce upload size:
- `node_modules` folder (if it exists)
- `.git` folder
- Any `.log` files
- `package-lock.json` (we'll regenerate it)

---

## 3. Uploading to cPanel

### Step 1: Login to cPanel

1. Open your web browser
2. Go to your cPanel login URL
3. Enter your username and password
4. Click "Log in"

### Step 2: Open File Manager

1. In cPanel, find the **"Files"** section
2. Click on **"File Manager"**
3. Navigate to your home directory (usually shows your username)

### Step 3: Create Application Directory

1. Click **"+ Folder"** button
2. Name it: `whatsapp-api`
3. Click **"Create New Folder"**

### Step 4: Upload Files

1. Double-click to enter the `whatsapp-api` folder
2. Click **"Upload"** button
3. Drag and drop all your application files
4. Wait for upload to complete (progress bar will show)

---

## 4. Setting Up Node.js Application

### Step 1: Find Node.js Application Manager

1. Go back to cPanel home
2. In the **"Software"** section, click **"Setup Node.js App"**
3. Click **"Create Application"**

### Step 2: Configure Application

Fill in these settings:

- **Node.js version**: Select the highest available (14.x or higher)
- **Application mode**: Production
- **Application root**: `whatsapp-api`
- **Application URL**: Choose your domain or subdomain
- **Application startup file**: `index.js`

### Step 3: Create Application

1. Click **"Create"** button
2. Wait for the application to be created
3. You'll see your application listed

---

## 5. Configuring Environment Variables

### Step 1: Access Environment Variables

1. In the Node.js application list, find your app
2. Click **"Edit"** (pencil icon)
3. Scroll down to **"Environment variables"**

### Step 2: Add Variables

Click **"Add Variable"** and add each of these:

| Name | Value |
|------|-------|
| `NODE_ENV` | `production` |
| `PORT` | (leave as assigned by cPanel) |
| `ADMIN_DASHBOARD_PASSWORD` | Your chosen password |
| `TOKEN_ENCRYPTION_KEY` | Your 64-character key |
| `SESSION_SECRET` | Your 32-character secret |
| `MAX_SESSIONS` | `5` |
| `SESSION_TIMEOUT_HOURS` | `24` |

### Step 3: Save Configuration

Click **"Save"** at the bottom of the page

---

## 6. Installing Dependencies

### Method A: Using cPanel Terminal (Recommended)

1. In cPanel, find **"Advanced"** section
2. Click **"Terminal"**
3. Run these commands:

```bash
cd ~/whatsapp-api
npm install --production
```

### Method B: Using Run NPM Install Button

1. In Node.js application manager
2. Find your application
3. Click **"Run NPM Install"** button
4. Wait for completion

---

## 7. Starting Your Application

### Step 1: Initial Start

1. In Node.js application manager
2. Find your application
3. Click **"Start"** button
4. Check the status - should show "Running"

### Step 2: Verify Logs

1. Click **"View Logs"** button
2. Look for: `Server is running on port XXXXX`
3. Check for any error messages

---

## 8. Setting Up Domain/Subdomain

### Option A: Using Subdomain (Recommended)

1. In cPanel, find **"Domains"** section
2. Click **"Subdomains"**
3. Create subdomain:
   - Subdomain: `whatsapp` (or your choice)
   - Domain: Select your main domain
   - Document Root: `/home/username/whatsapp-api`
4. Click **"Create"**

### Option B: Using Existing Domain

Your Node.js app URL is already configured in step 4

---

## 9. Testing Your Installation

### Step 1: Access Admin Dashboard

1. Open your browser
2. Go to: `https://yourdomain.com/admin/dashboard.html`
   - Or: `https://whatsapp.yourdomain.com/admin/dashboard.html` (if using subdomain)
3. You should see the login page

### Step 2: Login

1. For first login, use password only:
   - Password: The one you set in `.env`
2. Click **"Login"**

### Step 3: Create First Admin User

1. Once logged in, go to **"Users"** menu
2. Create a proper admin user with email/password
3. Logout and login with the new admin account

### Step 4: Test WhatsApp Connection

1. In dashboard, create a new session
2. Scan the QR code with WhatsApp
3. Check if status shows "Connected"

---

## 10. Troubleshooting Common Issues

### Issue: "Python not found" or "bcrypt installation failed"

**This is a common issue on cPanel because bcrypt requires Python to compile.**

**Solution:**
The application now includes a dual-compatibility system that works on both cPanel and local development:

1. **Automatic Compatibility**: The app will automatically use:
   - `bcrypt` (native, faster) on Windows/Mac/Linux where it can be compiled
   - `bcryptjs` (pure JavaScript) on cPanel where compilation isn't available

2. **Installation Options**:
   - **Option A**: Run `npm install --production` (will skip bcrypt on cPanel automatically)
   - **Option B**: Run `npm run install:smart` (intelligent installer that handles both environments)

3. **If you still have issues**:
   - Delete `node_modules` folder
   - Run `npm install bcryptjs` first
   - Then run `npm install --production`

### Issue: "csurf deprecated" warning

**This is just a warning, not an error. The application will still work.**

The `csurf` package is deprecated but still functional. This warning can be safely ignored. In future versions, we'll replace it with a newer CSRF protection method.

### Issue: "Out of Memory" Error

**Solution:**
1. Create file `~/whatsapp-api/.htaccess`:
```apache
<IfModule mod_lsapi.c>
    lsapi_terminate_backends_on_exit Off
</IfModule>
```

2. Reduce `MAX_SESSIONS` in environment variables to `3`

### Issue: Application Won't Start

**Check these:**
1. Node.js version is 14 or higher
2. All environment variables are set correctly
3. No syntax errors in `.env` file
4. Port is not already in use

### Issue: Can't Access Dashboard

**Try:**
1. Check if application is running in Node.js manager
2. Verify the URL is correct
3. Check browser console for errors (F12)
4. Clear browser cache

### Issue: QR Code Not Showing

**Solutions:**
1. Refresh the page (the fix is already in v3.0)
2. Check WebSocket connection in browser console
3. Ensure no firewall blocking WebSocket

### Issue: "Permission Denied" Errors

**Fix permissions:**
1. In cPanel File Manager
2. Select all files in `whatsapp-api`
3. Click **"Permissions"**
4. Set to `755` for folders, `644` for files

### Issue: "npm install" takes too long or times out

**Solutions:**
1. Use the terminal method instead of the button
2. Try installing in smaller batches:
```bash
cd ~/whatsapp-api
npm install express
npm install @whiskeysockets/baileys
npm install --production
```

---

## 🎉 Congratulations!

Your WhatsApp API Server is now running on cPanel! 

### Next Steps:

1. **Secure Your Installation:**
   - Change default admin password
   - Create individual user accounts
   - Enable SSL (usually automatic with cPanel)

2. **Configure Webhooks (Optional):**
   - Set webhook URLs for receiving messages
   - Configure in the dashboard

3. **Monitor Performance:**
   - Check cPanel resource usage
   - Monitor error logs regularly
   - Set up email alerts for downtime

### Getting Help:

- 📖 Check the [API Documentation](api_documentation.md)
- 🐛 Report issues on [GitHub](https://github.com/Alucard0x1/Super-Light-Web-WhatsApp-API-Server/issues)
- 💬 Join our community discussions

---

## 📌 Quick Reference

### Important URLs:
- Admin Dashboard: `https://yourdomain.com/admin/dashboard.html`
- API Endpoint: `https://yourdomain.com/api/v1/`

### Default Credentials:
- First login: Use only password (from `.env`)
- Then create admin user with email

### Resource Limits:
- Max file upload: 25MB
- Recommended sessions: 5 for cPanel
- Session timeout: 24 hours

---

**Last Updated:** v3.0 - December 2024 