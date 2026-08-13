/**
 * ChatMessage Model Unit Tests
 */

const ChatMessage = require('../../src/models/ChatMessage');
const { db } = require('../../src/config/database');

describe('ChatMessage Model', () => {
    const testSession = 'test';
    const testJid = '6281234567890@s.whatsapp.net';

    afterAll(() => {
        db.prepare("DELETE FROM chat_messages WHERE id = 'msg_test_001'").run();
    });

    test('should save incoming chat message', () => {
        const msg = ChatMessage.save({
            id: 'msg_test_001',
            sessionId: testSession,
            remoteJid: testJid,
            senderName: 'Test Contact',
            fromMe: 0,
            messageType: 'text',
            body: 'Hello from customer'
        });

        expect(msg).toBeDefined();
        expect(msg.id).toBe('msg_test_001');
        expect(msg.body).toBe('Hello from customer');
        expect(msg.from_me).toBe(0);
    });

    test('should retrieve chat history for contact', () => {
        const history = ChatMessage.getChatHistory(testSession, testJid);
        expect(history).toBeDefined();
        expect(history.length).toBeGreaterThanOrEqual(1);
    });

    test('should retrieve active conversations for session', () => {
        const conversations = ChatMessage.getRecentConversations(testSession);
        expect(conversations).toBeDefined();
        expect(conversations.length).toBeGreaterThanOrEqual(1);
    });

    test('should mark conversation as read', () => {
        const result = ChatMessage.markAsRead(testSession, testJid);
        expect(result.changes).toBeGreaterThanOrEqual(1);
    });
});
