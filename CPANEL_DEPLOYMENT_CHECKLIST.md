# cPanel Deployment Checklist - Memory Optimized

## Pre-Deployment

- [ ] Copy `.env.production` to `.env` and update all values
- [ ] Set `MAX_SESSIONS=3` (or lower) for limited memory
- [ ] Ensure `NODE_ENV=production` in `.env`

## Deployment Steps

1. **Upload Files**
   - [ ] ZIP project (exclude node_modules)
   - [ ] Upload via cPanel File Manager
   - [ ] Extract in target directory

2. **Node.js App Setup in cPanel**
   - [ ] Create Node.js Application
   - [ ] Node.js version: 16+ (prefer 18 or 20)
   - [ ] Application root: `/home/username/whatsapp-api`
   - [ ] Application startup file: `index.js`
   - [ ] **Important Environment Variables:**
     ```
     NODE_ENV=production
     NODE_OPTIONS=--max-old-space-size=1024
     ```

3. **Install Dependencies**
   - [ ] Click "Run NPM Install" in cPanel
   - [ ] Or via terminal: `npm install --production`

4. **Create Required Directories**
   ```bash
   mkdir -p logs sessions media auth_info_baileys activity_logs
   chmod 755 logs sessions media auth_info_baileys activity_logs
   ```

5. **Start Application**
   - [ ] Option 1: Click "Start" in cPanel
   - [ ] Option 2: Use PM2 (if available)
     ```bash
     npm install pm2 -g
     npm run start:pm2
     ```

## Troubleshooting Memory Issues

If you see "Out of memory" errors:

1. **Reduce Sessions**
   - Edit `.env`: `MAX_SESSIONS=2`

2. **Add to cPanel Node.js Environment**
   ```
   NODE_OPTIONS=--max-old-space-size=768 --optimize-for-size
   ```

3. **Use PM2 with Memory Limit**
   ```bash
   pm2 start ecosystem.config.js --max-memory-restart 768M
   ```

4. **Monitor Memory Usage**
   ```bash
   pm2 monit
   # or
   top -u yourusername
   ```

5. **Clear Unused Data**
   ```bash
   # Clear old logs
   find logs/ -name "*.log" -mtime +7 -delete
   
   # Clear old session files
   find sessions/ -name "*" -mtime +1 -delete
   ```

## Post-Deployment

- [ ] Test login at `/admin/login.html`
- [ ] Create a test session
- [ ] Send a test message
- [ ] Check logs for errors
- [ ] Set up monitoring (UptimeRobot, etc.)

## Emergency Commands

```bash
# Stop application
pm2 stop whatsapp-api

# View logs
pm2 logs whatsapp-api --lines 100

# Restart with lower memory
pm2 restart whatsapp-api --max-memory-restart 512M

# Clear all PM2 apps
pm2 delete all
```

## Support

If memory issues persist:
1. Contact hosting provider about memory limits
2. Consider VPS hosting instead of shared hosting
3. Reduce features or number of concurrent sessions 