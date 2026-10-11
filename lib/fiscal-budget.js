export const normalizeThaiDigits = text => String(text || '')
    .replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 3664));

const yearPattern = '2\\s*[56]\\s*\\d\\s*\\d(?!\\d)';
const yearList = `${yearPattern}(?:\\s*(?:-|–|—|ถึง|และ|หรือ|,|/)\\s*(?:${yearPattern}|\\d{2}(?!\\d)))*`;

function sourceSection(pages, item) {
    let section = null;
    const compact = text => normalizeThaiDigits(text).replace(/\s/g, '');
    for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
        const offset = page.page_number === item.page ? compact(page.text).indexOf(compact(item.clause_text)) : -1;
        let consumed = 0;
        for (const line of String(page.text || '').split('\n')) {
            const heading = normalizeThaiDigits(line).match(/^\s*(?:ข้อ\s*|หมวด\s*)?(\d{1,2})(?:[.),]|\s)\s*(?=[ก-๙])/);
            if (heading) section = heading[1];
            consumed += compact(line).length;
            if (offset >= 0 && consumed > offset) return section;
        }
    }
    return null;
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
            const section = sourceSection(pages, { page: page.page_number, clause_text });
            const tokens = [...match[1].matchAll(new RegExp(`${yearPattern}|\\d{2}`, 'g'))];
            let firstYear;
            for (const token of tokens) {
                const digits = token[0].replace(/\s/g, '');
                const year = digits.length === 4 ? Number(digits) : Math.floor(firstYear / 100) * 100 + Number(digits);
                firstYear ??= year;
                evidence.push({ year, page: page.page_number, clause_text, section, method: 'regex' });
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
    const evidence = [...regexEvidence, ...llmEvidence.map(item => ({
        ...item, section: sourceSection(pages, item), method: 'llm',
    }))];
    // Section 9 is a useful priority, but other sections remain available as evidence.
    const preferred = evidence.some(item => item.section === '9')
        ? evidence.filter(item => item.section === '9') : evidence;
    const years = [...new Set(preferred.map(item => item.year))].sort((a, b) => a - b);
    const methods = new Set(preferred.map(item => item.method));
    return {
        year: years.length === 1 ? years[0] : null,
        years,
        status: years.length > 1 ? 'ambiguous' : years.length ? 'found' : 'not_found',
        method: methods.size > 1 ? 'regex+llm' : methods.values().next().value || 'none',
        evidence: [...new Map(evidence.map(item => [`${item.year}|${item.page}|${item.clause_text}|${item.method}`, item])).values()],
    };
}
