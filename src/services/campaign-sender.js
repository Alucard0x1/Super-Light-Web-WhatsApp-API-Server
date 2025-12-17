const EventEmitter = require('events');

class CampaignSender extends EventEmitter {
    constructor(campaignManager, sessions, activityLogger) {
        super();
        this.campaignManager = campaignManager;
        this.sessions = sessions;
        this.activityLogger = activityLogger;
        this.activeQueues = new Map(); // campaignId -> queue info
        this.sendingStats = new Map(); // campaignId -> stats
    }

    // Start sending a campaign
    async startCampaign(campaignId, userEmail) {
        const campaign = this.campaignManager.loadCampaign(campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        // Check if campaign is already running
        if (this.activeQueues.has(campaignId)) {
            throw new Error('Campaign is already running');
        }

        // Check if session exists and is connected
        const session = this.sessions.get(campaign.sessionId);
        console.log(`🔍 Session check for ${campaign.sessionId}:`, {
            sessionId: campaign.sessionId,
            sessionExists: !!session,
            sessionStatus: session?.status,
            hasSock: !!session?.sock,
            sockType: session?.sock ? typeof session.sock : 'undefined',
            availableSessions: Array.from(this.sessions.keys())
        });
        
        if (!session || session.status !== 'CONNECTED' || !session.sock) {
            console.error(`Session validation failed for ${campaign.sessionId}:`, {
                exists: !!session,
                status: session?.status,
                hasSock: !!session?.sock
            });
            throw new Error(`WhatsApp session '${campaign.sessionId}' is not connected or not available`);
        }

        console.log(`🚀 Starting campaign: ${campaign.name} (${campaign.recipients.length} recipients)`);

        // Initialize queue
        const queue = {
            campaignId,
            status: 'running',
            currentIndex: 0,
            interval: null,
            startTime: Date.now(),
            processedCount: 0
        };

        this.activeQueues.set(campaignId, queue);
        this.sendingStats.set(campaignId, {
            startTime: new Date().toISOString(),
            messagesPerMinute: 0,
            lastMessageTime: null
        });

        // Update campaign status
        this.campaignManager.updateCampaignStatus(campaignId, 'sending');

        // Log activity
        await this.activityLogger.logCampaignStart(userEmail, campaignId, campaign.name, campaign.recipients.length);

        // Start processing
        this.processQueue(campaignId);

        return {
            campaignId,
            status: 'started',
            recipientCount: campaign.recipients.length
        };
    }

    // Process campaign queue
    async processQueue(campaignId) {
        const queue = this.activeQueues.get(campaignId);
        if (!queue || queue.status !== 'running') return;

        const campaign = this.campaignManager.loadCampaign(campaignId);
        if (!campaign) {
            this.stopCampaign(campaignId);
            return;
        }

        const session = this.sessions.get(campaign.sessionId);
        console.log(`🔍 Session check in processQueue for ${campaign.sessionId}:`, {
            sessionExists: !!session,
            sessionStatus: session?.status,
            hasSock: !!session?.sock
        });
        
        if (!session || session.status !== 'CONNECTED' || !session.sock) {
            console.error(`Session ${campaign.sessionId} not available or not connected`);
            this.pauseCampaign(campaignId, 'Session disconnected or not available');
            return;
        }

        // Get next batch of recipients
        const pendingRecipients = this.campaignManager.getPendingRecipients(campaignId, 1);
        
        console.log(`📋 Pending recipients check:`, {
            campaignId: campaignId,
            pendingRecipientsCount: pendingRecipients.length,
            totalRecipients: campaign.recipients.length,
            recipientStatuses: campaign.recipients.map(r => ({ number: r.number, status: r.status }))
        });
        
        if (pendingRecipients.length === 0) {
            console.log(`⚠️ No pending recipients found, completing campaign`);
            // Campaign completed
            this.completeCampaign(campaignId);
            return;
        }

        const recipient = pendingRecipients[0];
        
        try {
            // Process template
            let messageContent = this.campaignManager.processTemplate(campaign.message.content, recipient);
            
            // Remove HTML tags for WhatsApp (keep line breaks)
            messageContent = messageContent
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<p>/gi, '')
                .replace(/<\/p>/gi, '\n\n')
                .replace(/<[^>]*>/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            // Prepare message based on type
            let messageData;
            const jid = recipient.number.includes('@') ? recipient.number : `${recipient.number}@s.whatsapp.net`;

            switch (campaign.message.type) {
                case 'text':
                    messageData = {
                        text: messageContent
                    };
                    break;
                    
                case 'image':
                    messageData = {
                        image: { url: campaign.message.mediaUrl },
                        caption: campaign.message.mediaCaption ? 
                            this.campaignManager.processTemplate(campaign.message.mediaCaption, recipient) : 
                            messageContent
                    };
                    break;
                    
                case 'document':
                    messageData = {
                        document: { url: campaign.message.mediaUrl },
                        fileName: campaign.message.fileName || 'document.pdf',
                        caption: campaign.message.mediaCaption ? 
                            this.campaignManager.processTemplate(campaign.message.mediaCaption, recipient) : 
                            messageContent
                    };
                    break;
                    
                default:
                    throw new Error(`Unsupported message type: ${campaign.message.type}`);
            }

            // Send message using the correct property name (sock instead of socket)
            console.log(`📤 Sending message to ${recipient.number} (${recipient.name || 'Unknown'}) at ${new Date().toISOString()}`);
            console.log(`Message details:`, {
                jid: jid,
                messageType: campaign.message.type,
                contentLength: messageContent.length
            });
            
            await session.sock.sendMessage(jid, messageData);
            
            // Update recipient status
            this.campaignManager.updateRecipientStatus(campaignId, recipient.number, 'sent');
            
            // Update stats
            queue.processedCount++;
            const stats = this.sendingStats.get(campaignId);
            if (stats) {
                stats.lastMessageTime = new Date().toISOString();
                const elapsedMinutes = (Date.now() - Date.parse(stats.startTime)) / 60000;
                stats.messagesPerMinute = elapsedMinutes > 0 ? queue.processedCount / elapsedMinutes : 0;
            }

            // Emit progress event
            this.emit('progress', {
                campaignId,
                processed: queue.processedCount,
                total: campaign.statistics.total,
                recipient: {
                    number: recipient.number,
                    name: recipient.name,
                    status: 'sent'
                }
            });

            // Log activity
            await this.activityLogger.logCampaignMessage(
                campaign.createdBy,
                campaignId,
                recipient.number,
                'sent'
            );

            console.log(`✅ Message sent successfully to ${recipient.number}`);

        } catch (error) {
            console.error(`❌ Error sending to ${recipient.number}:`, error.message);
            
            // Update recipient status with error
            this.campaignManager.updateRecipientStatus(
                campaignId, 
                recipient.number, 
                'failed', 
                error.message
            );

            // Emit progress event
            this.emit('progress', {
                campaignId,
                processed: queue.processedCount,
                total: campaign.statistics.total,
                recipient: {
                    number: recipient.number,
                    name: recipient.name,
                    status: 'failed',
                    error: error.message
                }
            });

            // Log activity
            await this.activityLogger.logCampaignMessage(
                campaign.createdBy,
                campaignId,
                recipient.number,
                'failed',
                error.message
            );
        }

        // Schedule next message
        if (queue.status === 'running') {
            const delay = campaign.settings.delayBetweenMessages || 3000;
            console.log(`⏳ Waiting ${delay}ms (${delay/1000} seconds) before next message at ${new Date().toISOString()}`);
            setTimeout(() => {
                console.log(`⏰ Delay complete, processing next message at ${new Date().toISOString()}`);
                this.processQueue(campaignId);
            }, delay);
        }
    }

    // Pause campaign
    pauseCampaign(campaignId, reason = null) {
        const queue = this.activeQueues.get(campaignId);
        if (!queue) return;

        queue.status = 'paused';
        if (queue.interval) {
            clearInterval(queue.interval);
            queue.interval = null;
        }

        this.campaignManager.updateCampaignStatus(campaignId, 'paused');

        this.emit('status', {
            campaignId,
            status: 'paused',
            reason
        });

        return true;
    }

    // Resume campaign
    async resumeCampaign(campaignId, userEmail) {
        const queue = this.activeQueues.get(campaignId);
        const campaign = this.campaignManager.loadCampaign(campaignId);
        
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        // Check if session exists and is connected
        const session = this.sessions.get(campaign.sessionId);
        if (!session || session.status !== 'CONNECTED' || !session.sock) {
            console.error(`Session validation failed for resuming ${campaign.sessionId}:`, {
                exists: !!session,
                status: session?.status,
                hasSock: !!session?.sock
            });
            throw new Error(`WhatsApp session '${campaign.sessionId}' is not connected or not available`);
        }

        console.log(`▶️ Resuming campaign: ${campaign.name}`);

        if (!queue) {
            // Re-create queue if it doesn't exist
            const newQueue = {
                campaignId,
                status: 'running',
                currentIndex: 0,
                interval: null,
                startTime: Date.now(),
                processedCount: campaign.statistics.sent
            };
            this.activeQueues.set(campaignId, newQueue);
        } else {
            queue.status = 'running';
        }

        this.campaignManager.updateCampaignStatus(campaignId, 'sending');

        // Log activity
        await this.activityLogger.logCampaignResume(userEmail, campaignId, campaign.name);

        // Start processing
        this.processQueue(campaignId);

        this.emit('status', {
            campaignId,
            status: 'resumed'
        });

        return true;
    }

    // Stop campaign
    stopCampaign(campaignId) {
        const queue = this.activeQueues.get(campaignId);
        if (!queue) return;

        if (queue.interval) {
            clearInterval(queue.interval);
        }

        this.activeQueues.delete(campaignId);
        this.sendingStats.delete(campaignId);

        this.emit('status', {
            campaignId,
            status: 'stopped'
        });
    }

    // Complete campaign
    async completeCampaign(campaignId) {
        const queue = this.activeQueues.get(campaignId);
        const campaign = this.campaignManager.loadCampaign(campaignId);
        
        if (queue) {
            this.stopCampaign(campaignId);
        }

        if (campaign) {
            this.campaignManager.updateCampaignStatus(campaignId, 'completed');
            
            // Log activity
            await this.activityLogger.logCampaignComplete(
                campaign.createdBy,
                campaignId,
                campaign.name,
                campaign.statistics
            );
        }

        this.emit('status', {
            campaignId,
            status: 'completed'
        });
    }

    // Retry failed messages
    async retryFailed(campaignId, userEmail) {
        const campaign = this.campaignManager.loadCampaign(campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        // Mark all failed recipients for retry
        let retryCount = 0;
        campaign.recipients.forEach(recipient => {
            if (recipient.status === 'failed') {
                this.campaignManager.markForRetry(campaignId, recipient.number);
                retryCount++;
            }
        });

        if (retryCount > 0) {
            // Log activity
            await this.activityLogger.logCampaignRetry(userEmail, campaignId, campaign.name, retryCount);
            
            // Start sending if not already running
            if (!this.activeQueues.has(campaignId)) {
                return this.startCampaign(campaignId, userEmail);
            }
        }

        return {
            campaignId,
            retryCount,
            status: retryCount > 0 ? 'retrying' : 'no_failed_messages'
        };
    }

    // Get campaign status
    getCampaignStatus(campaignId) {
        const queue = this.activeQueues.get(campaignId);
        const stats = this.sendingStats.get(campaignId);
        const campaign = this.campaignManager.loadCampaign(campaignId);

        if (!campaign) {
            return null;
        }

        return {
            campaignId,
            name: campaign.name,
            status: campaign.status,
            isActive: !!queue,
            queueStatus: queue ? queue.status : 'inactive',
            statistics: campaign.statistics,
            sendingStats: stats || null,
            progress: campaign.statistics.total > 0 ? 
                ((campaign.statistics.sent + campaign.statistics.failed) / campaign.statistics.total) * 100 : 0
        };
    }

    // Get all active campaigns
    getActiveCampaigns() {
        const active = [];
        this.activeQueues.forEach((queue, campaignId) => {
            const status = this.getCampaignStatus(campaignId);
            if (status) {
                active.push(status);
            }
        });
        return active;
    }
}

module.exports = CampaignSender; 