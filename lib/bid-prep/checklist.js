import DocumentSummary from '../../models/DocumentSummary.js';
import Project from '../../models/Project.js';
import { User } from '../../models/User.js';
import { bidPrepNotices } from './notices.js';
import { isProjectId } from './security.js';
import { sanitizePlainText } from './text.js';

const PROFILE_SELECT = 'company_name skills techStack registered_capital highest_past_project_value concurrent_project_capacity certifications';
const MAX_ITEMS = 100;

const FIELD_CHECKS = [
    ['company_name', profile => String(profile.company_name || '').trim().length > 0],
    ['skills', profile => {
        const skills = profile.skills?.length ? profile.skills : profile.techStack;
        return Array.isArray(skills) && skills.length > 0;
    }],
    ['registered_capital', profile => typeof profile.registered_capital === 'number' && Number.isFinite(profile.registered_capital) && profile.registered_capital >= 0],
    ['highest_past_project_value', profile => typeof profile.highest_past_project_value === 'number' && Number.isFinite(profile.highest_past_project_value) && profile.highest_past_project_value >= 0],
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

/**
 * Secured checklist view. Comparison stays manual: this layer never answers
 * pass from missing or ambiguous data. Issue #137 owns the comparison rules.
 */
export function checklistFromProfile({ projectId, profile, qualifications, torNeedsReview }) {
    const missingProfileFields = FIELD_CHECKS.filter(([, check]) => !check(profile || {})).map(([name]) => name);
    const items = [];
    for (const raw of qualifications || []) {
        if (items.length >= MAX_ITEMS) break;
        const requirement = requirementOf(raw);
        const text = sanitizePlainText(requirement.text, 2000);
        if (!text) continue;
        const needsReview = requirement.needsReview || torNeedsReview === true;
        items.push({
            requirement: text,
            status: 'manual',
            reason: needsReview
                ? 'This TOR item needs review, so it is not marked pass or fail.'
                : 'Not compared automatically. Check it against the company profile and the TOR.',
            evidencePages: requirement.pages,
            needsReview,
        });
    }
    return {
        projectId,
        notices: bidPrepNotices(),
        summary: {
            pass: 0,
            fail: 0,
            manual: items.length,
        },
        missingProfileFields,
        truncated: Array.isArray(qualifications) && qualifications.length > items.length,
        items,
    };
}

export async function checklistForUser(userId, projectId) {
    if (!isProjectId(projectId)) return { status: 404, code: 'TOR_NOT_FOUND', message: 'TOR not found.' };
    const project = await Project.findOne({ project_id: projectId }).select('project_id').lean();
    if (!project) return { status: 404, code: 'TOR_NOT_FOUND', message: 'TOR not found.' };
    const summary = await DocumentSummary.findOne({ project_id: projectId }).sort({ processed_at: -1 }).select('extraction needs_review').lean();
    if (!summary) return { status: 409, code: 'TOR_NOT_READY', message: 'This TOR has not been processed yet.' };
    const profile = await User.findById(userId).select(PROFILE_SELECT).lean();
    if (!profile) return { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    const extraction = summary.extraction || {};
    return {
        status: 200,
        body: checklistFromProfile({
            projectId,
            profile,
            qualifications: extraction.qualifications,
            torNeedsReview: summary.needs_review === true,
        }),
    };
}
