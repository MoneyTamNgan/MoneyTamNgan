import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePastProjectValue } from '../../lib/bid-prep/past-project-value.js';
import { resolvePastProjectRequirement } from '../../lib/past-project-requirement.js';
import { extractTorWithVertex } from '../../lib/vertex/tor-extractor.js';

const heading = '4. คุณสมบัติของผู้ยื่นข้อเสนอ';
const clearClause = '4.1 ต้องมีผลงานประเภทเดียวกัน มูลค่าไม่น้อยกว่า ๒ ล้านบาท';
const pagesFor = clause => [{ page_number: 5, text: `${heading}\n${clause}` }];
const proposal = (clause_text, minimum_baht = 2000000, operator = '>=', page = 5) => ({
    status: 'found', minimum_baht, operator, evidence: [{ page, clause_text }],
});
const verify = (pages, suggestions, complete = true) =>
    resolvePastProjectRequirement(pages, suggestions, { complete });
const saved = { status: 'found', minimum_baht: 2000000, operator: '>=', evidence: proposal(clearClause).evidence };

for (const [label, phrase, amount, operator] of [
    ['Thai numerals and millions', 'ไม่น้อยกว่า ๒ ล้านบาท', 2000000, '>='],
    ['Arabic grouping and satang', 'ไม่ต่ำกว่า 2,000,000.50 บาท', 2000000.5, '>='],
    ['Thai grouping and baht', 'อย่างน้อย ๒,๐๐๐,๐๐๐ บาทถ้วน', 2000000, '>='],
    ['currency prefix', 'มากกว่า ฿2000000', 2000000, '>'],
    ['hundred-thousands', 'ตั้งแต่ 5 แสนบาทขึ้นไป', 500000, '>='],
    ['decimal scale', 'สูงกว่า 1.25 ล้านบาท', 1250000, '>'],
    ['minimum after the amount', '2 ล้านบาทขึ้นไป', 2000000, '>='],
]) {
    test(`verifies a prior-work minimum with ${label}`, () => {
        const clause = `4.1 ต้องมีผลงานประเภทเดียวกัน มูลค่า${phrase}`;
        assert.deepEqual(verify(pagesFor(clause), [proposal(clause, amount, operator)]),
            { status: 'found', minimum_baht: amount, operator, evidence: [{ page: 5, clause_text: clause }] });
    });
}

test('accepts a prior-work clause continued on the next PDF page', () => {
    const start = '4.1 ต้องมีผลงานประเภทเดียวกัน';
    const end = 'มูลค่าไม่น้อยกว่า ๒ ล้านบาท';
    const input = [...pagesFor(start), { page_number: 6, text: end }];
    const evidence = [{ page: 5, clause_text: start }, { page: 6, clause_text: end }];
    assert.deepEqual(verify(input, [{ ...proposal(start), evidence }]), { ...saved, evidence });
});

test('separates a prior-work minimum from the procurement budget and registered capital', () => {
    const body = `${clearClause}\n4.2 ทุนจดทะเบียนไม่น้อยกว่า 3 ล้านบาท\n5. วงเงินงบประมาณ 10 ล้านบาท`;
    assert.deepEqual(verify(pagesFor(body), [proposal(clearClause)]), saved);
});

test('a readable qualifications section with experience but no value records not_stated', () => {
    const input = pagesFor('4.1 ผู้ยื่นข้อเสนอต้องมีประสบการณ์อย่างน้อย 3 ปี\n5. งบประมาณ 10 ล้านบาท');
    assert.deepEqual(verify(input, []), { status: 'not_stated', evidence: [] });
});

test('an empty document or missing qualifications heading needs review', () => {
    assert.equal(verify([], []).status, 'manual_review');
    assert.equal(verify([{ page_number: 1, text: 'ข้อความทั่วไปของโครงการ' }], []).status, 'manual_review');
});

test('incomplete OCR coverage needs review even if Vertex found a valid amount', () => {
    assert.equal(verify(pagesFor(clearClause), [proposal(clearClause)], false).status, 'manual_review');
});

test('rejects a wrong page, paraphrased quote, amount, or operator', () => {
    for (const candidate of [
        proposal(clearClause, 2000000, '>=', 6), proposal(clearClause.replace('ประเภท', 'ลักษณะ')),
        proposal(clearClause, 2500000), proposal(clearClause, 2000000, '>'),
    ]) assert.equal(verify(pagesFor(clearClause), [candidate]).status, 'manual_review');
});

test('a keyword candidate omitted by Vertex needs review', () => {
    assert.deepEqual(verify(pagesFor(clearClause), []), { status: 'manual_review', evidence: saved.evidence });
});

test('unclear clauses always require manual review', () => {
    for (const clause of [
        '4.1 ต้องมีผลงานมูลค่ารวมไม่น้อยกว่า ๒ ล้านบาท',
        '4.1 ต้องมีผลงานมูลค่าไม่น้อยกว่าร้อยละ 50 ของราคากลาง',
        '4.1 ต้องมีผลงานมูลค่าไม่เกิน ๒ ล้านบาท',
        '4.1 ต้องมีประสบการณ์และวงเงินงบประมาณไม่น้อยกว่า ๒ ล้านบาท',
        '4.1 ต้องมีผลงานมูลค่าไม่น้อยกว่า ๒ ล้านบาท หรือ ๓ ล้านบาท',
        '4.1 ผลงานเดิมของหน่วยงานมีมูลค่ามากกว่า ๒ ล้านบาท',
    ]) assert.equal(verify(pagesFor(clause), [proposal(clause)]).status, 'manual_review', clause);
    const alternative = `${clearClause} หรือ ๓ ล้านบาท`;
    assert.equal(verify(pagesFor(alternative), [proposal(clearClause)]).status, 'manual_review');
    const other = clearClause.replace('๒', '๓').replace('4.1', '4.2');
    assert.equal(verify(pagesFor(`${clearClause}\n${other}`), [proposal(clearClause), proposal(other, 3000000)]).status, 'manual_review');
});

test('the value comparison prefers recorded projects and includes the inclusive boundary', () => {
    const profile = { past_projects: [{ value: 1000000 }, { value: 2000000 }], highest_past_project_value: 9000000 };
    const comparison = comparePastProjectValue(saved, profile);
    assert.equal(comparison.companyValueBaht, 2000000);
    assert.equal(comparison.meetsMinimum, true);
    assert.equal(comparison.evidence[0].page, 5);
    assert.equal(comparePastProjectValue({ ...saved, operator: '>' }, profile).meetsMinimum, false);
});

test('uses the legacy value as a fallback and leaves missing data ungraded', () => {
    assert.equal(comparePastProjectValue(saved, { highest_past_project_value: 1500000 }).meetsMinimum, false);
    assert.equal(comparePastProjectValue(saved, { highest_past_project_value: 0 }).companyValueBaht, 0);
    assert.equal(comparePastProjectValue(saved, { past_projects: [{ value: '2000000' }, { value: -1 }] }).meetsMinimum, null);
    assert.equal(comparePastProjectValue(undefined, {}).status, 'pending_extraction');
    assert.equal(comparePastProjectValue({ status: 'not_stated' }, {}).meetsMinimum, null);
    assert.equal(comparePastProjectValue({ ...saved, evidence: [] }, {}).status, 'manual_review');
});

test('the existing Vertex request sends candidates and returns only the verified extraction', async t => {
    const old = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'fixture';
    t.after(() => {
        if (old === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
        else process.env.GOOGLE_CLOUD_PROJECT = old;
    });
    let calls = 0;
    const extraction = { summary: '', qualifications: [], scope_of_work: [], tech_stack: [],
        flagged_clauses: [], risk_findings: [], fiscal_year_evidence: [],
        past_project_evidence: [proposal(clearClause)], confidence: 0.9, document_language: 'th' };
    const result = await extractTorWithVertex({ pages: pagesFor(clearClause) }, {
        headers: async () => ({}),
        fetchImpl: async (_url, { body }) => {
            calls++;
            const request = JSON.parse(JSON.parse(body).contents[0].parts[0].text);
            assert.equal(request.past_project_candidates[0][0].clause_text, clearClause);
            assert.deepEqual(request.document_pages, pagesFor(clearClause));
            return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(extraction) }] } }] });
        },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.extraction.past_project_requirement, saved);
    assert.equal(Object.hasOwn(result.extraction, 'past_project_evidence'), false);
});
