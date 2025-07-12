const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ActivityLogger {
    constructor(encryptionKey) {
        this.logsDir = path.join(__dirname, 'activity_logs');
        this.encryptionKey = encryptionKey;
        this.maxLogsPerFile = 1000;
        this.ensureLogsDir();
    }

    async ensureLogsDir() {
        try {
            await fs.mkdir(this.logsDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create logs directory:', error);
        }
    }

    encrypt(text) {
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    }

    decrypt(text) {
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        
        const parts = text.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = parts[1];
        
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    async logActivity({
        userEmail,
        action,
        resource,
        resourceId,
        details,
        ip,
        userAgent,
        success = true
    }) {
        const activity = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            userEmail,
            action,
            resource,
            resourceId,
            details,
            ip,
            userAgent,
            success
        };

        // Get today's log file
        const today = new Date().toISOString().split('T')[0];
        const logFile = path.join(this.logsDir, `activities_${today}.enc`);

        try {
            // Read existing logs
            let logs = [];
            try {
                const encryptedData = await fs.readFile(logFile, 'utf8');
                const decryptedData = this.decrypt(encryptedData);
                logs = JSON.parse(decryptedData);
            } catch (error) {
                // File doesn't exist yet, start fresh
                logs = [];
            }

            // Add new activity
            logs.push(activity);

            // Save back
            const jsonData = JSON.stringify(logs);
            const encryptedData = this.encrypt(jsonData);
            await fs.writeFile(logFile, encryptedData);

        } catch (error) {
            console.error('Failed to log activity:', error);
        }

        return activity;
    }

    async getActivities({
        userEmail = null,
        startDate = null,
        endDate = null,
        action = null,
        resource = null,
        limit = 100
    } = {}) {
        const activities = [];

        try {
            // Get list of log files
            const files = await fs.readdir(this.logsDir);
            const logFiles = files
                .filter(f => f.startsWith('activities_') && f.endsWith('.enc'))
                .sort()
                .reverse(); // Most recent first

            for (const file of logFiles) {
                try {
                    const filePath = path.join(this.logsDir, file);
                    const encryptedData = await fs.readFile(filePath, 'utf8');
                    const decryptedData = this.decrypt(encryptedData);
                    const logs = JSON.parse(decryptedData);

                    for (const log of logs.reverse()) {
                        // Apply filters
                        if (userEmail && log.userEmail !== userEmail) continue;
                        if (action && log.action !== action) continue;
                        if (resource && log.resource !== resource) continue;
                        
                        if (startDate && new Date(log.timestamp) < new Date(startDate)) continue;
                        if (endDate && new Date(log.timestamp) > new Date(endDate)) continue;

                        activities.push(log);
                        
                        if (activities.length >= limit) {
                            return activities;
                        }
                    }
                } catch (error) {
                    console.error(`Failed to read log file ${file}:`, error);
                }
            }
        } catch (error) {
            console.error('Failed to get activities:', error);
        }

        return activities;
    }

    async getUserActivities(userEmail, limit = 50) {
        return this.getActivities({ userEmail, limit });
    }

    async getSessionActivities(sessionId, limit = 50) {
        return this.getActivities({ 
            resource: 'session',
            resourceId: sessionId,
            limit 
        });
    }

    // Activity helper methods
    async logLogin(userEmail, ip, userAgent, success = true) {
        return this.logActivity({
            userEmail,
            action: 'login',
            resource: 'auth',
            resourceId: null,
            details: { success },
            ip,
            userAgent,
            success
        });
    }

    async logSessionCreate(userEmail, sessionId, ip, userAgent) {
        return this.logActivity({
            userEmail,
            action: 'create',
            resource: 'session',
            resourceId: sessionId,
            details: { sessionId },
            ip,
            userAgent
        });
    }

    async logSessionDelete(userEmail, sessionId, ip, userAgent) {
        return this.logActivity({
            userEmail,
            action: 'delete',
            resource: 'session',
            resourceId: sessionId,
            details: { sessionId },
            ip,
            userAgent
        });
    }

    async logMessageSend(userEmail, sessionId, recipient, messageType, ip, userAgent) {
        return this.logActivity({
            userEmail,
            action: 'send_message',
            resource: 'message',
            resourceId: sessionId,
            details: { recipient, messageType },
            ip,
            userAgent
        });
    }

    async logUserCreate(adminEmail, newUserEmail, role, ip, userAgent) {
        return this.logActivity({
            userEmail: adminEmail,
            action: 'create_user',
            resource: 'user',
            resourceId: newUserEmail,
            details: { newUserEmail, role },
            ip,
            userAgent
        });
    }

    async logUserUpdate(adminEmail, targetUserEmail, changes, ip, userAgent) {
        return this.logActivity({
            userEmail: adminEmail,
            action: 'update_user',
            resource: 'user',
            resourceId: targetUserEmail,
            details: { changes },
            ip,
            userAgent
        });
    }

    async logUserDelete(adminEmail, targetUserEmail, ip, userAgent) {
        return this.logActivity({
            userEmail: adminEmail,
            action: 'delete_user',
            resource: 'user',
            resourceId: targetUserEmail,
            details: { deletedUser: targetUserEmail },
            ip,
            userAgent
        });
    }

    // Get activity summary for dashboard
    async getActivitySummary(userEmail = null, days = 7) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const activities = await this.getActivities({
            userEmail,
            startDate: startDate.toISOString(),
            limit: 10000
        });

        const summary = {
            totalActivities: activities.length,
            byAction: {},
            byResource: {},
            byUser: {},
            recentActivities: activities.slice(0, 10)
        };

        activities.forEach(activity => {
            // Count by action
            summary.byAction[activity.action] = (summary.byAction[activity.action] || 0) + 1;
            
            // Count by resource
            summary.byResource[activity.resource] = (summary.byResource[activity.resource] || 0) + 1;
            
            // Count by user
            summary.byUser[activity.userEmail] = (summary.byUser[activity.userEmail] || 0) + 1;
        });

        return summary;
    }

    // Campaign logging methods
    async logCampaignCreate(userEmail, campaignId, campaignName, recipientCount) {
        return this.logActivity({
            userEmail,
            action: 'create_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName, recipientCount }
        });
    }
    
    async logCampaignStart(userEmail, campaignId, campaignName, recipientCount) {
        return this.logActivity({
            userEmail,
            action: 'start_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName, recipientCount }
        });
    }
    
    async logCampaignMessage(userEmail, campaignId, recipient, status, error = null) {
        return this.logActivity({
            userEmail,
            action: 'campaign_message',
            resource: 'campaign',
            resourceId: campaignId,
            details: { recipient, status, error }
        });
    }
    
    async logCampaignPause(userEmail, campaignId, campaignName) {
        return this.logActivity({
            userEmail,
            action: 'pause_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName }
        });
    }
    
    async logCampaignResume(userEmail, campaignId, campaignName) {
        return this.logActivity({
            userEmail,
            action: 'resume_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName }
        });
    }
    
    async logCampaignComplete(userEmail, campaignId, campaignName, statistics) {
        return this.logActivity({
            userEmail,
            action: 'complete_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName, statistics }
        });
    }
    
    async logCampaignDelete(userEmail, campaignId, campaignName) {
        return this.logActivity({
            userEmail,
            action: 'delete_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName }
        });
    }
    
    async logCampaignRetry(userEmail, campaignId, campaignName, retryCount) {
        return this.logActivity({
            userEmail,
            action: 'retry_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName, retryCount }
        });
    }
}

module.exports = ActivityLogger; 