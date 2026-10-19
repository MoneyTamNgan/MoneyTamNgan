import { createHash } from 'node:crypto';
import { normalizeThaiDigits, parseSubmissionWindow } from './egp-announcement.js';
import { assessProcurementEligibility } from './procurement-eligibility.js';

export const SCHEDULE_VERSION = 'thai-announcement-schedule-v1';

/** Fresh announcement evidence supersedes stale API deadlines, never contract/award evidence. */
export function announcementProcurementEligibility(project, announcement, options = {}) {
    const deadline = announcement?.schedule.status === 'parsed'
        ? announcement.schedule.submission_schedule?.ends_at : null;
    return assessProcurementEligibility({ ...project, bid_submission_end: deadline, bid_deadline: deadline },
        { ...options, sourceUrl: announcement?.url });
}
const MONTHS = ['มกราคม|ม.ค.', 'กุมภาพันธ์|ก.พ.', 'มีนาคม|มี.ค.', 'เมษายน|เม.ย.',
    'พฤษภาคม|พ.ค.', 'มิถุนายน|มิ.ย.', 'กรกฎาคม|ก.ค.', 'สิงหาคม|ส.ค.',
    'กันยายน|ก.ย.', 'ตุลาคม|ต.ค.', 'พฤศจิกายน|พ.ย.', 'ธันวาคม|ธ.ค.'];
const monthPattern = MONTHS.flatMap(m => m.split('|')).map(m => m.replaceAll('.', '\\.')).join('|');
// Bare mentions such as "จนถึงวันเสนอราคา" must not capture a later publication date.
const eventPattern = /(?:วัน)?เปิดซอง(?=\s*(?::|(?:ใน)?วันที่|\d{1,4}(?![\d.])))|(?<!จนถึง)วันเสนอราคา(?=\s*(?::|(?:ใน)?วันที่|\d{1,4}(?![\d.])))|(?:ยื่นข้อเสนอ|(?<!วัน)เสนอราคา)(?:[\s\S]{0,80}?)(?:ในวันที่|วันที่)|กำหนด(?:วัน)?ยื่นข้อเสนอ/g;

function calendarDate(day, month, year) {
    year = Number(year);
    if (year >= 2400) year -= 543;
    else if (year < 100) year += 1957;
    day = Number(day); month = Number(month);
    if (year < 1900 || year > 2200) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateFrom(text, label) {
    const named = new RegExp(`(\\d{1,2})\\s*(${monthPattern})\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\d)`).exec(text);
    if (named) return calendarDate(named[1], MONTHS.findIndex(m => m.split('|').includes(named[2])) + 1, named[3]);
    const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
    if (iso) return calendarDate(iso[3], iso[2], iso[1]);
    const numeric = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/.exec(text);
    if (numeric) return calendarDate(numeric[1], numeric[2], numeric[3]);
    // e-GP's positioned PDF values can appear after the sentence's time placeholders.
    const legacy = parseSubmissionWindow(`${label}${text}`);
    if (!legacy) return null;
    const [year, month, day] = legacy.date.split('-');
    return calendarDate(day, month, year);
}

function time(value) {
    const [h, m] = value.split(/[.:]/).map(Number);
    return h <= 23 && m <= 59 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null;
}

/** Deterministic, evidence-bearing extraction. Missing/contradictory values are not guessed. */
export function parseAnnouncementSchedule(input) {
    const pages = Array.isArray(input) ? input : String(input || '').split('\f').map((text, i) => ({ page_number: i + 1, text }));
    const events = [], warnings = [];
    for (const page of pages) {
        const text = normalizeThaiDigits(page.text);
        const anchors = [...text.matchAll(eventPattern)];
        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            const end = Math.min(anchor.index + anchor[0].length + 320, anchors[i + 1]?.index ?? text.length);
            let clause = text.slice(anchor.index + anchor[0].length, end);
            // Purchase/publication/preparation dates are not submission deadlines.
            clause = clause.split(/ซึ่งสามารถ|จัดเตรียมเอกสาร|ขอ(?:ซื้อ|รับ)เอกสาร|ประกาศ\s*ณ|ประกาศวันที่/)[0];
            const date = dateFrom(clause, anchor[0]);
            const kind = /เปิดซอง/.test(anchor[0]) ? 'bid_opening' : 'bid_submission';
            const evidence = `${anchor[0]}${clause}`.replace(/\s+/g, ' ').trim();
            if (!date) { warnings.push('invalid_or_missing_date'); continue; }
            const timeSection = /(?:ระหว่างเวลา|ตั้งแต่เวลา|เวลา)\s*([\s\S]*)/.exec(clause)?.[1];
            const tokens = timeSection ? [...timeSection.matchAll(/(?<![\d,])(\d{1,2}[.:]\d{2})(?![\d,]|\.\d)/g)] : [];
            const times = tokens.slice(0, 2).map(m => time(m[1]));
            let start = null, finish = null, at = null;
            if (times.some(t => !t) || tokens.length > 2) warnings.push('invalid_or_ambiguous_time');
            else if (times.length === 2 && /ถึง|[-–—]/.test(timeSection)) {
                if (times[0] < times[1]) [start, finish] = times;
                else warnings.push('invalid_time_window');
            } else if (times.length === 1) {
                if (/ระหว่าง|ตั้งแต่/.test(clause)) warnings.push('incomplete_time_window');
                else at = times[0];
            }
            events.push({ kind, date, time: at, start_time: start, end_time: finish,
                page: page.page_number, text: evidence.slice(0, 500) });
        }
    }
    const preferred = events.filter(e => e.kind === 'bid_submission');
    const candidates = preferred.length ? preferred : events.filter(e => e.kind === 'bid_opening');
    const conflict = ['date', 'time', 'start_time', 'end_time'].some(key =>
        new Set(candidates.map(e => e[key]).filter(Boolean)).size > 1);
    if (conflict) warnings.push('conflicting_schedule');
    const chosen = candidates.length && !conflict ? {
        ...candidates[0],
        ...Object.fromEntries(['time', 'start_time', 'end_time'].map(key => [key, candidates.find(e => e[key])?.[key] ?? null])),
    } : null;
    const instant = (date, value) => value ? `${date}T${value}:00+07:00` : null;
    return {
        parser_version: SCHEDULE_VERSION,
        text_sha256: createHash('sha256').update(pages.map(p => p.text).join('\f')).digest('hex'),
        status: !chosen ? (events.length || warnings.length ? 'needs_review' : 'not_found') : warnings.length ? 'needs_review' : 'parsed',
        bidding_date: chosen ? { date: chosen.date, time: chosen.time, at: instant(chosen.date, chosen.time),
            kind: chosen.kind, timezone: 'Asia/Bangkok' } : null,
        submission_schedule: chosen?.kind === 'bid_submission' ? {
            date: chosen.date, start_time: chosen.start_time, end_time: chosen.end_time,
            starts_at: instant(chosen.date, chosen.start_time), ends_at: instant(chosen.date, chosen.end_time),
            timezone: 'Asia/Bangkok',
        } : null,
        evidence: events, warnings: [...new Set(warnings)],
    };
}

/** Shared by ingestion and backfill; replacing all fields also clears stale deadlines. */
export function announcementScheduleFields(schedule, { documentId, sourceUrl, method = 'embedded', error = null } = {}) {
    const submission = schedule.submission_schedule;
    return {
        bidding_date: schedule.bidding_date,
        submission_schedule: submission,
        announcement_schedule: {
            parser_version: schedule.parser_version, status: error ? 'needs_review' : schedule.status,
            document_id: documentId, source_url: sourceUrl, extraction_method: method,
            text_sha256: schedule.text_sha256, evidence: schedule.evidence, warnings: schedule.warnings,
            extracted_at: new Date(), error,
        },
        'tender.submission_date': submission?.date ?? null,
        'tender.submission_start_time': submission?.start_time ?? null,
        'tender.submission_end_time': submission?.end_time ?? null,
        'tender.closes_at': schedule.status === 'parsed' && !error && submission?.ends_at ? new Date(submission.ends_at) : null,
    };
}
