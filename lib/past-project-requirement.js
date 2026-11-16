import { normalizeThaiDigits } from './fiscal-budget.js';

const QUALIFICATIONS = /^(?:ข้อ)?[\d.()]*คุณสมบัติ(?:เฉพาะ)?(?:ของ)?ผู้(?:ยื่นข้อเสนอ|เสนอราคา|เข้าร่วมเสนอราคา|เข้าร่วมยื่นข้อเสนอ|รับจ้าง)/u;
const PAST_WORK = /ผลงาน|ประสบการณ์|เคย(?:ดำเนินงาน|รับจ้าง|ส่งมอบงาน|พัฒนา|ทำงาน|ดำเนินการ)|สัญญา(?:ที่ผ่านมา|เดิม)|past(?:project|performance)|previous(?:project|contract)/iu;
const BIDDER_REQUIREMENT = /ผู้(?:ยื่นข้อเสนอ|เสนอราคา|เข้าร่วมเสนอราคา|รับจ้าง)|ต้อง(?:มี|เคย|แสดง|ยื่น)|(?:เป็น)?ผู้มีผลงาน|musthave|required/iu;
const VALUE = /มูลค่า|วงเงิน|ราคา|ค่าจ้าง|value|worth/iu;
const OTHER_VALUE = /วงเงิน(?:งบประมาณ|จัดซื้อจัดจ้าง)|งบประมาณ|ราคากลาง|ทุนจดทะเบียน|หลักประกัน|ค่าปรับ|โครงการ(?:นี้|ปัจจุบัน)|การจัด(?:ซื้อ|จ้าง)ครั้งนี้/u;
const MINIMUM = 'ไม่น้อยกว่า|ไม่ต่ำกว่า|อย่างน้อย|ตั้งแต่|ขั้นต่ำ|มากกว่า|สูงกว่า|เกิน|atleast|morethan|greaterthan';
const MINIMUM_HINT = new RegExp(MINIMUM, 'iu');
const MONEY = '(?:(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?)(ล้าน|แสน|หมื่น|พัน|ร้อย)?';
const THRESHOLD = new RegExp(`(?:(${MINIMUM})(?:จำนวน|วงเงิน|มูลค่า)?)?(฿|THB)?${MONEY}(บาท|THB)?(ขึ้นไป|เป็นต้นไป)?`, 'giu');
const MONETARY_HINT = /บาท|฿|THB|ร้อยละ|เปอร์เซ็นต์|%|\d(?:ล้าน|แสน|หมื่น|พัน)/iu;
const UNRESOLVED_VALUE = /ร้อยละ|เปอร์เซ็นต์|%|มูลค่ารวม|วงเงินรวม|รวม(?:กัน|ทุกสัญญา|หลายสัญญา)|สะสม|ไม่จำเป็นต้อง|ไม่มีข้อกำหนด|ยกเว้น|(?:ไม่มากกว่า|ไม่สูงกว่า|ไม่เกิน)/u;
const CLAUSE_START = /^(?:(?:ข้อ\s*)?\d{1,2}(?:\.\d{1,2})+(?:[.)]\s*|\s+|(?=[ก-๙]))|(?:ข้อ\s*)?\d{1,2}[.)](?!\d)\s*|[-•]\s+)/u;

const normalize = text => normalizeThaiDigits(text).normalize('NFC').replace(/\s+/gu, '');
const compactQuote = text => text.normalize('NFC').replace(/\s+/gu, '');

export function scanPastProjectRequirements(pages) {
    const clauses = [];
    let clause = [];
    let foundQualifications = false;
    let hasQualificationText = false;
    let inQualifications = false, hasPastWork = false;
    const flush = () => {
        if (clause.length) clauses.push(clause);
        clause = [];
        hasPastWork = false;
    };
    for (const { page_number: page, text } of pages) {
        if (clause.length && page > clause.at(-1).page + 1) flush();
        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            if (!line) continue;
            const numbered = normalizeThaiDigits(line).match(CLAUSE_START)?.[0];
            const normalized = normalize(line);
            const heading = QUALIFICATIONS.test(normalized);
            if (heading) {
                foundQualifications = true;
                inQualifications = true;
            } else if (numbered && !/\d\.\d/u.test(numbered)) {
                inQualifications = false;
            }
            const pastWork = PAST_WORK.test(normalized);
            if (heading || numbered || (pastWork && !hasPastWork)) flush();
            hasPastWork ||= pastWork;
            if (inQualifications && !heading && /[ก-ฮ]{3}/u.test(line)) hasQualificationText = true;
            if (clause.at(-1)?.page === page) clause.at(-1).clause_text += `\n${line}`;
            else clause.push({ page, clause_text: line });
        }
    }
    flush();
    const candidates = clauses.filter(evidence => {
        const text = normalize(evidence.map(part => part.clause_text).join(' '));
        return PAST_WORK.test(text) && ((MONETARY_HINT.test(text) && (VALUE.test(text) || MINIMUM_HINT.test(text)))
            || (VALUE.test(text) && MINIMUM_HINT.test(text)));
    });
    return { candidates, readableQualifications: foundQualifications && hasQualificationText };
}

function thresholdFrom(text) {
    if (!PAST_WORK.test(text) || !BIDDER_REQUIREMENT.test(text) || UNRESOLVED_VALUE.test(text)) return null;
    const thresholds = [];
    for (const match of text.matchAll(THRESHOLD)) {
        const [phrase, operator, prefix, whole, decimals, scale, suffix, upward] = match;
        if (!prefix && !suffix) continue;
        if ((!operator || operator === 'ตั้งแต่') && !upward) continue;
        const before = text.slice(0, match.index);
        const pastWork = [...before.matchAll(new RegExp(PAST_WORK.source, 'giu'))].at(-1);
        if (!pastWork) continue;
        const relation = before.slice(pastWork.index);
        if (relation.length > 150 || OTHER_VALUE.test(relation)) continue;
        const multiplier = { ล้าน: 1e6, แสน: 1e5, หมื่น: 1e4, พัน: 1e3, ร้อย: 100 }[scale] ?? 1;
        const amount = Number(whole.replace(/,/g, '') + (decimals ? `.${decimals}` : '')) * multiplier;
        const cents = Math.round(amount * 100);
        if (amount <= 0 || !Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 0.00001) continue;
        const after = text.slice(match.index + phrase.length);
        if (/^(?:[\d,.]|(?:ถึง|[-–—]|หรือ|และ)(?:฿|THB)?\d)/iu.test(after)) return null;
        thresholds.push({
            minimum_baht: cents / 100,
            operator: /^(?:มากกว่า|สูงกว่า|เกิน|morethan|greaterthan)$/iu.test(operator || '') ? '>' : '>=',
        });
    }
    if (thresholds.length !== 1) return null;
    return thresholds[0];
}

function verifyProposal(proposal, sourceByPage, candidates) {
    if (!Array.isArray(proposal?.evidence) || !proposal.evidence.length || proposal.evidence.length > 2) return null;
    const evidence = proposal.evidence;
    for (const [index, part] of evidence.entries()) {
        if (!Number.isInteger(part?.page) || typeof part.clause_text !== 'string'
            || !part.clause_text.trim() || part.clause_text.length > 2000
            || !sourceByPage.get(part.page)?.includes(compactQuote(part.clause_text))
            || (index > 0 && part.page !== evidence[index - 1].page + 1)) return null;
    }
    const clause = normalize(evidence.map(part => part.clause_text).join(' '));
    const threshold = thresholdFrom(clause);
    const sourceClause = candidates.find(candidate => evidence.every(part => candidate.some(source =>
        source.page === part.page && compactQuote(source.clause_text).includes(compactQuote(part.clause_text)))));
    const sourceThreshold = sourceClause && thresholdFrom(normalize(sourceClause.map(part => part.clause_text).join(' ')));
    const verified = proposal.status === 'found' && threshold && sourceThreshold
        && threshold.minimum_baht === proposal.minimum_baht && threshold.operator === proposal.operator
        && sourceThreshold.minimum_baht === threshold.minimum_baht && sourceThreshold.operator === threshold.operator;
    return {
        ...(verified ? threshold : {}),
        evidence: evidence.map(({ page, clause_text }) => ({ page, clause_text: clause_text.trim() })),
        sourceClause,
    };
}

/** Resolve suggestions across Vertex chunks against the original readable TOR pages. */
export function resolvePastProjectRequirement(pages, proposals, { complete, context = scanPastProjectRequirements(pages) } = {}) {
    const { candidates, readableQualifications } = context;
    const sourceByPage = new Map(pages.map(({ page_number, text }) => [page_number, compactQuote(text)]));
    const verified = proposals.map(proposal => verifyProposal(proposal, sourceByPage, candidates));
    const quotes = verified.flatMap(item => item?.evidence || []);
    const uniqueEvidence = evidence => [...new Map(evidence
        .map(part => [`${part.page}:${compactQuote(part.clause_text)}`, part])).values()]
        .sort((a, b) => a.page - b.page).slice(0, 20);
    const first = verified[0];
    const unchecked = candidates.filter(candidate => !verified.some(item => item?.sourceClause === candidate));
    if (complete && first?.minimum_baht && !unchecked.length && verified.every(item =>
        item?.minimum_baht === first.minimum_baht && item.operator === first.operator)) {
        return { status: 'found', minimum_baht: first.minimum_baht, operator: first.operator, evidence: uniqueEvidence(quotes) };
    }
    if (complete && !proposals.length && !candidates.length && readableQualifications) {
        return { status: 'not_stated', evidence: [] };
    }
    const reviewQuotes = unchecked.flat().slice(0, 20)
        .map(part => ({ page: part.page, clause_text: part.clause_text.slice(0, 2000) }));
    return { status: 'manual_review', evidence: uniqueEvidence([...quotes, ...reviewQuotes]) };
}
