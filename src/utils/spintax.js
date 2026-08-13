/**
 * Spintax Utility
 * Parses and expands Spintax templates like "{Hello|Hi|Greetings} {{Name}}"
 */

function parseSpintax(text, variables = {}) {
    if (!text || typeof text !== 'string') return '';

    let result = text;
    if (variables && typeof variables === 'object') {
        for (const [key, val] of Object.entries(variables)) {
            if (val !== undefined && val !== null) {
                result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val));
            }
        }
    }

    const spintaxRegex = /\{([^{}]+)\}/g;
    while (spintaxRegex.test(result)) {
        result = result.replace(spintaxRegex, (match, choices) => {
            const options = choices.split('|');
            const randomIndex = Math.floor(Math.random() * options.length);
            return options[randomIndex];
        });
    }
    return result;
}

module.exports = { parseSpintax };
