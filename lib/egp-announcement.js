/**
 * Parse the bid-submission window from an e-GP invitation (ประกาศเชิญชวน).
 *
 * e-GP renders announcements from templates, and PDF text extraction often
 * emits the filled-in values after the static sentence, e.g.
 *   "...อิเล็กทรอนิกส์ในวันที่ ๘ \n ระหว่างเวลา  น. ถึง  น. ...ตุลาคม ๒๕๖๙ ๐๙.๐๐ ๑๒.๐๐"
 * so values are collected from a bounded window after the anchor instead of
 * requiring them to appear in reading order.
 */

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

const THAI_MONTHS = [
    ['มกราคม', 'ม.ค.'],
    ['กุมภาพันธ์', 'ก.พ.'],
    ['มีนาคม', 'มี.ค.'],
    ['เมษายน', 'เม.ย.'],
    ['พฤษภาคม', 'พ.ค.'],
    ['มิถุนายน', 'มิ.ย.'],
    ['กรกฎาคม', 'ก.ค.'],
    ['สิงหาคม', 'ส.ค.'],
    ['กันยายน', 'ก.ย.'],
    ['ตุลาคม', 'ต.ค.'],
    ['พฤศจิกายน', 'พ.ย.'],
    ['ธันวาคม', 'ธ.ค.'],
];

const MONTH_PATTERN = THAI_MONTHS.flat()
    .sort((a, b) => b.length - a.length)
    .map(name => name.replace(/\./g, '\\.'))
    .join('|');

/** Sentence that introduces the submission date in the standard template. */
const ANCHOR_REGEX = /(?:ยื่นข้อเสนอ|เสนอราคา)[^\n]{0,80}?ในวันที่/;
const WINDOW_CHARS = 320;

export function normalizeThaiDigits(text) {
    return String(text || '').replace(/[๐-๙]/g, digit => String(THAI_DIGITS.indexOf(digit)));
}

function monthNumber(name) {
    const index = THAI_MONTHS.findIndex(names => names.includes(name));
    return index >= 0 ? index + 1 : null;
}

function normalizeTime(value) {
    const [hours, minutes] = value.split(/[.:]/).map(Number);
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function toGregorianYear(year) {
    if (year >= 2400) return year - 543;
    if (year < 100) return year + 1957; // two-digit Buddhist year, e.g. 69 -> 2026
    return year;
}

/**
 * @param {string} text - Extracted announcement text
 * @returns {null | {
 *   date: string, startTime: string|null, endTime: string|null,
 *   closesAt: string|null, raw: string
 * }} ISO date (Gregorian), HH:MM times, and closing instant in Asia/Bangkok
 */
export function parseSubmissionWindow(text) {
    const normalized = normalizeThaiDigits(text);
    const anchor = ANCHOR_REGEX.exec(normalized);
    if (!anchor) return null;

    const afterAnchor = normalized.slice(anchor.index + anchor[0].length);
    const window = afterAnchor.slice(0, WINDOW_CHARS);

    const monthMatch = new RegExp(`(\\d{1,2})?\\s*(${MONTH_PATTERN})\\s*(?:พ\\.ศ\\.\\s*)?(\\d{2,4})`)
        .exec(window);
    if (!monthMatch) return null;

    const leadingDay = /^\s*(\d{1,2})(?!\d|[.:]\d)/.exec(afterAnchor);
    const day = Number(leadingDay?.[1] ?? monthMatch[1]);
    const month = monthNumber(monthMatch[2]);
    const year = toGregorianYear(Number(monthMatch[3]));
    if (!day || day > 31 || !month) return null;

    const times = [...window.matchAll(/(?<![\d,])(\d{1,2}[.:]\d{2})(?![\d,]|\.\d)/g)]
        .map(match => normalizeTime(match[1]))
        .filter(Boolean)
        .slice(0, 2);
    const [startTime = null, endTime = null] = times;

    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
        date,
        startTime,
        endTime,
        closesAt: endTime ? `${date}T${endTime}:00+07:00` : null,
        raw: window.replace(/\s+/g, ' ').trim().slice(0, 200),
    };
}

/** The template opens with "ประกาศ<agency>" on its own line, before "เรื่อง ...". */
export function parseAnnouncingAgency(text) {
    for (const line of String(text || '').split('\n').slice(0, 12)) {
        const match = /^\s*ประกาศ\s*(.+?)\s*$/.exec(line);
        if (match && !/^(?:เชิญชวน|ราคากลาง|ณ\b)/.test(match[1])) return match[1];
        if (/^\s*เรื่อง/.test(line)) break;
    }
    return null;
}

/** Reference price: the first baht amount after "เป็นเงินทั้งสิ้น". */
export function parseReferencePrice(text) {
    const normalized = normalizeThaiDigits(text);
    const anchor = /เป็นเงินทั้งสิ้น/.exec(normalized);
    if (!anchor) return null;
    const match = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*บาท/
        .exec(normalized.slice(anchor.index, anchor.index + 200));
    const amount = match ? Number(match[1].replace(/,/g, '')) : NaN;
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Everything the invitation contributes to the project record. */
export function parseInvitation(text) {
    return {
        agency: parseAnnouncingAgency(text),
        referencePrice: parseReferencePrice(text),
        submission: parseSubmissionWindow(text),
    };
}
