import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import { parseAnnouncementSchedule, announcementScheduleFields, announcementProcurementEligibility } from '../lib/announcement-schedule.js';
import { acquireTenderDocuments, createAcquisitionContext, extractAnnouncementSchedule } from '../lib/tender-acquisition.js';

const invitation = 'ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบในวันที่ ๘ ตุลาคม ๒๕๖๙\nระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น. ซึ่งสามารถจัดเตรียมเอกสารได้ตั้งแต่วันที่ 1 ตุลาคม 2569';

test('announcement admission requires a validated current deadline, without weakening contract/award exclusion', () => {
    const announcement = { schedule: parseAnnouncementSchedule(invitation) };
    const before = { now: new Date('2026-10-07T00:00:00+07:00') };
    assert.equal(announcementProcurementEligibility({}, announcement, before).status, 'open');
    assert.equal(announcementProcurementEligibility({}, announcement, { now: new Date('2026-10-09') }).status, 'closed');
    assert.equal(announcementProcurementEligibility({ project_status: 'awarded' }, announcement, before).status, 'closed');
    assert.equal(announcementProcurementEligibility({ bid_submission_end: '2080-01-01T12:00:00+07:00' }, null, before).status, 'unknown');
    const uncertain = { schedule: { ...announcement.schedule, status: 'needs_review' } };
    assert.equal(announcementProcurementEligibility({}, uncertain, before).status, 'unknown');
});

test('expired announcement still persists schedule output but prevents subsequent TOR/ZIP acquisition', async () => {
    const calls = [];
    const result = await acquireTenderDocuments({ projectId: '69099693138', invitationLink: 'https://e.test/a.pdf', draftLink: 'https://e.test/b.zip' },
        createAcquisitionContext({ allowBrowser: false }), {
            download: async attachment => { calls.push(attachment.type); return { path: 'a.pdf', size: 100 }; },
            readText: async () => invitation,
            checkEligibility: announcement => announcementProcurementEligibility({}, announcement, { now: new Date('2026-10-09') }),
            scrape: () => assert.fail('closed bid must not invoke browser'),
        });
    assert.deepEqual(calls, ['pdf']);
    assert.equal(result.torDeferred, true);
    assert.equal(result.eligibility.status, 'closed');
    assert.equal(result.announcement.schedule.status, 'parsed');
});

test('Thai digits and Buddhist year normalize with Bangkok submission instants and page evidence', () => {
    const s = parseAnnouncementSchedule(`หน้าหนึ่ง\f${invitation}`);
    assert.equal(s.status, 'parsed');
    assert.equal(s.bidding_date.date, '2026-10-08');
    assert.equal(s.bidding_date.kind, 'bid_submission');
    assert.equal(s.bidding_date.at, null); // a window is not a single bidding instant
    assert.equal(s.submission_schedule.start_time, '09:00');
    assert.equal(s.submission_schedule.ends_at, '2026-10-08T12:00:00+07:00');
    assert.equal(s.evidence[0].page, 2);
    assert.match(s.evidence[0].text, /8 ตุลาคม 2569/);
    assert.equal(s.text_sha256.length, 64);
});

test('opening and submission dates remain distinct; opening time does not become a submission window', () => {
    const s = parseAnnouncementSchedule(`${invitation}\nวันเปิดซอง 9 ตุลาคม 2569 เวลา 13:30 น.`);
    assert.equal(s.bidding_date.date, '2026-10-08');
    assert.equal(s.evidence[1].kind, 'bid_opening');
    assert.equal(s.evidence[1].date, '2026-10-09');
    const opening = parseAnnouncementSchedule('วันเปิดซอง 9 ต.ค. 2569 เวลา 13:30 น.');
    assert.equal(opening.bidding_date.kind, 'bid_opening');
    assert.equal(opening.bidding_date.at, '2026-10-09T13:30:00+07:00');
    assert.equal(opening.submission_schedule, null);
});

test('all Thai months, abbreviations, numeric and ISO dates parse', () => {
    const names = ['มกราคม', 'ก.พ.', 'มีนาคม', 'เม.ย.', 'พฤษภาคม', 'มิ.ย.', 'กรกฎาคม', 'ส.ค.', 'กันยายน', 'ต.ค.', 'พฤศจิกายน', 'ธ.ค.'];
    names.forEach((m, i) => assert.equal(parseAnnouncementSchedule(`วันเสนอราคา 1 ${m} พ.ศ. 2570`).bidding_date.date,
        `2027-${String(i + 1).padStart(2, '0')}-01`));
    for (const value of ['08/10/2569', '2026-10-08', '8 ต.ค. 69']) {
        assert.equal(parseAnnouncementSchedule(`วันเสนอราคา ${value}`).bidding_date.date, '2026-10-08');
    }
});

test('positioned e-GP PDF values after placeholders are supported', () => {
    const s = parseAnnouncementSchedule('ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบในวันที่ ๘\nระหว่างเวลา น. ถึง น.\nตุลาคม ๒๕๖๙ ๐๙.๐๐ ๑๒.๐๐');
    assert.equal(s.submission_schedule.ends_at, '2026-10-08T12:00:00+07:00');
});

test('submission anchor can wrap across lines within the same PDF page', () => {
    const s = parseAnnouncementSchedule('ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐ\nด้วยอิเล็กทรอนิกส์\nในวันที่ 8 ตุลาคม 2569 ระหว่างเวลา 09.00 ถึง 12.00');
    assert.equal(s.status, 'parsed');
    assert.equal(s.submission_schedule.end_time, '12:00');
});

test('impossible calendar dates are rejected and leap years validated', () => {
    for (const d of ['31 กุมภาพันธ์ 2569', '29 กุมภาพันธ์ 2569', '31/04/2569', '2026-13-01']) {
        assert.equal(parseAnnouncementSchedule(`วันเสนอราคา ${d}`).bidding_date, null);
    }
    assert.equal(parseAnnouncementSchedule('วันเสนอราคา 29 กุมภาพันธ์ 2567').bidding_date.date, '2024-02-29');
});

test('invalid/reversed windows cannot create a closing deadline', () => {
    for (const range of ['25.00 ถึง 26.00', '12.00 ถึง 09.00', '09.00 ถึง 09.00']) {
        const s = parseAnnouncementSchedule(`วันเสนอราคา 8 ตุลาคม 2569 ระหว่างเวลา ${range}`);
        assert.equal(s.status, 'needs_review');
        assert.equal(s.submission_schedule.ends_at, null);
    }
    assert.equal(parseAnnouncementSchedule('วันเสนอราคา 8 ตุลาคม 2569').submission_schedule.ends_at, null);
});

test('conflicting submission dates require review rather than choosing the first', () => {
    const s = parseAnnouncementSchedule(`${invitation}\nวันเสนอราคา 9 ตุลาคม 2569 เวลา 13.00 น.`);
    assert.equal(s.status, 'needs_review');
    assert.equal(s.bidding_date, null);
    assert.equal(s.submission_schedule, null);
    assert.ok(s.warnings.includes('conflicting_schedule'));
});

test('publication, fiscal year and document purchase dates are not bidding dates', () => {
    for (const text of ['', 'ปีงบประมาณ 2569 ประกาศ ณ วันที่ 8 ตุลาคม 2569',
        'ขอซื้อเอกสารวันที่ 8 ตุลาคม 2569 ระหว่างเวลา 09.00 ถึง 12.00']) {
        assert.equal(parseAnnouncementSchedule(text).bidding_date, null);
    }
});

test('real announcement boilerplate until bidding date does not capture document publication date', () => {
    const text = `${invitation}\nประกาศจนถึงวันเสนอราคา\n3. ดาวน์โหลดเอกสารเลขที่ 1/2569 ลงวันที่ 30 กันยายน พ.ศ. 2569\nได้ตั้งแต่วันที่ประกาศจนถึงวันเสนอราคา ได้ที่เว็บไซต์ example.test\nประกาศ ณ วันที่ 30 กันยายน 2569`;
    const s = parseAnnouncementSchedule(text);
    assert.equal(s.status, 'parsed');
    assert.equal(s.bidding_date.date, '2026-10-08');
    assert.equal(s.evidence.length, 1);
});

test('unreadable announcement uses Thai OCR, preserving actual page numbers', async () => {
    let calls = 0;
    const r = await extractAnnouncementSchedule('fake.pdf', {
        readText: async () => '',
        ocr: async () => { calls++; return { pages: [{ page_number: 3, text: invitation, extraction_method: 'ocr' }], needsReview: true }; },
    });
    assert.equal(calls, 1);
    assert.equal(r.method, 'ocr');
    assert.equal(r.schedule.evidence[0].page, 3);
    assert.equal(r.schedule.status, 'needs_review');
    assert.equal(r.schedule.bidding_date, null);
    assert.equal(r.schedule.submission_schedule, null);
    assert.match(r.text, /เสนอราคา/);
});

test('readable OCR without quality warnings can populate structured schedule fields', async () => {
    const r = await extractAnnouncementSchedule('fake.pdf', {
        readText: async () => '',
        ocr: async () => ({ pages: [{ page_number: 1, text: invitation, extraction_method: 'ocr' }], needsReview: false }),
    });
    assert.equal(r.schedule.status, 'parsed');
    assert.equal(r.schedule.bidding_date.date, '2026-10-08');
    assert.equal(r.schedule.submission_schedule.end_time, '12:00');
});

test('extraction errors remain visible, with no invented schedule', async () => {
    const r = await extractAnnouncementSchedule('fake.pdf', {
        readText: async () => { throw new Error('pdftotext failed'); },
        ocr: async () => { throw new Error('missing tha traineddata'); },
    });
    assert.match(r.error, /missing tha/);
    assert.equal(r.schedule.status, 'needs_review');
    assert.equal(r.schedule.bidding_date, null);
});

test('PR60 acquisition keeps schedule when TOR acquisition fails, and skips OCR on usable embedded text', async () => {
    const result = await acquireTenderDocuments({ projectId: '69099693138', invitationLink: 'https://example.test/dant.pdf' },
        createAcquisitionContext({ allowBrowser: false }), {
            download: async () => ({ path: 'fake.pdf', size: 100, contentType: 'application/pdf' }),
            readText: async () => invitation,
            ocr: async () => assert.fail('embedded invitation must not trigger OCR'),
        });
    assert.equal(result.tor, null);
    assert.equal(result.announcement.schedule.status, 'parsed');
    assert.equal(result.announcement.invitation.submission.closesAt, '2026-10-08T12:00:00+07:00');
});

test('Mongo schema retains structured fields, evidence and timezone, with matching legacy deadlines', async () => {
    const documentId = new mongoose.Types.ObjectId();
    const fields = announcementScheduleFields(parseAnnouncementSchedule(invitation), { documentId, sourceUrl: 'https://example.test/a.pdf' });
    const project = new Project({ project_id: '69099693138', project_name: 'Test', source: { provider: 'egp_rss' }, ...fields });
    await project.validate();
    assert.equal(project.bidding_date.date, '2026-10-08');
    assert.equal(project.submission_schedule.ends_at.toISOString(), '2026-10-08T05:00:00.000Z');
    assert.equal(project.announcement_schedule.document_id.toString(), documentId.toString());
    assert.equal(fields['tender.closes_at'].getTime(), project.submission_schedule.ends_at.getTime());
    const missing = announcementScheduleFields(parseAnnouncementSchedule(''));
    assert.equal(missing['tender.closes_at'], null); // do not keep an obsolete previous deadline
});

test('uncertain OCR candidates are stored for review but do not automatically close the tender', () => {
    const schedule = parseAnnouncementSchedule(invitation);
    schedule.status = 'needs_review';
    const fields = announcementScheduleFields(schedule);
    assert.equal(fields.submission_schedule.end_time, '12:00');
    assert.equal(fields['tender.closes_at'], null);
});
