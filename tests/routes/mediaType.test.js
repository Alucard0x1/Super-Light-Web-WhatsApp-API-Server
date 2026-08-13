/**
 * mediaTypeFromSignature Unit Tests
 * Locks in magic-byte detection and the mediaDir path-containment guard
 * (Snyk CWE-23 path-traversal sink hardening for fs.openSync/fs.readSync).
 */

jest.mock('sanitize-html', () => jest.fn((html) => html)); // transitive ESM dep of campaigns.js
jest.mock('@whiskeysockets/baileys', () => ({ jidNormalizedUser: jest.fn() })); // baileys 7.x is ESM-only

const path = require('path');
const fs = require('fs');
const { mediaTypeFromSignature } = require('../../src/routes/api');

describe('mediaTypeFromSignature', () => {
    const mediaDir = path.join(__dirname, '../../media');
    const createdFiles = [];

    afterAll(() => {
        createdFiles.forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });
    });

    const writeInMediaDir = (name, bytes) => {
        const filePath = path.join(mediaDir, name);
        fs.writeFileSync(filePath, Buffer.from(bytes));
        createdFiles.push(filePath);
        return filePath;
    };

    test('returns null for paths outside the media directory (no file access)', () => {
        const outside = path.join(__dirname, 'outside.tmp');
        fs.writeFileSync(outside, Buffer.from([0xff, 0xd8, 0xff]));
        createdFiles.push(outside);
        expect(mediaTypeFromSignature(outside, 'image/jpeg')).toBeNull();
        expect(mediaTypeFromSignature('../package.json', 'image/jpeg')).toBeNull();
    });

    test('detects JPEG by magic bytes inside media dir', () => {
        const filePath = writeInMediaDir(`snyk_test_${Date.now()}.upload`, [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        expect(mediaTypeFromSignature(filePath, 'image/jpeg')).toEqual({ extension: '.jpg', kind: 'image' });
    });

    test('detects PNG by magic bytes inside media dir', () => {
        const filePath = writeInMediaDir(`snyk_test_${Date.now()}.upload`,
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
        expect(mediaTypeFromSignature(filePath, 'image/png')).toEqual({ extension: '.png', kind: 'image' });
    });

    test('detects PDF by magic bytes inside media dir', () => {
        const filePath = writeInMediaDir(`snyk_test_${Date.now()}.upload`, '%PDF-1.7');
        expect(mediaTypeFromSignature(filePath, 'application/pdf')).toEqual({ extension: '.pdf', kind: 'document' });
    });

    test('returns null for unknown signatures', () => {
        const filePath = writeInMediaDir(`snyk_test_${Date.now()}.upload`, 'plain text content');
        expect(mediaTypeFromSignature(filePath, 'image/jpeg')).toBeNull();
    });
});
