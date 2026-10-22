import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDiscoveryCandidate } from '../../lib/discovery-candidates.js';
const lean = value => ({ lean: async () => value });

for (const status of ['unknown', 'closed', 'open']) {
    test(`candidate ${status} never bypasses open-bid admission`, async () => {
        const writes = [], promotions = [], jobs = [];
        const dependencies = {
            CandidateModel: { findOne: () => lean({ _id: 'candidate', payload: {
                project_id: '67000000001', project_name: 'พัฒนาระบบสารสนเทศ', dept_name: 'fixture',
            } }), updateOne: async (...args) => writes.push(args) },
            ProjectModel: { findOne: () => lean(null), findOneAndUpdate: async (...args) => promotions.push(args) },
            loadKeywords: async () => ({}),
            verifyEligibility: async () => ({ status, reason: 'fixture' }),
            enqueue: async id => jobs.push(id),
        };
        if (status === 'unknown') await assert.rejects(verifyDiscoveryCandidate('67000000001', dependencies), /Eligibility unavailable/);
        else await verifyDiscoveryCandidate('67000000001', dependencies);
        assert.equal(promotions.length, status === 'open' ? 1 : 0);
        assert.equal(jobs.length, status === 'open' ? 1 : 0);
        assert.equal(writes[0][1].$set.status, status === 'closed' ? 'closed' : 'pending');
    });
}
test('manually rejected candidate cannot be promoted by keyword matching', async () => {
    const result = await verifyDiscoveryCandidate('67000000001', {
        CandidateModel: { findOne: () => lean({ _id: 'candidate', payload: { project_name: 'พัฒนาระบบสารสนเทศ' } }), updateOne: async () => {} },
        ProjectModel: { findOne: () => lean({ is_software: false, classification: { status: 'manual_override' } }) },
        verifyEligibility: async () => assert.fail('Must not verify a rejected candidate'),
    });
    assert.equal(result.status, 'review_required');
});
test('admin override on an unpublished candidate is honoured on promotion', async () => {
    const reviewer = { user_id: 'admin-1', email: 'a@example.com', via: 'admin_session' };
    const promotions = [];
    const result = await verifyDiscoveryCandidate('67000000001', {
        CandidateModel: { findOne: () => lean({ _id: 'candidate', payload: {
            project_id: '67000000001', project_name: 'รายการทดสอบ', dept_name: 'fixture',
        }, classification: { isSoftware: true, status: 'manual_override', method: 'admin_override',
            reason: 'Admin', tags: ['ERP'], reviewed_by: reviewer, reviewed_at: new Date(0) } }), updateOne: async () => {} },
        ProjectModel: { findOne: () => lean(null), findOneAndUpdate: async (...args) => promotions.push(args) },
        loadKeywords: async () => assert.fail('Must not re-run keywords over an admin override'),
        verifyEligibility: async () => ({ status: 'open' }),
        enqueue: async () => {},
    });
    assert.equal(result.status, 'promoted');
    const update = promotions[0][1];
    assert.equal(update.$set.is_software, true);
    assert.equal(update.$set['classification.status'], 'manual_override');
    assert.deepEqual(update.$set['classification.reviewed_by'], reviewer);
    assert.equal(update.$setOnInsert['classification.status'], undefined);
});
test('admin-rejected candidate is marked rejected', async () => {
    const writes = [];
    const result = await verifyDiscoveryCandidate('67000000001', {
        CandidateModel: { findOne: () => lean({ _id: 'candidate', payload: { project_name: 'พัฒนาระบบสารสนเทศ' },
            classification: { isSoftware: false, status: 'manual_override' } }), updateOne: async (...args) => writes.push(args) },
        ProjectModel: { findOne: () => lean(null) },
        verifyEligibility: async () => assert.fail('Must not verify a rejected candidate'),
    });
    assert.equal(result.status, 'rejected');
    assert.equal(writes[0][1].$set.status, 'rejected');
});
