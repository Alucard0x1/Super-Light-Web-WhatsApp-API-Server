const Joi = require('joi');

const ValidationSchemas = {
    // Admin login validation
    adminLogin: Joi.object({
        username: Joi.string()
            .min(3)
            .max(50)
            .required()
            .messages({
                'string.min': 'Username must be at least 3 characters',
                'string.max': 'Username cannot exceed 50 characters',
                'any.required': 'Username is required'
            }),
        password: Joi.string()
            .min(6)
            .required()
            .messages({
                'string.min': 'Password must be at least 6 characters',
                'any.required': 'Password is required'
            })
    }),

    // Session creation validation
    sessionCreate: Joi.object({
        sessionId: Joi.string()
            .min(3)
            .max(50)
            .pattern(/^[a-zA-Z0-9_-]+$/)
            .required()
            .messages({
                'string.min': 'Session ID must be at least 3 characters',
                'string.max': 'Session ID cannot exceed 50 characters',
                'string.pattern.base': 'Session ID can only contain letters, numbers, hyphens, and underscores',
                'any.required': 'Session ID is required'
            })
    }),

    // Message sending validation
    sendMessage: Joi.object({
        recipient_type: Joi.string()
            .valid('individual', 'group')
            .required(),
        to: Joi.string()
            .min(10)
            .required(),
        type: Joi.string()
            .valid('text', 'image', 'document')
            .required(),
        text: Joi.object({
            body: Joi.string().max(4096).required()
        }).when('type', { is: 'text', then: Joi.required() }),
        image: Joi.object({
            link: Joi.string().uri(),
            id: Joi.string(),
            caption: Joi.string().max(1024)
        }).xor('link', 'id').when('type', { is: 'image', then: Joi.required() }),
        document: Joi.object({
            link: Joi.string().uri(),
            id: Joi.string(),
            mimetype: Joi.string().required(),
            filename: Joi.string().max(255)
        }).xor('link', 'id').when('type', { is: 'document', then: Joi.required() })
    }),

    // Webhook configuration validation
    webhookConfig: Joi.object({
        url: Joi.string()
            .uri()
            .required()
            .messages({
                'string.uri': 'Please provide a valid URL',
                'any.required': 'Webhook URL is required'
            })
    }),

    // Message deletion validation
    deleteMessage: Joi.object({
        sessionId: Joi.string().required(),
        messageId: Joi.string().required(),
        remoteJid: Joi.string().required()
    })
};

module.exports = ValidationSchemas; 