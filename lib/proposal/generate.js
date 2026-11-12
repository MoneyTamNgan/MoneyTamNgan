import { accessHeaders, fetchVertexWithRetry, vertexEndpoint } from '../vertex/tor-extractor.js';
import {
    ProposalDraftError,
    PROPOSAL_PROMPT_VERSION,
    buildProposalRequest,
    groundProposalDraft,
    logProposalEvent,
} from './draft.js';

function positiveInt(name, fallback, max) {
    const value = Number(process.env[name]);
    const parsed = Number.isInteger(value) && value > 0 ? value : fallback;
    return Math.min(max, parsed);
}

export function proposalTimeoutMs() {
    return positiveInt('PROPOSAL_DRAFT_TIMEOUT_MS', 60_000, 90_000);
}

export function schemaAttempts() {
    return positiveInt('PROPOSAL_DRAFT_SCHEMA_ATTEMPTS', 2, 3);
}

function mapVertexError(error) {
    if (error instanceof ProposalDraftError) return error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return new ProposalDraftError('VERTEX_TIMEOUT', 'Vertex timed out while generating the proposal draft.');
    }
    return new ProposalDraftError('VERTEX_UNAVAILABLE', 'Vertex is unavailable, so the proposal draft was not generated.');
}

async function requestDraft(requestBody, { projectId, location, model, headersFn, dependencies }) {
    const authHeaders = await headersFn();
    let response;
    try {
        response = await fetchVertexWithRetry(vertexEndpoint(projectId, location, model), {
            method: 'POST',
            headers: {
                ...Object.fromEntries(new Headers(authHeaders).entries()),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        }, {
            fetchImpl: dependencies.fetchImpl,
            wait: dependencies.wait,
            random: dependencies.random,
            maxAttempts: 1,
            timeoutMs: dependencies.timeoutMs || proposalTimeoutMs(),
        });
    } catch (error) {
        throw mapVertexError(error);
    }
    if (!response) {
        throw new ProposalDraftError('VERTEX_UNAVAILABLE', 'Vertex is unavailable, so the proposal draft was not generated.');
    }
    if (!response.ok) {
        if (response.body?.cancel) await response.body.cancel().catch(() => {});
        throw new ProposalDraftError('VERTEX_UNAVAILABLE', `Vertex returned HTTP ${response.status} while generating the proposal draft.`);
    }
    const payload = await response.json().catch(() => {
        throw new ProposalDraftError('INVALID_SCHEMA', 'Vertex proposal draft was not valid JSON.');
    });
    if (payload.candidates?.[0]?.finishReason !== 'STOP') {
        throw new ProposalDraftError('INVALID_SCHEMA', 'Vertex proposal draft was incomplete or blocked.');
    }
    const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!text) throw new ProposalDraftError('INVALID_SCHEMA', 'Vertex returned an empty proposal draft.');
    try {
        return { parsed: JSON.parse(text), modelVersion: payload.modelVersion || model };
    } catch {
        throw new ProposalDraftError('INVALID_SCHEMA', 'Vertex proposal draft was not valid JSON.');
    }
}

/**
 * Call Vertex with a response schema. Malformed JSON is retried a limited
 * number of times. Timeouts and outages fail immediately with a clear error.
 */
export async function generateProposalDraft({ tor, profile }, dependencies = {}) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) {
        throw new ProposalDraftError('VERTEX_NOT_CONFIGURED', 'GOOGLE_CLOUD_PROJECT is required for Vertex proposal drafts.');
    }
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
    const model = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
    const requestBody = buildProposalRequest(tor, profile);
    const headersFn = dependencies.headers || accessHeaders;
    const attempts = dependencies.maxSchemaAttempts || schemaAttempts();
    const writeLog = dependencies.writeLog;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const raw = await requestDraft(requestBody, { projectId, location, model, headersFn, dependencies });
            const draft = groundProposalDraft(raw.parsed, {
                tor, profile, model, modelVersion: raw.modelVersion,
            });
            logProposalEvent({
                event: 'generated', status: 'completed', model, promptVersion: PROPOSAL_PROMPT_VERSION, attempt,
            }, writeLog);
            return draft;
        } catch (error) {
            const mapped = mapVertexError(error);
            if (mapped.code !== 'INVALID_SCHEMA' || attempt === attempts) {
                logProposalEvent({
                    event: 'generate_failed', status: 'failed', code: mapped.code, model, promptVersion: PROPOSAL_PROMPT_VERSION,
                }, writeLog);
                throw mapped;
            }
            lastError = mapped;
            logProposalEvent({
                event: 'schema_retry', status: 'retry', code: mapped.code, model, promptVersion: PROPOSAL_PROMPT_VERSION, attempt,
            }, writeLog);
        }
    }
    throw lastError;
}
