import Project from '../models/Project.js';

export const HIGH_BUDGET_TAG = 'HIGH_BUDGET_ANOMALY';
export const BUDGET_THRESHOLD = 1.5;
export const MIN_BUDGET_SAMPLES = 3;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const date = value => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

/** Exact median of distinct, valid historical project budgets; no rounding
 * before the strict threshold comparison. Category is the existing binary
 * software classification, not an inferred technology/subcategory. */
export function evaluateBudgetAnomaly(project, peers = []) {
    const budgets = [...new Map(peers.filter(p => p.project_id && p.project_id !== project.project_id && positive(p.budget))
        .map(p => [p.project_id, p.budget])).values()].sort((a, b) => a - b);
    const valid = positive(project.budget);
    const useHistory = valid && budgets.length >= MIN_BUDGET_SAMPLES;
    const middle = Math.floor(budgets.length / 2);
    const baseline = !valid ? null : !useHistory ? project.budget
        : budgets.length % 2 ? budgets[middle] : budgets[middle - 1] / 2 + budgets[middle] / 2;
    const ratio = valid ? project.budget / baseline : 1;
    const calculable = Number.isFinite(ratio) && ratio > 0;
    const flagged = valid && calculable && ratio > BUDGET_THRESHOLD;
    return {
        baseline_price: baseline,
        baseline_sample_count: budgets.length,
        baseline_method: !valid || !calculable ? 'unavailable' : useHistory ? 'historical_category_median' : 'tor_budget_fallback',
        budget_deviation_multiplier: calculable ? ratio : 1,
        high_budget_flag: flagged,
        tags: [...new Set([...(project.anomalies?.tags || []).filter(t => t !== HIGH_BUDGET_TAG), ...(flagged ? [HIGH_BUDGET_TAG] : [])])],
    };
}

export async function calculateBudgetAnomaly(project, { ProjectModel = Project } = {}) {
    const category = project.is_software === true ? 'software' : project.is_software === false ? 'non_software' : null;
    // Prefer announcement chronology; only fall back to ingestion chronology
    // when the target has no announcement date. Never include later records.
    const announced = date(project.timeline?.announce_date);
    const cutoff = announced || date(project.created_at);
    const timeField = announced ? 'timeline.announce_date' : 'created_at';
    const peers = positive(project.budget) && category && cutoff ? await ProjectModel.find({
        project_id: { $ne: project.project_id }, is_software: project.is_software,
        budget: { $gt: 0 }, [timeField]: { $lt: cutoff },
    }).select('project_id budget').lean() : [];
    return { ...evaluateBudgetAnomaly(project, peers), baseline_category: category, baseline_reference_date: cutoff };
}

export const budgetAnomalyFields = result => Object.fromEntries(
    Object.entries(result).map(([key, value]) => [`anomalies.${key}`, value])
);
