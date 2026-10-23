export const normalizeThaiDigits = text => String(text || '')
    .replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 3664));
export const FISCAL_PARSER_VERSION = 'thai-fiscal-context-v2';

const yearPattern = '2\\s*[56]\\s*\\d\\s*\\d(?!\\d)';
const yearList = `${yearPattern}(?:\\s*(?:-|–|—|ถึง|และ|หรือ|,|/)\\s*(?:${yearPattern}|\\d{2}(?!\\d)))*`;

function sourceContext(pages, item) {
    let section = null, heading = '';
    const compact = text => normalizeThaiDigits(text).replace(/\s/g, '');
    for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
        const original = String(page.text || '');
        const offset = page.page_number === item.page
            ? Number.isInteger(item.source_offset) ? compact(original.slice(0, item.source_offset)).length
                : compact(original).indexOf(compact(item.clause_text)) : -1;
        let consumed = 0;
        for (const line of original.split('\n')) {
            const title = normalizeThaiDigits(line).match(/^\s*(?:ข้อ\s*|หมวด\s*)?(\d{1,2})(?:[.),]|\s)\s*(?=[ก-๙])/);
            if (title) {
                section = title[1];
                const label = normalizeThaiDigits(line).match(/ปี\s*งบ\s*ประมาณ|งบ\s*ประมาณ/);
                heading = (label ? line.slice(0, label.index + label[0].length) : line).trim().slice(0, 200);
            }
            consumed += compact(line).length;
            if (offset >= 0 && consumed > offset) {
                // Locate the actual budget label rather than the start of a long
                // LLM quotation, so both methods receive the same source context.
                const label = normalizeThaiDigits(item.clause_text).match(/ปี\s*งบ\s*ประมาณ|งบ\s*ประมาณ/);
                const lineCompact = compact(line);
                const quoteAt = lineCompact.indexOf(compact(item.clause_text));
                const prefixAt = quoteAt >= 0 ? quoteAt : Math.max(0, offset - (consumed - lineCompact.length));
                const markerAt = label ? lineCompact.indexOf(compact(label[0]), prefixAt) : prefixAt;
                const before = lineCompact.slice(Math.max(0, markerAt - 180), markerAt < 0 ? prefixAt : markerAt);
                return { section, heading, before, context_text: line.trim().slice(0, 500) };
            }
        }
    }
    return { section: null, heading: '', before: '', context_text: '' };
}

function lastCue(text, pattern) {
    let index = -1;
    for (const match of text.matchAll(pattern)) index = match.index;
    return index;
}

/** Conservative context rules: preserve all quotes, but do not promote
 * historical experience or future maintenance references into funding years. */
function contextualize(pages, item) {
    const { source_offset, ...evidence } = item;
    const source = sourceContext(pages, item);
    const before = source.before;
    const heading = normalizeThaiDigits(source.heading).replace(/\s/g, '');
    const historical = /ย้อนหลัง|ที่ผ่านมา|ปีก่อน|ก่อนหน้า|อ้างอิง|สัญญาเดิม|โครงการเดิม|ประวัติ|ผลการดำเนินงาน/g;
    const future = /หลังส่งมอบ|ภายหลังส่งมอบ|ปีถัดไป|ปีต่อไป|บริการหลังการขาย|ระยะรับประกัน|ต่อสัญญา|ค่าบำรุงรักษาในอนาคต/g;
    const funding = /จัดสรร|วงเงิน|ใช้เงิน|เงินค่าจ้าง|แหล่งเงิน|เบิกจ่าย|งบผูกพัน|ผูกพันงบ|ได้รับงบ|งบประมาณสำหรับ/g;
    const current = lastCue(before, /โครงการนี้|ครั้งนี้|งบประมาณปัจจุบัน/g);
    const historyAt = lastCue(before, historical);
    const futureAt = lastCue(before, future);
    const fundingAt = lastCue(before, funding);
    let context = 'unspecified';
    if ((historyAt >= 0 && current < historyAt) || (lastCue(heading, historical) >= 0 && current < 0)) context = 'historical_reference';
    else if ((futureAt >= 0 && fundingAt < futureAt && current < futureAt)
        || (lastCue(heading, future) >= 0 && fundingAt < 0 && current < 0)) context = 'future_maintenance';
    else if (fundingAt >= 0 || current >= 0) context = 'project_funding';
    else if (/โครงการ|ประกวดราคา|จัดซื้อ|จ้าง/.test(before)) context = 'project_title';
    return { ...evidence, section: source.section, context, context_text: source.context_text,
        budget_section: Boolean(source.section && /วงเงิน|งบประมาณ|แหล่งเงิน|ค่าใช้จ่าย/.test(heading)),
        eligible: !['historical_reference', 'future_maintenance'].includes(context) };
}

/** Require an explicit fiscal-year label; calendar dates and project IDs are not evidence. */
export function findFiscalYearEvidence(pages) {
    const evidence = [];
    for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
        const original = String(page.text || '');
        const normalized = normalizeThaiDigits(original);
        const fiscalLabel = '(?:ปี\\s*งบ\\s*ประมาณ|งบ\\s*ประมาณ\\s*ประ\\s*จ(?:ำ|ํ\\s*า)\\s*ปี)';
        const pattern = new RegExp(`${fiscalLabel}\\s*(?:พ\\.?\\s*ศ\\.?\\s*)?[:：]?\\s*(${yearList})`, 'g');
        for (const match of normalized.matchAll(pattern)) {
            const clause_text = original.slice(match.index, match.index + match[0].length).trim();
            const tokens = [...match[1].matchAll(new RegExp(`${yearPattern}|\\d{2}`, 'g'))];
            let firstYear;
            for (const token of tokens) {
                const digits = token[0].replace(/\s/g, '');
                const year = digits.length === 4 ? Number(digits) : Math.floor(firstYear / 100) * 100 + Number(digits);
                firstYear ??= year;
                evidence.push(contextualize(pages, { year, page: page.page_number, clause_text, method: 'regex', source_offset: match.index }));
            }
        }
    }
    return evidence;
}

export function validateFiscalYearEvidence(items, pages) {
    for (const item of items) {
        const source = pages.filter(page => page.page_number === item.page).map(page => page.text).join('');
        const compact = text => normalizeThaiDigits(text).replace(/\s/g, '');
        if (!source || !compact(source).includes(compact(item.clause_text))
            || !compact(item.clause_text).includes(String(item.year))
            || !/งบ\s*ประมาณ/.test(item.clause_text)) {
            throw new Error('Vertex fiscal-year evidence is not supported by the source text');
        }
    }
    return items;
}

export function resolveFiscalBudget(pages, llmEvidence = []) {
    const regexEvidence = findFiscalYearEvidence(pages);
    const evidence = [...regexEvidence, ...llmEvidence.map(item => contextualize(pages, { ...item, method: 'llm' }))];
    const eligible = evidence.filter(item => item.eligible);
    const funding = eligible.filter(item => item.context === 'project_funding');
    // A section number alone never proves funding. Conflicting explicit funding
    // clauses in other sections remain visible instead of being hidden by #9.
    const budgetSection = eligible.filter(item => item.budget_section);
    const preferred = funding.length ? funding : budgetSection.length ? budgetSection : eligible;
    const years = [...new Set(preferred.map(item => item.year))].sort((a, b) => a - b);
    const methods = new Set(preferred.map(item => item.method));
    return {
        year: years.length === 1 ? years[0] : null,
        years,
        status: years.length > 1 ? 'ambiguous' : years.length ? 'found' : 'not_found',
        method: methods.size > 1 ? 'regex+llm' : methods.values().next().value || 'none',
        parser_version: FISCAL_PARSER_VERSION,
        selection_reason: funding.length ? 'explicit_project_funding' : budgetSection.length ? 'budget_section' : 'explicit_fiscal_label',
        evidence: [...new Map(evidence.map(item => [`${item.year}|${item.page}|${item.clause_text}|${item.method}|${item.context}`,
            { ...item, selected: preferred.includes(item) }])).values()],
        ...(evidence.some(item => !item.eligible) ? { warnings: [
            'fiscal_non_project_context_ignored', ...(!eligible.length ? ['fiscal_context_requires_review'] : []),
        ] } : {}),
    };
}
