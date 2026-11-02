import { expect, it, vi } from 'vitest';
import { calculateBudgetAnomaly, evaluateBudgetAnomaly, budgetAnomalyFields } from '@/lib/budget-anomaly';

const project = { project_id: 'target', budget: 160, is_software: true, timeline: { announce_date: '2026-10-01' } };
const peers = (...budgets) => budgets.map((budget, i) => ({ project_id: `peer-${i}`, budget }));

it.each([0, 1, 2])('uses the target budget and multiplier 1 for N=%i', count => {
    expect(evaluateBudgetAnomaly(project, peers(...Array(count).fill(10)))).toMatchObject({
        baseline_price: 160, baseline_sample_count: count, baseline_method: 'tor_budget_fallback',
        budget_deviation_multiplier: 1, high_budget_flag: false, tags: [],
    });
});
it('uses the median beginning at exactly three samples', () => {
    expect(evaluateBudgetAnomaly(project, peers(90, 100, 10000))).toMatchObject({
        baseline_price: 100, budget_deviation_multiplier: 1.6, high_budget_flag: true,
        baseline_method: 'historical_category_median', tags: ['HIGH_BUDGET_ANOMALY'],
    });
    expect(evaluateBudgetAnomaly(project, peers(80, 90, 110, 120)).baseline_price).toBe(100);
});
it.each([[150, false], [150.000001, true], [149.999999, false]])('compares the unrounded ratio strictly at budget=%s', (budget, flagged) => {
    const result = evaluateBudgetAnomaly({ ...project, budget }, peers(100, 100, 100));
    expect(result.budget_deviation_multiplier).toBe(budget / 100);
    expect(result.high_budget_flag).toBe(flagged);
    expect(result.tags.includes('HIGH_BUDGET_ANOMALY')).toBe(flagged);
});
it('deduplicates projects, excludes the target, and rejects invalid sample budgets', () => {
    const result = evaluateBudgetAnomaly(project, [...peers(100, 100), { project_id: 'peer-0', budget: 100 },
        { project_id: 'target', budget: 1 }, ...peers(0, -1, NaN, Infinity, '100').map(p => ({ ...p, project_id: `invalid-${p.project_id}` }))]);
    expect(result.baseline_sample_count).toBe(2);
    expect(result.budget_deviation_multiplier).toBe(1);
});
it.each([0, -1, null, undefined, NaN, Infinity, '160'])('does not invent a calculable baseline for invalid target=%s', budget => {
    expect(evaluateBudgetAnomaly({ ...project, budget }, peers(100, 100, 100))).toMatchObject({
        baseline_price: null, baseline_method: 'unavailable', high_budget_flag: false,
        budget_deviation_multiplier: 1,
    });
});
it('removes a stale anomaly tag while preserving unrelated tags and flagged clauses', () => {
    const result = evaluateBudgetAnomaly({ ...project, anomalies: { tags: ['OTHER', 'HIGH_BUDGET_ANOMALY'] } }, []);
    expect(result.tags).toEqual(['OTHER']);
    expect(budgetAnomalyFields(result)['anomalies.tags']).toEqual(['OTHER']);
    expect(budgetAnomalyFields(result)).not.toHaveProperty('anomalies.flagged_clauses');
});
it.each([true, false])('queries only older projects in the same category=%s', async is_software => {
    const find = vi.fn(() => ({ select: () => ({ lean: async () => peers(90, 100, 110) }) }));
    const result = await calculateBudgetAnomaly({ ...project, is_software }, { ProjectModel: { find } });
    expect(find).toHaveBeenCalledWith({ project_id: { $ne: 'target' }, is_software, budget: { $gt: 0 },
        'timeline.announce_date': { $lt: new Date('2026-10-01') } });
    expect(result.baseline_category).toBe(is_software ? 'software' : 'non_software');
});
it('uses created_at chronology only when announcement date is absent', async () => {
    const find = vi.fn(() => ({ select: () => ({ lean: async () => [] }) }));
    await calculateBudgetAnomaly({ ...project, timeline: {}, created_at: '2026-09-01' }, { ProjectModel: { find } });
    expect(find.mock.calls[0][0].created_at).toEqual({ $lt: new Date('2026-09-01') });
});
it('falls back rather than mixing unknown categories or undated records into history', async () => {
    const find = vi.fn();
    for (const p of [{ ...project, is_software: null }, { ...project, timeline: {} }]) {
        expect((await calculateBudgetAnomaly(p, { ProjectModel: { find } })).baseline_method).toBe('tor_budget_fallback');
    }
    expect(find).not.toHaveBeenCalled();
});
