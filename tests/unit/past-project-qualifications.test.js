import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichPastProjectForProject, enrichPastProjectSummary } from '../../lib/vertex/past-project-qualifications.js';

const clause = 'จะต้องมีผลงานด้านพัฒนาระบบซอฟท์แวร์คอมพิวเตอร์ที่มีมูลค่าไม่น้อยกว่า ๔,๕๐๐,๐๐๐ บาท (สี่ล้านห้าแสนบาทถ้วน) ไม่น้อยกว่า ๑ สัญญา และเป็นผลงานแล้วเสร็จย้อนหลังไม่เกิน ๕ ปี';
const qualifications = [
    { value: 'มีความสามารถตามกฎหมาย', page: 3 },
    { value: 'ผู้ยื่นข้อเสนอต้องมีมูลค่าสุทธิของกิจการเป็นบวก', page: 4 },
    { value: clause, page: 6 },
];
const detected = { status: 'found', qualification_id: 3, minimum_baht: 4500000, operator: '>=', quote: clause };
const summaryFor = qualifications => ({
    _id: 'summary-1',
    extraction: { qualifications, fiscal_budget: { year: 2569 } },
});
const lean = value => ({ lean: async () => value });

function fixture(summary, result, { checkRequest, match = 1 } = {}) {
    const calls = [];
    const writes = [];
    return {
        calls, writes,
        SummaryModel: {
            findOne: () => ({ sort: () => lean(summary) }),
            findById: () => lean(summary),
            updateOne: async (...args) => {
                writes.push(args);
                return { matchedCount: match };
            },
        },
        headers: async () => ({}),
        fetchImpl: async (_url, options) => {
            const request = JSON.parse(options.body);
            const input = JSON.parse(request.contents[0].parts[0].text);
            calls.push(input);
            checkRequest?.(input, request);
            return Response.json({
                candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }],
            });
        },
    };
}

test.before(() => { process.env.GOOGLE_CLOUD_PROJECT ||= 'fixture'; });

test('standalone enrichment sends every qualification with มูลค่า and grounds the page 6 threshold', async () => {
    const summary = summaryFor(qualifications);
    const dependencies = fixture(summary, { ...detected, page: 99 }, {
        checkRequest(input) {
            assert.deepEqual(input, { qualifications: [
                { id: 2, ...qualifications[1] }, { id: 3, ...qualifications[2] },
            ] });
        },
    });
    dependencies.ProjectModel = { findOne: filter => {
        assert.deepEqual(filter, { project_id: '69099360837' });
        return lean({ primary_document_id: 'doc-1', latest_summary_id: 'summary-1' });
    } };
    const result = await enrichPastProjectForProject('69099360837', dependencies);
    assert.equal(result.documentSummaryId, 'summary-1');
    assert.equal(result.requirement.status, 'found');
    assert.equal(result.requirement.source, 'qualifications');
    assert.equal(result.requirement.minimum_baht, 4500000);
    assert.equal(result.requirement.operator, '>=');
    assert.deepEqual(result.requirement.evidence, [{ page: 6, clause_text: clause }]);
    assert.deepEqual(dependencies.writes[0][0]['extraction.qualifications'], { $eq: qualifications });
    assert.deepEqual(dependencies.writes[0][1], {
        $set: { 'extraction.past_project_requirement': result.requirement },
    });
    assert.equal(dependencies.calls.length, 1);
});

test('missing qualifications and a filtered-out list skip the Vertex request', async () => {
    for (const [items, status] of [[undefined, 'manual_review'], [[], 'manual_review'],
        [[qualifications[0]], 'not_stated']]) {
        const summary = summaryFor(items);
        const dependencies = fixture(summary, null);
        const { requirement } = await enrichPastProjectSummary(summary, dependencies);
        assert.equal(requirement.status, status);
        assert.equal(dependencies.calls.length, 0);
    }
});

test('amount, quote, operator, and source ID must match the stored qualification', async () => {
    for (const override of [{ minimum_baht: 5000000 }, { operator: '>' }, { qualification_id: 2 },
        { quote: clause.replace('๔', '๕') }, { quote: 'ไม่น้อยกว่า ๔,๕๐๐,๐๐๐ บาท' }]) {
        const summary = summaryFor(qualifications);
        const dependencies = fixture(summary, { ...detected, ...override });
        const { requirement } = await enrichPastProjectSummary(summary, dependencies);
        assert.equal(requirement.status, 'manual_review');
        assert.equal(requirement.minimum_baht, undefined);
    }
});

test('bid prices and aggregate values cannot be published as past-project minimums', async () => {
    for (const quote of [
        'ต้องมีผลงานประเภทเดียวกันและเสนอราคาไม่ต่ำกว่า ๔,๕๐๐,๐๐๐ บาท ซึ่งเป็นมูลค่าที่เสนอ',
        'ต้องมีผลงานที่มีมูลค่ารวมไม่น้อยกว่า ๔,๕๐๐,๐๐๐ บาท',
        'ต้องมีผลงานมูลค่าไม่น้อยกว่าร้อยละ 50 ของราคากลาง',
    ]) {
        const summary = summaryFor([{ value: quote, page: 6 }]);
        const dependencies = fixture(summary, { ...detected, qualification_id: 1, quote });
        assert.equal((await enrichPastProjectSummary(summary, dependencies)).requirement.status, 'manual_review', quote);
    }
});

test('strict and inclusive money phrases ignore separate percentage and age conditions', async () => {
    for (const [minimum, operator] of [['สูงกว่า', '>'], ['อย่างต่ำ', '>='], ['ไม่ต่ำกว่า', '>=']]) {
        const quote = `มีผลงานมูลค่า${minimum} ๔.๕ ล้านบาท ที่ส่งมอบครบ 100% ย้อนหลังไม่เกิน ๕ ปี`;
        const summary = summaryFor([{ value: quote, page: 6 }]);
        const dependencies = fixture(summary, { ...detected, qualification_id: 1, quote, operator });
        assert.equal((await enrichPastProjectSummary(summary, dependencies)).requirement.status, 'found', quote);
    }
});

test('unchanged qualifications reuse the result while changed qualifications are processed again', async () => {
    const summary = summaryFor(qualifications);
    const dependencies = fixture(summary, detected);
    summary.extraction.past_project_requirement = (await enrichPastProjectSummary(summary, dependencies)).requirement;
    assert.equal((await enrichPastProjectSummary(summary, dependencies)).reused, true);
    assert.equal(dependencies.calls.length, 1);
    summary.extraction.qualifications = [{ value: 'ผู้เสนอราคาต้องมีมูลค่าสุทธิเป็นบวก', page: 3 }];
    const refreshed = await enrichPastProjectSummary(summary, fixture(summary, { status: 'not_stated' }));
    assert.equal(refreshed.reused, false);
    assert.equal(refreshed.requirement.status, 'not_stated');
});

test('Vertex failure leaves the saved summary available for another enrichment attempt', async () => {
    const summary = summaryFor(qualifications);
    const dependencies = fixture(summary, detected);
    dependencies.maxAttempts = 1;
    dependencies.fetchImpl = async () => new Response(null, { status: 503 });
    await assert.rejects(enrichPastProjectSummary(summary, dependencies), /Vertex HTTP 503/);
    assert.equal(dependencies.writes.length, 0);
    assert.equal(summary.extraction.fiscal_budget.year, 2569);
});
