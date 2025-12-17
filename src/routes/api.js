const express = require('express');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
// Security: csurf removed (deprecated) - use modern CSRF protection if needed

const router = express.Router();

const webhookUrls = new Map();

const getWebhookUrl = (sessionId) => webhookUrls.get(sessionId) || process.env.WEBHOOK_URL || '';

// Multer setup for file uploads with security validation
const mediaDir = path.join(__dirname, '../../media');

// Allowed MIME types for file uploads
const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, mediaDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${randomUUID()}${ext}`);
    }
});

// File filter validates BEFORE saving to disk (security improvement)
const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF, DOC, DOCX, XLS, XLSX.'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

function initializeApi(sessions, sessionTokens, createSession, getSessionsDetails, deleteSession, log, userManager, activityLogger) {
    // Security middlewares
    router.use(helmet());

    // More lenient rate limiter for authenticated dashboard requests
    const apiLimiter = rateLimit({
        windowMs: 1 * 60 * 1000,
        max: 100, // Increased from 30 to 100 requests per minute
        message: { status: 'error', message: 'Too many requests, please try again later.' },
        skip: (req) => {
            // Skip rate limiting for authenticated admin users
            return req.session && req.session.adminAuthed;
        },
        // Trust proxy headers for proper IP detection
        trustProxy: true,
        standardHeaders: true,
        legacyHeaders: false
    });

    router.use(apiLimiter);

    const validateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token == null) {
            return res.status(401).json({ status: 'error', message: 'No token provided' });
        }

        const sessionId = req.query.sessionId || req.body.sessionId || req.params.sessionId;
        if (sessionId) {
            const expectedToken = sessionTokens.get(sessionId);
            if (expectedToken && token === expectedToken) {
                return next();
            }
        }

        const isAnyTokenValid = Array.from(sessionTokens.values()).includes(token);
        if (isAnyTokenValid) {
            if (sessionId) {
                return res.status(403).json({ status: 'error', message: `Invalid token for session ${sessionId}` });
            }
            return next();
        }

        return res.status(403).json({ status: 'error', message: 'Invalid token' });
    };

    // Unprotected routes
    router.post('/sessions', async (req, res) => {
        log('API request', 'SYSTEM', { event: 'api-request', method: req.method, endpoint: req.originalUrl, body: req.body });

        // Get current user from session
        const currentUser = req.session && req.session.adminAuthed ? {
            email: req.session.userEmail,
            role: req.session.userRole
        } : null;

        // Check if user is authenticated or has master API key
        if (!currentUser) {
            const masterKey = req.headers['x-master-key'];
            const requiredMasterKey = process.env.MASTER_API_KEY;

            if (requiredMasterKey && masterKey !== requiredMasterKey) {
                log('Unauthorized session creation attempt', 'SYSTEM', {
                    event: 'auth-failed',
                    endpoint: req.originalUrl,
                    ip: req.ip
                });
                return res.status(401).json({
                    status: 'error',
                    message: 'Master API key required for session creation'
                });
            }
        }

        const { sessionId } = req.body;
        if (!sessionId) {
            log('API error', 'SYSTEM', { event: 'api-error', error: 'sessionId is required', endpoint: req.originalUrl });
            return res.status(400).json({ status: 'error', message: 'sessionId is required' });
        }

        // Convert spaces to underscores
        const sanitizedSessionId = sessionId.trim().replace(/\s+/g, '_');

        try {
            // Pass the creator email to createSession
            const creatorEmail = currentUser ? currentUser.email : null;
            await createSession(sanitizedSessionId, creatorEmail);
            const token = sessionTokens.get(sanitizedSessionId);

            // Log activity
            if (currentUser && activityLogger) {
                await activityLogger.logSessionCreate(
                    currentUser.email,
                    sanitizedSessionId,
                    req.ip,
                    req.headers['user-agent']
                );
            }

            log('Session created', sanitizedSessionId, {
                event: 'session-created',
                sessionId: sanitizedSessionId,
                createdBy: currentUser ? currentUser.email : 'api-key'
            });
            res.status(201).json({ status: 'success', message: `Session ${sanitizedSessionId} created.`, token: token });
        } catch (error) {
            log('API error', 'SYSTEM', { event: 'api-error', error: error.message, endpoint: req.originalUrl });
            res.status(500).json({ status: 'error', message: `Failed to create session: ${error.message}` });
        }
    });

    router.get('/sessions', (req, res) => {
        log('API request', 'SYSTEM', { event: 'api-request', method: req.method, endpoint: req.originalUrl });

        // Get current user from session
        const currentUser = req.session && req.session.adminAuthed ? {
            email: req.session.userEmail,
            role: req.session.userRole
        } : null;

        if (currentUser) {
            // If authenticated, filter sessions based on role
            res.status(200).json(getSessionsDetails(currentUser.email, currentUser.role === 'admin'));
        } else {
            // For API access without authentication, show all sessions (backward compatibility)
            res.status(200).json(getSessionsDetails());
        }
    });

    // Campaign Management Endpoints (Session-based auth, not token-based)
    const CampaignManager = require('../services/campaigns');
    const CampaignSender = require('../services/campaign-sender');
    const RecipientListManager = require('../services/recipient-lists');

    // Initialize campaign manager and sender
    const campaignManager = new CampaignManager(process.env.TOKEN_ENCRYPTION_KEY || 'default-key');
    const campaignSender = new CampaignSender(campaignManager, sessions, activityLogger);
    const recipientListManager = new RecipientListManager(process.env.TOKEN_ENCRYPTION_KEY || 'default-key');

    // Middleware to check campaign access (session-based)
    const checkCampaignAccess = async (req, res, next) => {
        const currentUser = req.session && req.session.adminAuthed ? {
            email: req.session.userEmail,
            role: req.session.userRole
        } : null;

        if (!currentUser) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }

        req.currentUser = currentUser;
        next();
    };

    // Campaign routes - these use session auth, not token auth
    router.get('/campaigns', checkCampaignAccess, (req, res) => {
        const campaigns = campaignManager.getAllCampaigns(
            req.currentUser.email,
            req.currentUser.role === 'admin'
        );
        res.json(campaigns);
    });

    // ============================================
    // USER MANAGEMENT & ACTIVITIES (Session Auth)
    // ============================================

    // Middleware to require Admin role
    const requireAdminRole = (req, res, next) => {
        if (!req.currentUser || req.currentUser.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Admin access required' });
        }
        next();
    };

    // Users Endpoints
    router.get('/users', checkCampaignAccess, async (req, res) => {
        // Users can usually only see themselves, Admin can see all
        if (req.currentUser.role === 'admin') {
            const users = User.getAll();
            res.json({ status: 'success', data: users });
        } else {
            const user = User.findByEmail(req.currentUser.email);
            // Hide sensitive data if any not sanitized
            res.json({ status: 'success', data: [user] });
        }
    });

    router.post('/users', checkCampaignAccess, requireAdminRole, async (req, res) => {
        try {
            const newUser = await User.create({
                ...req.body,
                createdBy: req.currentUser.email
            });

            ActivityLog.logUserAction(req.currentUser.email, 'create_user', 'user', newUser.id, {
                newUserEmail: newUser.email,
                role: newUser.role
            });

            res.status(201).json({ status: 'success', data: newUser });
        } catch (error) {
            res.status(400).json({ status: 'error', error: error.message });
        }
    });

    router.put('/users/:email', checkCampaignAccess, requireAdminRole, async (req, res) => {
        const targetEmail = decodeURIComponent(req.params.email);
        const user = User.findByEmail(targetEmail);

        if (!user) {
            return res.status(404).json({ status: 'error', error: 'User not found' });
        }

        try {
            const updatedUser = await User.update(user.id, req.body);

            ActivityLog.logUserAction(req.currentUser.email, 'update_user', 'user', user.id, {
                targetEmail: targetEmail,
                changes: req.body
            });

            res.json({ status: 'success', data: updatedUser });
        } catch (error) {
            res.status(400).json({ status: 'error', error: error.message });
        }
    });

    router.delete('/users/:email', checkCampaignAccess, requireAdminRole, async (req, res) => {
        const targetEmail = decodeURIComponent(req.params.email);
        const user = User.findByEmail(targetEmail);

        if (!user) {
            return res.status(404).json({ status: 'error', error: 'User not found' });
        }

        if (user.email === req.currentUser.email) {
            return res.status(400).json({ status: 'error', error: 'Cannot delete your own account' });
        }

        try {
            User.delete(user.id);

            ActivityLog.logUserAction(req.currentUser.email, 'delete_user', 'user', user.id, {
                targetEmail: targetEmail
            });

            res.json({ status: 'success', message: 'User deleted' });
        } catch (error) {
            res.status(500).json({ status: 'error', error: error.message });
        }
    });

    // Activities Endpoints
    router.get('/activities', checkCampaignAccess, async (req, res) => {
        // Admin sees all, Users see only theirs? For now assuming admin tool.
        // But dashboard.html allows loading activities for current user?
        // activities.html seems to restrict page to Admin.

        if (req.currentUser.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Admin access required' });
        }

        const limit = parseInt(req.query.limit) || 50;
        // ActivityLog.getRecent(limit) - need to check ActivityLog model methods
        // Assuming ActivityLog has getRecent or getAll
        const logs = ActivityLog.getAll ? ActivityLog.getAll(limit) : [];
        res.json({ status: 'success', data: logs });
    });

    router.get('/activities/summary', checkCampaignAccess, requireAdminRole, async (req, res) => {
        // Assuming ActivityLog.getSummary exists or we simply aggregate logs
        // If not exists, return dummy or calculate simple stats from getAll
        const days = parseInt(req.query.days) || 7;
        const summary = ActivityLog.getSummary ? ActivityLog.getSummary(days) : { totalActivities: 0 };
        res.json({ status: 'success', data: summary });
    });

    // Function to check and start campaigns (shared with scheduler and API endpoints)
    async function checkAndStartScheduledCampaigns() {
        try {
            if (!campaignManager || !campaignSender) {
                return { error: 'Campaign services not initialized' };
            }

            const now = new Date();
            const campaigns = campaignManager.getAllCampaigns();

            // Find campaigns that should be started
            const campaignsToStart = campaigns.filter(campaign => {
                return (
                    campaign.status === 'ready' &&
                    campaign.scheduledAt &&
                    new Date(campaign.scheduledAt) <= now
                );
            });

            console.log(`📋 Scheduler check: Found ${campaignsToStart.length} campaigns to start out of ${campaigns.length} total campaigns`);

            // Start each campaign
            for (const campaign of campaignsToStart) {
                try {
                    console.log(`🚀 Auto-starting scheduled campaign: ${campaign.name} (${campaign.id})`);

                    // Find the user who created the campaign
                    const createdBy = campaign.createdBy || 'scheduler';

                    // Start the campaign
                    await campaignSender.startCampaign(campaign.id, createdBy);

                    log(`Scheduled campaign started: ${campaign.name}`, 'SCHEDULER', {
                        event: 'campaign-auto-start',
                        campaignId: campaign.id,
                        campaignName: campaign.name,
                        scheduledAt: campaign.scheduledAt,
                        startedAt: now.toISOString()
                    });

                } catch (error) {
                    console.error(`❌ Error auto-starting campaign ${campaign.id}:`, error);
                    log(`Failed to auto-start campaign: ${campaign.name} - ${error.message}`, 'SCHEDULER', {
                        event: 'campaign-auto-start-error',
                        campaignId: campaign.id,
                        error: error.message
                    });
                }
            }

            return {
                totalCampaigns: campaigns.length,
                campaignsToStart: campaignsToStart.length,
                campaigns: campaignsToStart.map(c => ({
                    id: c.id,
                    name: c.name,
                    status: c.status,
                    scheduledAt: c.scheduledAt
                }))
            };

        } catch (error) {
            console.error('❌ Campaign scheduler error:', error);
            return { error: error.message };
        }
    }

    router.get('/campaigns/csv-template', checkCampaignAccess, (req, res) => {
        const csvContent = `WhatsApp Number,Name,Job Title,Company Name
+1234567890,John Doe,Sales Manager,ABC Corporation
+0987654321,Jane Smith,Marketing Director,XYZ Company
+1122334455,Bob Johnson,CEO,Startup Inc
+5544332211,Alice Brown,CTO,Tech Solutions
+9988776655,Charlie Davis,Product Manager,Innovation Labs`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_campaign_template.csv"');
        res.send(csvContent);
    });

    // Manual trigger endpoint for checking scheduled campaigns (MUST be before /:id route)
    router.get('/campaigns/check-scheduled', checkCampaignAccess, async (req, res) => {
        console.log('🔍 Manual scheduler check triggered by:', req.currentUser.email);
        try {
            const result = await checkAndStartScheduledCampaigns();
            res.json({
                status: 'success',
                message: 'Scheduler check completed',
                ...result
            });
        } catch (error) {
            res.status(500).json({
                status: 'error',
                message: error.message
            });
        }
    });

    // Endpoint to get campaigns that should have been started but are still in ready status (MUST be before /:id route)
    router.get('/campaigns/overdue', checkCampaignAccess, (req, res) => {
        try {
            if (!campaignManager) {
                return res.status(503).json({ error: 'Campaign manager not initialized' });
            }

            const now = new Date();
            const campaigns = campaignManager.getAllCampaigns();

            const overdueCampaigns = campaigns.filter(campaign => {
                return (
                    campaign.status === 'ready' &&
                    campaign.scheduledAt &&
                    new Date(campaign.scheduledAt) <= now
                );
            });

            res.json({
                totalCampaigns: campaigns.length,
                overdueCampaigns: overdueCampaigns.length,
                campaigns: overdueCampaigns.map(c => ({
                    id: c.id,
                    name: c.name,
                    status: c.status,
                    scheduledAt: c.scheduledAt,
                    createdAt: c.createdAt,
                    minutesOverdue: Math.floor((now - new Date(c.scheduledAt)) / 60000)
                }))
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/campaigns/:id', checkCampaignAccess, (req, res) => {
        const campaign = campaignManager.loadCampaign(req.params.id);
        if (!campaign) {
            return res.status(404).json({ status: 'error', message: 'Campaign not found' });
        }

        // Check access
        if (req.currentUser.role !== 'admin' && campaign.createdBy !== req.currentUser.email) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        res.json(campaign);
    });

    router.post('/campaigns', checkCampaignAccess, async (req, res) => {
        try {
            const campaignData = {
                ...req.body,
                createdBy: req.currentUser.email
            };

            const campaign = campaignManager.createCampaign(campaignData);

            // Log activity
            await activityLogger.logCampaignCreate(
                req.currentUser.email,
                campaign.id,
                campaign.name,
                campaign.recipients.length
            );

            res.status(201).json(campaign);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    router.put('/campaigns/:id', checkCampaignAccess, (req, res) => {
        try {
            const campaign = campaignManager.loadCampaign(req.params.id);
            if (!campaign) {
                return res.status(404).json({ status: 'error', message: 'Campaign not found' });
            }

            // Check access
            if (req.currentUser.role !== 'admin' && campaign.createdBy !== req.currentUser.email) {
                return res.status(403).json({ status: 'error', message: 'Access denied' });
            }

            const updated = campaignManager.updateCampaign(req.params.id, req.body);
            res.json(updated);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    router.delete('/campaigns/:id', checkCampaignAccess, async (req, res) => {
        const campaign = campaignManager.loadCampaign(req.params.id);
        if (!campaign) {
            return res.status(404).json({ status: 'error', message: 'Campaign not found' });
        }

        // Check access
        if (req.currentUser.role !== 'admin' && campaign.createdBy !== req.currentUser.email) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        campaignManager.deleteCampaign(req.params.id);

        // Log activity
        await activityLogger.logCampaignDelete(
            req.currentUser.email,
            req.params.id,
            campaign.name
        );

        res.json({ status: 'success', message: 'Campaign deleted' });
    });

    router.post('/campaigns/:id/clone', checkCampaignAccess, async (req, res) => {
        try {
            const cloned = campaignManager.cloneCampaign(req.params.id, req.currentUser.email);
            res.status(201).json(cloned);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    router.post('/campaigns/:id/send', checkCampaignAccess, async (req, res) => {
        try {
            const result = await campaignSender.startCampaign(req.params.id, req.currentUser.email);
            res.json(result);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    router.post('/campaigns/:id/pause', checkCampaignAccess, async (req, res) => {
        const result = campaignSender.pauseCampaign(req.params.id);
        if (result) {
            await activityLogger.logCampaignPause(
                req.currentUser.email,
                req.params.id,
                'Campaign paused by user'
            );
            res.json({ status: 'success', message: 'Campaign paused' });
        } else {
            res.status(400).json({ status: 'error', message: 'Campaign not running' });
        }
    });

    router.post('/campaigns/:id/resume', checkCampaignAccess, async (req, res) => {
        try {
            const result = await campaignSender.resumeCampaign(req.params.id, req.currentUser.email);
            res.json({ status: 'success', message: 'Campaign resumed' });
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    router.post('/campaigns/:id/retry', checkCampaignAccess, async (req, res) => {
        try {
            const result = await campaignSender.retryFailed(req.params.id, req.currentUser.email);
            res.json(result);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    router.get('/campaigns/:id/status', checkCampaignAccess, (req, res) => {
        const status = campaignSender.getCampaignStatus(req.params.id);
        if (!status) {
            return res.status(404).json({ status: 'error', message: 'Campaign not found' });
        }
        res.json(status);
    });

    router.get('/campaigns/:id/export', checkCampaignAccess, (req, res) => {
        const campaign = campaignManager.loadCampaign(req.params.id);
        if (!campaign) {
            return res.status(404).json({ status: 'error', message: 'Campaign not found' });
        }

        // Check access
        if (req.currentUser.role !== 'admin' && campaign.createdBy !== req.currentUser.email) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        const csv = campaignManager.exportResults(req.params.id);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${campaign.name}_results.csv"`);
        res.send(csv);
    });

    router.post('/campaigns/preview-csv', checkCampaignAccess, upload.single('file'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'No file uploaded' });
        }

        try {
            const csvContent = fs.readFileSync(req.file.path, 'utf-8');
            const result = campaignManager.parseCSV(csvContent);

            // Clean up uploaded file
            fs.unlinkSync(req.file.path);

            res.json(result);
        } catch (error) {
            // Clean up uploaded file
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            res.status(400).json({ status: 'error', message: error.message });
        }
    });



    // Export the function for use by the main scheduler
    router.checkAndStartScheduledCampaigns = checkAndStartScheduledCampaigns;

    // Recipient List Management Endpoints (Session-based auth, not token-based)

    // Get all recipient lists
    router.get('/recipient-lists', checkCampaignAccess, (req, res) => {
        const lists = recipientListManager.getAllLists(
            req.currentUser.email,
            req.currentUser.role === 'admin'
        );
        res.json(lists);
    });

    // Get specific recipient list
    router.get('/recipient-lists/:id', checkCampaignAccess, (req, res) => {
        const list = recipientListManager.loadList(req.params.id);
        if (!list) {
            return res.status(404).json({ status: 'error', message: 'Recipient list not found' });
        }

        // Check access
        if (req.currentUser.role !== 'admin' && list.createdBy !== req.currentUser.email) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        res.json(list);
    });

    // Create new recipient list
    router.post('/recipient-lists', checkCampaignAccess, (req, res) => {
        try {
            const listData = {
                ...req.body,
                createdBy: req.currentUser.email
            };

            const list = recipientListManager.createList(listData);
            res.status(201).json(list);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    // Update recipient list
    router.put('/recipient-lists/:id', checkCampaignAccess, (req, res) => {
        try {
            const list = recipientListManager.loadList(req.params.id);
            if (!list) {
                return res.status(404).json({ status: 'error', message: 'Recipient list not found' });
            }

            // Check access
            if (req.currentUser.role !== 'admin' && list.createdBy !== req.currentUser.email) {
                return res.status(403).json({ status: 'error', message: 'Access denied' });
            }

            const updated = recipientListManager.updateList(req.params.id, req.body);
            res.json(updated);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    // Delete recipient list
    router.delete('/recipient-lists/:id', checkCampaignAccess, (req, res) => {
        const list = recipientListManager.loadList(req.params.id);
        if (!list) {
            return res.status(404).json({ status: 'error', message: 'Recipient list not found' });
        }

        // Check access
        if (req.currentUser.role !== 'admin' && list.createdBy !== req.currentUser.email) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        const success = recipientListManager.deleteList(req.params.id);
        if (success) {
            res.json({ status: 'success', message: 'Recipient list deleted' });
        } else {
            res.status(500).json({ status: 'error', message: 'Failed to delete recipient list' });
        }
    });

    // Clone recipient list
    router.post('/recipient-lists/:id/clone', checkCampaignAccess, (req, res) => {
        try {
            const cloned = recipientListManager.cloneList(req.params.id, req.currentUser.email, req.body.name);
            res.status(201).json(cloned);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    // Add recipient to list
    router.post('/recipient-lists/:id/recipients', checkCampaignAccess, (req, res) => {
        try {
            const list = recipientListManager.loadList(req.params.id);
            if (!list) {
                return res.status(404).json({ status: 'error', message: 'Recipient list not found' });
            }

            // Check access
            if (req.currentUser.role !== 'admin' && list.createdBy !== req.currentUser.email) {
                return res.status(403).json({ status: 'error', message: 'Access denied' });
            }

            const updated = recipientListManager.addRecipient(req.params.id, req.body);
            res.status(201).json(updated);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    // Update recipient in list
    router.put('/recipient-lists/:id/recipients/:number', checkCampaignAccess, (req, res) => {
        try {
            const list = recipientListManager.loadList(req.params.id);
            if (!list) {
                return res.status(404).json({ status: 'error', message: 'Recipient list not found' });
            }

            // Check access
            if (req.currentUser.role !== 'admin' && list.createdBy !== req.currentUser.email) {
                return res.status(403).json({ status: 'error', message: 'Access denied' });
            }

            const updated = recipientListManager.updateRecipient(req.params.id, req.params.number, req.body);
            res.json(updated);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    // Remove recipient from list
    router.delete('/recipient-lists/:id/recipients/:number', checkCampaignAccess, (req, res) => {
        try {
            const list = recipientListManager.loadList(req.params.id);
            if (!list) {
                return res.status(404).json({ status: 'error', message: 'Recipient list not found' });
            }

            // Check access
            if (req.currentUser.role !== 'admin' && list.createdBy !== req.currentUser.email) {
                return res.status(403).json({ status: 'error', message: 'Access denied' });
            }

            const updated = recipientListManager.removeRecipient(req.params.id, req.params.number);
            res.json(updated);
        } catch (error) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    });

    // Search recipients across all lists
    router.get('/recipient-lists/search/:query', checkCampaignAccess, (req, res) => {
        const results = recipientListManager.searchRecipients(
            req.params.query,
            req.currentUser.email,
            req.currentUser.role === 'admin'
        );
        res.json(results);
    });

    // Get recipient lists statistics
    router.get('/recipient-lists-stats', checkCampaignAccess, (req, res) => {
        const stats = recipientListManager.getStatistics(
            req.currentUser.email,
            req.currentUser.role === 'admin'
        );
        res.json(stats);
    });

    // Mark recipient list as used
    router.post('/recipient-lists/:id/mark-used', checkCampaignAccess, (req, res) => {
        const list = recipientListManager.loadList(req.params.id);
        if (!list) {
            return res.status(404).json({ status: 'error', message: 'Recipient list not found' });
        }

        // Check access
        if (req.currentUser.role !== 'admin' && list.createdBy !== req.currentUser.email) {
            return res.status(403).json({ status: 'error', message: 'Access denied' });
        }

        recipientListManager.markAsUsed(req.params.id);
        res.json({ status: 'success', message: 'List marked as used' });
    });

    // Debug endpoint to check session status
    router.get('/debug/sessions', checkCampaignAccess, (req, res) => {
        const debugInfo = {};
        sessions.forEach((session, sessionId) => {
            debugInfo[sessionId] = {
                status: session.status,
                hasSock: !!session.sock,
                sockConnected: session.sock ? 'yes' : 'no',
                owner: session.owner,
                detail: session.detail
            };
        });
        res.json(debugInfo);
    });

    // All routes below this are protected by token
    router.use(validateToken);

    router.delete('/sessions/:sessionId', async (req, res) => {
        log('API request', 'SYSTEM', { event: 'api-request', method: req.method, endpoint: req.originalUrl, params: req.params });
        const { sessionId } = req.params;

        // Get current user from session
        const currentUser = req.session && req.session.adminAuthed ? {
            email: req.session.userEmail,
            role: req.session.userRole
        } : null;

        try {
            // Check ownership if user is authenticated
            if (currentUser && currentUser.role !== 'admin' && userManager) {
                const sessionOwner = userManager.getSessionOwner(sessionId);
                if (sessionOwner && sessionOwner.email !== currentUser.email) {
                    return res.status(403).json({
                        status: 'error',
                        message: 'You can only delete your own sessions'
                    });
                }
            }

            await deleteSession(sessionId);

            // Log activity
            if (currentUser && activityLogger) {
                await activityLogger.logSessionDelete(
                    currentUser.email,
                    sessionId,
                    req.ip,
                    req.headers['user-agent']
                );
            }

            log('Session deleted', sessionId, { event: 'session-deleted', sessionId });
            res.status(200).json({ status: 'success', message: `Session ${sessionId} deleted.` });
        } catch (error) {
            log('API error', 'SYSTEM', { event: 'api-error', error: error.message, endpoint: req.originalUrl });
            res.status(500).json({ status: 'error', message: `Failed to delete session: ${error.message}` });
        }
    });

    async function sendMessage(sock, to, message) {
        try {
            const jid = jidNormalizedUser(to);
            const result = await sock.sendMessage(jid, message);
            return { status: 'success', message: `Message sent to ${to}`, messageId: result.key.id };
        } catch (error) {
            console.error(`Failed to send message to ${to}:`, error);
            return { status: 'error', message: `Failed to send message to ${to}. Reason: ${error.message}` };
        }
    }

    // Webhook setup endpoint
    router.post('/webhook', (req, res) => {
        log('API request', 'SYSTEM', { event: 'api-request', method: req.method, endpoint: req.originalUrl, body: req.body });
        const { url, sessionId } = req.body;
        if (!url || !sessionId) {
            log('API error', 'SYSTEM', { event: 'api-error', error: 'URL and sessionId are required.', endpoint: req.originalUrl });
            return res.status(400).json({ status: 'error', message: 'URL and sessionId are required.' });
        }
        webhookUrls.set(sessionId, url);
        log('Webhook URL updated', url, { event: 'webhook-updated', sessionId, url });
        res.status(200).json({ status: 'success', message: `Webhook URL for session ${sessionId} updated to ${url}` });
    });

    // Add GET and DELETE endpoints for webhook management
    router.get('/webhook', (req, res) => {
        const { sessionId } = req.query;
        if (!sessionId) {
            return res.status(400).json({ status: 'error', message: 'sessionId is required.' });
        }
        const url = webhookUrls.get(sessionId) || null;
        res.status(200).json({ status: 'success', sessionId, url });
    });

    router.delete('/webhook', (req, res) => {
        const { sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ status: 'error', message: 'sessionId is required.' });
        }
        webhookUrls.delete(sessionId);
        log('Webhook URL deleted', '', { event: 'webhook-deleted', sessionId });
        res.status(200).json({ status: 'success', message: `Webhook for session ${sessionId} deleted.` });
    });

    // Hardened media upload endpoint (validation handled by multer fileFilter)
    router.post('/media', upload.single('file'), (req, res) => {
        log('API request', 'SYSTEM', { event: 'api-request', method: req.method, endpoint: req.originalUrl, body: req.body });
        if (!req.file) {
            log('API error', 'SYSTEM', { event: 'api-error', error: 'No file uploaded or invalid file type.', endpoint: req.originalUrl });
            return res.status(400).json({ status: 'error', message: 'No file uploaded or invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF, DOC, DOCX, XLS, XLSX. Max size: 25MB.' });
        }
        const mediaId = req.file.filename;
        log('File uploaded', mediaId, { event: 'file-uploaded', mediaId });
        res.status(201).json({
            status: 'success',
            message: 'File uploaded successfully.',
            mediaId: mediaId,
            url: `/media/${mediaId}`
        });
    });

    // Main message sending endpoint
    router.post('/messages', async (req, res) => {
        log('API request', 'SYSTEM', { event: 'api-request', method: req.method, endpoint: req.originalUrl, query: req.query });
        const { sessionId } = req.query;
        if (!sessionId) {
            log('API error', 'SYSTEM', { event: 'api-error', error: 'sessionId query parameter is required', endpoint: req.originalUrl });
            return res.status(400).json({ status: 'error', message: 'sessionId query parameter is required' });
        }
        const session = sessions.get(sessionId);
        if (!session || !session.sock || session.status !== 'CONNECTED') {
            log('API error', 'SYSTEM', { event: 'api-error', error: `Session ${sessionId} not found or not connected.`, endpoint: req.originalUrl });
            return res.status(404).json({ status: 'error', message: `Session ${sessionId} not found or not connected.` });
        }
        const messages = Array.isArray(req.body) ? req.body : [req.body];
        const results = [];
        const phoneNumbers = []; // Track all phone numbers for logging
        const messageContents = []; // Track message contents with formatting

        for (const msg of messages) {
            const { recipient_type, to, type, text, image, document } = msg;
            // Input validation
            if (!to || !type) {
                results.push({ status: 'error', message: 'Invalid message format. "to" and "type" are required.' });
                continue;
            }
            if (!validator.isNumeric(to) && !to.endsWith('@g.us')) {
                results.push({ status: 'error', message: 'Invalid recipient format.' });
                continue;
            }

            // Add phone number to the list for logging
            phoneNumbers.push(to);

            // Track message content based on type
            let messageContent = {
                type: type,
                to: to
            };

            if (type === 'text') {
                if (!text || typeof text.body !== 'string' || text.body.length === 0 || text.body.length > 4096) {
                    results.push({ status: 'error', message: 'Invalid text message content.' });
                    continue;
                }
                messageContent.text = text.body; // Preserve formatting
            }
            if (type === 'image' && image) {
                if (image.id && !validator.isAlphanumeric(image.id.replace(/[\.\-]/g, ''))) {
                    results.push({ status: 'error', message: 'Invalid image ID.' });
                    continue;
                }
                if (image.link && !validator.isURL(image.link)) {
                    results.push({ status: 'error', message: 'Invalid image URL.' });
                    continue;
                }
                messageContent.image = {
                    caption: image.caption || '',
                    url: image.link || `/media/${image.id}` // Convert media ID to URL for display
                };
            }
            if (type === 'document' && document) {
                if (document.id && !validator.isAlphanumeric(document.id.replace(/[\.\-]/g, ''))) {
                    results.push({ status: 'error', message: 'Invalid document ID.' });
                    continue;
                }
                if (document.link && !validator.isURL(document.link)) {
                    results.push({ status: 'error', message: 'Invalid document URL.' });
                    continue;
                }
                messageContent.document = {
                    filename: document.filename || 'document',
                    url: document.link || `/media/${document.id}` // Convert media ID to URL for display
                };
            }

            messageContents.push(messageContent);

            let destination;
            if (recipient_type === 'group') {
                destination = to.endsWith('@g.us') ? to : `${to}@g.us`;
            } else {
                destination = `${to.replace(/[@s.whatsapp.net]/g, '')}@s.whatsapp.net`;
            }

            let messagePayload;
            let options = {};

            try {
                switch (type) {
                    case 'text':
                        if (!text || !text.body) {
                            throw new Error('For "text" type, "text.body" is required.');
                        }
                        messagePayload = { text: text.body };
                        break;

                    case 'image':
                        if (!image || (!image.link && !image.id)) {
                            throw new Error('For "image" type, "image.link" or "image.id" is required.');
                        }
                        const imageUrl = image.id ? path.join(mediaDir, image.id) : image.link;
                        messagePayload = { image: { url: imageUrl }, caption: image.caption };
                        break;

                    case 'document':
                        if (!document || (!document.link && !document.id)) {
                            throw new Error('For "document" type, "document.link" or "document.id" is required.');
                        }
                        const docUrl = document.id ? path.join(mediaDir, document.id) : document.link;
                        messagePayload = { document: { url: docUrl }, mimetype: document.mimetype, fileName: document.filename };
                        break;

                    default:
                        throw new Error(`Unsupported message type: ${type}`);
                }

                const result = await sendMessage(session.sock, destination, messagePayload);
                results.push(result);

            } catch (error) {
                results.push({ status: 'error', message: `Failed to process message for ${to}: ${error.message}` });
            }
        }

        // Log activity for each successful message
        if (activityLogger) {
            const currentUser = req.session && req.session.adminAuthed ? req.session.userEmail : null;
            const sessionOwner = userManager ? userManager.getSessionOwner(sessionId) : null;
            const userEmail = currentUser || (sessionOwner ? sessionOwner.email : 'api-user');

            for (let i = 0; i < results.length; i++) {
                if (results[i].status === 'success') {
                    await activityLogger.logMessageSend(
                        userEmail,
                        sessionId,
                        phoneNumbers[i],
                        messages[i].type,
                        req.ip,
                        req.headers['user-agent']
                    );
                }
            }
        }

        log('Messages sent', sessionId, {
            event: 'messages-sent',
            sessionId,
            count: results.length,
            phoneNumbers: phoneNumbers,
            messages: messageContents
        });
        res.status(200).json(results);
    });

    router.delete('/message', async (req, res) => {
        log('API request', 'SYSTEM', { event: 'api-request', method: req.method, endpoint: req.originalUrl, body: req.body });
        const { sessionId, messageId, remoteJid } = req.body;

        if (!sessionId || !messageId || !remoteJid) {
            log('API error', 'SYSTEM', { event: 'api-error', error: 'sessionId, messageId, and remoteJid are required.', endpoint: req.originalUrl });
            return res.status(400).json({ status: 'error', message: 'sessionId, messageId, and remoteJid are required.' });
        }

        const session = sessions.get(sessionId);
        if (!session || !session.sock || session.status !== 'CONNECTED') {
            log('API error', 'SYSTEM', { event: 'api-error', error: `Session ${sessionId} not found or not connected.`, endpoint: req.originalUrl });
            return res.status(404).json({ status: 'error', message: `Session ${sessionId} not found or not connected.` });
        }

        try {
            await session.sock.chatModify({
                clear: { messages: [{ id: messageId, fromMe: true, timestamp: 0 }] }
            }, remoteJid);

            // The above is for clearing. For actual deletion:
            await session.sock.sendMessage(remoteJid, { delete: { remoteJid: remoteJid, fromMe: true, id: messageId } });

            log('Message deleted', messageId, { event: 'message-deleted', messageId, sessionId });
            res.status(200).json({ status: 'success', message: `Attempted to delete message ${messageId}` });
        } catch (error) {
            log('API error', 'SYSTEM', { event: 'api-error', error: error.message, endpoint: req.originalUrl });
            console.error(`Failed to delete message ${messageId}:`, error);
            res.status(500).json({ status: 'error', message: `Failed to delete message. Reason: ${error.message}` });
        }
    });

    // Make campaign sender available for WebSocket updates
    router.campaignSender = campaignSender;

    // ============================================
    // LEGACY API ENDPOINTS (merged from legacy_api.js)
    // ============================================

    // Legacy rate limiter (stricter for these endpoints)
    const legacyLimiter = rateLimit({
        windowMs: 1 * 60 * 1000,
        max: 10,
        message: { status: 'error', message: 'Too many requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
        validate: { trustProxy: false }
    });

    // Legacy JSON endpoint: POST /legacy/send-message
    router.post('/legacy/send-message', legacyLimiter, validateToken, express.json(), async (req, res) => {
        const { sessionId, number, message } = req.body;

        if (!sessionId || !number || !message) {
            return res.status(400).json({ status: 'error', message: 'sessionId, number, and message are required.' });
        }

        // Input validation
        if (!/^[0-9]{8,15}$/.test(number)) {
            return res.status(400).json({ status: 'error', message: 'Invalid phone number format.' });
        }
        if (typeof message !== 'string' || message.length === 0 || message.length > 4096) {
            return res.status(400).json({ status: 'error', message: 'Invalid message content.' });
        }

        const session = sessions.get(sessionId);
        if (!session || !session.sock || session.status !== 'CONNECTED') {
            return res.status(404).json({ status: 'error', message: `Session ${sessionId} not found or not connected.` });
        }

        try {
            const destination = `${number}@s.whatsapp.net`;
            const result = await sendMessage(session.sock, destination, { text: message });
            res.status(200).json(result);
        } catch (error) {
            console.error(`Failed to send legacy message to ${number}:`, error);
            res.status(500).json({ status: 'error', message: `Failed to send message: ${error.message}` });
        }
    });

    // Legacy form-data endpoint: POST /legacy/message
    router.post('/legacy/message', legacyLimiter, validateToken, multer().none(), async (req, res) => {
        const { phone, message, sessionId } = req.body;
        const targetSessionId = sessionId || 'putra';

        if (!phone || !message) {
            return res.status(400).json({ status: 'error', message: 'phone and message are required.' });
        }

        // Input validation
        if (!/^[0-9]{8,15}$/.test(phone)) {
            return res.status(400).json({ status: 'error', message: 'Invalid phone number format.' });
        }
        if (typeof message !== 'string' || message.length === 0 || message.length > 4096) {
            return res.status(400).json({ status: 'error', message: 'Invalid message content.' });
        }

        const session = sessions.get(targetSessionId);
        if (!session || !session.sock || session.status !== 'CONNECTED') {
            return res.status(404).json({ status: 'error', message: `Session ${targetSessionId} not found or not connected.` });
        }

        try {
            const destination = `${phone}@s.whatsapp.net`;
            const result = await sendMessage(session.sock, destination, { text: message });
            res.status(200).json(result);
        } catch (error) {
            console.error(`Failed to send legacy message to ${phone}:`, error);
            res.status(500).json({ status: 'error', message: `Failed to send message: ${error.message}` });
        }
    });

    return router;
}

module.exports = { initializeApi, getWebhookUrl }; 