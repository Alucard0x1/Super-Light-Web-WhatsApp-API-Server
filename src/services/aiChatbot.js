/**
 * AI Chatbot Service
 * Handles LLM / OpenAI API Integration for WhatsApp Auto-Replies
 */

const axios = require('axios');
const { db } = require('../config/database');
const ChatMessage = require('../models/ChatMessage');

class AiChatbotService {
    /**
     * Get current AI Settings
     */
    getSettings() {
        const stmt = db.prepare('SELECT * FROM ai_settings WHERE id = 1');
        let settings = stmt.get();

        if (!settings) {
            db.prepare('INSERT OR IGNORE INTO ai_settings (id, is_enabled) VALUES (1, 0)').run();
            settings = stmt.get();
        }

        // Fallback to process.env if database row is empty
        const apiKey = settings.api_key || process.env.OPENAI_API_KEY || '';
        const isEnabled = settings.is_enabled === 1 || process.env.AI_CHATBOT_ENABLED === 'true';

        return {
            isEnabled: isEnabled ? 1 : 0,
            provider: settings.provider || 'openai',
            apiKey: apiKey,
            apiBaseUrl: settings.api_base_url || 'https://api.openai.com/v1',
            model: settings.model || 'gpt-4o-mini',
            systemPrompt: settings.system_prompt || 'You are a helpful customer support AI assistant for WhatsApp. Be concise, polite, and professional.',
            temperature: settings.temperature || 0.7,
            maxTokens: settings.max_tokens || 500,
            autoReplyUnmatched: settings.auto_reply_unmatched === 1 ? 1 : 0
        };
    }

    /**
     * Update AI Settings
     */
    updateSettings(data) {
        const current = this.getSettings();
        const isEnabled = data.isEnabled !== undefined ? (data.isEnabled ? 1 : 0) : current.isEnabled;
        const provider = data.provider || current.provider;
        const apiKey = data.apiKey !== undefined ? data.apiKey : current.apiKey;
        const apiBaseUrl = data.apiBaseUrl || current.apiBaseUrl;
        const model = data.model || current.model;
        const systemPrompt = data.systemPrompt !== undefined ? data.systemPrompt : current.systemPrompt;
        const temperature = data.temperature !== undefined ? parseFloat(data.temperature) : current.temperature;
        const maxTokens = data.maxTokens !== undefined ? parseInt(data.maxTokens, 10) : current.maxTokens;
        const autoReplyUnmatched = data.autoReplyUnmatched !== undefined ? (data.autoReplyUnmatched ? 1 : 0) : current.autoReplyUnmatched;

        const stmt = db.prepare(`
            UPDATE ai_settings 
            SET is_enabled = ?, provider = ?, api_key = ?, api_base_url = ?, model = ?, system_prompt = ?, temperature = ?, max_tokens = ?, auto_reply_unmatched = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `);

        stmt.run(isEnabled, provider, apiKey, apiBaseUrl, model, systemPrompt, temperature, maxTokens, autoReplyUnmatched);
        return this.getSettings();
    }

    /**
     * Generate AI Response for an incoming WhatsApp message
     */
    async generateResponse({ sessionId, remoteJid, userText }) {
        const settings = this.getSettings();

        if (!settings.isEnabled) {
            return null;
        }

        if (!settings.apiKey) {
            console.warn('[AI Chatbot] API Key is missing. Skipping AI reply.');
            return null;
        }

        try {
            // Build conversation history (last 6 messages)
            const recentMsgs = ChatMessage.getChatHistory(sessionId, remoteJid, 6);
            const messages = [
                { role: 'system', content: settings.systemPrompt }
            ];

            // Reconstruct historical context (newest at bottom)
            const sortedMsgs = [...recentMsgs].reverse();
            for (const msg of sortedMsgs) {
                if (msg.body && msg.body.trim()) {
                    messages.push({
                        role: msg.from_me ? 'assistant' : 'user',
                        content: msg.body.trim()
                    });
                }
            }

            // Append current incoming text if not already included
            const lastMsg = messages[messages.length - 1];
            if (!lastMsg || lastMsg.content !== userText.trim()) {
                messages.push({ role: 'user', content: userText.trim() });
            }

            const endpoint = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`;

            const response = await axios.post(
                endpoint,
                {
                    model: settings.model,
                    messages: messages,
                    temperature: settings.temperature,
                    max_tokens: settings.maxTokens
                },
                {
                    headers: {
                        'Authorization': `Bearer ${settings.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            const replyText = response.data?.choices?.[0]?.message?.content?.trim();
            return replyText || null;
        } catch (error) {
            console.error('[AI Chatbot] API request failed:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Test Playground Sandbox
     */
    async testPlayground({ userPrompt, systemPrompt, model, apiKey, apiBaseUrl, temperature }) {
        const current = this.getSettings();
        const keyToUse = apiKey || current.apiKey;
        const baseUrlToUse = apiBaseUrl || current.apiBaseUrl;
        const modelToUse = model || current.model;
        const promptToUse = systemPrompt || current.systemPrompt;
        const tempToUse = temperature !== undefined ? parseFloat(temperature) : current.temperature;

        if (!keyToUse) {
            throw new Error('API Key is required to test the AI sandbox.');
        }

        const endpoint = `${baseUrlToUse.replace(/\/$/, '')}/chat/completions`;

        const response = await axios.post(
            endpoint,
            {
                model: modelToUse,
                messages: [
                    { role: 'system', content: promptToUse },
                    { role: 'user', content: userPrompt }
                ],
                temperature: tempToUse,
                max_tokens: 300
            },
            {
                headers: {
                    'Authorization': `Bearer ${keyToUse}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        return response.data?.choices?.[0]?.message?.content?.trim() || 'No response generated.';
    }
}

module.exports = new AiChatbotService();
