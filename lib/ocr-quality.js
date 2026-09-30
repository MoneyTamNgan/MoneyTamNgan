/** Conservative checks: never silently replace a financial value. */
export const normalizeThaiDigits = text => text.replace(/[๐-๙]/g, char => String(char.charCodeAt(0) - 0x0e50));

const digits = { ศูนย์: 0, หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 };
const units = { สิบ: 10, ร้อย: 100, พัน: 1000, หมื่น: 10000, แสน: 100000 };

function thaiInteger(text) {
    if (!text) return null;
    const million = text.lastIndexOf('ล้าน');
    if (million >= 0) {
        const left = thaiInteger(text.slice(0, million));
        const tail = text.slice(million + 4);
        const right = tail ? thaiInteger(tail) : 0;
        return left === null || right === null ? null : left * 1000000 + right;
    }
    const tokens = text.match(/ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน/g) || [];
    if (tokens.join('') !== text) return null;
    let total = 0, pending = null, lastUnit = Infinity;
    for (const token of tokens) {
        if (Object.hasOwn(digits, token)) {
            if (pending !== null) return null;
            pending = digits[token];
        } else {
            if (units[token] >= lastUnit) return null;
            total += (pending ?? 1) * units[token];
            pending = null;
            lastUnit = units[token];
        }
    }
    return total + (pending ?? 0);
}

export function thaiBahtWords(text) {
    const value = text.replace(/\s/g, '').normalize('NFC');
    const match = value.match(/^(.+?)บาท(?:(ถ้วน)|(.+?)สตางค์)?$/);
    if (!match) return null;
    const baht = thaiInteger(match[1]);
    const satang = match[3] ? thaiInteger(match[3]) : 0;
    if (baht === null || satang === null || satang > 99) return null;
    const amount = baht + satang / 100;
    return Number.isSafeInteger(baht * 100 + satang) ? amount : null;
}

export function financialAmounts(text) {
    const normalized = normalizeThaiDigits(text).replace(/(?<=\d)\s*([,.])\s*(?=\d)/g, '$1');
    return [...normalized.matchAll(/(?<![\d,.])([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(ล้าน)?\s*บาท(?:\s*\(([^)]{1,220})\))?/g)]
        .map(match => ({ raw: match[0], amount: Number(match[1].replaceAll(',', '')) * (match[2] ? 1000000 : 1),
            written: match[3] || null, writtenAmount: match[3] ? thaiBahtWords(match[3]) : null }));
}

export function moneyWarnings(text) {
    return financialAmounts(text).flatMap(value => {
        // A following numbered clause, e.g. "20 ล้านบาท (3)", is not amount wording.
        if (!value.written || /^\s*\d+\s*$/.test(value.written)) return [];
        if (value.writtenAmount === null) return [{ code: 'amount_words_unreadable', ...value }];
        return Math.abs(value.amount - value.writtenAmount) > 0.005
            ? [{ code: 'amount_words_mismatch', ...value }] : [];
    });
}

export function financialDisagreement(first, second) {
    const values = text => financialAmounts(text).map(a => a.amount).sort((a, b) => a - b);
    return JSON.stringify(values(first)) !== JSON.stringify(values(second));
}

export function hasFinancialText(text) {
    return /บาท|วงเงิน|ราคากลาง|ล้าน|THB/i.test(text);
}
