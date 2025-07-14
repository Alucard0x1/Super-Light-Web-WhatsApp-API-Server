# Production Deployment Guide for cPanel

## Current Production Readiness Status: **90%**

The project is mostly production-ready but needs a few configurations and considerations for cPanel deployment.

## 🔧 Recent Fixes for cPanel Deployment

### Trust Proxy Configuration
The application now properly handles reverse proxy environments (like cPanel) with:
- Express trust proxy enabled
- Rate limiting configured to work behind proxies
- Proper IP detection for security features

### Timeout Overflow Fix
Fixed 32-bit integer overflow issue that prevented session creation on some hosting environments.

### Session Management
Enhanced session handling to prevent undefined errors during WhatsApp connection initialization.

## ✅ What's Already Production-Ready

1. **Security Features**
   - ✅ Token-based authentication
   - ✅ Master API key for session creation
   - ✅ Encrypted session token storage
   - ✅ Rate limiting (30 requests/minute)
   - ✅ Input validation with validator.js
   - ✅ Helmet.js for security headers
   - ✅ File upload restrictions (type & size)
   - ✅ Session limits and timeout

2. **Application Features**
   - ✅ Multi-session support
   - ✅ Persistent sessions
   - ✅ Webhook support
   - ✅ Comprehensive logging
   - ✅ Error handling
   - ✅ Media management

## ⚠️ Required for Production Deployment

### 1. Environment Configuration
Create a `.env` file with ALL required variables:

```env
# Required Security Keys
ADMIN_DASHBOARD_PASSWORD=your_secure_password_here
SESSION_SECRET=your_random_session_secret_here
TOKEN_ENCRYPTION_KEY=your_64_character_hex_key_here
MASTER_API_KEY=your_master_api_key_here

# Optional but Recommended
PORT=3000
MAX_SESSIONS=10
SESSION_TIMEOUT_HOURS=24
WEBHOOK_URL=https://your-default-webhook.com/events
```

### 2. Process Management (Critical for cPanel)
Add PM2 for process management:

```bash
npm install pm2 --save
```

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'whatsapp-api',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

### 3. cPanel-Specific Setup

#### Step 1: Upload Files
1. ZIP your project (excluding node_modules)
2. Upload via cPanel File Manager
3. Extract in your desired directory (e.g., `/home/yourusername/whatsapp-api`)

#### Step 2: Node.js Setup in cPanel
1. Go to "Setup Node.js App" in cPanel
2. Create new application:
   - Node.js version: 16 or higher
   - Application mode: Production
   - Application root: `/home/yourusername/whatsapp-api`
   - Application URL: Choose subdomain (e.g., `api.yourdomain.com`)
   - Application startup file: `index.js`

#### Step 3: Install Dependencies
1. Click "Run NPM Install" button in cPanel
2. Or via terminal: `cd /home/yourusername/whatsapp-api && npm install`

#### Step 4: Environment Variables
1. In cPanel Node.js app settings, add environment variables
2. Or create `.env` file in project root

#### Step 5: Start Application

**Important: Memory Optimization Required**

Due to cPanel memory limitations, use the optimized start scripts:

1. **Option 1: Using cPanel Interface**
   - Set Application startup file: `index.js`
   - Add to Environment Variables:
     ```
     NODE_ENV=production
     NODE_OPTIONS=--max-old-space-size=1024
     ```

2. **Option 2: Using PM2 (Recommended)**
   ```bash
   cd /home/yourusername/whatsapp-api
   npm run start:pm2
   ```

3. **Option 3: Direct Node.js with optimizations**
   ```bash
   cd /home/yourusername/whatsapp-api
   npm run start:production
   ```

**Memory Limit Issues?**
- Reduce `MAX_SESSIONS` to 3-5 in `.env`
- Disable features you don't need
- Consider upgrading hosting plan for more memory

### 4. Security Hardening

#### Update `.htaccess` for Apache:
```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
<IfModule mod_rewrite.c>
    RewriteEngine On

    # Exclude static files from being proxied
    RewriteCond %{REQUEST_URI} !^/media/
    RewriteCond %{REQUEST_URI} !^/admin/js/

    # Proxy all other requests to Node.js app
    RewriteRule ^(.*)$ http://localhost:3000/$1 [P,L]
</IfModule>
# Security Headers
<IfModule mod_headers.c>
    Header set X-Content-Type-Options "nosniff"
<FilesMatch "\.(env|enc|log|json)$">    Header set X-XSS-Protection "1; mode=block"
</IfModule>

# Protect sensitive files
<FilesMatch "\.(env|enc|log)$">
    Order allow,deny
    Deny from all
</FilesMatch>
```

### 5. Database Considerations
Currently using file-based storage. For production, consider:
- MySQL/PostgreSQL for session data
- Redis for token caching
- MongoDB for message history

### 6. Monitoring & Logging

Add production logging configuration:
```javascript
// Add to index.js
const winston = require('winston');
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});
```

### 7. SSL/HTTPS Configuration
1. Enable SSL in cPanel (Let's Encrypt)
2. Update webhook URLs to use HTTPS
3. Enforce HTTPS in application

### 8. Backup Strategy
1. Set up automated backups in cPanel
2. Include:
   - `auth_info_baileys/` directory
   - `session_tokens.enc`
   - `.env` file
   - `media/` directory

## Pre-Deployment Checklist

- [ ] Set strong passwords for all environment variables
- [ ] Generate secure encryption keys
- [ ] Test all API endpoints
- [ ] Configure domain/subdomain
- [ ] Enable SSL certificate
- [ ] Set up monitoring (UptimeRobot, etc.)
- [ ] Configure backup schedule
- [ ] Test webhook delivery
- [ ] Set appropriate file permissions:
  ```bash
  chmod 600 .env
  chmod 600 session_tokens.enc
  chmod 700 auth_info_baileys
  ```
- [ ] Remove or secure test files
- [ ] Update API documentation with production URLs
- [ ] Set up error alerting

## Performance Optimization

1. **Enable Node.js Clustering** (for multiple CPU cores):
   ```javascript
   const cluster = require('cluster');
   const numCPUs = require('os').cpus().length;
   ```

2. **Add Compression**:
   ```bash
   npm install compression
   ```

3. **Configure Nginx/Apache Caching** for static files

## Maintenance Mode

Add maintenance mode capability:
```javascript
app.use((req, res, next) => {
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({
            status: 'error',
            message: 'Service under maintenance'
        });
    }
    next();
});
```

## Post-Deployment

1. Monitor logs regularly
2. Set up alerts for errors
3. Review security logs
4. Update dependencies monthly
5. Test backup restoration

## 🚨 Troubleshooting Common cPanel Issues

### 1. Express Rate Limit - X-Forwarded-For Error
**Error**: `ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false`

**Solution**: Already fixed in the code. The app now has `app.set('trust proxy', true)` configured.

### 2. Timeout Overflow Warning
**Error**: `TimeoutOverflowWarning: 30240000000 does not fit into a 32-bit signed integer`

**Solution**: Already fixed. Session cleanup timeout is now capped at 24 hours maximum to prevent 32-bit overflow.

### 3. Cannot Set Properties of Undefined (sock)
**Error**: `TypeError: Cannot set properties of undefined (setting 'sock')`

**Solution**: Already fixed with proper session existence checks before setting socket properties.

### 4. Node.js Version Issues
Ensure your cPanel Node.js version is 18.x or higher:
```bash
node --version
```

### 5. Permission Issues
```bash
# Fix file permissions
chmod 755 index.js
chmod -R 755 admin/
chmod -R 777 auth_info_baileys/
chmod -R 777 logs/
chmod -R 777 media/
chmod -R 777 campaign_media/
```

### 6. Memory Issues
If you encounter memory errors, add to your `.env`:
```env
NODE_OPTIONS=--max-old-space-size=1024
```

### 7. Session Not Connecting
- Check firewall rules (ports 80, 443, and your app port)
- Verify WebSocket connections are allowed
- Check proxy_websockets is enabled in cPanel
- Ensure no ModSecurity rules are blocking WhatsApp connections

### 8. Error Logs Location
Check these logs for issues:
- Application logs: `logs/system.log`
- PM2 logs: `~/.pm2/logs/`
- cPanel error logs: `~/public_html/error_log`
- Node.js logs: Check cPanel's Node.js app error output

### 9. Environment Variables Not Loading
Ensure `.env` file:
- Is in the root directory
- Has correct permissions (644 or 600)
- Uses LF line endings (not CRLF)
- No spaces around `=` in variables

### 10. WebSocket Connection Issues
Add to your `.htaccess` if WebSockets fail:
```apache
RewriteEngine On
RewriteCond %{HTTP:Upgrade} websocket [NC]
RewriteCond %{HTTP:Connection} upgrade [NC]
RewriteRule ^/?(.*) "ws://localhost:3000/$1" [P,L]
```

### Additional Common Issues

1. **Port conflicts**: cPanel usually assigns ports automatically
2. **Memory limits**: Monitor and adjust in cPanel  
3. **File permissions**: May need to adjust after upload
4. **Node version**: Ensure cPanel supports Node.js 18.x or higher

## Support

For deployment issues:
- Check cPanel error logs
- Review Node.js app logs in cPanel
- Contact: [Telegram @Alucard0x1](https://t.me/Alucard0x1) 