import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalUpsert, searchKeywords } from '../../scripts/backfill-history.js';

const raw = {
    project_id: '66027307521',
    project_name: 'ประกวดราคาจ้างพัฒนาระบบสารสนเทศ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)',
    dept_name: 'กรมตัวอย่าง',
    project_money: '1000000',
    project_status: 'สิ้นสุดสัญญา',
    announce_date: '21 มิ.ย. 66',
    contract: [{ contract_date: '1 ส.ค. 66', contract_finish_date: '31 ม.ค. 67' }],
};
const classification = { status: 'software', isSoftware: true, confidence: 0.65,
    method: 'upstream_keyword_classifier', reason: 'Software keyword signals outweighed non-software signals' };

test('searchKeywords drops short Latin keywords that flood the loose API search', () => {
    assert.deepEqual(searchKeywords(['ai', 'api', ' cloud ', 'ซอฟต์แวร์', 'cloud']), ['cloud', 'ซอฟต์แวร์']);
});

test('historical upsert classifies only on insert and never queues processing', () => {
    const { updateOne } = buildHistoricalUpsert(raw, classification, new Date('2026-10-27T00:00:00Z'));
    assert.deepEqual(updateOne.filter, { project_id: raw.project_id });
    assert.equal(updateOne.upsert, true);
    const { $set, $setOnInsert } = updateOne.update;
    assert.equal($set.is_software, undefined);
    assert.equal(Object.keys($set).some(key => key.startsWith('classification')), false);
    assert.equal($set.procurement_eligibility, undefined);
    assert.equal($setOnInsert.is_software, true);
    assert.equal($setOnInsert['classification.status'], 'software');
    assert.equal($setOnInsert['processing.status'], 'metadata_only');
    assert.equal($setOnInsert.procurement_eligibility.status, 'closed');
});
