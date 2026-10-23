/**
 * Admin classification & document status overrides (FR-1.2.2, FR-1.2.3).
 *
 * An override is final: keyword re-runs, ingestion refreshes and candidate
 * verification all skip records whose classification.status is
 * `manual_override`. Every override is recorded in ClassificationOverride
 * together with the reviewer who made it.
 */

import ClassificationOverride from '../models/ClassificationOverride.js';
import DiscoveryCandidate from '../models/DiscoveryCandidate.js';
import Document from '../models/Document.js';
import Project from '../models/Project.js';
import { SESSION_COOKIE, verifySession } from './auth.js';
import { enqueueProject } from './job-queue.js';
import { isPipelineAuthorized } from './pipeline-auth.js';

export const PROCESSING_STATUSES = Project.schema.path('processing.status').enumValues;
export const DOCUMENT_STATUSES = Document.schema.path('processing_status').enumValues;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_REASON_LENGTH = 500;

export class OverrideError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

/** Validate a PATCH body; returns { value } or { error }. */
export function parseOverrideBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be a JSON object' };
    const { isSoftware, tags, processingStatus, documentStatus, reason, enqueueProcessing = false } = body;

    if (isSoftware !== undefined && typeof isSoftware !== 'boolean') return { error: 'isSoftware must be a boolean' };
    if (typeof enqueueProcessing !== 'boolean') return { error: 'enqueueProcessing must be a boolean' };
    if (processingStatus !== undefined && !PROCESSING_STATUSES.includes(processingStatus)) {
        return { error: `processingStatus must be one of: ${PROCESSING_STATUSES.join(', ')}` };
    }
    if (documentStatus !== undefined && !DOCUMENT_STATUSES.includes(documentStatus)) {
        return { error: `documentStatus must be one of: ${DOCUMENT_STATUSES.join(', ')}` };
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH)) {
        return { error: `reason must be a string of at most ${MAX_REASON_LENGTH} characters` };
    }

    let cleanTags;
    if (tags !== undefined) {
        if (!Array.isArray(tags) || tags.length > MAX_TAGS) return { error: `tags must be an array of at most ${MAX_TAGS} strings` };
        cleanTags = [];
        for (const tag of tags) {
            const value = typeof tag === 'string' ? tag.trim() : '';
            if (!value || value.length > MAX_TAG_LENGTH) return { error: `each tag must be a non-empty string of at most ${MAX_TAG_LENGTH} characters` };
            if (!cleanTags.some(existing => existing.toLowerCase() === value.toLowerCase())) cleanTags.push(value);
        }
    }

    if (isSoftware === undefined && cleanTags === undefined && processingStatus === undefined && documentStatus === undefined) {
        return { error: 'Provide at least one of isSoftware, tags, processingStatus or documentStatus' };
    }
    return { value: {
        isSoftware, tags: cleanTags, processingStatus, documentStatus,
        reason: reason?.trim() || undefined, enqueueProcessing,
    } };
}

/** Who is making the change: the admin session, or an operator using the pipeline token. */
export async function reviewerFromRequest(request) {
    const raw = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
    const session = await verifySession(raw ? decodeURIComponent(raw) : null);
    if (session?.role === 'admin') {
        return { user_id: String(session.sub), email: session.email ?? null, via: 'admin_session' };
    }
    if (isPipelineAuthorized(request)) return { user_id: null, email: null, via: 'pipeline_token' };
    return null;
}

function defaultReason(isSoftware) {
    return `Manually classified as ${isSoftware ? 'software' : 'not software'} by admin`;
}

function projectSnapshot(project, document) {
    return {
        is_software: project.is_software ?? null,
        classification_status: project.classification?.status,
        tags: project.classification?.tags ?? [],
        processing_status: project.processing?.status ?? project.workflow?.status,
        document_status: document?.processing_status,
    };
}

function candidateSnapshot(candidate) {
    return {
        is_software: candidate.classification?.isSoftware ?? null,
        classification_status: candidate.classification?.status,
        tags: candidate.classification?.tags ?? [],
        processing_status: undefined,
        document_status: undefined,
    };
}

/** Processing status implied by a classification change, unless the admin set one. */
function nextProcessingStatus(project, input) {
    if (input.processingStatus) return input.processingStatus;
    const current = project.processing?.status;
    if (input.isSoftware === false) return 'irrelevant';
    if (input.isSoftware === true && current === 'irrelevant') {
        return project.primary_document_id ? 'document_downloaded' : 'document_pending';
    }
    return null;
}

async function overrideProject(project, input, reviewer, now) {
    let document = null;
    if (input.documentStatus) {
        document = project.primary_document_id ? await Document.findById(project.primary_document_id).lean() : null;
        if (!document) throw new OverrideError('NO_DOCUMENT', 'This TOR has no stored document to update', 409);
    }

    const set = {
        'classification.reviewed_by': reviewer,
        'classification.reviewed_at': now,
    };
    if (input.isSoftware !== undefined) {
        Object.assign(set, {
            is_software: input.isSoftware,
            'classification.status': 'manual_override',
            'classification.method': 'admin_override',
            'classification.confidence': null,
            'classification.classified_at': now,
            'classification.reason': input.reason || defaultReason(input.isSoftware),
        });
    } else if (input.reason) {
        set['classification.reason'] = input.reason;
    }
    if (input.tags) set['classification.tags'] = input.tags;
    const processingStatus = nextProcessingStatus(project, input);
    if (processingStatus) {
        Object.assign(set, {
            'processing.status': processingStatus,
            'processing.error': null,
            'workflow.status': processingStatus,
            'workflow.error': null,
            'workflow.updated_at': now,
        });
    }

    await Project.updateOne({ _id: project._id }, { $set: set }, { runValidators: true });
    if (document) {
        await Document.updateOne({ _id: document._id }, { $set: { processing_status: input.documentStatus } }, { runValidators: true });
    }

    const updated = await Project.findById(project._id).lean();
    if (input.enqueueProcessing && updated.is_software === true) await enqueueProject(updated.project_id);
    return {
        before: projectSnapshot(project, document),
        after: projectSnapshot(updated, document && { ...document, processing_status: input.documentStatus }),
    };
}

async function overrideCandidate(candidate, input, reviewer, now) {
    if (input.processingStatus || input.documentStatus) {
        throw new OverrideError('NOT_PUBLISHED', 'Processing and document status apply only to published TORs', 409);
    }
    const classification = {
        ...(candidate.classification || {}),
        reviewed_by: reviewer,
        reviewed_at: now,
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.isSoftware !== undefined ? {
            isSoftware: input.isSoftware,
            status: 'manual_override',
            method: 'admin_override',
            confidence: null,
            reason: input.reason || defaultReason(input.isSoftware),
        } : {}),
    };
    const set = { classification };
    // Software candidates go back through open-bid verification before
    // publication; rejected ones leave the review queue.
    if (input.isSoftware === true) Object.assign(set, { status: 'pending', error: null });
    if (input.isSoftware === false) set.status = 'rejected';

    await DiscoveryCandidate.updateOne({ _id: candidate._id }, { $set: set });
    if (input.isSoftware === true) await enqueueProject(candidate.project_id, { type: 'verify_candidate' });
    const updated = await DiscoveryCandidate.findById(candidate._id).lean();
    return { before: candidateSnapshot(candidate), after: candidateSnapshot(updated), candidate: updated };
}

/**
 * Apply an override to a published project, or to a discovery candidate
 * (low-confidence notices that never became a project).
 */
export async function applyClassificationOverride(projectId, input, reviewer, { now = new Date() } = {}) {
    const project = await Project.findOne({ project_id: projectId }).lean();
    const candidate = project ? null : await DiscoveryCandidate.findOne({ project_id: projectId }).lean();
    if (!project && !candidate) throw new OverrideError('TOR_NOT_FOUND', `No TOR or candidate exists with id: ${projectId}`, 404);

    const result = project
        ? await overrideProject(project, input, reviewer, now)
        : await overrideCandidate(candidate, input, reviewer, now);
    await ClassificationOverride.create({
        project_id: projectId,
        target: project ? 'project' : 'candidate',
        reviewer,
        reason: input.reason,
        before: result.before,
        after: result.after,
    });
    return { target: project ? 'project' : 'candidate', candidate: result.candidate ?? null };
}

export function toOverrideHistoryItem(entry) {
    return {
        id: String(entry._id),
        target: entry.target,
        reviewer: {
            userId: entry.reviewer?.user_id ?? null,
            email: entry.reviewer?.email ?? null,
            via: entry.reviewer?.via,
        },
        reason: entry.reason ?? null,
        before: entry.before,
        after: entry.after,
        createdAt: entry.created_at,
    };
}
