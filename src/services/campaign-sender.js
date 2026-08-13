const EventEmitter = require('events');

class CampaignSender extends EventEmitter {
    constructor(campaignManager, sessions, activityLogger) {
        super();
        this.campaignManager = campaignManager;
        this.sessions = sessions;
        this.activityLogger = activityLogger;
        this.activeQueues = new Map(); // campaignId -> queue info
        this.sendingStats = new Map(); // campaignId -> stats
        this.inFlight = new Map(); // campaignId -> Map(recipientNumber -> startTime)
    }

    // Mark a recipient as being sent right now (prevents duplicate sends when
    // pause/resume or stop/start races with an in-flight sendMessage call).
    claimRecipient(campaignId, number) {
        let claims = this.inFlight.get(campaignId);
        if (!claims) {
            claims = new Map();
            this.inFlight.set(campaignId, claims);
        }
        claims.set(number, Date.now());
    }

    releaseRecipient(campaignId, number) {
        const claims = this.inFlight.get(campaignId);
        if (claims) claims.delete(number);
    }

    isRecipientClaimed(campaignId, number) {
        const claims = this.inFlight.get(campaignId);
        if (!claims || !claims.has(number)) return false;
        // Treat claims older than 60s as stale (sendMessage should never take that long)
        return Date.now() - claims.get(number) < 60000;
    }

    // Start sending a campaign
    async startCampaign(campaignId, userEmail) {
        console.log(`[CampaignSender] Loading campaign ${campaignId} for ${userEmail}`);
        const campaign = this.campaignManager.loadCampaign(campaignId);
        if (!campaign) {
            console.error(`[CampaignSender] Failed to load campaign ${campaignId}. File may be missing or decryption failed.`);
            throw new Error('Campaign not found or could not be loaded');
        }

        // Check if campaign is already running
        if (this.activeQueues.has(campaignId)) {
            throw new Error('Campaign is already running');
        }

        // Check if session exists and is connected
        const session = this.sessions.get(campaign.sessionId);
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
            timer: null,
            generation: Date.now(),
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

        // Capture the generation this loop belongs to; pause/stop/resume
        // bump it so stale loops abort instead of double-sending.
        const generation = queue.generation;
        const isCurrent = () => {
            const q = this.activeQueues.get(campaignId);
            return q && q.status === 'running' && q.generation === generation;
        };

        const campaign = this.campaignManager.loadCampaign(campaignId);
        if (!campaign) {
            this.stopCampaign(campaignId);
            return;
        }

        const session = this.sessions.get(campaign.sessionId);
        if (!session || session.status !== 'CONNECTED' || !session.sock) {
            console.error(`[Campaign ${campaignId}] Session ${campaign.sessionId} not connected, pausing`);
            this.pauseCampaign(campaignId, 'Session disconnected or not available');
            return;
        }

        // Get next batch of recipients
        const pendingRecipients = this.campaignManager.getPendingRecipients(campaignId, 1);

        if (pendingRecipients.length === 0) {
            // Campaign completed
            this.completeCampaign(campaignId);
            return;
        }

        const recipient = pendingRecipients[0];

        // Another (stale) loop may still be sending this recipient — never
        // send the same number twice. Re-check shortly instead.
        if (this.isRecipientClaimed(campaignId, recipient.number)) {
            queue.timer = setTimeout(() => {
                queue.timer = null;
                this.processQueue(campaignId);
            }, 500);
            return;
        }
        this.claimRecipient(campaignId, recipient.number);

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
            await session.sock.sendMessage(jid, messageData);
            this.releaseRecipient(campaignId, recipient.number);

            // The message went out regardless of pause/stop races; record it.
            this.campaignManager.updateRecipientStatus(campaignId, recipient.number, 'sent');

            // If the campaign was paused/stopped/resumed while sending,
            // the new loop owns the queue now — do not emit/schedule here.
            if (!isCurrent()) return;

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

            console.log(`[Campaign ${campaignId}] Sent to ${recipient.number}`);

        } catch (error) {
            this.releaseRecipient(campaignId, recipient.number);

            // The send failed regardless of pause/stop races; record it.
            this.campaignManager.updateRecipientStatus(
                campaignId,
                recipient.number,
                'failed',
                error.message
            );

            if (!isCurrent()) return;

            console.error(`[Campaign ${campaignId}] Failed to send to ${recipient.number}: ${error.message}`);

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

        // Schedule next message (track the timer so pause/stop can cancel it)
        if (isCurrent()) {
            const rawDelay = Number(campaign.settings.delayBetweenMessages) || 3000;
            const delay = Math.min(Math.max(rawDelay, 1000), 300000); // clamp 1s..5min
            queue.timer = setTimeout(() => {
                queue.timer = null;
                this.processQueue(campaignId);
            }, delay);
        }
    }

    // Pause campaign
    pauseCampaign(campaignId, reason = null) {
        const queue = this.activeQueues.get(campaignId);
        if (!queue) return;

        queue.status = 'paused';
        queue.generation = (queue.generation || 0) + 1; // invalidate in-flight loop
        if (queue.timer) {
            clearTimeout(queue.timer);
            queue.timer = null;
        }
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
                timer: null,
                generation: Date.now(),
                startTime: Date.now(),
                processedCount: campaign.statistics.sent
            };
            this.activeQueues.set(campaignId, newQueue);
        } else {
            queue.status = 'running';
            queue.generation = (queue.generation || 0) + 1; // fresh loop generation
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

        queue.status = 'stopped';
        queue.generation = (queue.generation || 0) + 1; // invalidate in-flight loop
        if (queue.timer) {
            clearTimeout(queue.timer);
            queue.timer = null;
        }
        if (queue.interval) {
            clearInterval(queue.interval);
        }

        this.activeQueues.delete(campaignId);
        this.sendingStats.delete(campaignId);

        // Persist a non-stuck status (completeCampaign overrides with 'completed' right after)
        this.campaignManager.updateCampaignStatus(campaignId, 'paused');

        this.emit('status', {
            campaignId,
            status: 'stopped'
        });
    }

    // Complete campaign
    async completeCampaign(campaignId) {
        const campaign = this.campaignManager.loadCampaign(campaignId);

        if (this.activeQueues.has(campaignId)) {
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