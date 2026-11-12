import { BidPrepDraft } from '../../models/BidPrepDraft.js';
import Project from '../../models/Project.js';
import { buildDraftDocx, safeDocxFilename } from './docx.js';
import { bidPrepNotices } from './notices.js';
import { isDraftId, isProjectId, limitFromEnv } from './security.js';
import { sanitizePlainText } from './text.js';

const MAX_SECTIONS = 40;
const MAX_SOURCES = 20;
const MAX_TEXT_CHARS = 100_000;

function fail(status, code, message) {
    return { status, code, message };
}

function cleanLine(value, max, label) {
    if (value == null) return { value: '' };
    if (typeof value !== 'string') return fail(400, 'INVALID_DRAFT', `${label} must be text.`);
    return { value: sanitizePlainText(value, max) };
}

export function parseDraftContent(body, { projectRequired }) {
    const title = cleanLine(body.title, 200, 'title');
    if (title.code) return title;
    let projectId = '';
    if (projectRequired) {
        if (!isProjectId(body.projectId)) return fail(400, 'INVALID_DRAFT', 'projectId is not valid.');
        projectId = body.projectId;
    }
    if (body.sections == null) return { title: title.value, projectId, sections: null };
    if (!Array.isArray(body.sections) || body.sections.length > MAX_SECTIONS) {
        return fail(400, 'INVALID_DRAFT', 'sections must be a list of at most 40 items.');
    }
    const sections = [];
    let chars = title.value.length;
    for (const section of body.sections) {
        if (!section || typeof section !== 'object' || Array.isArray(section)) {
            return fail(400, 'INVALID_DRAFT', 'Each section must be an object.');
        }
        const heading = cleanLine(section.heading, 200, 'heading');
        const text = cleanLine(section.body, 8000, 'body');
        if (heading.code) return heading;
        if (text.code) return text;
        if (section.sources != null && !Array.isArray(section.sources)) {
            return fail(400, 'INVALID_DRAFT', 'sources must be a list of text.');
        }
        const sources = [];
        for (const source of section.sources || []) {
            if (typeof source !== 'string' || sources.length >= MAX_SOURCES) {
                return fail(400, 'INVALID_DRAFT', 'Each section has at most 20 text sources.');
            }
            const cleaned = sanitizePlainText(source, 200);
            if (cleaned) sources.push(cleaned);
        }
        chars += heading.value.length + text.value.length;
        if (chars > MAX_TEXT_CHARS) return fail(413, 'PAYLOAD_TOO_LARGE', 'Draft content is too large.');
        sections.push({ heading: heading.value, body: text.value, sources });
    }
    return { title: title.value, projectId, sections };
}

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
    if (String(draft.title || '').trim()) return true;
    return (draft.sections || []).some(section => String(section.heading || '').trim() || String(section.body || '').trim());
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
    const max = limitFromEnv('BID_PREP_MAX_DRAFTS', 50);
    const count = await BidPrepDraft.countDocuments({ userId: String(userId) });
    if (count >= max) return fail(400, 'DRAFT_LIMIT', 'Draft limit reached.');
    const now = new Date();
    const created = await BidPrepDraft.create({
        userId: String(userId),
        projectId: parsed.projectId,
        title: parsed.title,
        sections: parsed.sections || [],
        version: 1,
        createdAt: now,
        updatedAt: now,
    });
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
    if (!Number.isInteger(body.version) || body.version < 1) return fail(400, 'INVALID_DRAFT', 'version must be a positive integer.');
    const parsed = parseDraftContent(body, { projectRequired: false });
    if (parsed.code) return parsed;
    const changes = { updatedAt: new Date() };
    if (body.title != null) changes.title = parsed.title;
    if (body.sections != null) changes.sections = parsed.sections;
    const updated = await BidPrepDraft.findOneAndUpdate(
        { _id: id, userId: String(userId), version: body.version },
        { $set: changes, $inc: { version: 1 } },
        { new: true },
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

export async function exportDraft(userId, id) {
    const draft = await owned(userId, id);
    if (!draft) return fail(404, 'DRAFT_NOT_FOUND', 'Draft not found.');
    if (!hasContent(draft)) return fail(400, 'EMPTY_DRAFT', 'The draft has no content to export.');
    const file = buildDraftDocx({
        title: draft.title,
        projectId: draft.projectId,
        sections: draft.sections,
        createdAt: draft.updatedAt,
    });
    if (file.length > 2 * 1024 * 1024) return fail(413, 'PAYLOAD_TOO_LARGE', 'The export is too large.');
    return {
        status: 200,
        file,
        filename: safeDocxFilename(draft.projectId),
        audit: { event: 'bid_prep_draft_exported', draftId: String(draft._id), projectId: draft.projectId },
    };
}
