import test from 'node:test';
import assert from 'node:assert/strict';
import { currentThaiFiscalYear, parseBidDeadline, assessProcurementEligibility, parseOfficialEligibilityHtml,
    verifyProcurementEligibility, verifySoftwareProcurement } from '../lib/procurement-eligibility.js';

const now = new Date('2026-10-07T03:00:00Z');
test('legacy scraper admission requires software metadata and current open evidence', async () => {
    const mustNotVerify = async () => { throw new Error('Non-software must not contact official page'); };
    assert.equal((await verifySoftwareProcurement(null, {}, mustNotVerify)).allowed, false);
    assert.equal((await verifySoftwareProcurement({ project_name: 'ก่อสร้างอาคาร' }, {}, mustNotVerify)).allowed, false);
    assert.equal((await verifySoftwareProcurement({ project_name: 'งานทดสอบ' }, {}, mustNotVerify)).allowed, false);
    const software = { project_name: 'พัฒนาระบบสารสนเทศ' };
    assert.equal((await verifySoftwareProcurement(software, {}, async () => ({ status: 'closed' }))).allowed, false);
    assert.equal((await verifySoftwareProcurement(software, {}, async () => ({ status: 'open' }))).allowed, true);
});
test('current Thai fiscal year rolls over in October in Bangkok', () => {
    assert.equal(currentThaiFiscalYear(new Date('2026-09-30T16:59:59Z')), '2569');
    assert.equal(currentThaiFiscalYear(new Date('2026-09-30T17:00:00Z')), '2570');
});
test('deadline parsing handles Thai digits, Buddhist years and Bangkok time', () => {
    assert.equal(parseBidDeadline('๘ ตุลาคม ๒๕๖๙ เวลา ๑๖.๓๐ น.').toISOString(), '2026-10-08T09:30:00.000Z');
    assert.equal(parseBidDeadline('08/10/2569 16:30').toISOString(), '2026-10-08T09:30:00.000Z');
    assert.equal(parseBidDeadline('2026-10-08T16:30:00+07:00').toISOString(), '2026-10-08T09:30:00.000Z');
    for (const value of ['08/10/2569', '31/02/2569 16:30', '08/10/2569 24:30', '2026-10-08T16:30:00']) {
        assert.equal(parseBidDeadline(value), null);
    }
});
test('future bids open, passed and exact deadline close, future starts wait', () => {
    const assess = record => assessProcurementEligibility(record, { now });
    assert.equal(assess({ bid_deadline: '08/10/2569 16:30' }).status, 'open');
    assert.equal(assess({ bid_deadline: '07/10/2569 10:00' }).status, 'closed');
    assert.equal(assess({ bid_deadline: '06/10/2569 16:30' }).status, 'closed');
    assert.equal(assess({ bid_deadline: '08/10/2569 16:30', bid_submission_start: '08/10/2569 08:00' }).status, 'not_yet_open');
});
test('contracts, award and cancellation win over future dates; generic Active proves nothing', () => {
    for (const record of [{ contract: [{ contract_date: '1 ต.ค. 69' }] },
        { timeline: { contract_start: '2026-01-01' } }, { project_status: 'ยกเลิก' }, { project_status: 'awarded' }]) {
        assert.equal(assessProcurementEligibility({ bid_deadline: '08/10/2569 16:30', ...record }, { now }).status, 'closed');
    }
    assert.equal(assessProcurementEligibility({ project_status: 'Active', timeline: { contract_end: '2030-01-01' } }, { now }).status, 'unknown');
    assert.equal(assessProcurementEligibility({ project_status: 'ร่าง TOR', bid_deadline: '08/10/2569 16:30' }, { now }).status, 'unknown');
});
test('official HTML accepts labelled deadlines only; conflicting/challenge pages remain unknown', () => {
    const parse = text => parseOfficialEligibilityHtml(`<body>${text}</body>`, { now });
    assert.equal(parse('วันสิ้นสุดการยื่นข้อเสนอ: 08/10/2569 16:30').status, 'open');
    assert.equal(parse('วันสิ้นสุดการเสนอราคา: 06/10/2569 16:30').status, 'closed');
    assert.equal(parse('วันสิ้นสุดการเสนอราคา: 08/10/2569 16:30\nสถานะโครงการ: ยกเลิก').status, 'closed');
    assert.equal(parse('วันสิ้นสุดการเสนอราคา: 08/10/2569 16:30\nวันสิ้นสุดการเสนอราคา: 09/10/2569 16:30').status, 'unknown');
    assert.equal(parse('วันประกาศ: 08/10/2569 16:30').status, 'unknown');
    assert.equal(parse('Just a moment! วันสิ้นสุดการเสนอราคา: 08/10/2569 16:30').status, 'unknown');
});
test('verifier never falls back to open metadata when official verification fails', async () => {
    const result = await verifyProcurementEligibility({ project_id: '123456', bid_deadline: '08/10/2569 16:30' },
        { now, resolve: async () => { throw new Error('Unavailable'); } });
    assert.equal(result.status, 'unknown');
    assert.match(result.reason, /Unavailable/);
});
test('verifier checks official current content and prevents unexpected hosts', async () => {
    const record = { project_id: '123456' };
    const result = await verifyProcurementEligibility(record, { now,
        resolve: async () => ({ officialDetailUrl: 'https://process5.gprocurement.go.th/egp-agpc01-web/announcement/procurement/example' }),
        fetchPage: async () => new Response('<body>เลขที่โครงการ 123456\nวันสิ้นสุดการเสนอราคา: 08/10/2569 16:30</body>', { headers: { 'Content-Type': 'text/html' } }) });
    assert.equal(result.status, 'open');
    const denied = await verifyProcurementEligibility(record, { now,
        resolve: async () => ({ officialDetailUrl: 'https://example.com/' }),
        fetchPage: async () => { throw new Error('Must not request unexpected host'); } });
    assert.equal(denied.status, 'unknown');
    assert.match(denied.reason, /Unexpected official URL/);
});
test('official content must identify the requested project; stale deadline is rechecked for extensions', async () => {
    assert.equal(parseOfficialEligibilityHtml('<body>เลขที่โครงการ 999999\nวันสิ้นสุดการเสนอราคา: 08/10/2569 16:30</body>',
        { now, projectId: '123456' }).status, 'unknown');
    const extended = await verifyProcurementEligibility({ project_id: '123456', bid_deadline: '06/10/2569 16:30' }, {
        now, minDelayMs: 0,
        resolve: async () => ({ officialDetailUrl: 'https://process5.gprocurement.go.th/egp-agpc01-web/announcement/procurement/example' }),
        fetchPage: async () => new Response('<body>เลขที่โครงการ 123456\nวันสิ้นสุดการเสนอราคา: 08/10/2569 16:30</body>',
            { headers: { 'Content-Type': 'text/html' } }),
    });
    assert.equal(extended.status, 'open');
});
