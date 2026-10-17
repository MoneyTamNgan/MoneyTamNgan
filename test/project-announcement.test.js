import test from 'node:test';
import assert from 'node:assert/strict';
import { findProjectInvitation, officialInvitationUrl, syncProjectAnnouncement, verifyProcurementWithAnnouncement } from '../lib/project-announcement.js';
import { parseAnnouncementSchedule } from '../lib/announcement-schedule.js';
const url = 'https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=test';
const project = { _id: 'p', project_id: '67000000001', source: { rss_dept_id: '0304' }, primary_document_id: 'tor', latest_summary_id: 'summary' };
const now = new Date('2026-10-07T00:00:00+07:00');
const schedule = () => parseAnnouncementSchedule('วันเสนอราคา 8 ตุลาคม 2569 ระหว่างเวลา 09.00 ถึง 12.00');

test('RSS lookup matches project IDs exactly and rejects conflicting versions', async () => {
    const deps = { sleep: async () => {}, now: () => 0, feed: async () => [{ projectId: 'different', link: url }, { projectId: project.project_id, link: url }] };
    assert.equal((await findProjectInvitation(project, deps)).url, url);
    await assert.rejects(findProjectInvitation(project, { ...deps, feed: async () => [
        { projectId: project.project_id, link: url }, { projectId: project.project_id, link: `${url}2` },
    ] }), /Conflicting/);
    for (const invalid of ['http://localhost/x', 'https://example.org/file.pdf', 'https://process5.gprocurement.go.th/wrong']) {
        assert.throws(() => officialInvitationUrl(invalid));
    }
});

test('sync persists schedule atomically without touching TOR/OCR/Vertex pointers and cleans temporary PDF', async () => {
    const writes = [], cleaned = [];
    const r = await syncProjectAnnouncement(project, { now,
        lookup: async () => ({ url, deptId: '0304' }),
        download: async () => ({ path: 'temp.pdf', size: 10 }),
        extract: async () => ({ schedule: schedule(), method: 'embedded' }),
        hash: async () => ({ sha256: 'hash', size: 10 }),
        register: async (...args) => { assert.equal(args[2].backend, 'remote'); return { _id: 'announcement' }; },
        transaction: async fn => fn('session'),
        Projects: { updateOne: async (filter, update, options) => { assert.equal(options.session, 'session'); writes.push(update.$set); } },
        cleanup: async file => cleaned.push(file.pdf_path),
    });
    assert.equal(r.project.bidding_date.date, '2026-10-08');
    assert.equal(r.project.latest_summary_id, 'summary');
    assert.equal(r.project.primary_document_id, 'tor');
    assert.ok(!('primary_document_id' in writes[0]));
    assert.ok(!('latest_summary_id' in writes[0]));
    assert.equal(r.eligibility.status, 'open');
    assert.deepEqual(cleaned, ['temp.pdf']);
});

test('transaction failures propagate for retry, while cleanup still runs', async () => {
    let cleaned = false;
    await assert.rejects(syncProjectAnnouncement(project, { lookup: async () => ({ url }),
        download: async () => ({ path: 'temp.pdf' }), extract: async () => ({ schedule: schedule() }),
        hash: async () => ({ sha256: 'hash' }), transaction: async () => { throw new Error('transaction failed'); },
        cleanup: async () => { cleaned = true; },
    }), /transaction failed/);
    assert.equal(cleaned, true);
});

test('missing source is explicit; durable TOR history is not erased', async () => {
    let write;
    const r = await syncProjectAnnouncement(project, { lookup: async () => null,
        Projects: { updateOne: async (f, u) => { write = u.$set; } }, now });
    assert.equal(r.status, 'not_found');
    assert.equal(r.project.latest_summary_id, 'summary');
    assert.deepEqual(Object.keys(write), ['announcement_schedule']);
});

test('current official cancellation wins; matching RSS fallback may verify an unavailable HTML page', async () => {
    const closed = await verifyProcurementWithAnnouncement(project, {
        verifyOfficial: async () => ({ status: 'closed' }), lookup: async () => assert.fail('must not bypass cancellation'),
    });
    assert.equal(closed.status, 'closed');
    let cleaned = false;
    const r = await verifyProcurementWithAnnouncement(project, { now,
        verifyOfficial: async () => ({ status: 'unknown', reason: 'page unavailable' }), lookup: async () => ({ url, deptId: '0304' }),
        download: async () => ({ path: 'temp.pdf' }), extract: async () => ({ schedule: schedule() }),
        cleanup: async () => { cleaned = true; },
    });
    assert.equal(r.status, 'open');
    assert.equal(r.announcement_url, url);
    assert.equal(cleaned, true);
});

test('unavailable or uncertain announcements never fall back to old open API metadata', async () => {
    for (const s of [null, { status: 'needs_review' }]) {
        const r = await verifyProcurementWithAnnouncement({ ...project, bid_deadline: '2030-01-01T12:00:00+07:00' }, { now,
            verifyOfficial: async () => ({ status: 'unknown', reason: 'page unavailable' }), lookup: async () => s ? ({ url }) : null,
            download: async () => ({ path: 'temp.pdf' }), extract: async () => ({ schedule: s }), cleanup: async () => {},
        });
        assert.equal(r.status, 'unknown');
    }
});
