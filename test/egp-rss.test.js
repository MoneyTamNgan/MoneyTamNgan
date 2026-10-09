import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeFeed, fetchAnnouncementFeed, parseFeed } from '../lib/egp-rss.js';
import { normalizeThaiDigits, parseSubmissionWindow } from '../lib/egp-announcement.js';

const fixture = () => readFile(new URL('./fixtures/egp-rss-d0.xml', import.meta.url));

test('parseFeed decodes windows-874 items into project announcements', async () => {
    const items = parseFeed(decodeFeed(await fixture()));
    assert.equal(items.length, 2);
    assert.deepEqual(items[1], {
        projectId: '69099693138',
        title: 'ประกวดราคาจ้างก่อสร้างซ่อมแซมและปรับปรุงบ้านพักข้าราชการสำนักงานคลังจังหวัดแพร่ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
        method: 'ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
        announceLabel: 'ประกาศเชิญชวน',
        link: 'https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=6572bdad-5898-4bb8-9095-8378e36c9801',
        pubDate: '2026-09-30',
    });
});

test('parseFeed skips items without an e-GP project ID', () => {
    const xml = '<rss><channel><item><description>n/a, x</description><link>l</link></item></channel></rss>';
    assert.deepEqual(parseFeed(xml), []);
});

test('fetchAnnouncementFeed tags items with department and type', async () => {
    const body = await fixture();
    let requested;
    const fetchImpl = async url => {
        requested = url;
        return new Response(body, { status: 200 });
    };
    const items = await fetchAnnouncementFeed({ deptId: '0304', type: 'D0', fetchImpl });
    assert.match(requested, /deptId=0304&anounceType=D0$/);
    assert.equal(items[0].deptId, '0304');
    assert.equal(items[0].announceType, 'D0');
});

test('fetchAnnouncementFeed rejects HTTP errors', async () => {
    const fetchImpl = async () => new Response('', { status: 503 });
    await assert.rejects(fetchAnnouncementFeed({ deptId: '0304', type: 'B0', fetchImpl }), /HTTP 503/);
});

test('normalizeThaiDigits converts Thai numerals', () => {
    assert.equal(normalizeThaiDigits('๐๙.๓๐ น. ๒๕๖๙'), '09.30 น. 2569');
});

test('parseSubmissionWindow reads template values extracted out of order', () => {
    // Real pypdf output from an e-GP invitation: values follow the static text.
    const text = [
        '๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๘ ',
        ' ระหว่างเวลา  น. ถึง  น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ตุลาคม ๒๕๖๙ ๐๙.๐๐ ๑๒.๐๐',
        'ประกาศจนถึงวันเสนอราคา',
    ].join('\n');
    assert.deepEqual(
        { ...parseSubmissionWindow(text), raw: undefined },
        {
            date: '2026-10-08', startTime: '09:00', endTime: '12:00',
            closesAt: '2026-10-08T12:00:00+07:00', raw: undefined,
        }
    );
});

test('parseSubmissionWindow reads well-ordered text and abbreviated months', () => {
    const ordered = parseSubmissionWindow(
        'ผู้ยื่นข้อเสนอต้องเสนอราคา ในวันที่ ๑๕ พฤศจิกายน ๒๕๖๗ ระหว่างเวลา ๘.๓๐ น. ถึง ๑๖.๓๐ น.'
    );
    assert.equal(ordered.closesAt, '2024-11-15T16:30:00+07:00');
    assert.equal(ordered.startTime, '08:30');

    const abbreviated = parseSubmissionWindow('ยื่นข้อเสนอในวันที่ 3 ม.ค. 2570 ระหว่างเวลา 10.00 น. ถึง 11.00 น.');
    assert.equal(abbreviated.date, '2027-01-03');
});

test('parseSubmissionWindow ignores money amounts and returns null without an anchor', () => {
    const withMoney = parseSubmissionWindow(
        'ยื่นข้อเสนอในวันที่ 9 มีนาคม 2570 ราคากลาง 1,841,800.00 บาท ระหว่างเวลา 09.00 น. ถึง 12.00 น.'
    );
    assert.equal(withMoney.startTime, '09:00');
    assert.equal(withMoney.endTime, '12:00');
    assert.equal(parseSubmissionWindow('ประกาศ ณ วันที่ ๓๐ กันยายน พ.ศ. ๒๕๖๙'), null);
});
