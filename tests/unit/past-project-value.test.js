import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePastProjectValue } from '../../lib/bid-prep/past-project-value.js';

const saved = {
    status: 'found',
    minimum_baht: 2000000,
    operator: '>=',
    evidence: [{ page: 5, clause_text: 'ต้องมีผลงานมูลค่าไม่น้อยกว่า ๒ ล้านบาท' }],
};

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
