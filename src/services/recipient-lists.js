const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');

class RecipientListManager {
    constructor(encryptionKey) {
        this.encryptionKey = encryptionKey;
        this.listsDir = path.join(__dirname, 'recipient_lists');
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.listsDir)) {
            fs.mkdirSync(this.listsDir, { recursive: true });
        }
    }

    generateId() {
        return `list_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
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

    // Save recipient list to file
    saveList(list) {
        const filePath = path.join(this.listsDir, `${list.id}.json`);
        const encrypted = this.encrypt(list);
        fs.writeFileSync(filePath, encrypted, 'utf-8');
        
        // Set file permissions (read/write for owner only)
        if (process.platform !== 'win32') {
            fs.chmodSync(filePath, 0o600);
        }
    }

    // Load recipient list from file
    loadList(listId) {
        try {
            const filePath = path.join(this.listsDir, `${listId}.json`);
            if (!fs.existsSync(filePath)) {
                return null;
            }
            
            const encrypted = fs.readFileSync(filePath, 'utf-8');
            return this.decrypt(encrypted);
        } catch (error) {
            console.error('Error loading recipient list:', error);
            return null;
        }
    }

    // Get all recipient lists
    getAllLists(userEmail = null, isAdmin = false) {
        try {
            const files = fs.readdirSync(this.listsDir);
            const lists = [];
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const list = this.loadList(file.replace('.json', ''));
                    if (list) {
                        // Filter by user if not admin
                        if (isAdmin || !userEmail || list.createdBy === userEmail) {
                            // Don't include full recipient list in listing
                            const summary = {
                                ...list,
                                recipients: undefined,
                                recipientCount: list.recipients ? list.recipients.length : 0
                            };
                            lists.push(summary);
                        }
                    }
                }
            }
            
            // Sort by last used date, then creation date (newest first)
            return lists.sort((a, b) => {
                const aDate = new Date(a.lastUsed || a.createdAt);
                const bDate = new Date(b.lastUsed || b.createdAt);
                return bDate - aDate;
            });
        } catch (error) {
            console.error('Error getting recipient lists:', error);
            return [];
        }
    }

    // Create new recipient list
    createList(data) {
        const list = {
            id: this.generateId(),
            name: sanitizeHtml(data.name, { allowedTags: [] }),
            description: sanitizeHtml(data.description || '', { allowedTags: [] }),
            createdBy: data.createdBy,
            createdAt: new Date().toISOString(),
            lastUsed: null,
            usageCount: 0,
            recipients: data.recipients || [],
            tags: data.tags || []
        };
        
        // Validate and sanitize recipients
        list.recipients = list.recipients.map(recipient => this.validateRecipient(recipient)).filter(Boolean);
        
        this.saveList(list);
        return list;
    }

    // Update recipient list
    updateList(listId, updates) {
        const list = this.loadList(listId);
        if (!list) {
            throw new Error('Recipient list not found');
        }
        
        // Update allowed fields
        if (updates.name) list.name = sanitizeHtml(updates.name, { allowedTags: [] });
        if (updates.description !== undefined) list.description = sanitizeHtml(updates.description, { allowedTags: [] });
        if (updates.recipients) {
            list.recipients = updates.recipients.map(recipient => this.validateRecipient(recipient)).filter(Boolean);
        }
        if (updates.tags) list.tags = updates.tags;
        
        list.updatedAt = new Date().toISOString();
        this.saveList(list);
        return list;
    }

    // Delete recipient list
    deleteList(listId) {
        try {
            const filePath = path.join(this.listsDir, `${listId}.json`);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return true;
        } catch (error) {
            console.error('Error deleting recipient list:', error);
            return false;
        }
    }

    // Clone recipient list
    cloneList(listId, newCreatedBy, newName = null) {
        const original = this.loadList(listId);
        if (!original) {
            throw new Error('Recipient list not found');
        }
        
        const cloned = {
            ...original,
            id: this.generateId(),
            name: newName || `${original.name} (Copy)`,
            createdBy: newCreatedBy,
            createdAt: new Date().toISOString(),
            lastUsed: null,
            usageCount: 0
        };
        
        this.saveList(cloned);
        return cloned;
    }

    // Add recipient to list
    addRecipient(listId, recipientData) {
        const list = this.loadList(listId);
        if (!list) {
            throw new Error('Recipient list not found');
        }
        
        const recipient = this.validateRecipient(recipientData);
        if (!recipient) {
            throw new Error('Invalid recipient data');
        }
        
        // Check for duplicates
        const exists = list.recipients.find(r => r.number === recipient.number);
        if (exists) {
            throw new Error('Recipient with this number already exists in the list');
        }
        
        list.recipients.push(recipient);
        list.updatedAt = new Date().toISOString();
        this.saveList(list);
        return list;
    }

    // Remove recipient from list
    removeRecipient(listId, recipientNumber) {
        const list = this.loadList(listId);
        if (!list) {
            throw new Error('Recipient list not found');
        }
        
        const index = list.recipients.findIndex(r => r.number === recipientNumber);
        if (index === -1) {
            throw new Error('Recipient not found in list');
        }
        
        list.recipients.splice(index, 1);
        list.updatedAt = new Date().toISOString();
        this.saveList(list);
        return list;
    }

    // Update recipient in list
    updateRecipient(listId, recipientNumber, updates) {
        const list = this.loadList(listId);
        if (!list) {
            throw new Error('Recipient list not found');
        }
        
        const recipient = list.recipients.find(r => r.number === recipientNumber);
        if (!recipient) {
            throw new Error('Recipient not found in list');
        }
        
        // Update fields
        if (updates.name !== undefined) recipient.name = sanitizeHtml(updates.name, { allowedTags: [] });
        if (updates.jobTitle !== undefined) recipient.jobTitle = sanitizeHtml(updates.jobTitle, { allowedTags: [] });
        if (updates.companyName !== undefined) recipient.companyName = sanitizeHtml(updates.companyName, { allowedTags: [] });
        if (updates.customFields) recipient.customFields = updates.customFields;
        
        list.updatedAt = new Date().toISOString();
        this.saveList(list);
        return list;
    }

    // Mark list as used (for usage tracking)
    markAsUsed(listId) {
        const list = this.loadList(listId);
        if (!list) return;
        
        list.lastUsed = new Date().toISOString();
        list.usageCount = (list.usageCount || 0) + 1;
        this.saveList(list);
    }

    // Validate and sanitize recipient data
    validateRecipient(data) {
        if (!data || !data.number) {
            return null;
        }
        
        // Clean phone number (remove spaces, dashes, plus sign, parentheses)
        let number = data.number.toString().replace(/[\s\-\+\(\)]/g, '');
        
        // Basic phone validation
        if (!/^\d{10,15}$/.test(number)) {
            return null;
        }
        
        return {
            number,
            name: sanitizeHtml(data.name || '', { allowedTags: [] }),
            jobTitle: sanitizeHtml(data.jobTitle || '', { allowedTags: [] }),
            companyName: sanitizeHtml(data.companyName || '', { allowedTags: [] }),
            customFields: data.customFields || {},
            addedAt: new Date().toISOString()
        };
    }

    // Search recipients across all lists
    searchRecipients(query, userEmail = null, isAdmin = false) {
        const lists = this.getAllLists(userEmail, isAdmin);
        const results = [];
        
        const queryLower = query.toLowerCase();
        
        lists.forEach(listSummary => {
            const list = this.loadList(listSummary.id);
            if (list) {
                list.recipients.forEach(recipient => {
                    if (
                        recipient.number.includes(query) ||
                        recipient.name.toLowerCase().includes(queryLower) ||
                        recipient.companyName.toLowerCase().includes(queryLower) ||
                        recipient.jobTitle.toLowerCase().includes(queryLower)
                    ) {
                        results.push({
                            ...recipient,
                            listId: list.id,
                            listName: list.name
                        });
                    }
                });
            }
        });
        
        return results;
    }

    // Get statistics
    getStatistics(userEmail = null, isAdmin = false) {
        const lists = this.getAllLists(userEmail, isAdmin);
        let totalRecipients = 0;
        let totalUsage = 0;
        
        lists.forEach(listSummary => {
            const list = this.loadList(listSummary.id);
            if (list) {
                totalRecipients += list.recipients.length;
                totalUsage += list.usageCount || 0;
            }
        });
        
        return {
            totalLists: lists.length,
            totalRecipients,
            totalUsage,
            averageListSize: lists.length > 0 ? Math.round(totalRecipients / lists.length) : 0
        };
    }
}

module.exports = RecipientListManager; 