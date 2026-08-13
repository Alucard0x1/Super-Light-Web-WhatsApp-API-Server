/**
 * AI Chatbot Service Unit Tests
 */

const aiChatbot = require('../../src/services/aiChatbot');
const { db } = require('../../src/config/database');

describe('AI Chatbot Service', () => {
    test('should retrieve default AI settings', () => {
        const settings = aiChatbot.getSettings();
        expect(settings).toBeDefined();
        expect(settings.isEnabled).toBeDefined();
        expect(settings.provider).toBe('openai');
        expect(settings.model).toBeDefined();
    });

    test('should update AI settings cleanly', () => {
        const updated = aiChatbot.updateSettings({
            isEnabled: 0,
            model: 'gpt-4o-mini',
            systemPrompt: 'Unit test AI prompt'
        });

        expect(updated.isEnabled).toBe(0);
        expect(updated.model).toBe('gpt-4o-mini');
        expect(updated.systemPrompt).toBe('Unit test AI prompt');
    });

    test('should return null if AI is disabled', async () => {
        aiChatbot.updateSettings({ isEnabled: 0 });
        const response = await aiChatbot.generateResponse({
            sessionId: 'test',
            remoteJid: '6281234567890@s.whatsapp.net',
            userText: 'Hello'
        });
        expect(response).toBeNull();
    });
});
