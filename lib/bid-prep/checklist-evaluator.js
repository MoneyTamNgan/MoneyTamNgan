import { bidPrepNotices } from './notices.js';
import { comparePastProjectValue } from './past-project-value.js';
import { compactQualificationText, sanitizePlainText } from './text.js';

const MAX_ITEMS = 100;
const baht = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const FIELD_CHECKS = [
    ['company_name', profile => String(profile.company_name || '').trim().length > 0],
    ['skills', profile => {
        const skills = profile.skills?.length ? profile.skills : profile.techStack;
        return Array.isArray(skills) && skills.length > 0;
    }],
    ['registered_capital', profile => typeof profile.registered_capital === 'number' && Number.isFinite(profile.registered_capital) && profile.registered_capital >= 0],
    ['concurrent_project_capacity', profile => Number.isInteger(profile.concurrent_project_capacity) && profile.concurrent_project_capacity >= 0],
    ['certifications', profile => Array.isArray(profile.certifications) && profile.certifications.length > 0],
];

function requirementOf(item) {
    if (typeof item === 'string') return { text: item, pages: [], needsReview: false };
    if (!item || typeof item !== 'object') return { text: '', pages: [], needsReview: false };
    const pages = [];
    for (const page of [item.page, item.source_page, ...(Array.isArray(item.evidence_pages) ? item.evidence_pages : [])]) {
        if (Number.isInteger(page) && page > 0 && page < 100000 && !pages.includes(page)) pages.push(page);
    }
    return {
        text: typeof item.value === 'string' ? item.value : '',
        pages: pages.slice(0, 20),
        needsReview: item.needs_review === true,
    };
}

function pastProjectValueCheck(comparison, qualifications, torNeedsReview) {
    if (comparison.status !== 'found' || comparison.evidence.length !== 1) return null;
    const [{ page, clauseText }] = comparison.evidence;
    const quote = compactQualificationText(clauseText);
    const matches = qualifications.filter(item =>
        item.pages.includes(page) && compactQualificationText(item.text).includes(quote));
    if (matches.length !== 1) return null;

    const [qualification] = matches;
    const { companyValueBaht, minimumBaht, meetsMinimum, operator } = comparison;
    const needsReview = qualification.needsReview || torNeedsReview;
    const amount = baht.format(minimumBaht);
    const comparatorLabel = operator === '>' ? 'มากกว่า' : 'ไม่น้อยกว่า';
    let status = 'manual';
    let reason;
    if (needsReview) {
        reason = 'The source qualification needs review before the value can be checked.';
    } else if (meetsMinimum === null) {
        reason = 'Missing company past-project value (past_projects or highest_past_project_value).';
    } else {
        status = meetsMinimum ? 'pass' : 'fail';
        reason = `Company's highest recorded past-project value (THB ${baht.format(companyValueBaht)}) ${meetsMinimum ? 'meets' : 'does not meet'} the stated amount. Check the full qualification separately.`;
    }
    return {
        qualification,
        item: {
            requirement: `ตรวจเฉพาะมูลค่าผลงานที่ผ่านมา (${comparatorLabel} ${amount} บาท)`,
            // Preserve the existing ID so saved overrides survive the label change.
            identityRequirement: `Past-project value only (${operator} THB ${amount})`,
            status, reason, evidencePages: [page], needsReview,
        },
    };
}

/** Compare one verified monetary threshold against preloaded profile data. */
export function checklistFromProfile({ projectId, profile, qualifications, torNeedsReview = false, pastProjectRequirement }) {
    const missingProfileFields = FIELD_CHECKS.filter(([, check]) => !check(profile || {})).map(([name]) => name);
    const pastProjectValueComparison = comparePastProjectValue(pastProjectRequirement, profile);
    if (pastProjectValueComparison.companyValueBaht === null) missingProfileFields.push('highest_past_project_value');

    const requirements = (Array.isArray(qualifications) ? qualifications : []).map(requirementOf);
    const valueCheck = pastProjectValueCheck(pastProjectValueComparison, requirements, torNeedsReview);
    const items = valueCheck ? [valueCheck.item] : [];
    const orderedRequirements = valueCheck
        ? [valueCheck.qualification, ...requirements.filter(item => item !== valueCheck.qualification)]
        : requirements;
    let truncated = false;
    for (const requirement of orderedRequirements) {
        const text = sanitizePlainText(requirement.text, 2000);
        if (!text) continue;
        if (items.length >= MAX_ITEMS) {
            truncated = true;
            break;
        }
        const needsReview = requirement.needsReview || torNeedsReview;
        items.push({
            requirement: text,
            status: 'manual',
            reason: needsReview
                ? 'Verify this qualification against the original TOR.'
                : 'Check the full qualification against the company profile and the TOR.',
            evidencePages: requirement.pages,
            needsReview,
        });
    }
    const summary = { pass: 0, fail: 0, manual: 0 };
    for (const item of items) summary[item.status]++;
    return { projectId, notices: bidPrepNotices(), summary, missingProfileFields, pastProjectValueComparison, truncated, items };
}
