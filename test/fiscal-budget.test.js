import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFiscalBudget, validateFiscalYearEvidence } from '../lib/fiscal-budget.js';
import { extractTorWithVertex } from '../lib/vertex/tor-extractor.js';

test('extracts explicit fiscal years and Thai/OCR-spaced digits', () => {
    for (const text of ['ปีงบประมาณ 2569', 'ปีงบประมาณ พ.ศ. ๒๕๗๐', 'ปี งบ ประมาณ 2 5 6 9', 'ปีงบประมาณ\n2569']) {
        const result = resolveFiscalBudget([{ page_number: 2, text }]);
        assert.equal(result.status, 'found');
        assert.ok([2569, 2570].includes(result.year));
        assert.equal(result.evidence[0].page, 2);
    }
});

test('section 9 takes priority and carries across pages, without discarding other evidence', () => {
    const result = resolveFiscalBudget([
        { page_number: 1, text: '2. ประวัติ\nปีงบประมาณ 2568' },
        { page_number: 5, text: '9. วงเงินงบประมาณ' },
        { page_number: 6, text: 'ใช้เงินปีงบประมาณ 2570\n10. ระยะเวลา\nปีงบประมาณ 2571' },
    ]);
    assert.equal(result.year, 2570);
    assert.equal(result.evidence.length, 3);
    assert.equal(result.evidence[1].section, '9');
});

test('does not infer fiscal year from IDs, dates or generic annual requirements', () => {
    const result = resolveFiscalBudget([{ page_number: 1,
        text: 'โครงการ 69012345678 ประกาศวันที่ 1 มกราคม 2569\nรายงานประจำปีงบประมาณ\nสัญญาสิ้นสุด 2570' }]);
    assert.equal(result.year, null);
    assert.equal(result.status, 'not_found');
});

test('retains multiple fiscal years for review rather than choosing arbitrarily', () => {
    for (const clause of ['ปีงบประมาณ 2569 หรือ 2570', 'ปีงบประมาณ 2569-70']) {
        const result = resolveFiscalBudget([{ page_number: 1, text: clause }]);
        assert.deepEqual(result.years, [2569, 2570]);
        assert.equal(result.status, 'ambiguous');
        assert.equal(result.year, null);
    }
});

test('LLM evidence must be an exact supported fiscal clause, including its year', () => {
    const pages = [{ page_number: 3, text: '9. งบประมาณ\nจัดสรรงบประมาณประจำ พ.ศ. 2570' }];
    const items = [{ year: 2570, page: 3, clause_text: 'จัดสรรงบประมาณประจำ พ.ศ. 2570', section: '1' }];
    assert.doesNotThrow(() => validateFiscalYearEvidence(items, pages));
    assert.equal(resolveFiscalBudget(pages, items).year, 2570);
    assert.equal(resolveFiscalBudget(pages, items).evidence[0].section, '9');
    assert.throws(() => validateFiscalYearEvidence([{ ...items[0], year: 2569 }], pages), /not supported/);
    assert.throws(() => validateFiscalYearEvidence([{ ...items[0], page: 4 }], pages), /not supported/);
});

test('Vertex pipeline combines regex and LLM fiscal evidence in its stored extraction shape', async t => {
    const old = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    t.after(() => { if (old === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = old; });
    const clause = 'ปีงบประมาณ 2570';
    const result = await extractTorWithVertex({ pages: [{ page_number: 3, text: `9. งบประมาณ\n${clause}` }] }, {
        headers: async () => ({}),
        fetchImpl: async (_url, options) => {
            assert.match(JSON.parse(options.body).systemInstruction.parts[0].text, /section 9/);
            return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{
                text: JSON.stringify({ summary: 'สรุป', qualifications: [], scope_of_work: [], tech_stack: [],
                    flagged_clauses: [], risk_findings: [], confidence: 0.9, document_language: 'th',
                    fiscal_year_evidence: [{ year: 2570, page: 3, clause_text: clause, section: '9' }] }),
            }] } }] }) };
        },
    });
    assert.equal(result.extraction.fiscal_budget.year, 2570);
    assert.equal(result.extraction.fiscal_budget.method, 'regex+llm');
    assert.match(result.promptVersion, /v6/);
});

test('procurement budget annual-year wording and decomposed Thai sara-am retain source evidence', () => {
    for (const label of ['งบประมาณประจำปี', 'งบประมาณประจําปี']) {
        const result = resolveFiscalBudget([{ page_number: 22, text: `12, ข้อสงวนสิทธิ์\n12.1 เงินค่าจ้างมาจากเงิน${label} 2565` }]);
        assert.equal(result.year, 2565);
        assert.equal(result.evidence[0].page, 22);
        assert.equal(result.evidence[0].section, '12');
        assert.equal(result.evidence[0].clause_text, `${label} 2565`);
    }
});

test('unsupported fiscal evidence does not block a valid summary or populate a guessed year', async t => {
    const old = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    t.after(() => { if (old === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = old; });
    const result = await extractTorWithVertex({ pages: [{ page_number: 1, text: 'เอกสารโครงการ ไม่ระบุปีงบประมาณ' }] }, {
        headers: async () => ({}), fetchImpl: async () => ({ ok: true, json: async () => ({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
                summary: 'สรุปโครงการ', qualifications: [], scope_of_work: [], tech_stack: [],
                flagged_clauses: [], risk_findings: [], confidence: 0.9, document_language: 'th',
                fiscal_year_evidence: [{ year: 2570, page: 1, clause_text: 'ปีงบประมาณ 2570' }],
            }) }] } }],
        }) }),
    });
    assert.equal(result.extraction.summary, 'สรุปโครงการ');
    assert.equal(result.extraction.fiscal_budget.year, null);
    assert.equal(result.extraction.fiscal_budget.status, 'not_found');
    assert.deepEqual(result.extraction.fiscal_year_evidence, []);
    assert.equal(result.extraction.fiscal_budget.warnings.length, 1);
});
