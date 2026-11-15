import { BidPrepDraft } from '../../models/BidPrepDraft.js';
import Project from '../../models/Project.js';
import { buildDraftDocx, safeDocxFilename } from './docx.js';
import { bidPrepNotices } from './notices.js';
import { isDraftId, isProjectId, limitFromEnv } from './security.js';
import { parseDraftContent } from './draft-content.js';
import { createOwnedDraft } from './draft-store.js';
import { checklistForUser } from './checklist.js';
export { parseDraftContent } from './draft-content.js';

function fail(status, code, message) { return { status, code, message }; }

function iso(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function publicDraft(draft, { includeSections }) {
    const payload = {
        id: String(draft._id),
        projectId: draft.projectId,
        title: draft.title || '',
        version: draft.version,
        createdAt: iso(draft.createdAt),
        updatedAt: iso(draft.updatedAt),
        notices: bidPrepNotices(),
    };
    if (includeSections) payload.sections = (draft.sections || []).map(section => ({
        heading: section.heading || '',
        body: section.body || '',
        sources: Array.isArray(section.sources) ? section.sources : [],
    }));
    return payload;
}

function hasContent(draft) {
    return Array.isArray(draft.sections) && draft.sections.some(section => typeof section?.body === 'string' && section.body.trim());
}

async function owned(userId, id) {
    if (!isDraftId(id)) return null;
    return BidPrepDraft.findOne({ _id: id, userId: String(userId) }).lean();
}

export async function createDraft(userId, body) {
    const parsed = parseDraftContent(body, { projectRequired: true });
    if (parsed.code) return parsed;
    const project = await Project.findOne({ project_id: parsed.projectId }).select('_id').lean();
    if (!project) return fail(404, 'TOR_NOT_FOUND', 'TOR not found.');
    const max = Math.min(limitFromEnv('BID_PREP_MAX_DRAFTS', 50), 50);
    const now = new Date();
    let created;
    try { created = await createOwnedDraft(userId, {
        projectId: parsed.projectId, title: parsed.title, sections: parsed.sections || [],
        version: 1, createdAt: now, updatedAt: now,
    }, max); }
    catch (error) { if (['DRAFT_LIMIT', 'USER_NOT_FOUND'].includes(error.code)) return fail(error.status, error.code, error.message); throw error; }
    return {
        status: 201,
        body: publicDraft(created, { includeSections: true }),
        audit: { event: 'bid_prep_draft_created', draftId: String(created._id), projectId: parsed.projectId },
    };
}

export async function listDrafts(userId) {
    const rows = await BidPrepDraft.find({ userId: String(userId) }).sort({ updatedAt: -1 }).limit(50)
        .select('projectId title version createdAt updatedAt').lean();
    return { status: 200, body: { drafts: rows.map(row => publicDraft(row, { includeSections: false })), notices: bidPrepNotices() } };
}

export async function getDraft(userId, id) {
    const draft = await owned(userId, id);
    if (!draft) return fail(404, 'DRAFT_NOT_FOUND', 'Draft not found.');
    return { status: 200, body: publicDraft(draft, { includeSections: true }) };
}

export async function updateDraft(userId, id, body) {
    if (!isDraftId(id)) return fail(404, 'DRAFT_NOT_FOUND', 'Draft not found.');
    if (!await owned(userId, id)) return fail(404, 'DRAFT_NOT_FOUND', 'Draft not found.');
    if (!Number.isSafeInteger(body.version) || body.version < 1) return fail(400, 'INVALID_DRAFT', 'version must be a positive integer.');
    const parsed = parseDraftContent(body, { projectRequired: false });
    if (parsed.code) return parsed;
    const changes = { updatedAt: new Date() };
    if (body.title != null) changes.title = parsed.title;
    if (body.sections != null) changes.sections = parsed.sections;
    const updated = await BidPrepDraft.findOneAndUpdate(
        { _id: id, userId: String(userId), version: body.version },
        { $set: changes, $inc: { version: 1 } },
        { returnDocument: 'after', runValidators: true },
    ).lean();
    if (updated) return { status: 200, body: publicDraft(updated, { includeSections: true }) };
    const current = await owned(userId, id);
    if (!current) return fail(404, 'DRAFT_NOT_FOUND', 'Draft not found.');
    return fail(409, 'DRAFT_CONFLICT', 'The draft was updated. Reload it and try again.');
}

export async function removeDraft(userId, id) {
    if (!isDraftId(id)) return fail(404, 'DRAFT_NOT_FOUND', 'Draft not found.');
    const result = await BidPrepDraft.deleteOne({ _id: id, userId: String(userId) });
    if (!result?.deletedCount) return fail(404, 'DRAFT_NOT_FOUND', 'Draft not found.');
    return { status: 200, body: { status: 'deleted', notices: bidPrepNotices() } };
}

export async function exportDraft(userId, id, { version } = {}) {
    const draft = await owned(userId, id);
    if (!draft) return fail(404, 'DRAFT_NOT_FOUND', 'Draft not found.');
    if (!hasContent(draft)) return fail(400, 'EMPTY_DRAFT', 'The draft has no content to export.');
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) return fail(400, 'INVALID_DRAFT', 'version must be a positive integer.');
    if (version !== undefined && version !== draft.version) return fail(409, 'DRAFT_CONFLICT', 'Reload the latest draft before exporting.');
    const parsed = parseDraftContent({ title: draft.title, sections: draft.sections }, { projectRequired: false });
    if (parsed.code || !Number.isFinite(new Date(draft.createdAt).getTime())) return fail(400, 'INVALID_DRAFT', 'Stored draft is corrupt and cannot be exported.');
    const checklist = await checklistForUser(userId, draft.projectId);
    const checklistBody = checklist.body || { items: [{ requirement: '[to fill in: qualification checklist]', status: 'manual',
        reason: `Checklist unavailable (${checklist.code || 'TOR_NOT_READY'}). Review the TOR before submitting.`, evidencePages: [] }], missingProfileFields: [], truncated: false };
    const file = buildDraftDocx({
        title: parsed.title, projectId: draft.projectId, sections: parsed.sections,
        createdAt: draft.createdAt, updatedAt: draft.updatedAt, checklist: checklistBody,
    });
    if (file.length > 2 * 1024 * 1024) return fail(413, 'PAYLOAD_TOO_LARGE', 'The export is too large.');
    return {
        status: 200,
        file,
        filename: safeDocxFilename(draft.projectId),
        audit: { event: 'bid_prep_draft_exported', draftId: String(draft._id), projectId: draft.projectId },
    };
}
