#!/usr/bin/env node
import '../lib/load-local-env.js';
import { writeFile } from 'node:fs/promises';
import { buildMatchNotificationEmail, sendMatchNotificationEmail, verifySmtpConnection } from '../lib/email.js';

// Connection-only by default. Sending requires --send and an explicitly supplied
// NOTIFICATION_TEST_TO in the local environment. No database or ledger is touched.
const args = process.argv.slice(2);
const evidenceIndex = args.indexOf('--evidence');
const evidencePath = evidenceIndex >= 0 ? args[evidenceIndex + 1] : null;
const evidence = {
    checked_at: new Date().toISOString(), transport: 'smtp', sampleOnly: true,
    connectionVerified: false, sendAttempted: false, providerAccepted: false,
    inboxDeliveryConfirmed: false,
};
try {
    if (evidenceIndex >= 0 && (!evidencePath || evidencePath.startsWith('--'))) throw new Error('INVALID_ARGUMENTS');
    const recipient = process.env.NOTIFICATION_TEST_TO;
    if (args.includes('--send') && (typeof recipient !== 'string' || recipient.length > 254
        || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient))) {
        throw new Error('TEST_RECIPIENT_REQUIRED');
    }
    const verified = await verifySmtpConnection();
    evidence.connectionVerified = verified.connected;
    if (!verified.connected) throw new Error(verified.code);
    if (args.includes('--send')) {
        const rendered = buildMatchNotificationEmail({ to: recipient, userName: 'SMTP test recipient', matches: [{
            torId: 'TEST-SMTP-001', title: '[TEST] โครงการพัฒนาระบบซอฟต์แวร์ — SMTP verification',
            agency: 'MoneyTamNgan test fixture', budget: 1000000, matchScore: 85,
        }] });
        rendered.subject = `[SMTP TEST] ${rendered.subject}`;
        evidence.sendAttempted = true;
        evidence.recipient = `${recipient[0]}***@***`;
        const result = await sendMatchNotificationEmail({ rendered });
        evidence.providerAccepted = Boolean(result?.id);
        if (!result?.id) throw new Error('SMTP_SEND_NOT_ACCEPTED');
    }
} catch (error) {
    const safeCodes = ['INVALID_ARGUMENTS', 'TEST_RECIPIENT_REQUIRED', 'SMTP_NOT_SELECTED', 'EAUTH',
        'ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ESOCKET', 'ETLS', 'SMTP_UNAVAILABLE', 'SMTP_SEND_NOT_ACCEPTED'];
    evidence.errorCode = safeCodes.includes(error?.message) ? error.message : 'SMTP_TEST_FAILED';
    process.exitCode = 1;
}
console.log(JSON.stringify(evidence, null, 2));
if (evidencePath && !evidencePath.startsWith('--')) {
    try { await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n'); }
    catch { console.error('Unable to write SMTP test evidence.'); process.exitCode = 1; }
}
