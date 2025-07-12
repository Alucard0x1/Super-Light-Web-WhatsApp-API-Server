// Global variables
let currentUser = null;
let sessions = [];
let campaigns = [];
let currentCampaign = null;
let currentStep = 1;
let csvRecipients = []; // Initialize as empty array
let selectedRecipients = [];
let recipientLists = [];
let currentEditingList = null;
let quillEditor = null;
let ws = null;
let activeCampaignId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Campaigns page loaded');
    
    // Clean up any existing intervals on page load
    if (window.campaignUpdateInterval) {
        clearInterval(window.campaignUpdateInterval);
        window.campaignUpdateInterval = null;
    }
    
    // Configure axios to include credentials (cookies) with requests
axios.defaults.withCredentials = true;

// Add axios interceptor for rate limit handling
axios.interceptors.response.use(
    response => response,
    async error => {
        if (error.response && error.response.status === 429) {
            // Rate limited - retry after a delay
            const retryAfter = error.config.retryCount || 0;
            if (retryAfter < 3) {
                error.config.retryCount = retryAfter + 1;
                const delay = Math.pow(2, retryAfter) * 1000; // Exponential backoff: 1s, 2s, 4s
                console.log(`Rate limited, retrying after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return axios(error.config);
            }
        }
        return Promise.reject(error);
    }
);

    await loadUserInfo();
    
    // Add small delays between API calls to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
    await loadSessions();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    await loadCampaigns();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    await loadRecipientLists(); // Load recipient lists
    
    // Set up event listeners
    document.getElementById('csvFile').addEventListener('change', handleCSVUpload);
    document.getElementById('messageType').addEventListener('change', handleMessageTypeChange);
    document.getElementById('searchCampaigns').addEventListener('input', filterCampaigns);
    document.getElementById('filterStatus').addEventListener('change', filterCampaigns);
    
    // Initialize Quill editor
    quillEditor = new Quill('#messageEditor', {
        theme: 'snow',
        placeholder: 'Enter your message here...',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline'],
                ['link'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['clean']
            ]
        }
    });
    
    quillEditor.on('text-change', updateMessagePreview);
    
    // Fix tab visibility if needed
    fixTabVisibility();
    
    setupWebSocket();
});

// Clean up when page is unloaded
window.addEventListener('beforeunload', function() {
    if (window.campaignUpdateInterval) {
        clearInterval(window.campaignUpdateInterval);
    }
});

// Load current user info
async function loadUserInfo() {
    try {
        const response = await axios.get('/api/v1/me');
        currentUser = response.data;
        document.getElementById('currentUserEmail').textContent = currentUser.email;
        
        // Show/hide admin-only features
        if (currentUser.role === 'admin') {
            document.getElementById('usersNavItem').style.display = 'block';
            document.getElementById('activitiesNavItem').style.display = 'block';
        }
        
        return true; // Successfully loaded
    } catch (error) {
        console.error('Error loading user info:', error);
        console.error('Error details:', error.response?.data || error.message);
        
        // Only redirect to login if we're sure it's an auth issue
        if (error.response?.status === 401 || error.response?.status === 403) {
            window.location.href = '/admin/login.html';
            return false;
        }
        
        // For other errors, try to continue
        showAlert('Error loading user information', 'warning');
        return false;
    }
}

// Load WhatsApp sessions
async function loadSessions() {
    try {
        console.log('Loading sessions...');
        const response = await axios.get('/api/v1/sessions');
        sessions = response.data; // The response is already an array
        console.log('Sessions loaded:', sessions);
        
        // Update session dropdown
        const sessionSelect = document.getElementById('sessionId');
        if (sessionSelect) {
            sessionSelect.innerHTML = '<option value="">Select a session...</option>';
            sessions.forEach(session => {
                if (session.status === 'CONNECTED') {
                    const option = document.createElement('option');
                    option.value = session.sessionId;
                    option.textContent = `${session.sessionId} - ${session.detail || 'Connected'}`;
                    sessionSelect.appendChild(option);
                }
            });
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
        console.error('Error details:', error.response?.data || error.message);
        showAlert('Error loading WhatsApp sessions', 'danger');
    }
}

// Load campaigns
async function loadCampaigns() {
    try {
        const response = await axios.get('/api/v1/campaigns');
        campaigns = response.data;
        displayCampaigns();
    } catch (error) {
        console.error('Error loading campaigns:', error);
        console.error('Error details:', error.response?.data || error.message);
        
        // Only redirect to login if we get a specific authentication error
        if (error.response?.status === 401 && error.response?.data?.message?.includes('Authentication required')) {
            window.location.href = '/admin/login.html';
        } else {
            // For other errors, just show alert but don't logout
            const errorMsg = error.response?.data?.message || 'Error loading campaigns';
            showAlert(errorMsg, 'danger');
            
            // Still try to display empty state
            campaigns = [];
            displayCampaigns();
        }
    }
}

// Display campaigns
function displayCampaigns() {
    const grid = document.getElementById('campaignsGrid');
    grid.innerHTML = '';
    
    if (campaigns.length === 0) {
        grid.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-megaphone" style="font-size: 4rem; color: #dee2e6;"></i>
                <h4 class="mt-3 text-muted">No campaigns yet</h4>
                <p class="text-muted">Create your first campaign to start sending bulk messages</p>
                <button class="btn btn-success mt-2" onclick="showCreateCampaign()">
                    <i class="bi bi-plus-circle"></i> Create Campaign
                </button>
            </div>
        `;
        return;
    }
    
    campaigns.forEach(campaign => {
        const card = createCampaignCard(campaign);
        grid.innerHTML += card;
    });
}

// Create campaign card HTML
function createCampaignCard(campaign) {
    const statusColors = {
        draft: 'secondary',
        ready: 'info',
        scheduled: 'info',
        sending: 'primary',
        paused: 'warning',
        completed: 'success'
    };
    
    const statusColor = statusColors[campaign.status] || 'secondary';
    const progress = campaign.statistics.total > 0 ? 
        Math.round(((campaign.statistics.sent + campaign.statistics.failed) / campaign.statistics.total) * 100) : 0;
    
    return `
        <div class="col-md-6 col-lg-4">
            <div class="campaign-card card">
                <div class="campaign-header">
                    <div>
                        <h5 class="mb-0">${escapeHtml(campaign.name)}</h5>
                        <small>${new Date(campaign.createdAt).toLocaleDateString()}</small>
                    </div>
                    <span class="campaign-status">${campaign.status.toUpperCase()}</span>
                </div>
                
                ${campaign.status === 'draft' ? `
                    <div class="p-3 text-center">
                        <i class="bi bi-pencil-square" style="font-size: 2rem; color: #6c757d;"></i>
                        <p class="mt-2 mb-0 text-muted">Draft campaign - Click Edit to continue</p>
                    </div>
                ` : `
                    <div class="campaign-stats">
                        <div class="stat">
                            <span class="stat-value">${campaign.recipientCount || 0}</span>
                            <span class="stat-label">Total</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value text-success">${campaign.statistics.sent}</span>
                            <span class="stat-label">Sent</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value text-danger">${campaign.statistics.failed}</span>
                            <span class="stat-label">Failed</span>
                        </div>
                    </div>
                `}
                
                ${campaign.status === 'sending' || campaign.status === 'paused' ? `
                    <div class="px-3 pb-3">
                        <div class="progress">
                            <div class="progress-bar bg-${statusColor}" style="width: ${progress}%">${progress}%</div>
                        </div>
                    </div>
                ` : ''}
                
                <div class="campaign-actions">
                    <button class="btn btn-sm btn-outline-primary" onclick="viewCampaign('${campaign.id}')">
                        <i class="bi bi-eye"></i> View
                    </button>
                    ${campaign.status === 'draft' ? `
                        <button class="btn btn-sm btn-outline-info" onclick="editCampaign('${campaign.id}')">
                            <i class="bi bi-pencil"></i> Edit
                        </button>
                        <button class="btn btn-sm btn-outline-success" onclick="sendCampaign('${campaign.id}')">
                            <i class="bi bi-send"></i> Send
                        </button>
                    ` : ''}
                    ${campaign.status === 'sending' ? `
                        <button class="btn btn-sm btn-outline-warning" onclick="pauseCampaign('${campaign.id}')">
                            <i class="bi bi-pause"></i> Pause
                        </button>
                    ` : ''}
                    ${campaign.status === 'paused' ? `
                        <button class="btn btn-sm btn-outline-success" onclick="resumeCampaign('${campaign.id}')">
                            <i class="bi bi-play"></i> Resume
                        </button>
                    ` : ''}
                    ${campaign.status === 'completed' && campaign.statistics.failed > 0 ? `
                        <button class="btn btn-sm btn-outline-warning" onclick="retryCampaign('${campaign.id}')">
                            <i class="bi bi-arrow-clockwise"></i> Retry Failed
                        </button>
                    ` : ''}
                    <button class="btn btn-sm btn-outline-secondary" onclick="cloneCampaign('${campaign.id}')">
                        <i class="bi bi-files"></i> Clone
                    </button>
                    ${currentUser.role === 'admin' || campaign.createdBy === currentUser.email ? `
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteCampaign('${campaign.id}')">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

// Show create campaign wizard
function showCreateCampaign() {
    currentCampaign = null;
    currentStep = 1;
    csvRecipients = [];
    
    document.getElementById('campaignListView').style.display = 'none';
    document.getElementById('campaignDetailView').style.display = 'none';
    document.getElementById('campaignWizard').style.display = 'block';
    
    // Reset wizard title
    document.getElementById('wizardTitle').textContent = 'Create New Campaign';
    
    // Reset form
    document.getElementById('basicInfoForm').reset();
    document.getElementById('csvFile').value = '';
    document.getElementById('csvPreview').style.display = 'none';
    quillEditor.setText('');
    
    // Remove any media notes
    const mediaNote = document.getElementById('mediaNote');
    if (mediaNote) mediaNote.remove();
    
    updateWizardStep(1);
}

// Update wizard step
function updateWizardStep(step) {
    currentStep = step;
    
    // Update step indicators
    document.querySelectorAll('.wizard-step').forEach((el, index) => {
        if (index + 1 < step) {
            el.classList.add('completed');
            el.classList.remove('active');
        } else if (index + 1 === step) {
            el.classList.add('active');
            el.classList.remove('completed');
        } else {
            el.classList.remove('active', 'completed');
        }
    });
    
    // Show/hide containers
    document.querySelectorAll('.wizard-container').forEach(el => {
        el.classList.remove('active');
    });
    document.querySelector(`.wizard-container[data-step="${step}"]`).classList.add('active');
    
    // Update navigation buttons
    document.getElementById('prevBtn').style.display = step > 1 ? 'inline-block' : 'none';
    document.getElementById('nextBtn').style.display = step < 4 ? 'inline-block' : 'none';
    document.getElementById('createBtn').style.display = step === 4 ? 'inline-block' : 'none';
}

// Navigate wizard
function nextStep() {
    if (validateCurrentStep()) {
        if (currentStep === 3) {
            prepareReview();
        }
        updateWizardStep(currentStep + 1);
    }
}

function previousStep() {
    updateWizardStep(currentStep - 1);
}

// Validate current step
function validateCurrentStep() {
    console.log('Validating step:', currentStep);
    
    switch (currentStep) {
        case 1:
            if (!document.getElementById('campaignName').value) {
                showAlert('Please enter campaign name', 'warning');
                return false;
            }
            if (!document.getElementById('sessionId').value) {
                showAlert('Please select WhatsApp session', 'warning');
                return false;
            }
            return true;
            
        case 2:
            // Check if recipients are selected from either recipient lists or CSV
            const hasSelectedRecipients = selectedRecipients.length > 0;
            const hasCSVRecipients = csvRecipients.length > 0;
            
            console.log('Validating recipients:', {
                selectedRecipients: selectedRecipients.length,
                csvRecipients: csvRecipients.length,
                hasSelectedRecipients,
                hasCSVRecipients
            });
            
            if (!hasSelectedRecipients && !hasCSVRecipients) {
                showAlert('Please select a recipient list or upload a CSV file with recipients', 'warning');
                return false;
            }
            
            // Use selected recipients or fall back to CSV recipients
            if (hasSelectedRecipients && !hasCSVRecipients) {
                csvRecipients = selectedRecipients; // Sync for campaign creation
            }
            
            return true;
            
        case 3:
            if (!quillEditor.getText().trim()) {
                showAlert('Please enter message content', 'warning');
                return false;
            }
            return true;
            
        default:
            return true;
    }
}

// Handle CSV upload
async function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    console.log('CSV file selected:', file.name, 'Size:', file.size);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        console.log('Uploading CSV to server...');
        const response = await axios.post('/api/v1/campaigns/preview-csv', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        console.log('Server response:', response);
        const result = response.data;
        
        if (result.success) {
            csvRecipients = result.recipients;
            displayCSVPreview(result.recipients);
            document.getElementById('recipientCount').textContent = result.recipients.length;
            document.getElementById('csvPreview').style.display = 'block';
            document.getElementById('csvErrors').style.display = 'none';
            console.log('CSV upload successful, recipients:', csvRecipients.length);
        } else {
            document.getElementById('csvErrors').innerHTML = 
                '<strong>Errors found:</strong><br>' + result.errors.join('<br>');
            document.getElementById('csvErrors').style.display = 'block';
            console.log('CSV upload failed, errors:', result.errors);
        }
    } catch (error) {
        console.error('Error uploading CSV:', error);
        console.error('Error details:', error.response?.data || error.message);
        
        // Check if it's an authentication error
        if (error.response?.status === 401) {
            showAlert('Session expired. Please refresh the page and log in again.', 'danger');
            setTimeout(() => {
                window.location.href = '/admin/login.html';
            }, 2000);
        } else {
            showAlert('Error processing CSV file: ' + (error.response?.data?.message || error.message), 'danger');
        }
    }
}

// Display CSV preview
function displayCSVPreview(recipients) {
    const table = document.getElementById('csvPreviewTable');
    const preview = recipients.slice(0, 10);
    
    let html = `
        <thead>
            <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Job Title</th>
                <th>Company</th>
            </tr>
        </thead>
        <tbody>
    `;
    
    preview.forEach(recipient => {
        html += `
            <tr>
                <td>${escapeHtml(recipient.number)}</td>
                <td>${escapeHtml(recipient.name || '-')}</td>
                <td>${escapeHtml(recipient.jobTitle || '-')}</td>
                <td>${escapeHtml(recipient.companyName || '-')}</td>
            </tr>
        `;
    });
    
    if (recipients.length > 10) {
        html += `
            <tr>
                <td colspan="4" class="text-center text-muted">
                    ... and ${recipients.length - 10} more recipients
                </td>
            </tr>
        `;
    }
    
    html += '</tbody>';
    table.innerHTML = html;
}

// Download CSV template
function downloadCSVTemplate() {
    // Create CSV content with sample data
    const csvContent = `WhatsApp Number,Name,Job Title,Company Name
+1234567890,John Doe,Sales Manager,ABC Corporation
+0987654321,Jane Smith,Marketing Director,XYZ Company
+1122334455,Bob Johnson,CEO,Startup Inc
+5544332211,Alice Brown,CTO,Tech Solutions
+9988776655,Charlie Davis,Product Manager,Innovation Labs`;
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', 'whatsapp_campaign_template.csv');
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Show success message
    showAlert('CSV template downloaded! Please fill it with your recipient data.', 'success');
}

// Handle message type change
function handleMessageTypeChange() {
    const messageType = document.getElementById('messageType').value;
    document.getElementById('mediaUploadSection').style.display = 
        messageType !== 'text' ? 'block' : 'none';
}

// Insert placeholder into editor
function insertPlaceholder(placeholder) {
    const range = quillEditor.getSelection(true);
    quillEditor.insertText(range.index, placeholder, 'user');
    quillEditor.setSelection(range.index + placeholder.length);
    updateMessagePreview();
}

// Update message preview
function updateMessagePreview() {
    const content = quillEditor.root.innerHTML;
    const sampleRecipient = csvRecipients[0] || {
        name: 'John Doe',
        jobTitle: 'Manager',
        companyName: 'Example Corp'
    };
    
    let preview = content
        .replace(/\{\{Name\}\}/g, sampleRecipient.name)
        .replace(/\{\{name\}\}/g, sampleRecipient.name)
        .replace(/\{\{JobTitle\}\}/g, sampleRecipient.jobTitle)
        .replace(/\{\{job_title\}\}/g, sampleRecipient.jobTitle)
        .replace(/\{\{Company\}\}/g, sampleRecipient.companyName)
        .replace(/\{\{company\}\}/g, sampleRecipient.companyName);
    
    document.getElementById('messagePreview').innerHTML = preview;
}

// Prepare review step
function prepareReview() {
    document.getElementById('reviewName').textContent = document.getElementById('campaignName').value;
    document.getElementById('reviewSession').textContent = 
        document.getElementById('sessionId').options[document.getElementById('sessionId').selectedIndex].text;
    document.getElementById('reviewRecipients').textContent = `${csvRecipients.length} recipients`;
    document.getElementById('reviewMessageType').textContent = 
        document.getElementById('messageType').options[document.getElementById('messageType').selectedIndex].text;
    
    const scheduledAt = document.getElementById('scheduledAt').value;
    document.getElementById('reviewSchedule').textContent = 
        scheduledAt ? new Date(scheduledAt).toLocaleString() : 'Send immediately';
}

// Create campaign
async function createCampaign() {
    const campaignData = {
        name: document.getElementById('campaignName').value,
        sessionId: document.getElementById('sessionId').value,
        scheduledAt: document.getElementById('scheduledAt').value || null,
        message: {
            type: document.getElementById('messageType').value,
            content: quillEditor.root.innerHTML
        },
        recipients: csvRecipients,
        settings: {
            delayBetweenMessages: parseInt(document.getElementById('delayBetweenMessages').value) * 1000
        },
        status: 'ready' // Mark as ready when creating from wizard completion
    };
    
    // Handle media upload if needed
    if (campaignData.message.type !== 'text') {
        const mediaFile = document.getElementById('mediaFile').files[0];
        if (mediaFile) {
            try {
                const mediaFormData = new FormData();
                mediaFormData.append('file', mediaFile);
                
                const mediaResponse = await axios.post('/api/v1/media', mediaFormData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                
                campaignData.message.mediaUrl = `/media/${mediaResponse.data.mediaId}`;
            } catch (error) {
                console.error('Error uploading media:', error);
                showAlert('Error uploading media file', 'danger');
                return;
            }
        } else if (currentCampaign?.message?.mediaUrl) {
            // Keep existing media URL if editing
            campaignData.message.mediaUrl = currentCampaign.message.mediaUrl;
        }
    }
    
    try {
        let response;
        if (currentCampaign && currentCampaign.id) {
            // Update existing campaign
            response = await axios.put(`/api/v1/campaigns/${currentCampaign.id}`, campaignData);
            showAlert('Campaign updated successfully!', 'success');
        } else {
            // Create new campaign
            response = await axios.post('/api/v1/campaigns', campaignData);
            showAlert('Campaign created successfully!', 'success');
        }
        
        // Ask if user wants to send now
        if (!campaignData.scheduledAt) {
            if (confirm('Campaign ready! Do you want to start sending now?')) {
                await sendCampaign(response.data.id);
            } else {
                backToList();
            }
        } else {
            backToList();
        }
    } catch (error) {
        console.error('Error saving campaign:', error);
        showAlert('Error saving campaign', 'danger');
    }
}

// Send campaign
async function sendCampaign(campaignId) {
    if (!confirm('Are you sure you want to start sending this campaign?')) {
        return;
    }
    
    try {
        await axios.post(`/api/v1/campaigns/${campaignId}/send`);
        showAlert('Campaign started!', 'success');
        activeCampaignId = campaignId;
        showProgress(campaignId);
        await loadCampaigns();
    } catch (error) {
        console.error('Error starting campaign:', error);
        showAlert(error.response?.data?.message || 'Error starting campaign', 'danger');
    }
}

// Pause campaign
async function pauseCampaign(campaignId) {
    campaignId = campaignId || activeCampaignId;
    if (!campaignId) return;
    
    try {
        await axios.post(`/api/v1/campaigns/${campaignId}/pause`);
        showAlert('Campaign paused', 'info');
        
        // If we're in detail view, refresh it
        if (document.getElementById('campaignDetailView').style.display !== 'none') {
            setTimeout(() => refreshCampaignView(campaignId), 500);
        } else {
            await loadCampaigns();
        }
    } catch (error) {
        console.error('Error pausing campaign:', error);
        showAlert('Error pausing campaign', 'danger');
    }
}

// Resume campaign
async function resumeCampaign(campaignId) {
    try {
        await axios.post(`/api/v1/campaigns/${campaignId}/resume`);
        showAlert('Campaign resumed', 'success');
        activeCampaignId = campaignId;
        
        // If we're in detail view, refresh it and start updates
        if (document.getElementById('campaignDetailView').style.display !== 'none') {
            setTimeout(() => refreshCampaignView(campaignId), 500);
        } else {
            showProgress(campaignId);
            await loadCampaigns();
        }
    } catch (error) {
        console.error('Error resuming campaign:', error);
        showAlert('Error resuming campaign', 'danger');
    }
}

// Retry failed messages
async function retryCampaign(campaignId) {
    if (!confirm('Retry sending to all failed recipients?')) {
        return;
    }
    
    try {
        const response = await axios.post(`/api/v1/campaigns/${campaignId}/retry`);
        showAlert(`Retrying ${response.data.retryCount} failed messages`, 'info');
        if (response.data.status === 'retrying') {
            activeCampaignId = campaignId;
            
            // If we're in detail view, refresh it
            if (document.getElementById('campaignDetailView').style.display !== 'none') {
                setTimeout(() => refreshCampaignView(campaignId), 500);
            } else {
                showProgress(campaignId);
            }
        }
        
        // Refresh campaigns list if not in detail view
        if (document.getElementById('campaignDetailView').style.display === 'none') {
            await loadCampaigns();
        }
    } catch (error) {
        console.error('Error retrying campaign:', error);
        showAlert('Error retrying campaign', 'danger');
    }
}

// Clone campaign
async function cloneCampaign(campaignId) {
    try {
        await axios.post(`/api/v1/campaigns/${campaignId}/clone`);
        showAlert('Campaign cloned successfully', 'success');
        await loadCampaigns();
    } catch (error) {
        console.error('Error cloning campaign:', error);
        showAlert('Error cloning campaign', 'danger');
    }
}

// Delete campaign
async function deleteCampaign(campaignId) {
    if (!confirm('Are you sure you want to delete this campaign?')) {
        return;
    }
    
    try {
        await axios.delete(`/api/v1/campaigns/${campaignId}`);
        showAlert('Campaign deleted', 'success');
        await loadCampaigns();
    } catch (error) {
        console.error('Error deleting campaign:', error);
        showAlert('Error deleting campaign', 'danger');
    }
}

// Save campaign as draft
async function saveDraft() {
    const saveDraftBtn = document.getElementById('saveDraftBtn');
    const originalText = saveDraftBtn.innerHTML;
    
    try {
        // Show loading state
        saveDraftBtn.disabled = true;
        saveDraftBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
        
        // Collect data from current state
        const campaignData = {
            name: document.getElementById('campaignName').value || 'Untitled Campaign',
            sessionId: document.getElementById('sessionId').value || '',
            scheduledAt: document.getElementById('scheduledAt').value || null,
            message: {
                type: document.getElementById('messageType').value || 'text',
                content: quillEditor.root.innerHTML || '',
                mediaUrl: null,
                mediaCaption: null
            },
            recipients: csvRecipients.length > 0 ? csvRecipients : [],
            settings: {
                delayBetweenMessages: parseInt(document.getElementById('delayBetweenMessages').value || 3) * 1000,
                retryFailedMessages: true,
                maxRetries: 3
            },
            status: 'draft'
        };
        
        // Handle media if present
        if (campaignData.message.type !== 'text') {
            const mediaFile = document.getElementById('mediaFile').files[0];
            if (mediaFile && !currentCampaign?.message?.mediaUrl) {
                try {
                    const mediaFormData = new FormData();
                    mediaFormData.append('file', mediaFile);
                    
                    const mediaResponse = await axios.post('/api/v1/media', mediaFormData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    
                    campaignData.message.mediaUrl = `/media/${mediaResponse.data.mediaId}`;
                } catch (error) {
                    console.error('Error uploading media:', error);
                }
            } else if (currentCampaign?.message?.mediaUrl) {
                campaignData.message.mediaUrl = currentCampaign.message.mediaUrl;
            }
        }
        
        let response;
        if (currentCampaign && currentCampaign.id) {
            // Update existing draft
            response = await axios.put(`/api/v1/campaigns/${currentCampaign.id}`, campaignData);
            showAlert('Draft updated successfully!', 'success');
        } else {
            // Create new draft
            response = await axios.post('/api/v1/campaigns', campaignData);
            currentCampaign = response.data;
            showAlert('Draft saved successfully!', 'success');
        }
        
        // Update the wizard title to show we're editing
        document.getElementById('wizardTitle').textContent = 'Edit Campaign Draft';
        
        // Restore button state
        saveDraftBtn.disabled = false;
        saveDraftBtn.innerHTML = originalText;
        
    } catch (error) {
        console.error('Error saving draft:', error);
        console.error('Error details:', error.response?.data || error.message);
        
        const errorMessage = error.response?.data?.message || error.response?.data?.error || 'Error saving draft';
        showAlert(errorMessage, 'danger');
        
        // Restore button state
        saveDraftBtn.disabled = false;
        saveDraftBtn.innerHTML = originalText;
    }
}

// Edit campaign (load draft into wizard)
async function editCampaign(campaignId) {
    try {
        const response = await axios.get(`/api/v1/campaigns/${campaignId}`);
        const campaign = response.data;
        
        if (campaign.status !== 'draft') {
            showAlert('Only draft campaigns can be edited', 'warning');
            return;
        }
        
        // Set current campaign
        currentCampaign = campaign;
        
        // Show wizard
        document.getElementById('campaignListView').style.display = 'none';
        document.getElementById('campaignDetailView').style.display = 'none';
        document.getElementById('campaignWizard').style.display = 'block';
        
        // Update wizard title
        document.getElementById('wizardTitle').textContent = 'Edit Campaign Draft';
        
        // Load data into form fields
        document.getElementById('campaignName').value = campaign.name || '';
        document.getElementById('sessionId').value = campaign.sessionId || '';
        document.getElementById('scheduledAt').value = campaign.scheduledAt || '';
        document.getElementById('delayBetweenMessages').value = (campaign.settings?.delayBetweenMessages || 3000) / 1000;
        
        // Load recipients
        if (campaign.recipients && campaign.recipients.length > 0) {
            csvRecipients = campaign.recipients;
            displayCSVPreview(campaign.recipients);
            document.getElementById('recipientCount').textContent = campaign.recipients.length;
            document.getElementById('csvPreview').style.display = 'block';
        }
        
        // Load message
        document.getElementById('messageType').value = campaign.message?.type || 'text';
        handleMessageTypeChange();
        
        if (campaign.message?.content) {
            quillEditor.root.innerHTML = campaign.message.content;
            updateMessagePreview();
        }
        
        // Note: Media file cannot be pre-loaded into file input, but we'll keep the mediaUrl
        if (campaign.message?.mediaUrl) {
            // Show a note that media is already uploaded
            const mediaSection = document.getElementById('mediaUploadSection');
            if (mediaSection.style.display !== 'none') {
                const note = document.createElement('div');
                note.className = 'alert alert-info mt-2';
                note.innerHTML = `<i class="bi bi-info-circle"></i> Media already uploaded. Leave empty to keep existing media.`;
                note.id = 'mediaNote';
                
                // Remove existing note if any
                const existingNote = document.getElementById('mediaNote');
                if (existingNote) existingNote.remove();
                
                mediaSection.appendChild(note);
            }
        }
        
        // Start at step 1
        updateWizardStep(1);
        
    } catch (error) {
        console.error('Error loading campaign for editing:', error);
        showAlert('Error loading campaign', 'danger');
    }
}

// View campaign details
async function viewCampaign(campaignId) {
    try {
        const response = await axios.get(`/api/v1/campaigns/${campaignId}`);
        const campaign = response.data;
        
        // Hide other views
        document.getElementById('campaignListView').style.display = 'none';
        document.getElementById('campaignWizard').style.display = 'none';
        document.getElementById('campaignDetailView').style.display = 'block';
        
        // Display campaign details
        document.getElementById('campaignDetailView').innerHTML = createCampaignDetailView(campaign);
        
    } catch (error) {
        console.error('Error loading campaign details:', error);
        showAlert('Error loading campaign details', 'danger');
    }
}

// Create campaign detail view
function createCampaignDetailView(campaign) {
    const canSend = ['ready', 'draft'].includes(campaign.status);
    const canPause = campaign.status === 'sending';
    const canResume = campaign.status === 'paused';
    const canRetry = campaign.status === 'completed' && campaign.statistics.failed > 0;
    
    return `
        <div class="row mb-4">
            <div class="col">
                <button class="btn btn-secondary" onclick="backToList()">
                    <i class="bi bi-arrow-left"></i> Back to Campaigns
                </button>
            </div>
            <div class="col-auto">
                <div class="btn-group">
                    ${canSend ? `
                        <button class="btn btn-success" onclick="sendCampaignFromDetail('${campaign.id}')">
                            <i class="bi bi-send-fill"></i> Send Campaign Now
                        </button>
                    ` : ''}
                    ${canPause ? `
                        <button class="btn btn-warning" onclick="pauseCampaign('${campaign.id}')">
                            <i class="bi bi-pause-fill"></i> Pause Campaign
                        </button>
                    ` : ''}
                    ${canResume ? `
                        <button class="btn btn-success" onclick="resumeCampaign('${campaign.id}')">
                            <i class="bi bi-play-fill"></i> Resume Campaign
                        </button>
                    ` : ''}
                    ${canRetry ? `
                        <button class="btn btn-warning" onclick="retryCampaign('${campaign.id}')">
                            <i class="bi bi-arrow-clockwise"></i> Retry Failed
                        </button>
                    ` : ''}
                    <a href="/api/v1/campaigns/${campaign.id}/export" class="btn btn-outline-primary">
                        <i class="bi bi-download"></i> Export Results
                    </a>
                </div>
            </div>
        </div>
        
        <!-- Progress Indicator for sending campaigns -->
        ${['sending', 'paused'].includes(campaign.status) ? `
            <div class="row mb-4" id="inlineProgress">
                <div class="col">
                    <div class="card border-info">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <h6 class="mb-0">
                                    <i class="bi bi-broadcast text-info"></i> 
                                    Campaign ${campaign.status === 'sending' ? 'Sending' : 'Paused'}
                                </h6>
                                <span class="badge bg-info" id="progressPercentage">
                                    ${Math.round(((campaign.statistics.sent + campaign.statistics.failed) / campaign.statistics.total) * 100)}%
                                </span>
                            </div>
                            <div class="progress mb-2">
                                <div class="progress-bar progress-bar-striped ${campaign.status === 'sending' ? 'progress-bar-animated' : ''}" 
                                     style="width: ${Math.round(((campaign.statistics.sent + campaign.statistics.failed) / campaign.statistics.total) * 100)}%"
                                     id="inlineProgressBar">
                                </div>
                            </div>
                            <div class="row text-center">
                                <div class="col">
                                    <small class="text-muted">Sent</small><br>
                                    <strong class="text-success" id="inlineSent">${campaign.statistics.sent}</strong>
                                </div>
                                <div class="col">
                                    <small class="text-muted">Failed</small><br>
                                    <strong class="text-danger" id="inlineFailed">${campaign.statistics.failed}</strong>
                                </div>
                                <div class="col">
                                    <small class="text-muted">Remaining</small><br>
                                    <strong class="text-warning" id="inlinePending">${campaign.statistics.pending}</strong>
                                </div>
                                <div class="col">
                                    <small class="text-muted">Speed</small><br>
                                    <strong class="text-info" id="inlineSpeed">-- msgs/min</strong>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        ` : ''}
        
        <div class="row">
            <div class="col-lg-8">
                <div class="card mb-4">
                    <div class="card-header">
                        <h4>${escapeHtml(campaign.name)}</h4>
                    </div>
                    <div class="card-body">
                        <dl class="row">
                            <dt class="col-sm-3">Status:</dt>
                            <dd class="col-sm-9"><span class="badge bg-primary">${campaign.status}</span></dd>
                            
                            <dt class="col-sm-3">Created:</dt>
                            <dd class="col-sm-9">${new Date(campaign.createdAt).toLocaleString()}</dd>
                            
                            <dt class="col-sm-3">Created By:</dt>
                            <dd class="col-sm-9">${campaign.createdBy}</dd>
                            
                            <dt class="col-sm-3">Session:</dt>
                            <dd class="col-sm-9">${campaign.sessionId}</dd>
                            
                            <dt class="col-sm-3">Message Type:</dt>
                            <dd class="col-sm-9">${campaign.message.type}</dd>
                            
                            ${campaign.scheduledAt ? `
                                <dt class="col-sm-3">Scheduled At:</dt>
                                <dd class="col-sm-9">${new Date(campaign.scheduledAt).toLocaleString()}</dd>
                            ` : ''}
                            
                            <dt class="col-sm-3">Delay Between Messages:</dt>
                            <dd class="col-sm-9">${(campaign.settings?.delayBetweenMessages || 3000) / 1000} seconds</dd>
                        </dl>
                        
                        <h5>Message Content:</h5>
                        <div class="border rounded p-3 bg-light">
                            ${formatMessageContentForDisplay(campaign.message.content)}
                        </div>
                        
                        ${campaign.message.mediaUrl ? `
                            <h6 class="mt-3">Media:</h6>
                            <div class="border rounded p-3 bg-light">
                                <i class="bi bi-paperclip"></i> Media file attached
                                <a href="${campaign.message.mediaUrl}" target="_blank" class="btn btn-sm btn-outline-primary ms-2">
                                    <i class="bi bi-eye"></i> View
                                </a>
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h5 class="mb-0">Recipients</h5>
                        <div>
                            <button class="btn btn-sm btn-outline-secondary" onclick="refreshCampaignView('${campaign.id}')">
                                <i class="bi bi-arrow-clockwise"></i> Refresh
                            </button>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="recipients-table">
                            <table class="table table-sm" id="recipientsTable">
                                <thead>
                                    <tr>
                                        <th>Number</th>
                                        <th>Name</th>
                                        <th>Status</th>
                                        <th>Sent At</th>
                                        <th>Error</th>
                                    </tr>
                                </thead>
                                <tbody id="recipientsTableBody">
                                    ${campaign.recipients.map(r => `
                                        <tr data-number="${r.number}">
                                            <td>${escapeHtml(r.number)}</td>
                                            <td>${escapeHtml(r.name || '-')}</td>
                                            <td><span class="status-badge ${r.status || 'pending'}">${r.status || 'pending'}</span></td>
                                            <td>${r.sentAt ? new Date(r.sentAt).toLocaleString() : '-'}</td>
                                            <td>${r.error ? `<small class="text-danger">${escapeHtml(r.error)}</small>` : '-'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="col-lg-4">
                <div class="card">
                    <div class="card-header">
                        <h5>Statistics</h5>
                    </div>
                    <div class="card-body">
                        <div class="row text-center mb-3">
                            <div class="col-6">
                                <div class="border rounded p-3">
                                    <h3 class="text-primary mb-0" id="statTotal">${campaign.statistics.total}</h3>
                                    <small class="text-muted">Total</small>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="border rounded p-3">
                                    <h3 class="text-success mb-0" id="statSent">${campaign.statistics.sent}</h3>
                                    <small class="text-muted">Sent</small>
                                </div>
                            </div>
                        </div>
                        <div class="row text-center">
                            <div class="col-6">
                                <div class="border rounded p-3">
                                    <h3 class="text-danger mb-0" id="statFailed">${campaign.statistics.failed}</h3>
                                    <small class="text-muted">Failed</small>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="border rounded p-3">
                                    <h3 class="text-warning mb-0" id="statPending">${campaign.statistics.pending}</h3>
                                    <small class="text-muted">Pending</small>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Success Rate -->
                        <div class="mt-4">
                            <div class="d-flex justify-content-between">
                                <span>Success Rate</span>
                                <span>${campaign.statistics.total > 0 ? Math.round((campaign.statistics.sent / campaign.statistics.total) * 100) : 0}%</span>
                            </div>
                            <div class="progress mt-1">
                                <div class="progress-bar bg-success" 
                                     style="width: ${campaign.statistics.total > 0 ? Math.round((campaign.statistics.sent / campaign.statistics.total) * 100) : 0}%">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Campaign Actions -->
                <div class="card mt-3">
                    <div class="card-header">
                        <h6>Quick Actions</h6>
                    </div>
                    <div class="card-body">
                        <div class="d-grid gap-2">
                            <button class="btn btn-outline-info btn-sm" onclick="cloneCampaign('${campaign.id}')">
                                <i class="bi bi-files"></i> Clone Campaign
                            </button>
                            ${currentUser && (currentUser.role === 'admin' || campaign.createdBy === currentUser.email) ? `
                                <button class="btn btn-outline-danger btn-sm" onclick="deleteCampaign('${campaign.id}')">
                                    <i class="bi bi-trash"></i> Delete Campaign
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Filter campaigns
function filterCampaigns() {
    const searchTerm = document.getElementById('searchCampaigns').value.toLowerCase();
    const statusFilter = document.getElementById('filterStatus').value;
    
    const filtered = campaigns.filter(campaign => {
        const matchesSearch = campaign.name.toLowerCase().includes(searchTerm);
        const matchesStatus = !statusFilter || campaign.status === statusFilter;
        return matchesSearch && matchesStatus;
    });
    
    campaigns = filtered;
    displayCampaigns();
    campaigns = []; // Reset for next load
    loadCampaigns();
}

// Show progress container
function showProgress(campaignId) {
    const campaign = campaigns.find(c => c.id === campaignId);
    if (!campaign) return;
    
    document.getElementById('progressCampaignName').textContent = campaign.name;
    document.getElementById('progressTotal').textContent = campaign.statistics.total;
    document.getElementById('progressContainer').style.display = 'block';
    
    updateProgress(campaign.statistics);
}

// Update progress
function updateProgress(stats) {
    const total = stats.total || 1;
    const processed = stats.sent + stats.failed;
    const progress = Math.round((processed / total) * 100);
    
    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('progressBar').textContent = `${progress}%`;
    document.getElementById('progressSent').textContent = stats.sent;
    document.getElementById('progressFailed').textContent = stats.failed;
}

// Hide progress
function hideProgress() {
    document.getElementById('progressContainer').style.display = 'none';
}

// Back to list view
function backToList() {
    // Clean up any active real-time updates
    if (window.campaignUpdateInterval) {
        clearInterval(window.campaignUpdateInterval);
        window.campaignUpdateInterval = null;
    }
    
    // Reset speed calculation tracking
    window.lastStatsUpdate = null;
    
    document.getElementById('campaignListView').style.display = 'block';
    document.getElementById('campaignWizard').style.display = 'none';
    document.getElementById('campaignDetailView').style.display = 'none';
    loadCampaigns();
}

// Setup WebSocket for real-time updates
function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'campaign-progress' && data.campaignId === activeCampaignId) {
            updateProgress(data.statistics);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting in 5s...');
        setTimeout(setupWebSocket, 5000);
    };
}

// Show alert
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3`;
    alertDiv.style.zIndex = '9999';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// Escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text ? text.replace(/[&<>"']/g, m => map[m]) : '';
}

// Format message content for display - make placeholders more user-friendly
function formatMessageContentForDisplay(content) {
    if (!content) return '';
    
    let formatted = content;
    
    // Replace common placeholders with user-friendly versions
    formatted = formatted.replace(/\{\{Name\}\}/g, '<span class="badge bg-info">Name</span>');
    formatted = formatted.replace(/\{\{name\}\}/g, '<span class="badge bg-info">Name</span>');
    formatted = formatted.replace(/\{\{JobTitle\}\}/g, '<span class="badge bg-success">Job Title</span>');
    formatted = formatted.replace(/\{\{job_title\}\}/g, '<span class="badge bg-success">Job Title</span>');
    formatted = formatted.replace(/\{\{Company\}\}/g, '<span class="badge bg-warning">Company</span>');
    formatted = formatted.replace(/\{\{company\}\}/g, '<span class="badge bg-warning">Company</span>');
    formatted = formatted.replace(/\{\{CompanyName\}\}/g, '<span class="badge bg-warning">Company Name</span>');
    formatted = formatted.replace(/\{\{company_name\}\}/g, '<span class="badge bg-warning">Company Name</span>');
    
    // Replace any remaining placeholders with generic badge
    formatted = formatted.replace(/\{\{([^}]+)\}\}/g, '<span class="badge bg-secondary">$1</span>');
    
    return formatted;
}

// Logout function
async function logout() {
    try {
        await axios.post('/admin/logout');
        window.location.href = '/admin/login.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
} 

// Debug CSV upload
function debugCSVUpload() {
    console.log('=== CSV Upload Debug Info ===');
    console.log('Current user:', currentUser);
    console.log('Sessions loaded:', sessions);
    console.log('Current step:', currentStep);
    console.log('CSV Recipients count:', csvRecipients.length);
    
    const fileInput = document.getElementById('csvFile');
    console.log('File input element:', fileInput);
    console.log('Selected files:', fileInput.files);
    
    if (fileInput.files.length > 0) {
        console.log('File name:', fileInput.files[0].name);
        console.log('File size:', fileInput.files[0].size);
        console.log('File type:', fileInput.files[0].type);
    }
    
    // Check authentication
    axios.get('/api/v1/campaigns')
        .then(response => {
            console.log('Authentication check - SUCCESS');
            console.log('Response:', response.data);
        })
        .catch(error => {
            console.log('Authentication check - FAILED');
            console.log('Error:', error.response?.status, error.response?.data);
            if (error.response?.status === 401) {
                alert('Your session has expired. Please refresh the page and log in again.');
            }
        });
    
    console.log('=== End Debug Info ===');
    alert('Debug info logged to console. Press F12 to view.');
} 

// ========== RECIPIENT LIST MANAGEMENT ==========

// Load all recipient lists
async function loadRecipientLists() {
    try {
        console.log('Loading recipient lists...');
        const response = await axios.get('/api/v1/recipient-lists');
        recipientLists = response.data || [];
        console.log('Recipient lists loaded:', recipientLists);
        displayRecipientLists();
        
        // Check if there's a preselected list (from "Use in Campaign" button)
        if (window.preselectedListId) {
            await selectRecipientList(window.preselectedListId);
            window.preselectedListId = null; // Clear it after use
        }
    } catch (error) {
        console.error('Error loading recipient lists:', error);
        recipientLists = []; // Initialize as empty array on error
        displayRecipientLists(); // Still display empty state
        showAlert('Error loading recipient lists', 'danger');
    }
}

// Display recipient lists
function displayRecipientLists() {
    const container = document.getElementById('recipientListsContainer');
    if (!container) return;
    
    if (!recipientLists || recipientLists.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-people display-1"></i>
                <p class="mt-2">No recipient lists yet. Create your first list to get started!</p>
            </div>
        `;
        return;
    }
    
    const html = recipientLists.map(list => `
        <div class="card mb-2">
            <div class="card-body p-3">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h6 class="card-title mb-1">
                            ${escapeHtml(list.name)}
                            ${list.tags && list.tags.length > 0 ? 
                                list.tags.map(tag => `<span class="badge bg-secondary ms-1">${escapeHtml(tag)}</span>`).join('') : ''
                            }
                        </h6>
                        <p class="card-text small text-muted mb-2">${escapeHtml(list.description || 'No description')}</p>
                        <div class="small text-muted">
                            <i class="bi bi-people"></i> ${list.recipientCount || 0} recipients
                            <span class="ms-3"><i class="bi bi-calendar"></i> ${new Date(list.createdAt).toLocaleDateString()}</span>
                            ${list.lastUsedAt ? `<span class="ms-3"><i class="bi bi-clock"></i> Last used: ${new Date(list.lastUsedAt).toLocaleDateString()}</span>` : ''}
                        </div>
                    </div>
                    <div class="d-flex gap-1">
                        <button class="btn btn-sm btn-outline-primary" onclick="selectRecipientList('${list.id}')" title="Select this list">
                            <i class="bi bi-check-circle"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="editRecipientList('${list.id}')" title="Edit list">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-info" onclick="cloneRecipientList('${list.id}')" title="Clone list">
                            <i class="bi bi-files"></i>
                        </button>
                        ${currentUser && (currentUser.role === 'admin' || list.createdBy === currentUser.email) ? `
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteRecipientList('${list.id}')" title="Delete list">
                                <i class="bi bi-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = html;
}

// Select recipient list for campaign
async function selectRecipientList(listId) {
    try {
        const response = await axios.get(`/api/v1/recipient-lists/${listId}`);
        const list = response.data;
        
        selectedRecipients = list.recipients || [];
        csvRecipients = selectedRecipients; // For backward compatibility
        
        displaySelectedRecipients();
        showAlert(`Selected "${list.name}" with ${selectedRecipients.length} recipients`, 'success');
        
        // Mark list as used
        axios.post(`/api/v1/recipient-lists/${listId}/mark-used`).catch(console.error);
        
    } catch (error) {
        console.error('Error selecting recipient list:', error);
        showAlert('Error loading recipient list', 'danger');
    }
}

// Display selected recipients
function displaySelectedRecipients() {
    const preview = document.getElementById('selectedRecipientsPreview');
    const count = document.getElementById('selectedRecipientCount');
    const body = document.getElementById('selectedRecipientsBody');
    
    if (!preview || !count || !body) return;
    
    count.textContent = selectedRecipients.length;
    
    if (selectedRecipients.length === 0) {
        preview.style.display = 'none';
        return;
    }
    
    preview.style.display = 'block';
    
    const html = selectedRecipients.map((recipient, index) => `
        <tr>
            <td>${escapeHtml(recipient.number)}</td>
            <td>${escapeHtml(recipient.name || '-')}</td>
            <td>${escapeHtml(recipient.jobTitle || '-')}</td>
            <td>${escapeHtml(recipient.companyName || '-')}</td>
            <td>
                <button class="btn btn-sm btn-outline-danger" onclick="removeSelectedRecipient(${index})" title="Remove">
                    <i class="bi bi-x"></i>
                </button>
            </td>
        </tr>
    `).join('');
    
    body.innerHTML = html;
}

// Remove recipient from selection
function removeSelectedRecipient(index) {
    selectedRecipients.splice(index, 1);
    csvRecipients = selectedRecipients; // Keep in sync
    displaySelectedRecipients();
}

// Show create list modal
function showCreateListModal() {
    // Reset form
    document.getElementById('createListForm').reset();
    document.getElementById('recipientsContainer').innerHTML = '';
    
    // Add initial recipient row
    addRecipientRow();
    
    // Show modal
    new bootstrap.Modal(document.getElementById('createListModal')).show();
}

// Add recipient row to create list form
function addRecipientRow() {
    const container = document.getElementById('recipientsContainer');
    const index = container.children.length;
    
    const row = document.createElement('div');
    row.className = 'row mb-2 recipient-row';
    row.innerHTML = `
        <div class="col-md-3">
            <input type="text" class="form-control form-control-sm" placeholder="WhatsApp Number" name="number_${index}" required>
        </div>
        <div class="col-md-3">
            <input type="text" class="form-control form-control-sm" placeholder="Name" name="name_${index}">
        </div>
        <div class="col-md-2">
            <input type="text" class="form-control form-control-sm" placeholder="Job Title" name="jobTitle_${index}">
        </div>
        <div class="col-md-3">
            <input type="text" class="form-control form-control-sm" placeholder="Company" name="company_${index}">
        </div>
        <div class="col-md-1">
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeRecipientRow(this)">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `;
    
    container.appendChild(row);
}

// Remove recipient row
function removeRecipientRow(button) {
    button.closest('.recipient-row').remove();
}

// Show add multiple recipients modal
function addMultipleRecipients() {
    document.getElementById('bulkRecipientsText').value = '';
    window.bulkAddToEditList = false; // Ensure we're adding to create list
    new bootstrap.Modal(document.getElementById('addMultipleModal')).show();
}

// Process bulk recipients
function processBulkRecipients() {
    const text = document.getElementById('bulkRecipientsText').value.trim();
    if (!text) return;
    
    const lines = text.split('\n');
    
    // Check if we're adding to edit list or create list
    if (window.bulkAddToEditList && currentEditingList) {
        // Add to edit list
        lines.forEach(line => {
            const parts = line.split(',').map(part => part.trim());
            if (parts[0]) { // At least phone number is required
                const newRecipient = {
                    number: parts[0] || '',
                    name: parts[1] || '',
                    jobTitle: parts[2] || '',
                    companyName: parts[3] || ''
                };
                
                // Check if number already exists in the list
                const exists = currentEditingList.recipients.find(r => r.number === newRecipient.number);
                if (!exists) {
                    currentEditingList.recipients.push(newRecipient);
                }
            }
        });
        
        refreshEditListRecipients();
        window.bulkAddToEditList = false; // Reset flag
        
    } else {
        // Add to create list (existing functionality)
        const container = document.getElementById('recipientsContainer');
        
        lines.forEach(line => {
            const parts = line.split(',').map(part => part.trim());
            if (parts[0]) { // At least phone number is required
                const row = document.createElement('div');
                row.className = 'row mb-2 recipient-row';
                const index = container.children.length;
                
                row.innerHTML = `
                    <div class="col-md-3">
                        <input type="text" class="form-control form-control-sm" placeholder="WhatsApp Number" name="number_${index}" value="${escapeHtml(parts[0] || '')}" required>
                    </div>
                    <div class="col-md-3">
                        <input type="text" class="form-control form-control-sm" placeholder="Name" name="name_${index}" value="${escapeHtml(parts[1] || '')}">
                    </div>
                    <div class="col-md-2">
                        <input type="text" class="form-control form-control-sm" placeholder="Job Title" name="jobTitle_${index}" value="${escapeHtml(parts[2] || '')}">
                    </div>
                    <div class="col-md-3">
                        <input type="text" class="form-control form-control-sm" placeholder="Company" name="company_${index}" value="${escapeHtml(parts[3] || '')}">
                    </div>
                    <div class="col-md-1">
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeRecipientRow(this)">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                `;
                
                container.appendChild(row);
            }
        });
    }
    
    bootstrap.Modal.getInstance(document.getElementById('addMultipleModal')).hide();
}

// Save recipient list
async function saveRecipientList() {
    try {
        const formData = new FormData(document.getElementById('createListForm'));
        const container = document.getElementById('recipientsContainer');
        
        // Collect list data
        const listData = {
            name: document.getElementById('listName').value,
            description: document.getElementById('listDescription').value,
            tags: document.getElementById('listTags').value.split(',').map(tag => tag.trim()).filter(Boolean),
            recipients: []
        };
        
        // Collect recipients
        Array.from(container.children).forEach((row, index) => {
            const number = row.querySelector(`[name="number_${index}"]`)?.value.trim();
            if (number) {
                listData.recipients.push({
                    number: number,
                    name: row.querySelector(`[name="name_${index}"]`)?.value.trim() || '',
                    jobTitle: row.querySelector(`[name="jobTitle_${index}"]`)?.value.trim() || '',
                    companyName: row.querySelector(`[name="company_${index}"]`)?.value.trim() || ''
                });
            }
        });
        
        if (listData.recipients.length === 0) {
            showAlert('Please add at least one recipient', 'warning');
            return;
        }
        
        // Save list
        const response = await axios.post('/api/v1/recipient-lists', listData);
        showAlert(`Recipient list "${listData.name}" created successfully!`, 'success');
        
        // Close modal and refresh lists
        bootstrap.Modal.getInstance(document.getElementById('createListModal')).hide();
        await loadRecipientLists();
        
    } catch (error) {
        console.error('Error saving recipient list:', error);
        showAlert(error.response?.data?.message || 'Error saving recipient list', 'danger');
    }
}

// Edit recipient list
async function editRecipientList(listId) {
    try {
        const response = await axios.get(`/api/v1/recipient-lists/${listId}`);
        const list = response.data;
        currentEditingList = list;
        
        // Populate form
        document.getElementById('editListId').value = list.id;
        document.getElementById('editListName').value = list.name;
        document.getElementById('editListDescription').value = list.description || '';
        document.getElementById('editListTags').value = list.tags ? list.tags.join(', ') : '';
        
        // Load recipients
        refreshEditListRecipients();
        
        // Show modal
        new bootstrap.Modal(document.getElementById('editListModal')).show();
        
    } catch (error) {
        console.error('Error loading recipient list for editing:', error);
        showAlert('Error loading recipient list', 'danger');
    }
}

// Refresh recipients in edit modal
function refreshEditListRecipients() {
    if (!currentEditingList) return;
    
    const body = document.getElementById('editListRecipientsBody');
    if (!body) return;
    
    const html = currentEditingList.recipients.map(recipient => `
        <tr>
            <td>
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(recipient.number)}" 
                       onchange="updateRecipientField('${recipient.number}', 'number', this.value)">
            </td>
            <td>
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(recipient.name || '')}" 
                       onchange="updateRecipientField('${recipient.number}', 'name', this.value)">
            </td>
            <td>
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(recipient.jobTitle || '')}" 
                       onchange="updateRecipientField('${recipient.number}', 'jobTitle', this.value)">
            </td>
            <td>
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(recipient.companyName || '')}" 
                       onchange="updateRecipientField('${recipient.number}', 'companyName', this.value)">
            </td>
            <td>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeRecipientFromEditList('${recipient.number}')">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
    
    body.innerHTML = html;
}

// Update recipient field in memory
function updateRecipientField(originalNumber, field, newValue) {
    if (!currentEditingList) return;
    
    const recipient = currentEditingList.recipients.find(r => r.number === originalNumber);
    if (recipient) {
        recipient[field] = newValue;
    }
}

// Add recipient to edit list
function addRecipientToEditList() {
    if (!currentEditingList) return;
    
    const newRecipient = {
        number: '',
        name: '',
        jobTitle: '',
        companyName: ''
    };
    
    currentEditingList.recipients.push(newRecipient);
    refreshEditListRecipients();
}

// Remove recipient from edit list
async function removeRecipientFromEditList(number) {
    if (!currentEditingList) return;
    
    // Check if this is an empty/new recipient (not saved to backend yet)
    if (!number || number.trim() === '') {
        // For empty recipients, just remove from local array without confirmation
        currentEditingList.recipients = currentEditingList.recipients.filter(r => r.number !== number);
        refreshEditListRecipients();
        return;
    }
    
    // For existing recipients with numbers, confirm and call API
    if (!confirm('Remove this recipient from the list?')) return;
    
    try {
        await axios.delete(`/api/v1/recipient-lists/${currentEditingList.id}/recipients/${number}`);
        currentEditingList.recipients = currentEditingList.recipients.filter(r => r.number !== number);
        refreshEditListRecipients();
        showAlert('Recipient removed', 'success');
    } catch (error) {
        console.error('Error removing recipient:', error);
        showAlert('Error removing recipient', 'danger');
    }
}

// Update recipient list
async function updateRecipientList() {
    if (!currentEditingList) return;
    
    try {
        const listData = {
            name: document.getElementById('editListName').value,
            description: document.getElementById('editListDescription').value,
            tags: document.getElementById('editListTags').value.split(',').map(tag => tag.trim()).filter(Boolean),
            recipients: currentEditingList.recipients.filter(r => r.number.trim())
        };
        
        await axios.put(`/api/v1/recipient-lists/${currentEditingList.id}`, listData);
        showAlert('Recipient list updated successfully!', 'success');
        
        // Close modal and refresh
        bootstrap.Modal.getInstance(document.getElementById('editListModal')).hide();
        currentEditingList = null;
        await loadRecipientLists();
        
    } catch (error) {
        console.error('Error updating recipient list:', error);
        showAlert(error.response?.data?.message || 'Error updating recipient list', 'danger');
    }
}

// Clone recipient list
async function cloneRecipientList(listId) {
    const newName = prompt('Enter name for the cloned list:');
    if (!newName) return;
    
    try {
        await axios.post(`/api/v1/recipient-lists/${listId}/clone`, { name: newName });
        showAlert('Recipient list cloned successfully!', 'success');
        await loadRecipientLists();
    } catch (error) {
        console.error('Error cloning recipient list:', error);
        showAlert('Error cloning recipient list', 'danger');
    }
}

// Delete recipient list
async function deleteRecipientList(listId) {
    if (!confirm('Are you sure you want to delete this recipient list? This action cannot be undone.')) {
        return;
    }
    
    try {
        await axios.delete(`/api/v1/recipient-lists/${listId}`);
        showAlert('Recipient list deleted successfully', 'success');
        await loadRecipientLists();
    } catch (error) {
        console.error('Error deleting recipient list:', error);
        showAlert('Error deleting recipient list', 'danger');
    }
}

// Send campaign from detail view
async function sendCampaignFromDetail(campaignId) {
    if (!confirm('Are you sure you want to start sending this campaign? This will send messages to all recipients in the list.')) {
        return;
    }
    
    try {
        // Show loading state on button
        const sendBtn = document.querySelector(`button[onclick="sendCampaignFromDetail('${campaignId}')"]`);
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Starting...';
        }
        
        await axios.post(`/api/v1/campaigns/${campaignId}/send`);
        showAlert('Campaign started! Watch the progress below.', 'success');
        activeCampaignId = campaignId;
        
        // Refresh the view to show the progress indicator
        setTimeout(() => refreshCampaignView(campaignId), 1000);
        
    } catch (error) {
        console.error('Error starting campaign:', error);
        showAlert(error.response?.data?.message || 'Error starting campaign', 'danger');
        
        // Restore button if error
        const sendBtn = document.querySelector(`button[onclick="sendCampaignFromDetail('${campaignId}')"]`);
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="bi bi-send-fill"></i> Send Campaign Now';
        }
    }
}

// Refresh campaign view
async function refreshCampaignView(campaignId) {
    try {
        const response = await axios.get(`/api/v1/campaigns/${campaignId}`);
        const campaign = response.data;
        
        // Update the entire detail view
        document.getElementById('campaignDetailView').innerHTML = createCampaignDetailView(campaign);
        
        // If campaign is actively sending, set up real-time updates
        if (campaign.status === 'sending') {
            activeCampaignId = campaignId;
            startRealtimeUpdates(campaignId);
        }
        
    } catch (error) {
        console.error('Error refreshing campaign view:', error);
        showAlert('Error refreshing campaign data', 'danger');
    }
}

// Start real-time updates for campaign detail view
function startRealtimeUpdates(campaignId) {
    // Clear any existing interval
    if (window.campaignUpdateInterval) {
        clearInterval(window.campaignUpdateInterval);
    }
    
    // Update every 2 seconds while campaign is active
    window.campaignUpdateInterval = setInterval(async () => {
        try {
            const response = await axios.get(`/api/v1/campaigns/${campaignId}`);
            const campaign = response.data;
            
            // Update statistics in real-time
            updateDetailViewStats(campaign.statistics);
            
            // Update recipient table
            updateRecipientTable(campaign.recipients);
            
            // Update inline progress if visible
            updateInlineProgress(campaign.statistics, campaign.status);
            
            // Stop updates if campaign completed
            if (!['sending', 'paused'].includes(campaign.status)) {
                clearInterval(window.campaignUpdateInterval);
                showAlert(`Campaign ${campaign.status}!`, campaign.status === 'completed' ? 'success' : 'info');
                
                // Refresh the full view to show final state
                setTimeout(() => refreshCampaignView(campaignId), 1000);
            }
            
        } catch (error) {
            console.error('Error updating campaign progress:', error);
            clearInterval(window.campaignUpdateInterval);
        }
    }, 2000);
}

// Update statistics in detail view
function updateDetailViewStats(stats) {
    const statTotal = document.getElementById('statTotal');
    const statSent = document.getElementById('statSent');
    const statFailed = document.getElementById('statFailed');
    const statPending = document.getElementById('statPending');
    
    if (statTotal) statTotal.textContent = stats.total;
    if (statSent) statSent.textContent = stats.sent;
    if (statFailed) statFailed.textContent = stats.failed;
    if (statPending) statPending.textContent = stats.pending;
    
    // Update success rate
    const successRate = stats.total > 0 ? Math.round((stats.sent / stats.total) * 100) : 0;
    const successRateBar = document.querySelector('.progress-bar.bg-success');
    if (successRateBar) {
        successRateBar.style.width = `${successRate}%`;
        const successRateText = successRateBar.parentElement.previousElementSibling.querySelector('span:last-child');
        if (successRateText) successRateText.textContent = `${successRate}%`;
    }
}

// Update recipient table with latest status
function updateRecipientTable(recipients) {
    const tableBody = document.getElementById('recipientsTableBody');
    if (!tableBody) return;
    
    recipients.forEach(recipient => {
        const row = tableBody.querySelector(`tr[data-number="${recipient.number}"]`);
        if (row) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 5) {
                // Update status badge
                const statusCell = cells[2];
                const statusBadge = statusCell.querySelector('.status-badge');
                if (statusBadge) {
                    const status = recipient.status || 'pending';
                    statusBadge.className = `status-badge ${status}`;
                    statusBadge.textContent = status;
                }
                
                // Update sent at
                const sentAtCell = cells[3];
                sentAtCell.textContent = recipient.sentAt ? new Date(recipient.sentAt).toLocaleString() : '-';
                
                // Update error
                const errorCell = cells[4];
                errorCell.innerHTML = recipient.error ? 
                    `<small class="text-danger">${escapeHtml(recipient.error)}</small>` : '-';
                
                // Add visual feedback for newly sent messages
                if (recipient.status === 'sent' && !row.classList.contains('table-success')) {
                    row.classList.add('table-success');
                    setTimeout(() => row.classList.remove('table-success'), 3000);
                } else if (recipient.status === 'failed' && !row.classList.contains('table-danger')) {
                    row.classList.add('table-danger');
                    setTimeout(() => row.classList.remove('table-danger'), 3000);
                }
            }
        }
    });
}

// Update inline progress indicator
function updateInlineProgress(stats, status) {
    const total = stats.total || 1;
    const processed = stats.sent + stats.failed;
    const progressPercent = Math.round((processed / total) * 100);
    
    // Update percentage badge
    const percentageBadge = document.getElementById('progressPercentage');
    if (percentageBadge) percentageBadge.textContent = `${progressPercent}%`;
    
    // Update progress bar
    const progressBar = document.getElementById('inlineProgressBar');
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
        
        // Update animation based on status
        if (status === 'sending') {
            progressBar.classList.add('progress-bar-animated');
        } else {
            progressBar.classList.remove('progress-bar-animated');
        }
    }
    
    // Update individual stats
    const inlineSent = document.getElementById('inlineSent');
    const inlineFailed = document.getElementById('inlineFailed');
    const inlinePending = document.getElementById('inlinePending');
    
    if (inlineSent) inlineSent.textContent = stats.sent;
    if (inlineFailed) inlineFailed.textContent = stats.failed;
    if (inlinePending) inlinePending.textContent = stats.pending;
    
    // Calculate and update speed (messages per minute)
    const speed = calculateSendingSpeed(stats);
    const inlineSpeed = document.getElementById('inlineSpeed');
    if (inlineSpeed) inlineSpeed.textContent = speed ? `${speed} msgs/min` : '-- msgs/min';
}

// Calculate sending speed
function calculateSendingSpeed(stats) {
    // This is a simple estimation - in a real implementation, 
    // you'd track timing data from the backend
    if (!window.lastStatsUpdate) {
        window.lastStatsUpdate = { stats, time: Date.now() };
        return 0;
    }
    
    const timeDiff = (Date.now() - window.lastStatsUpdate.time) / 1000 / 60; // minutes
    const sentDiff = stats.sent - window.lastStatsUpdate.stats.sent;
    
    if (timeDiff > 0 && sentDiff > 0) {
        const speed = Math.round(sentDiff / timeDiff);
        window.lastStatsUpdate = { stats, time: Date.now() };
        return speed;
    }
    
    return 0;
}

// ========================================
// Recipient Lists Page Functions
// ========================================

let allRecipientLists = [];
let filteredRecipientLists = [];

// Load recipient lists for the lists page
async function loadRecipientListsPage() {
    try {
        const response = await axios.get('/api/v1/recipient-lists');
        allRecipientLists = response.data || [];
        filteredRecipientLists = [...allRecipientLists];
        
        displayRecipientListsGrid();
        populateTagsFilter();
    } catch (error) {
        console.error('Error loading recipient lists:', error);
        allRecipientLists = [];
        filteredRecipientLists = [];
        displayRecipientListsGrid(); // Still display empty state
        showAlert('Error loading recipient lists', 'danger');
    }
}

// Display recipient lists in grid view
function displayRecipientListsGrid() {
    const grid = document.getElementById('recipientListsGrid');
    if (!grid) return;
    
    if (filteredRecipientLists.length === 0) {
        grid.innerHTML = `
            <div class="col-12">
                <div class="text-center py-5">
                    <i class="bi bi-inbox display-1 text-muted"></i>
                    <p class="text-muted mt-3">No recipient lists found</p>
                    <button class="btn btn-primary" onclick="showCreateListModal()">
                        <i class="bi bi-plus-circle"></i> Create Your First List
                    </button>
                </div>
            </div>
        `;
        return;
    }
    
    const html = filteredRecipientLists.map(list => createRecipientListCard(list)).join('');
    grid.innerHTML = html;
}

// Create a recipient list card
function createRecipientListCard(list) {
    const tags = list.tags && list.tags.length > 0 ? 
        list.tags.map(tag => `<span class="badge bg-secondary">${escapeHtml(tag)}</span>`).join('') : 
        '<span class="text-muted">No tags</span>';
    
    const lastUsed = list.lastUsedAt ? 
        `Last used: ${new Date(list.lastUsedAt).toLocaleDateString()}` : 
        'Never used';
    
    return `
        <div class="col-lg-4 col-md-6 mb-4">
            <div class="card list-card">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h5 class="card-title mb-0">${escapeHtml(list.name)}</h5>
                        <div class="dropdown">
                            <button class="btn btn-sm btn-light" type="button" data-bs-toggle="dropdown">
                                <i class="bi bi-three-dots-vertical"></i>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end">
                                <li><a class="dropdown-item" href="#" onclick="editRecipientList('${list.id}')">
                                    <i class="bi bi-pencil"></i> Edit
                                </a></li>
                                <li><a class="dropdown-item" href="#" onclick="cloneRecipientList('${list.id}')">
                                    <i class="bi bi-files"></i> Clone
                                </a></li>
                                <li><a class="dropdown-item" href="#" onclick="exportRecipientList('${list.id}')">
                                    <i class="bi bi-download"></i> Export CSV
                                </a></li>
                                <li><hr class="dropdown-divider"></li>
                                <li><a class="dropdown-item text-danger" href="#" onclick="deleteRecipientList('${list.id}')">
                                    <i class="bi bi-trash"></i> Delete
                                </a></li>
                            </ul>
                        </div>
                    </div>
                    
                    <p class="card-text text-muted small">
                        ${list.description ? escapeHtml(list.description) : '<em>No description</em>'}
                    </p>
                    
                    <div class="tags">
                        ${tags}
                    </div>
                    
                    <div class="list-stats">
                        <div class="stat">
                            <div class="stat-value">${list.recipientCount || 0}</div>
                            <div class="stat-label">Recipients</div>
                        </div>
                        <div class="stat">
                            <div class="stat-value">${list.usageCount || 0}</div>
                            <div class="stat-label">Times Used</div>
                        </div>
                    </div>
                    
                    <div class="list-meta mt-3">
                        <div><i class="bi bi-person"></i> Created by: ${escapeHtml(list.createdBy)}</div>
                        <div><i class="bi bi-calendar"></i> Created: ${new Date(list.createdAt).toLocaleDateString()}</div>
                        <div><i class="bi bi-clock"></i> ${lastUsed}</div>
                    </div>
                    
                    <div class="d-grid gap-2 mt-3">
                        <button class="btn btn-primary btn-sm" onclick="viewRecipientList('${list.id}')">
                            <i class="bi bi-eye"></i> View Recipients
                        </button>
                        <button class="btn btn-outline-success btn-sm" onclick="useListInCampaign('${list.id}')">
                            <i class="bi bi-send"></i> Use in Campaign
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Filter recipient lists
function filterRecipientLists() {
    const searchTerm = document.getElementById('searchLists').value.toLowerCase();
    const selectedTag = document.getElementById('filterTags').value;
    
    filteredRecipientLists = allRecipientLists.filter(list => {
        const matchesSearch = !searchTerm || 
            list.name.toLowerCase().includes(searchTerm) ||
            (list.description && list.description.toLowerCase().includes(searchTerm));
        
        const matchesTag = !selectedTag || 
            (list.tags && list.tags.includes(selectedTag));
        
        return matchesSearch && matchesTag;
    });
    
    displayRecipientListsGrid();
}

// Populate tags filter
function populateTagsFilter() {
    const allTags = new Set();
    allRecipientLists.forEach(list => {
        if (list.tags) {
            list.tags.forEach(tag => allTags.add(tag));
        }
    });
    
    const filterSelect = document.getElementById('filterTags');
    if (!filterSelect) return;
    
    const tagsArray = Array.from(allTags).sort();
    filterSelect.innerHTML = '<option value="">All Tags</option>' + 
        tagsArray.map(tag => `<option value="${tag}">${escapeHtml(tag)}</option>`).join('');
}

// View recipient list details
async function viewRecipientList(listId) {
    try {
        const response = await axios.get(`/api/v1/recipient-lists/${listId}`);
        const list = response.data;
        
        // Show in edit modal in view-only mode
        currentEditingList = list;
        
        document.getElementById('editListId').value = list.id;
        document.getElementById('editListName').value = list.name;
        document.getElementById('editListName').readOnly = true;
        document.getElementById('editListDescription').value = list.description || '';
        document.getElementById('editListDescription').readOnly = true;
        document.getElementById('editListTags').value = list.tags ? list.tags.join(', ') : '';
        document.getElementById('editListTags').readOnly = true;
        
        // Show recipients in read-only mode
        const body = document.getElementById('editListRecipientsBody');
        const html = list.recipients.map(recipient => `
            <tr>
                <td>${escapeHtml(recipient.number)}</td>
                <td>${escapeHtml(recipient.name || '-')}</td>
                <td>${escapeHtml(recipient.jobTitle || '-')}</td>
                <td>${escapeHtml(recipient.companyName || '-')}</td>
                <td>-</td>
            </tr>
        `).join('');
        body.innerHTML = html;
        
        // Update modal title and buttons
        document.querySelector('#editListModal .modal-title').textContent = 'View Recipient List';
        document.querySelector('#editListModal .btn-success').style.display = 'none';
        
        new bootstrap.Modal(document.getElementById('editListModal')).show();
        
        // Reset after modal closes
        document.getElementById('editListModal').addEventListener('hidden.bs.modal', function() {
            document.getElementById('editListName').readOnly = false;
            document.getElementById('editListDescription').readOnly = false;
            document.getElementById('editListTags').readOnly = false;
            document.querySelector('#editListModal .modal-title').textContent = 'Edit Recipient List';
            document.querySelector('#editListModal .btn-success').style.display = 'block';
        }, { once: true });
        
    } catch (error) {
        console.error('Error viewing recipient list:', error);
        showAlert('Error loading recipient list details', 'danger');
    }
}

// Use list in campaign (switch to campaign creation with this list pre-selected)
function useListInCampaign(listId) {
    // Store the selected list ID
    window.preselectedListId = listId;
    
    // Switch to campaigns tab
    document.getElementById('campaigns-tab').click();
    
    // Start creating a new campaign
    showCreateCampaign();
    
    // The loadRecipientLists function will check for preselectedListId
}

// Export recipient list to CSV
async function exportRecipientList(listId) {
    try {
        const response = await axios.get(`/api/v1/recipient-lists/${listId}`);
        const list = response.data;
        
        // Create CSV content
        const headers = ['WhatsApp Number', 'Name', 'Job Title', 'Company Name'];
        const rows = [headers];
        
        list.recipients.forEach(recipient => {
            rows.push([
                recipient.number,
                recipient.name || '',
                recipient.jobTitle || '',
                recipient.companyName || ''
            ]);
        });
        
        const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
        
        // Download the CSV
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${list.name.replace(/[^a-z0-9]/gi, '_')}_recipients.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showAlert('Recipient list exported successfully', 'success');
        
    } catch (error) {
        console.error('Error exporting recipient list:', error);
        showAlert('Error exporting recipient list', 'danger');
    }
}

// Fix tab visibility issues
function fixTabVisibility() {
    setTimeout(() => {
        const tabs = document.querySelectorAll('#mainTabs .nav-link');
        tabs.forEach(tab => {
            // Ensure tab content is visible
            if (tab.textContent.trim() === '') {
                // Re-populate tab text if missing
                if (tab.id === 'campaigns-tab') {
                    tab.innerHTML = '<i class="bi bi-megaphone"></i> Campaigns';
                } else if (tab.id === 'lists-tab') {
                    tab.innerHTML = '<i class="bi bi-people"></i> Recipient Lists';
                }
            }
            
            // Force styles
            tab.style.color = '#495057';
            tab.style.fontWeight = '500';
            tab.style.padding = '0.5rem 1rem';
            tab.style.display = 'inline-block';
            tab.style.backgroundColor = 'transparent';
        });
        
        // Ensure active tab is styled correctly
        const activeTab = document.querySelector('#mainTabs .nav-link.active');
        if (activeTab) {
            activeTab.style.color = '#0d6efd';
            activeTab.style.backgroundColor = '#fff';
        }
        
        console.log('Tab visibility fixed');
    }, 500);
} 

// Show add multiple recipients modal for edit list
function addMultipleRecipientsToEditList() {
    document.getElementById('bulkRecipientsText').value = '';
    window.bulkAddToEditList = true; // Flag to distinguish between create and edit
    new bootstrap.Modal(document.getElementById('addMultipleModal')).show();
} 

// Check for overdue campaigns
async function checkOverdueCampaigns() {
    try {
        const response = await axios.get('/api/v1/campaigns/overdue');
        const data = response.data;
        
        if (data.overdueCampaigns > 0) {
            const campaignsList = data.campaigns.map(c => 
                `• ${c.name} (${c.minutesOverdue} min overdue)`
            ).join('\n');
            
            const result = confirm(`Found ${data.overdueCampaigns} overdue campaign(s):\n\n${campaignsList}\n\nWould you like to manually start them now?`);
            
            if (result) {
                await manuallyTriggerScheduler();
            }
        } else {
            showAlert('No overdue campaigns found. All scheduled campaigns are running on time!', 'success');
        }
        
        return data;
    } catch (error) {
        console.error('Error checking overdue campaigns:', error);
        showAlert('Error checking overdue campaigns', 'danger');
    }
}

// Manually trigger the scheduler
async function manuallyTriggerScheduler() {
    try {
        showAlert('Checking for scheduled campaigns...', 'info');
        
        const response = await axios.get('/api/v1/campaigns/check-scheduled');
        const data = response.data;
        
        if (data.campaignsToStart > 0) {
            showAlert(`Started ${data.campaignsToStart} scheduled campaign(s)!`, 'success');
            // Refresh the campaigns list
            await loadCampaigns();
        } else {
            showAlert('No campaigns needed to be started. All scheduled campaigns are up to date.', 'info');
        }
        
        console.log('Scheduler check result:', data);
        return data;
    } catch (error) {
        console.error('Error triggering scheduler:', error);
        showAlert('Error triggering scheduler', 'danger');
    }
}