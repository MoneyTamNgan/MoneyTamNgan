import { createHash } from 'node:crypto';
import DocumentSummary from '../../models/DocumentSummary.js';
import Project from '../../models/Project.js';
import { embeddingConfig } from '../embedding-config.js';
import { accessHeaders, fetchVertexWithRetry } from './tor-extractor.js';

export { embeddingConfig };
export const MAX_EMBEDDING_ATTEMPTS = 5;
const RETRY_AFTER_MS = 10 * 60 * 1000;
const MAX_TEXT_CHARS = 8000;

const textOf = item => (typeof item === 'string' ? item : item?.value);

/** The text that represents a TOR: title, agency and the stored AI summary. */
export function buildEmbeddingText(project, summary) {
    const extraction = summary?.extraction || {};
    const scope = (extraction.scope_of_work || []).map(textOf).filter(Boolean).slice(0, 10);
    const stack = (extraction.tech_stack || []).map(textOf).filter(Boolean);
    return [
        project.project_name && `ชื่อโครงการ: ${project.project_name}`,
        project.dept_name && `หน่วยงาน: ${project.dept_name}`,
        extraction.summary && `สรุป: ${extraction.summary}`,
        scope.length && `ขอบเขตงาน: ${scope.join('; ')}`,
        stack.length && `เทคโนโลยี: ${stack.join(', ')}`,
    ].filter(Boolean).join('\n').slice(0, MAX_TEXT_CHARS);
}

export function embeddingSourceHash(text, { model, dimensions }) {
    return createHash('sha256').update(JSON.stringify([model, dimensions, text])).digest('hex');
}

export async function embedText(text, config, { headers = accessHeaders, ...retry } = {}) {
    if (!config.projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required for embeddings');
    const location = encodeURIComponent(config.location);
    const url = `https://${config.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}`
        + `/locations/${location}/publishers/google/models/${encodeURIComponent(config.model)}:predict`;
    const authHeaders = await headers();
    const response = await fetchVertexWithRetry(url, {
        method: 'POST',
        headers: { ...Object.fromEntries(new Headers(authHeaders).entries()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instances: [{ content: text, task_type: 'RETRIEVAL_DOCUMENT' }],
            parameters: { autoTruncate: true, outputDimensionality: config.dimensions },
        }),
    }, retry);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Vertex embeddings returned HTTP ${response.status}: ${payload?.error?.message || 'Unknown error'}`);
    }
    const values = payload?.predictions?.[0]?.embeddings?.values;
    if (!Array.isArray(values) || values.length !== config.dimensions || !values.every(Number.isFinite)) {
        throw new Error(`Vertex returned an invalid embedding (expected ${config.dimensions} numbers)`);
    }
    return values;
}

const defaultStore = {
    loadProject: projectId => Project.findOne({ project_id: projectId })
        .select('project_id project_name dept_name latest_summary_id embedding').lean(),
    loadSummary: id => DocumentSummary.findById(id).select('extraction').lean(),
    saveReady: (_id, { values, model, dimensions, sourceHash, summaryId }) => Project.updateOne({ _id }, { $set: {
        vectorEmbedding: values,
        embedding: { status: 'ready', model, dimensions, source_hash: sourceHash, summary_id: summaryId,
            attempts: 0, error: null, updated_at: new Date() },
    } }),
    saveFailed: (_id, { model, dimensions, sourceHash, summaryId, attempts, error }) => Project.updateOne({ _id }, { $set: {
        embedding: { status: 'failed', model, dimensions, source_hash: sourceHash, summary_id: summaryId,
            attempts, error: String(error).slice(0, 500), updated_at: new Date() },
    } }),
    async findPending(limit) {
        const projects = await Project.find({
            latest_summary_id: { $exists: true, $ne: null },
            $or: [
                // New or re-summarised TOR: the embedding was made from a different summary.
                { $expr: { $ne: [{ $ifNull: ['$embedding.summary_id', null] }, '$latest_summary_id'] } },
                { 'embedding.status': 'pending' },
                { 'embedding.status': 'failed', 'embedding.attempts': { $lt: MAX_EMBEDDING_ATTEMPTS },
                    'embedding.updated_at': { $lt: new Date(Date.now() - RETRY_AFTER_MS) } },
            ],
        }).sort({ updated_at: -1 }).limit(limit).select('project_id').lean();
        return projects.map(project => project.project_id);
    },
};

/**
 * Generate and store the embedding for one project. Never throws: a failure is
 * recorded on the project (embedding.status = 'failed', with attempts) so the
 * sweep can retry it, and processing of the TOR itself is never affected.
 */
export async function embedProject(projectId, deps = {}) {
    const config = deps.config || embeddingConfig();
    const store = deps.store || defaultStore;
    if (!config.enabled) return { projectId, status: 'skipped', reason: 'vertex_disabled' };

    const project = await store.loadProject(projectId);
    if (!project) return { projectId, status: 'skipped', reason: 'project_not_found' };
    const summary = project.latest_summary_id ? await store.loadSummary(project.latest_summary_id) : null;
    if (!summary) return { projectId, status: 'skipped', reason: 'no_summary' };

    const text = buildEmbeddingText(project, summary);
    const sourceHash = embeddingSourceHash(text, config);
    if (project.embedding?.status === 'ready' && project.embedding.source_hash === sourceHash) {
        return { projectId, status: 'unchanged' };
    }
    const meta = { model: config.model, dimensions: config.dimensions, sourceHash, summaryId: project.latest_summary_id };
    try {
        const values = await embedText(text, config, deps);
        await store.saveReady(project._id, { ...meta, values });
        return { projectId, status: 'ready' };
    } catch (error) {
        const previous = project.embedding?.source_hash === sourceHash ? (project.embedding.attempts || 0) : 0;
        const attempts = previous + 1;
        await store.saveFailed(project._id, { ...meta, attempts, error: error.message });
        return { projectId, status: 'failed', attempts, error: error.message };
    }
}

/** Embed projects that have no current embedding yet, or whose last attempt failed. */
export async function embedPending({ limit = 10 } = {}, deps = {}) {
    const store = deps.store || defaultStore;
    const results = [];
    for (const projectId of await store.findPending(limit)) results.push(await embedProject(projectId, deps));
    return results;
}
