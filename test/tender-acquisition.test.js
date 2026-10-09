import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import { acquireTenderDocuments, createAcquisitionContext } from '../lib/tender-acquisition.js';
import { collectOpenTenders, tenderStatus } from '../lib/egp-rss.js';
import { parseAnnouncingAgency, parseInvitation, parseReferencePrice } from '../lib/egp-announcement.js';
import { persistAnnouncementRecord } from '../lib/mongo-artifacts.js';

// pdftotext output from a real e-GP invitation (project 69099693138).
const INVITATION_TEXT = [
    '(สำเนา)',
    'ประกาศจังหวัดแพร่',
    'เรื่อง ประกวดราคาจ้างก่อสร้างซ่อมแซมและปรับปรุงบ้านพักข้าราชการสำนักงานคลังจังหวัดแพร่',
    'ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    '',
    'จังหวัดแพร่ มีความประสงค์จะประกวดราคาจ้างก่อสร้างซ่อมแซมและปรับปรุงบ้านพัก',
    'ก่อสร้าง ในการประกวดราคาครั้งนี้ เป็นเงินทั้งสิ้น ๑,๘๔๑,๘๐๐.๐๐ บาท (หนึ่งล้านแปดแสนสี่หมื่นหนึ่งพัน',
    '๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๘ ตุลาคม ๒๕๖๙',
    'ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่',
].join('\n');

const noSleep = async () => {};
const failingScrape = error => async () => ({ pdf_path: null, error, outcome: 'failed', retryable: true });

function fakeDownload(calls = []) {
    return async (attachment, target) => {
        calls.push({ attachment, target });
        if (attachment.type === 'zip') {
            return {
                path: `storage/tor/${target.projectId}/extracted/001-TOR.pdf`,
                size: 100, contentType: 'application/pdf',
                archivePath: `storage/tor/${target.projectId}/draft.zip`,
                archiveSize: 200, archiveContentType: 'application/zip',
                extractedPdfs: [{ entryName: 'TOR.pdf', filename: '001-TOR.pdf',
                    path: `storage/tor/${target.projectId}/extracted/001-TOR.pdf`, size: 100 }],
            };
        }
        return { path: `storage/tor/${target.projectId}/dant.pdf`, size: 50, contentType: 'application/pdf' };
    };
}

test('invitation parser reads agency, reference price and closing time', () => {
    assert.equal(parseAnnouncingAgency(INVITATION_TEXT), 'จังหวัดแพร่');
    assert.equal(parseReferencePrice(INVITATION_TEXT), 1841800);
    assert.equal(parseInvitation(INVITATION_TEXT).submission.closesAt, '2026-10-08T12:00:00+07:00');
    assert.deepEqual(parseInvitation('ไม่มีข้อมูล'), { agency: null, referencePrice: null, submission: null });
});

test('tenderStatus prefers a past closing time, then the latest feed stage', () => {
    const now = new Date('2026-10-05T00:00:00+07:00');
    assert.equal(tenderStatus({ hasInvitation: true, closesAt: '2026-10-01T12:00:00+07:00' }, now), 'closed');
    assert.equal(tenderStatus({ hasDraft: true, hasInvitation: true, closesAt: '2026-10-08T12:00:00+07:00' }, now), 'bidding_open');
    assert.equal(tenderStatus({ hasDraft: true }, now), 'draft_open');
    assert.equal(tenderStatus({}, now), 'unknown');
});

test('collectOpenTenders merges B0 and D0 links per project and keeps going after feed errors', async () => {
    const xml = (id, link) => `<rss><channel><item><title>t${id}</title>`
        + `<description>${id}, e-bidding, x</description><link>${link}</link>`
        + '<pubDate>2026-09-30</pubDate></item></channel></rss>';
    const fetchImpl = async url => {
        const { searchParams } = new URL(url);
        const dept = searchParams.get('deptId');
        if (dept === '0002') return new Response('', { status: 503 });
        const type = searchParams.get('anounceType');
        return new Response(xml('69099693138', `https://example.test/${type}`), { status: 200 });
    };
    const errors = [];
    const tenders = await collectOpenTenders({
        deptIds: ['0001', '0002'], fetchImpl, sleep: noSleep, backoffMs: [],
        onError: error => errors.push(error),
    });
    assert.equal(tenders.length, 1);
    assert.equal(tenders[0].draftLink, 'https://example.test/B0');
    assert.equal(tenders[0].invitationLink, 'https://example.test/D0');
    assert.equal(errors.length, 2);
});

test('feed route fetches the invitation and the draft ZIP without a browser', async () => {
    const calls = [];
    const outcome = await acquireTenderDocuments(
        { projectId: '69099693138', draftLink: 'https://e.test/zip', invitationLink: 'https://e.test/pdf' },
        createAcquisitionContext({ sleep: noSleep }),
        {
            download: fakeDownload(calls),
            readText: async () => INVITATION_TEXT,
            scrape: () => assert.fail('browser must not run'),
            launch: () => assert.fail('browser must not launch'),
        }
    );
    assert.equal(outcome.torRoute, 'feed');
    assert.equal(outcome.tor.pdf_path, 'storage/tor/69099693138/extracted/001-TOR.pdf');
    assert.equal(outcome.tor.extracted_pdfs.length, 1);
    assert.equal(outcome.announcement.path, 'storage/tor/69099693138/dant.pdf');
    assert.equal(outcome.announcement.invitation.agency, 'จังหวัดแพร่');
    assert.deepEqual(calls.map(call => call.attachment.type), ['pdf', 'zip']);
});

test('browser fallback retries transient failures and resets the breaker on success', async () => {
    let attempts = 0;
    const sleeps = [];
    const ctx = createAcquisitionContext({ sleep: async ms => sleeps.push(ms) });
    const outcome = await acquireTenderDocuments(
        { projectId: '69099000001', invitationLink: 'https://e.test/pdf' },
        ctx,
        {
            download: fakeDownload(),
            readText: async () => INVITATION_TEXT,
            launch: async () => ({ connected: true, close: async () => {} }),
            scrape: async () => (++attempts < 3
                ? { pdf_path: null, error: 'Navigation timeout of 30000 ms exceeded', retryable: true }
                : { pdf_path: 'storage/tor/69099000001/TOR.pdf', extracted_pdfs: [] }),
        }
    );
    assert.equal(outcome.torRoute, 'browser');
    assert.equal(outcome.torAttempts, 3);
    assert.deepEqual(sleeps, [15000, 60000]);
    assert.equal(ctx.consecutiveTransient, 0);
});

test('browser fallback stops at non-retryable failures and still returns the announcement', async () => {
    let attempts = 0;
    const outcome = await acquireTenderDocuments(
        { projectId: '69099000002', invitationLink: 'https://e.test/pdf' },
        createAcquisitionContext({ sleep: noSleep }),
        {
            download: fakeDownload(),
            readText: async () => INVITATION_TEXT,
            launch: async () => ({ connected: true, close: async () => {} }),
            scrape: async () => {
                attempts += 1;
                return { pdf_path: null, error: 'Aggregator returned no official e-GP detail link', retryable: false };
            },
        }
    );
    assert.equal(attempts, 1);
    assert.equal(outcome.tor, null);
    assert.match(outcome.torError, /Aggregator/);
    assert.ok(outcome.announcement);
});

test('circuit breaker pauses after consecutive transient failures', async () => {
    const sleeps = [];
    const ctx = createAcquisitionContext({
        sleep: async ms => sleeps.push(ms), retryDelaysMs: [], breakerThreshold: 2, breakerPauseMs: 999,
    });
    const deps = {
        download: fakeDownload(),
        launch: async () => ({ connected: true, close: async () => {} }),
        scrape: failingScrape('e-GP returned an empty page after the render retries'),
    };
    for (const id of ['1', '2', '3']) await acquireTenderDocuments({ projectId: id }, ctx, deps);
    assert.deepEqual(sleeps, [999]);
});

test('announcement records link by feed URL and reuse identical ZIP entries', async () => {
    const project = { _id: new mongoose.Types.ObjectId(), project_id: '69099693138' };
    const announcement = { url: 'https://e.test/pdf', path: 'storage/tor/69099693138/dant.pdf', size: 50 };
    const persisted = { sha256: 'c'.repeat(64), size: 50, backend: 'local', gcsUri: null };

    let upsert;
    const created = await persistAnnouncementRecord(project, announcement, persisted, { DocumentModel: {
        findOne: () => ({ lean: async () => null }),
        findOneAndUpdate: async (filter, update, options) => {
            upsert = { filter, update, options };
            return { _id: 'new', ...filter, ...update.$set };
        },
    } });
    assert.deepEqual(upsert.filter, {
        project_id: '69099693138', source_url: 'https://e.test/pdf', entry_name: 'dant.pdf',
    });
    assert.equal(created.document_type, 'announcement');
    assert.equal(created.is_current_primary, false);
    assert.equal(created.storage.local_path, 'storage/tor/69099693138/dant.pdf');
    assert.equal(upsert.options.upsert, true);

    const existing = { _id: 'zip-entry', sha256: persisted.sha256 };
    const reused = await persistAnnouncementRecord(project, announcement, persisted, { DocumentModel: {
        findOne: () => ({ lean: async () => existing }),
        findOneAndUpdate: () => assert.fail('must not create a duplicate sha256'),
    } });
    assert.equal(reused, existing);
});

test('RSS-created projects validate without Open Data agency and budget', async () => {
    const rss = new Project({ project_id: '69099693138', project_name: 'x', source: { provider: 'egp_rss' },
        tender: { status: 'bidding_open', closes_at: new Date() } });
    await assert.doesNotReject(() => rss.validate());
    const api = new Project({ project_id: '67079116603', project_name: 'x' });
    await assert.rejects(() => api.validate(), /dept_name|budget/);
});

test('collectOpenTenders stops at maxProjects and drops a feed type that keeps failing', async () => {
    const requested = [];
    const fetchImpl = async url => {
        const { searchParams } = new URL(url);
        const dept = searchParams.get('deptId');
        const type = searchParams.get('anounceType');
        requested.push(`${dept}/${type}`);
        if (type === 'B0') return new Response('', { status: 503 });
        const id = `690990000${dept}`;
        return new Response(`<rss><channel><item><title>t</title><description>${id}, e-bidding, x</description>`
            + '<link>https://example.test/D0</link></item></channel></rss>', { status: 200 });
    };
    const tenders = await collectOpenTenders({
        deptIds: ['01', '02', '03', '04', '05'], fetchImpl, sleep: noSleep, backoffMs: [],
        typeFailureLimit: 2, maxProjects: 4,
    });
    assert.equal(tenders.length, 4);
    assert.deepEqual(requested, ['01/B0', '01/D0', '02/B0', '02/D0', '03/D0', '04/D0']);
});

test('disabling the browser keeps feed documents and skips the scraper', async () => {
    const outcome = await acquireTenderDocuments(
        { projectId: '69099000003', invitationLink: 'https://e.test/pdf' },
        createAcquisitionContext({ sleep: noSleep, allowBrowser: false }),
        {
            download: fakeDownload(),
            readText: async () => INVITATION_TEXT,
            launch: () => assert.fail('browser must not launch'),
            scrape: () => assert.fail('browser must not run'),
        }
    );
    assert.equal(outcome.tor, null);
    assert.match(outcome.torError, /disabled/);
    assert.ok(outcome.announcement);
});

test('GridFS announcements store the file id instead of a local path', async () => {
    const project = { _id: new mongoose.Types.ObjectId(), project_id: '69099693138' };
    const announcement = { url: 'https://e.test/pdf', path: 'storage/tor/69099693138/dant.pdf', size: 50 };
    const gridfsId = new mongoose.Types.ObjectId();
    const persisted = { sha256: 'd'.repeat(64), size: 50, backend: 'gridfs', gridfsId };

    const created = await persistAnnouncementRecord(project, announcement, persisted, { DocumentModel: {
        findOne: () => ({ lean: async () => null }),
        findOneAndUpdate: async (filter, update) => ({ ...filter, ...update.$set }),
    } });
    assert.equal(created.storage.backend, 'gridfs');
    assert.equal(created.storage.gridfs_id, gridfsId);
    assert.equal(created.storage.local_path, undefined);

    let moved;
    await persistAnnouncementRecord(project, announcement, persisted, { DocumentModel: {
        findOne: () => ({ lean: async () => ({ _id: 'old', sha256: persisted.sha256 }) }),
        findOneAndUpdate: async (filter, update) => { moved = { filter, update }; return {}; },
    } });
    assert.deepEqual(moved.filter, { _id: 'old' });
    assert.equal(moved.update.$set['storage.gridfs_id'], gridfsId);
});

test('collectOpenTenders does not back off after a feed timeout', async () => {
    const sleeps = [];
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    };
    await collectOpenTenders({
        deptIds: ['01'], fetchImpl, delayMs: 1, backoffMs: [30000], sleep: async ms => sleeps.push(ms),
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1]);
});
