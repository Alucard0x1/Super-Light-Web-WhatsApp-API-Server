/**
 * CampaignSender — Race Condition Regression Tests
 *
 * R3) startCampaign() must be idempotent: when a campaign queue already exists
 *     (a /send, /retry, or the 60s scheduler racing), it returns an
 *     "already-running" result instead of throwing "Campaign is already running".
 *     This prevents the scheduler from surfacing noisy errors every 60s and
 *     prevents any attempt to set up a second sending loop.
 */

const CampaignSender = require('../../src/services/campaign-sender');

describe('CampaignSender startCampaign idempotency', () => {
    const campaign = {
        id: 'camp_race',
        name: 'Race Test',
        sessionId: 'sess_1',
        createdBy: 'admin@example.com',
        status: 'ready',
        recipients: [{ number: '6281111111111', status: 'pending' }],
        statistics: { total: 1, sent: 0, failed: 0, pending: 1 },
        message: { type: 'text', content: 'Hi' },
        settings: { delayBetweenMessages: 1000 }
    };

    test('returns already-running (no throw) when the queue already exists', async () => {
        const manager = {
            loadCampaign: jest.fn().mockReturnValue(campaign),
            updateCampaignStatus: jest.fn()
        };
        const sender = new CampaignSender(manager, new Map(), {});
        sender.activeQueues.set('camp_race', { status: 'running', generation: 1 });

        const result = await sender.startCampaign('camp_race', 'admin@example.com');

        expect(result.status).toBe('already-running');
        expect(result.campaignId).toBe('camp_race');
        // Must NOT attempt to re-transition status or start a second loop.
        expect(manager.updateCampaignStatus).not.toHaveBeenCalledWith('camp_race', 'sending');
    });

    test('a fresh start returns started and transitions status to sending', async () => {
        const manager = {
            loadCampaign: jest.fn().mockReturnValue(campaign),
            updateCampaignStatus: jest.fn(),
            // Empty pending -> queue completes immediately; harmless here.
            getPendingRecipients: jest.fn().mockReturnValue([]),
            processTemplate: jest.fn(x => x)
        };
        const sessions = new Map();
        sessions.set('sess_1', { status: 'CONNECTED', sock: { sendMessage: jest.fn().mockResolvedValue({ key: { id: 'm1' } }) } });
        const logger = {
            logCampaignStart: jest.fn().mockResolvedValue(),
            logCampaignComplete: jest.fn().mockResolvedValue()
        };
        const sender = new CampaignSender(manager, sessions, logger);

        const result = await sender.startCampaign('camp_race', 'admin@example.com');

        expect(result.status).toBe('started');
        expect(manager.updateCampaignStatus).toHaveBeenCalledWith('camp_race', 'sending');
    });
});
