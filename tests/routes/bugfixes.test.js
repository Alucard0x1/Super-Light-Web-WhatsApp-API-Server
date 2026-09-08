/**
 * Bug Fixes Regression Tests
 */

jest.mock('@whiskeysockets/baileys', () => ({
    jidNormalizedUser: jest.fn(jid => jid.toLowerCase())
}));

const chatsRouter = require('../../src/routes/chats');
const autoReplyRouter = require('../../src/routes/autoReply');
const aiChatbot = require('../../src/services/aiChatbot');
const CampaignSender = require('../../src/services/campaign-sender');

describe('Bug Fixes Verification', () => {
    describe('Chat and AutoReply Route Authentication', () => {
        test('chats route rejects unauthenticated requests with 401', () => {
            const req = {
                method: 'GET',
                url: '/',
                headers: {},
                session: null,
                query: { sessionId: 'test-session' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();

            chatsRouter.handle(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
        });

        test('auto-replies route rejects unauthenticated requests with 401', () => {
            const req = {
                headers: {},
                session: null,
                method: 'GET',
                url: '/'
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();

            autoReplyRouter.handle(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
        });
    });

    describe('AI Chatbot SSRF Guard', () => {
        test('testPlayground rejects private IP addresses', async () => {
            await expect(aiChatbot.testPlayground({
                userPrompt: 'Hello',
                apiKey: 'sk-test',
                apiBaseUrl: 'http://169.254.169.254'
            })).rejects.toThrow('must not point to a private or reserved address');
        });

        test('testPlayground rejects localhost', async () => {
            await expect(aiChatbot.testPlayground({
                userPrompt: 'Hello',
                apiKey: 'sk-test',
                apiBaseUrl: 'http://localhost:8080'
            })).rejects.toThrow('must not point to a local address');
        });
    });

    describe('CampaignSender retryFailed Paused State', () => {
        test('retryFailed resumes a paused campaign queue', async () => {
            const mockManager = {
                loadCampaign: jest.fn().mockReturnValue({
                    id: 'camp-123',
                    name: 'Test Campaign',
                    recipients: [
                        { number: '12345', status: 'failed' }
                    ]
                }),
                markForRetry: jest.fn()
            };
            const mockLogger = {
                logCampaignRetry: jest.fn().mockResolvedValue()
            };

            const sender = new CampaignSender(mockManager, new Map(), mockLogger);
            sender.activeQueues.set('camp-123', { status: 'paused', generation: 1 });
            sender.resumeCampaign = jest.fn().mockResolvedValue(true);

            const result = await sender.retryFailed('camp-123', 'admin@example.com');

            expect(mockManager.markForRetry).toHaveBeenCalledWith('camp-123', '12345');
            expect(sender.resumeCampaign).toHaveBeenCalledWith('camp-123', 'admin@example.com');
            expect(result.status).toBe('retrying');
            expect(result.retryCount).toBe(1);
        });
    });
});
