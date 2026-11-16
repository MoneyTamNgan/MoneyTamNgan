import assert from 'node:assert/strict';
import test from 'node:test';
import { checklistFromProfile } from '../../lib/bid-prep/checklist-evaluator.js';

const quote = 'ต้องมีผลงานด้านพัฒนาระบบซอฟต์แวร์ มูลค่าไม่น้อยกว่า ๔,๕๐๐,๐๐๐ บาท';
const fullClause = `${quote} อย่างน้อยหนึ่งสัญญา แล้วเสร็จย้อนหลังไม่เกิน ๕ ปี`;
const qualification = { value: fullClause, page: 6 };
const requirement = {
    source: 'qualifications', status: 'found', minimum_baht: 4500000, operator: '>=',
    evidence: [{ page: 6, clause_text: quote }],
};
const build = (overrides = {}) => checklistFromProfile({
    projectId: '69099360837',
    profile: { past_projects: [{ value: 5000000 }] },
    qualifications: [qualification],
    pastProjectRequirement: requirement,
    ...overrides,
});

for (const [label, operator, minimum, savedValue, expected] of [
    ['above the stated amount', '>=', 4500000, 5000000, 'pass'],
    ['below the stated amount', '>=', 4500000, 4000000, 'fail'],
    ['equal to an inclusive amount', '>=', 4500000, 4500000, 'pass'],
    ['equal to a strict amount', '>', 4500000, 4500000, 'fail'],
    ['above a fractional minimum', '>', 4500000.25, 4500000.26, 'pass'],
    ['zero company value', '>=', 4500000, 0, 'fail'],
]) {
    test(`checks the value alone for a project ${label}`, () => {
        const money = minimum === 4500000 ? '๔,๕๐๐,๐๐๐' : minimum.toLocaleString('en-US');
        const evidenceQuote = `ต้องมีผลงานด้านพัฒนาระบบซอฟต์แวร์ มูลค่า${operator === '>' ? 'มากกว่า' : 'ไม่น้อยกว่า'} ${money} บาท`;
        const valueClause = fullClause.replace(quote, evidenceQuote);
        const result = build({
            profile: { past_projects: [{ value: savedValue }] },
            qualifications: [{ ...qualification, value: valueClause }],
            pastProjectRequirement: { ...requirement, operator, minimum_baht: minimum, evidence: [{ page: 6, clause_text: evidenceQuote }] },
        });
        assert.equal(result.items[0].status, expected);
        assert.deepEqual(result.items[0].evidencePages, [6]);
        const comparatorLabel = operator === '>' ? 'มากกว่า' : 'ไม่น้อยกว่า';
        assert.equal(result.items[0].requirement,
            `ตรวจเฉพาะมูลค่าผลงานที่ผ่านมา (${comparatorLabel} ${minimum.toLocaleString('en-US')} บาท)`);
        assert.equal(result.items[1].status, 'manual');
        assert.equal(result.items[1].requirement, valueClause);
        assert.deepEqual(result.summary, { pass: Number(expected === 'pass'), fail: Number(expected === 'fail'), manual: 1 });
    });
}

test('uses the legacy company value when no recorded project has a usable value', () => {
    assert.equal(build({ profile: { past_projects: [{ value: -1 }], highest_past_project_value: 4500000 } }).items[0].status, 'pass');
});

test('marks a grounded amount manual and names the fields when the company value is missing', () => {
    const result = build({ profile: {} });
    assert.equal(result.items[0].status, 'manual');
    assert.match(result.items[0].reason, /past_projects or highest_past_project_value/);
    assert.ok(result.missingProfileFields.includes('highest_past_project_value'));
});

test('marks a flagged TOR or qualification for review', () => {
    for (const options of [{ torNeedsReview: true }, { qualifications: [{ ...qualification, needs_review: true }] }]) {
        const result = build(options);
        assert.equal(result.items[0].status, 'manual');
        assert.equal(result.items[0].needsReview, true);
        assert.equal(result.summary.pass, 0);
    }
});

test('matches the quote to its recorded page even with whitespace in the saved clause', () => {
    const result = build({ qualifications: [
        { value: fullClause, page: 5 },
        { value: fullClause.replace('มูลค่าไม่น้อยกว่า', 'มูลค่า\n ไม่น้อยกว่า'), page: 6 },
        { value: 'ต้องมีทุนจดทะเบียน', page: 6 },
    ] });
    assert.equal(result.items[0].status, 'pass');
    assert.equal(result.summary.manual, 3);
});

for (const [label, overrides] of [
    ['a quote on another page', { qualifications: [{ ...qualification, page: 7 }] }],
    ['an unrelated quote on the correct page', { qualifications: [{ value: 'ต้องมีทุนจดทะเบียน', page: 6 }] }],
    ['an ambiguous match to multiple qualifications', { qualifications: [qualification, qualification] }],
    ['a missing extraction', { pastProjectRequirement: undefined }],
    ['a not-stated minimum', { pastProjectRequirement: { status: 'not_stated' } }],
    ['an extraction held for review', { pastProjectRequirement: { ...requirement, status: 'manual_review' } }],
    ['a requirement with no evidence', { pastProjectRequirement: { ...requirement, evidence: [] } }],
]) {
    test(`keeps all qualifications manual for ${label}`, () => {
        const result = build(overrides);
        assert.ok(result.items.length > 0);
        assert.ok(result.items.every(item => item.status === 'manual'));
        assert.equal(result.summary.pass, 0);
        assert.equal(result.summary.fail, 0);
    });
}

test('returns an empty checklist when no qualifications are present', () => {
    const result = build({ qualifications: [] });
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.summary, { pass: 0, fail: 0, manual: 0 });
    assert.equal(result.truncated, false);
});

test('evaluates 100 rows within the checklist budget without dropping the value check', () => {
    const other = { value: 'ต้องมีทุนจดทะเบียนอย่างน้อย ๑ ล้านบาท และมีใบรับรอง ISO 9001', page: 3 };
    const qualifications = [...Array(99).fill(other), qualification];
    const start = performance.now();
    const result = build({ qualifications });
    assert.ok(performance.now() - start < 100);
    assert.equal(result.items.length, 100);
    assert.equal(result.items[0].status, 'pass');
    assert.equal(result.items[1].requirement, fullClause);
    assert.equal(result.summary.manual, 99);
    assert.equal(result.truncated, true);
});
