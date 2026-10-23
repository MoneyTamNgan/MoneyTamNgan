#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { findFiscalYearEvidence, resolveFiscalBudget, FISCAL_PARSER_VERSION } from '../lib/fiscal-budget.js';

export function legacyFiscalBaseline(pages) {
    const evidence = findFiscalYearEvidence(pages);
    const preferred = evidence.some(item => item.section === '9') ? evidence.filter(item => item.section === '9') : evidence;
    const years = [...new Set(preferred.map(item => item.year))].sort((a, b) => a - b);
    return { years, status: years.length > 1 ? 'ambiguous' : years.length ? 'found' : 'not_found' };
}

export function evaluateFiscalDataset(cases) {
    if (!Array.isArray(cases) || !cases.length) throw new TypeError('Expected a nonempty labeled dataset');
    const ids = new Set();
    const methods = { baseline: legacyFiscalBaseline, contextAware: resolveFiscalBudget };
    const scores = Object.fromEntries(Object.keys(methods).map(name => [name, { exactMatches: 0, falsePositiveCases: 0, missedYearCases: 0, failures: [] }]));
    const labelSources = {};
    let noYearCases = 0;
    for (const row of cases) {
        if (!row?.id || ids.has(row.id) || !['synthetic', 'human_reviewed'].includes(row.label_source)
            || (row.label_source === 'human_reviewed' && !row.reviewed_by)
            || !Array.isArray(row.pages) || row.pages.some(p => !Number.isInteger(p.page_number) || p.page_number < 1 || typeof p.text !== 'string')
            || !Array.isArray(row.expected?.years) || row.expected.years.some(y => !Number.isInteger(y) || y < 2500 || y > 2699)
            || !['found', 'ambiguous', 'not_found'].includes(row.expected.status)) throw new TypeError('Invalid or duplicate labeled dataset case');
        ids.add(row.id);
        labelSources[row.label_source] = (labelSources[row.label_source] || 0) + 1;
        const expected = [...new Set(row.expected.years)].sort((a, b) => a - b);
        const expectedStatus = expected.length > 1 ? 'ambiguous' : expected.length ? 'found' : 'not_found';
        if (expectedStatus !== row.expected.status) throw new TypeError('Dataset status must agree with labeled years');
        if (!expected.length) noYearCases++;
        for (const [name, method] of Object.entries(methods)) {
            const result = method(row.pages);
            const score = scores[name];
            if (JSON.stringify(result.years) === JSON.stringify(expected) && result.status === row.expected.status) score.exactMatches++;
            else score.failures.push({ id: row.id, expected: row.expected, actual: { years: result.years, status: result.status } });
            if (!expected.length && result.years.length) score.falsePositiveCases++;
            if (expected.some(year => !result.years.includes(year))) score.missedYearCases++;
        }
    }
    for (const score of Object.values(scores)) {
        score.exactMatchRate = score.exactMatches / cases.length;
        score.falsePositiveRateOnNoYearCases = noYearCases ? score.falsePositiveCases / noYearCases : null;
    }
    return { parserVersion: FISCAL_PARSER_VERSION, caseCount: cases.length, noYearCases, labelSources,
        limitation: 'Excerpt-based evaluation, not a live PDF/OCR accuracy measurement. Synthetic cases are not production accuracy evidence.',
        ...scores };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const { values } = parseArgs({ options: { dataset: { type: 'string' } } });
        const path = values.dataset || new URL('../tests/unit/fixtures/fiscal-context-cases.json', import.meta.url);
        const report = evaluateFiscalDataset(JSON.parse(await readFile(path, 'utf8')));
        console.log(JSON.stringify(report, null, 2));
        if (report.contextAware.failures.length) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
