import { sanitizePlainText } from './text.js';

const isValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function highestPastProjectValue(profile) {
    const values = (Array.isArray(profile?.past_projects) ? profile.past_projects : [])
        .map(project => project?.value).filter(isValue);
    if (values.length) return Math.max(...values);
    return isValue(profile?.highest_past_project_value) ? profile.highest_past_project_value : null;
}

export function comparePastProjectValue(requirement, profile) {
    const companyValueBaht = highestPastProjectValue(profile);
    const evidence = (Array.isArray(requirement?.evidence) ? requirement.evidence : [])
        .filter(item => Number.isInteger(item?.page) && item.page > 0 && typeof item.clause_text === 'string')
        .map(item => ({ page: item.page, clauseText: sanitizePlainText(item.clause_text, 2000) }))
        .filter(item => item.clauseText);
    const result = { companyValueBaht, minimumBaht: null, operator: null, meetsMinimum: null, evidence };
    if (!requirement) return { ...result, status: 'pending_extraction' };
    if (requirement.status === 'not_stated') return { ...result, status: 'not_stated' };
    const { minimum_baht: minimumBaht, operator } = requirement;
    if (requirement.status !== 'found' || !isValue(minimumBaht) || minimumBaht === 0
        || !['>=', '>'].includes(operator) || !evidence.length) return { ...result, status: 'manual_review' };
    const meetsMinimum = companyValueBaht === null ? null
        : operator === '>' ? companyValueBaht > minimumBaht : companyValueBaht >= minimumBaht;
    return { ...result, status: 'found', minimumBaht, operator, meetsMinimum };
}
