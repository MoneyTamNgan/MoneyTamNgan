import { createHash } from 'node:crypto';
import DocumentSummary from '../../models/DocumentSummary.js';
import Project from '../../models/Project.js';
import { User } from '../../models/User.js';
import { checklistFromProfile } from './checklist-evaluator.js';
import { isProjectId } from './security.js';

export { checklistFromProfile } from './checklist-evaluator.js';

const PROFILE_SELECT = 'company_name skills techStack registered_capital highest_past_project_value past_projects concurrent_project_capacity certifications bid_checklist_statuses bid_checklist_revision';
const STATUSES = new Set(['pass', 'fail', 'manual']);

function applyChecklistStatuses(checklist, documentId, overrides) {
    const occurrences = new Map();
    const summary = { pass: 0, fail: 0, manual: 0 };
    const items = checklist.items.map(({ identityRequirement, ...item }) => {
        const identity = JSON.stringify([identityRequirement ?? item.requirement, item.evidencePages]);
        const occurrence = (occurrences.get(identity) ?? 0) + 1;
        occurrences.set(identity, occurrence);
        const id = createHash('sha256').update(JSON.stringify([checklist.projectId, documentId, identity, occurrence])).digest('hex');
        const saved = overrides instanceof Map ? overrides.get(id) : overrides?.[id];
        const overrideStatus = STATUSES.has(saved) ? saved : null;
        const status = overrideStatus ?? item.status;
        summary[status]++;
        return { ...item, id, status, overrideStatus, reason: overrideStatus ? 'Status set manually.' : item.reason };
    });
    return { ...checklist, items, summary };
}

async function loadChecklist(userId, projectId) {
    if (!isProjectId(projectId)) return { status: 404, code: 'TOR_NOT_FOUND', message: 'TOR not found.' };
    const project = await Project.findOne({ project_id: projectId })
        .select('project_id latest_summary_id primary_document_id flagged_clauses_meta.analysis_status').lean();
    if (!project) return { status: 404, code: 'TOR_NOT_FOUND', message: 'TOR not found.' };
    if (!project.latest_summary_id && project.flagged_clauses_meta?.analysis_status === 'unreadable') {
        return { status: 409, code: 'TOR_DOCUMENT_UNREADABLE', message: 'The current TOR text could not be read.' };
    }
    const summary = await DocumentSummary.findOne({
        project_id: projectId,
        ...(project.primary_document_id ? { document_id: project.primary_document_id } : {}),
        ...(project.latest_summary_id ? { _id: project.latest_summary_id } : {}),
    }).sort({ processed_at: -1 }).select('document_id extraction needs_review confidence').lean();
    if (!summary) return { status: 409, code: 'TOR_NOT_READY', message: 'This TOR has not been processed yet.' };
    const profile = await User.findById(userId).select(PROFILE_SELECT).lean();
    if (!profile) return { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    const extraction = summary.extraction || {};
    const pastProjectRequirement = extraction.past_project_requirement;
    const lowConfidence = Number.isFinite(summary.confidence)
        && summary.confidence < Number(process.env.VERTEX_REVIEW_THRESHOLD || 0.8);
    return {
        status: 200,
        revision: profile.bid_checklist_revision ?? null,
        body: applyChecklistStatuses(checklistFromProfile({
            projectId,
            profile,
            qualifications: extraction.qualifications,
            torNeedsReview: summary.needs_review === true || lowConfidence,
            pastProjectRequirement: pastProjectRequirement?.source === 'qualifications'
                ? pastProjectRequirement : undefined,
        }), String(summary.document_id ?? summary._id), profile.bid_checklist_statuses),
    };
}

export async function checklistForUser(userId, projectId) {
    const result = await loadChecklist(userId, projectId);
    if (result.code) return result;
    return { status: result.status, body: result.body };
}

export async function updateChecklistStatus(userId, projectId, { itemId, status }) {
    if (typeof itemId !== 'string' || !/^[a-f0-9]{64}$/.test(itemId) || (status !== null && !STATUSES.has(status))) {
        return { status: 400, code: 'INVALID_CHECKLIST_STATUS', message: 'A valid checklist item ID and status are required.' };
    }
    const current = await loadChecklist(userId, projectId);
    if (current.code) return current;
    if (!current.body.items.some(item => item.id === itemId)) {
        return { status: 404, code: 'CHECKLIST_ITEM_NOT_FOUND', message: 'This checklist item is no longer available.' };
    }
    const path = `bid_checklist_statuses.${itemId}`;
    // A null filter also matches accounts created before checklist revisions existed.
    const result = await User.updateOne({ _id: userId, bid_checklist_revision: current.revision }, status === null
        ? { $unset: { [path]: '' } }
        : { $set: { [path]: status } });
    if (!result.matchedCount) {
        return { status: 409, code: 'CHECKLIST_CHANGED', message: 'Your Bid Prep data changed. Reload the checklist to try again.' };
    }
    return checklistForUser(userId, projectId);
}

// Set one decision on many items in a single request and a single write.
export async function updateChecklistStatuses(userId, projectId, { itemIds, status }) {
    const valid = Array.isArray(itemIds) && itemIds.length >= 1 && itemIds.length <= 200
        && itemIds.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) && STATUSES.has(status);
    if (!valid) {
        return { status: 400, code: 'INVALID_CHECKLIST_STATUS', message: 'A list of valid checklist item IDs and a status are required.' };
    }
    const wanted = new Set(itemIds);
    const current = await loadChecklist(userId, projectId);
    if (current.code) return current;
    const known = new Set(current.body.items.map(item => item.id));
    if ([...wanted].some(id => !known.has(id))) {
        return { status: 404, code: 'CHECKLIST_ITEM_NOT_FOUND', message: 'A checklist item is no longer available.' };
    }
    const set = Object.fromEntries([...wanted].map(id => [`bid_checklist_statuses.${id}`, status]));
    const result = await User.updateOne({ _id: userId, bid_checklist_revision: current.revision }, { $set: set });
    if (!result.matchedCount) {
        return { status: 409, code: 'CHECKLIST_CHANGED', message: 'Your Bid Prep data changed. Reload the checklist to try again.' };
    }
    return checklistForUser(userId, projectId);
}
