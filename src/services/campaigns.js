const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const sanitizeHtml = require('sanitize-html');
const { format } = require('date-fns');

class CampaignManager {
    constructor(encryptionKey) {
        this.encryptionKey = encryptionKey;
        this.campaignsDir = path.join(__dirname, 'campaigns');
        this.campaignMediaDir = path.join(__dirname, 'campaign_media');
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.campaignsDir)) {
            fs.mkdirSync(this.campaignsDir, { recursive: true });
        }
        if (!fs.existsSync(this.campaignMediaDir)) {
            fs.mkdirSync(this.campaignMediaDir, { recursive: true });
        }
    }

    generateId() {
        return `campaign_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // Encryption functions
    encrypt(text) {
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(JSON.stringify(text), 'utf8', 'hex');
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
        
        return JSON.parse(decrypted);
    }

    // Save campaign to file
    saveCampaign(campaign) {
        const filePath = path.join(this.campaignsDir, `${campaign.id}.json`);
        const encrypted = this.encrypt(campaign);
        fs.writeFileSync(filePath, encrypted, 'utf-8');
        
        // Set file permissions (read/write for owner only)
        if (process.platform !== 'win32') {
            fs.chmodSync(filePath, 0o600);
        }
    }

    // Load campaign from file
    loadCampaign(campaignId) {
        try {
            const filePath = path.join(this.campaignsDir, `${campaignId}.json`);
            if (!fs.existsSync(filePath)) {
                return null;
            }
            
            const encrypted = fs.readFileSync(filePath, 'utf-8');
            return this.decrypt(encrypted);
        } catch (error) {
            console.error('Error loading campaign:', error);
            return null;
        }
    }

    // Get all campaigns
    getAllCampaigns(userEmail = null, isAdmin = false) {
        try {
            const files = fs.readdirSync(this.campaignsDir);
            const campaigns = [];
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const campaign = this.loadCampaign(file.replace('.json', ''));
                    if (campaign) {
                        // Filter by user if not admin
                        if (isAdmin || !userEmail || campaign.createdBy === userEmail) {
                            // Don't include full recipient list in listing
                            const summary = {
                                ...campaign,
                                recipients: undefined,
                                recipientCount: campaign.recipients ? campaign.recipients.length : 0
                            };
                            campaigns.push(summary);
                        }
                    }
                }
            }
            
            // Sort by creation date (newest first)
            return campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } catch (error) {
            console.error('Error getting campaigns:', error);
            return [];
        }
    }

    // Create new campaign
    createCampaign(data) {
        // Ensure all recipients have proper status initialization
        const recipients = (data.recipients || []).map(recipient => ({
            ...recipient,
            status: recipient.status || 'pending',
            sentAt: recipient.sentAt || null,
            error: recipient.error || null,
            retryCount: recipient.retryCount || 0
        }));

        const campaign = {
            id: this.generateId(),
            name: sanitizeHtml(data.name, { allowedTags: [] }),
            createdBy: data.createdBy,
            createdAt: new Date().toISOString(),
            scheduledAt: data.scheduledAt || null,
            status: data.status || 'draft',
            sessionId: data.sessionId,
            message: {
                type: data.message.type || 'text',
                content: sanitizeHtml(data.message.content, {
                    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'a'],
                    allowedAttributes: {
                        'a': ['href', 'target']
                    }
                }),
                mediaUrl: data.message.mediaUrl || null,
                mediaCaption: data.message.mediaCaption || null
            },
            recipients: recipients,
            statistics: {
                total: recipients.length,
                sent: 0,
                failed: 0,
                pending: recipients.length
            },
            settings: {
                delayBetweenMessages: data.settings?.delayBetweenMessages || 3000, // 3 seconds default
                retryFailedMessages: data.settings?.retryFailedMessages !== false,
                maxRetries: data.settings?.maxRetries || 3
            }
        };
        
        this.saveCampaign(campaign);
        return campaign;
    }

    // Update campaign
    updateCampaign(campaignId, updates) {
        const campaign = this.loadCampaign(campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }
        
        // Update allowed fields
        if (updates.name) campaign.name = sanitizeHtml(updates.name, { allowedTags: [] });
        if (updates.scheduledAt !== undefined) campaign.scheduledAt = updates.scheduledAt;
        if (updates.sessionId) campaign.sessionId = updates.sessionId;
        if (updates.status) campaign.status = updates.status;
        if (updates.message) {
            campaign.message = {
                ...campaign.message,
                ...updates.message
            };
            if (updates.message.content) {
                campaign.message.content = sanitizeHtml(updates.message.content, {
                    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'a'],
                    allowedAttributes: {
                        'a': ['href', 'target']
                    }
                });
            }
        }
        if (updates.recipients) {
            // Ensure all recipients have proper status initialization
            campaign.recipients = updates.recipients.map(recipient => ({
                ...recipient,
                status: recipient.status || 'pending',
                sentAt: recipient.sentAt || null,
                error: recipient.error || null,
                retryCount: recipient.retryCount || 0
            }));
            campaign.statistics.total = campaign.recipients.length;
            campaign.statistics.pending = campaign.recipients.length;
        }
        if (updates.settings) {
            campaign.settings = {
                ...campaign.settings,
                ...updates.settings
            };
        }
        
        campaign.updatedAt = new Date().toISOString();
        this.saveCampaign(campaign);
        return campaign;
    }

    // Delete campaign
    deleteCampaign(campaignId) {
        try {
            const filePath = path.join(this.campaignsDir, `${campaignId}.json`);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            // Delete associated media
            const mediaDir = path.join(this.campaignMediaDir, campaignId);
            if (fs.existsSync(mediaDir)) {
                fs.rmSync(mediaDir, { recursive: true, force: true });
            }
            
            return true;
        } catch (error) {
            console.error('Error deleting campaign:', error);
            return false;
        }
    }

    // Clone campaign
    cloneCampaign(campaignId, newCreatedBy) {
        const original = this.loadCampaign(campaignId);
        if (!original) {
            throw new Error('Campaign not found');
        }
        
        const cloned = {
            ...original,
            id: this.generateId(),
            name: `${original.name} (Copy)`,
            createdBy: newCreatedBy,
            createdAt: new Date().toISOString(),
            status: 'draft',
            recipients: original.recipients.map(r => ({
                ...r,
                status: 'pending',
                sentAt: null,
                error: null
            })),
            statistics: {
                total: original.recipients.length,
                sent: 0,
                failed: 0,
                pending: original.recipients.length
            }
        };
        
        this.saveCampaign(cloned);
        return cloned;
    }

    // Parse CSV file
    parseCSV(csvContent, columnMapping = null) {
        try {
            // First, try to detect the delimiter
            const firstLine = csvContent.split(/\r?\n/)[0];
            let delimiter = ',';
            
            // Check if semicolon is more common than comma in the first line
            const commaCount = (firstLine.match(/,/g) || []).length;
            const semicolonCount = (firstLine.match(/;/g) || []).length;
            
            if (semicolonCount > commaCount) {
                delimiter = ';';
                console.log('Detected semicolon delimiter in CSV');
            }
            
            // Remove BOM if present
            if (csvContent.charCodeAt(0) === 0xFEFF) {
                csvContent = csvContent.substr(1);
                console.log('Removed BOM from CSV');
            }
            
            const records = parse(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                delimiter: delimiter,
                relax_column_count: true,  // Allow variable column count
                skip_records_with_empty_values: true
            });
            
            console.log('Parsed CSV records:', records.length);
            if (records.length > 0) {
                console.log('First record:', records[0]);
                console.log('Headers found:', Object.keys(records[0]));
            }
            
            const recipients = [];
            const errors = [];
            
            records.forEach((record, index) => {
                // Default column names - be more flexible with variations
                let number = record['WhatsApp Number'] || record['WhatsApp number'] || record['Phone'] || record['Number'] || 
                           record['phone'] || record['number'] || record['Mobile'] || record['mobile'] || 
                           record['Contact'] || record['contact'];
                let name = record['Name'] || record['name'] || record['Full Name'] || record['full name'] || '';
                let jobTitle = record['Job Title'] || record['job_title'] || record['Title'] || record['title'] || 
                              record['Position'] || record['position'] || '';
                let companyName = record['Company Name'] || record['company_name'] || record['Company'] || record['company'] || 
                                 record['Organization'] || record['organization'] || '';
                
                // Apply custom column mapping if provided
                if (columnMapping) {
                    number = record[columnMapping.number] || number;
                    name = record[columnMapping.name] || name;
                    jobTitle = record[columnMapping.jobTitle] || jobTitle;
                    companyName = record[columnMapping.companyName] || companyName;
                }
                
                // Validate phone number
                if (!number) {
                    errors.push(`Row ${index + 2}: Missing phone number. Available columns: ${Object.keys(record).join(', ')}`);
                    return;
                }
                
                // Clean phone number (remove spaces, dashes, plus sign, parentheses)
                number = number.toString().replace(/[\s\-\+\(\)]/g, '');
                
                // Basic phone validation
                if (!/^\d{10,15}$/.test(number)) {
                    errors.push(`Row ${index + 2}: Invalid phone number format: ${number} (should be 10-15 digits)`);
                    return;
                }
                
                // Collect all other fields as custom fields
                const customFields = {};
                Object.keys(record).forEach(key => {
                    const keyLower = key.toLowerCase();
                    if (!['whatsapp number', 'phone', 'number', 'mobile', 'contact', 'name', 'full name', 
                          'job title', 'title', 'position', 'company name', 'company', 'organization'].includes(keyLower)) {
                        customFields[key] = record[key];
                    }
                });
                
                recipients.push({
                    number,
                    name: sanitizeHtml(name || '', { allowedTags: [] }),
                    jobTitle: sanitizeHtml(jobTitle || '', { allowedTags: [] }),
                    companyName: sanitizeHtml(companyName || '', { allowedTags: [] }),
                    customFields,
                    status: 'pending',
                    sentAt: null,
                    error: null
                });
            });
            
            return {
                success: errors.length === 0,
                recipients,
                errors,
                headers: records.length > 0 ? Object.keys(records[0]) : []
            };
        } catch (error) {
            console.error('CSV parsing error details:', error);
            return {
                success: false,
                recipients: [],
                errors: [`CSV parsing error: ${error.message}. Please ensure your CSV file uses comma or semicolon as delimiter and has proper headers.`],
                headers: []
            };
        }
    }

    // Process message template with placeholders
    processTemplate(template, recipient) {
        let processed = template;
        
        // Replace standard placeholders
        processed = processed.replace(/\{\{Name\}\}/g, recipient.name || '');
        processed = processed.replace(/\{\{name\}\}/g, recipient.name || '');
        processed = processed.replace(/\{\{JobTitle\}\}/g, recipient.jobTitle || '');
        processed = processed.replace(/\{\{job_title\}\}/g, recipient.jobTitle || '');
        processed = processed.replace(/\{\{Company\}\}/g, recipient.companyName || '');
        processed = processed.replace(/\{\{company\}\}/g, recipient.companyName || '');
        processed = processed.replace(/\{\{CompanyName\}\}/g, recipient.companyName || '');
        processed = processed.replace(/\{\{company_name\}\}/g, recipient.companyName || '');
        
        // Replace custom field placeholders
        if (recipient.customFields) {
            Object.keys(recipient.customFields).forEach(key => {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                processed = processed.replace(regex, recipient.customFields[key] || '');
            });
        }
        
        return processed;
    }

    // Update recipient status
    updateRecipientStatus(campaignId, recipientNumber, status, error = null) {
        const campaign = this.loadCampaign(campaignId);
        if (!campaign) return;
        
        const recipient = campaign.recipients.find(r => r.number === recipientNumber);
        if (recipient) {
            const oldStatus = recipient.status;
            recipient.status = status;
            recipient.error = error;
            
            if (status === 'sent') {
                recipient.sentAt = new Date().toISOString();
            }
            
            // Update statistics - treat undefined/null as 'pending'
            if (oldStatus !== status) {
                // Decrement old status count
                if (oldStatus === 'sent') campaign.statistics.sent--;
                else if (oldStatus === 'failed') campaign.statistics.failed--;
                else if (oldStatus === 'pending' || oldStatus === undefined || oldStatus === null) campaign.statistics.pending--;
                
                // Increment new status count
                if (status === 'sent') campaign.statistics.sent++;
                else if (status === 'failed') campaign.statistics.failed++;
                else if (status === 'pending') campaign.statistics.pending++;
            }
            
            this.saveCampaign(campaign);
        }
    }

    // Update campaign status
    updateCampaignStatus(campaignId, status) {
        const campaign = this.loadCampaign(campaignId);
        if (!campaign) return;
        
        campaign.status = status;
        if (status === 'sending') {
            campaign.startedAt = new Date().toISOString();
        } else if (status === 'completed') {
            campaign.completedAt = new Date().toISOString();
        }
        
        this.saveCampaign(campaign);
        return campaign;
    }

    // Get recipients for sending
    getPendingRecipients(campaignId, limit = 100) {
        const campaign = this.loadCampaign(campaignId);
        if (!campaign) {
            console.log(`⚠️ Campaign not found: ${campaignId}`);
            return [];
        }
        
        console.log(`🔍 Getting pending recipients for campaign ${campaignId}:`, {
            totalRecipients: campaign.recipients.length,
            recipientDetails: campaign.recipients.map(r => ({
                number: r.number,
                status: r.status,
                retryCount: r.retryCount || 0
            })),
            maxRetries: campaign.settings.maxRetries
        });
        
        const pendingRecipients = campaign.recipients
            .filter(r => 
                r.status === 'pending' || 
                r.status === undefined || 
                r.status === null || 
                (r.status === 'failed' && (!r.retryCount || r.retryCount < campaign.settings.maxRetries))
            )
            .slice(0, limit);
            
        console.log(`📊 Found ${pendingRecipients.length} pending recipients`);
        
        return pendingRecipients;
    }

    // Mark recipient for retry
    markForRetry(campaignId, recipientNumber) {
        const campaign = this.loadCampaign(campaignId);
        if (!campaign) return;
        
        const recipient = campaign.recipients.find(r => r.number === recipientNumber);
        if (recipient) {
            recipient.retryCount = (recipient.retryCount || 0) + 1;
            recipient.status = 'pending';
            recipient.error = null;
            
            // Update statistics
            campaign.statistics.failed--;
            campaign.statistics.pending++;
            
            this.saveCampaign(campaign);
        }
    }

    // Export campaign results to CSV
    exportResults(campaignId) {
        const campaign = this.loadCampaign(campaignId);
        if (!campaign) return null;
        
        const headers = ['Number', 'Name', 'Job Title', 'Company', 'Status', 'Sent At', 'Error'];
        const rows = [headers];
        
        campaign.recipients.forEach(recipient => {
            rows.push([
                recipient.number,
                recipient.name || '',
                recipient.jobTitle || '',
                recipient.companyName || '',
                recipient.status,
                recipient.sentAt || '',
                recipient.error || ''
            ]);
        });
        
        return rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    }
}

module.exports = CampaignManager; 