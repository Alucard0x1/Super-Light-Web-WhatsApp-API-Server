/**
 * Integration smoke test for the campaign engine fixes:
 *  1. retryCount increments on failure -> failed recipients stop being re-picked
 *  2. pause/resume cannot double-send (generation guard + timer cancellation)
 * Run with: node tests/campaign-engine-smoke.js
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const CampaignManager = require('../src/services/campaigns');
const CampaignSender = require('../src/services/campaign-sender');

const key = crypto.randomBytes(32).toString('hex');
const cm = new CampaignManager(key);

const noopLogger = {
    logCampaignStart: async () => {},
    logCampaignMessage: async () => {},
    logCampaignComplete: async () => {},
    logCampaignResume: async () => {},
    logCampaignRetry: async () => {}
};

let failures = 0;
function check(name, condition) {
    if (condition) {
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}`);
    }
}

// --- Test 1: retry counting ---
(async () => {
    console.log('[1] Retry counting terminates failed-recipient re-picking');
    const campaign = cm.createCampaign({
        name: 'retry-test',
        recipients: [
            { number: '6281111111111' },
            { number: '6282222222222' }
        ],
        settings: { delayBetweenMessages: 100, maxRetries: 2 }
    });

    cm.updateRecipientStatus(campaign.id, '6281111111111', 'failed', 'boom');
    let pending = cm.getPendingRecipients(campaign.id, 10);
    check('failed recipient re-picked while retryCount < maxRetries', pending.some(r => r.number === '6281111111111'));

    cm.updateRecipientStatus(campaign.id, '6281111111111', 'failed', 'boom');
    pending = cm.getPendingRecipients(campaign.id, 10);
    check('failed recipient excluded after retryCount reaches maxRetries', !pending.some(r => r.number === '6281111111111'));
    check('other recipient still pending', pending.some(r => r.number === '6282222222222'));

    // --- Test 2: pause/resume does not double-send ---
    console.log('[2] Pause/resume concurrency (no duplicate sends)');
    const sent = [];
    const sessions = {
        get: () => ({
            status: 'CONNECTED',
            sock: {
                sendMessage: async (jid) => {
                    sent.push(jid);
                    await new Promise(r => setTimeout(r, 300)); // slow send: pause lands mid-send
                }
            }
        })
    };
    const sender = new CampaignSender(cm, sessions, noopLogger);
    const c2 = cm.createCampaign({
        name: 'pause-test',
        recipients: [
            { number: '6283333333333' },
            { number: '6284444444444' },
            { number: '6285555555555' }
        ],
        settings: { delayBetweenMessages: 100 }
    });

    await sender.startCampaign(c2.id, 't@test');
    setTimeout(() => sender.pauseCampaign(c2.id), 150);          // pause while first send is IN FLIGHT
    setTimeout(async () => { await sender.resumeCampaign(c2.id, 't@test'); }, 200); // resume before it settles

    await new Promise(r => setTimeout(r, 6000));
    const unique = new Set(sent);
    check(`no duplicates (sent=${sent.length}, unique=${unique.size})`, sent.length === unique.size);
    check(`all recipients eventually sent (${sent.length}/3)`, sent.length === 3);

    const status = cm.loadCampaign(c2.id);
    check('campaign status persisted as completed', status && status.status === 'completed');

    // --- Test 3: stop while in flight, then restart fresh ---
    console.log('[3] Stop/restart does not double-send');
    sent.length = 0;
    const c3 = cm.createCampaign({
        name: 'stop-test',
        recipients: [
            { number: '6286666666666' },
            { number: '6287777777777' }
        ],
        settings: { delayBetweenMessages: 100 }
    });
    await sender.startCampaign(c3.id, 't@test');
    setTimeout(() => sender.stopCampaign(c3.id), 150);           // stop mid-send
    setTimeout(async () => { await sender.startCampaign(c3.id, 't@test'); }, 200); // restart immediately

    await new Promise(r => setTimeout(r, 5000));
    const unique3 = new Set(sent);
    check(`no duplicates on stop/restart (sent=${sent.length}, unique=${unique3.size})`, sent.length === unique3.size);
    check(`all recipients eventually sent (${sent.length}/2)`, sent.length === 2);

    // Cleanup test files
    cm.deleteCampaign(campaign.id);
    cm.deleteCampaign(c2.id);
    cm.deleteCampaign(c3.id);
    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
    console.error('Test crashed:', err);
    process.exit(1);
});
