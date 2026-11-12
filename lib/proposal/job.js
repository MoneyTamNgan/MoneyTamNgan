import { User } from '../../models/User.js';
import Project from '../../models/Project.js';
import { completeJob, failJob } from '../job-queue.js';
import { hydrateProjectCompatibility } from '../project-compat.js';
import {
    PROFILE_SELECT,
    ProposalDraftError,
    logProposalEvent,
    normalizeTor,
    publicProfile,
} from './draft.js';
import { generateProposalDraft } from './generate.js';

async function resolveQuery(value, select) {
    const selected = select && value && typeof value.select === 'function' ? value.select(select) : value;
    if (selected && typeof selected.lean === 'function') return selected.lean();
    return selected;
}

export function assertVertexEnabled(env = process.env) {
    if (String(env.VERTEX_AI_ENABLED || '').toLowerCase() !== 'true') {
        throw new ProposalDraftError('VERTEX_DISABLED', 'Vertex AI is disabled, so the proposal draft was not generated.');
    }
}

export async function loadProposalInputs(job, dependencies = {}) {
    if (!job?.owner_id || !job?.project_id) {
        throw new ProposalDraftError('INVALID_JOB', 'Proposal draft job is missing its owner or TOR.');
    }
    const connectDB = dependencies.connectDB || (await import('../db.js')).default;
    await connectDB();
    const UserModel = dependencies.User || User;
    const ProjectModel = dependencies.Project || Project;
    const hydrate = dependencies.hydrate || hydrateProjectCompatibility;
    const userQuery = UserModel.findById(job.owner_id);
    const projectQuery = ProjectModel.findOne({ project_id: String(job.project_id) });
    const [user, project] = await Promise.all([
        resolveQuery(userQuery, PROFILE_SELECT),
        resolveQuery(projectQuery),
    ]);
    if (!user) throw new ProposalDraftError('PROFILE_NOT_FOUND', 'Company profile was not found.');
    if (!project) throw new ProposalDraftError('TOR_NOT_FOUND', 'TOR was not found.');
    const hydrated = await hydrate(project);
    return { tor: normalizeTor(hydrated), profile: publicProfile(user), select: PROFILE_SELECT };
}

function publicErrorMessage(error) {
    if (error instanceof ProposalDraftError) return error.message;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return 'Vertex timed out while generating the proposal draft.';
    }
    return 'The proposal draft could not be generated.';
}

/**
 * Run one claimed proposal job to completion or a terminal failure.
 * The result stored on the job is not written to the log.
 */
export async function executeProposalDraftJob(job, dependencies = {}) {
    if (dependencies.skipVertexGate !== true) assertVertexEnabled();
    const inputs = await loadProposalInputs(job, dependencies);
    logProposalEvent({ event: 'job_started', jobId: job._id, status: 'running' }, dependencies.writeLog);
    const generate = dependencies.generate || generateProposalDraft;
    return generate(inputs, dependencies);
}

export async function settleProposalDraftJob(job, dependencies = {}) {
    const finish = dependencies.completeJob || completeJob;
    const fail = dependencies.failJob || failJob;
    try {
        const draft = await executeProposalDraftJob(job, dependencies);
        await finish(job._id, {
            status: 'completed',
            model: draft.model,
            model_version: draft.model_version,
            prompt_version: draft.prompt_version,
            draft,
        });
        logProposalEvent({
            event: 'job_completed', jobId: job._id, status: 'completed', model: draft.model, promptVersion: draft.prompt_version,
        }, dependencies.writeLog);
        return { status: 'completed' };
    } catch (error) {
        const message = publicErrorMessage(error);
        await fail(job, new Error(message));
        logProposalEvent({
            event: 'job_failed', jobId: job._id, status: 'failed', code: error?.code || 'PROPOSAL_DRAFT_FAILED',
        }, dependencies.writeLog);
        return { status: 'failed', error: message };
    }
}
