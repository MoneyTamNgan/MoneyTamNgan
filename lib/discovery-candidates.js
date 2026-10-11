import DiscoveryCandidate from '../models/DiscoveryCandidate.js';
import Project from '../models/Project.js';
import { buildProjectUpsert } from './egp-api.js';
import { classifyProjectMetadata } from './classifier.js';
import { loadKeywordSets } from './keywords.js';
import { verifyProcurementEligibility } from './procurement-eligibility.js';
import { enqueueProject } from './job-queue.js';

/** Unverified metadata stays outside the published project collection. */
export async function verifyDiscoveryCandidate(projectId, dependencies = {}) {
    const Candidate = dependencies.CandidateModel || DiscoveryCandidate;
    const Projects = dependencies.ProjectModel || Project;
    const candidate = await Candidate.findOne({ project_id: String(projectId) }).lean();
    if (!candidate) throw new Error(`Discovery candidate ${projectId} not found`);
    const current = await Projects.findOne({ project_id: String(projectId) }).lean();
    const classification = current?.classification?.status === 'manual_override'
        ? { isSoftware: current.is_software, ...current.classification }
        : classifyProjectMetadata(candidate.payload, await (dependencies.loadKeywords || loadKeywordSets)());
    if (classification.isSoftware !== true) {
        await Candidate.updateOne({ _id: candidate._id }, { $set: { status: 'review_required', classification } });
        return { status: 'review_required', projectId };
    }
    const eligibility = await (dependencies.verifyEligibility || verifyProcurementEligibility)(candidate.payload);
    await Candidate.updateOne({ _id: candidate._id }, { $set: { eligibility,
        status: eligibility.status === 'open' ? 'pending' : eligibility.status === 'unknown' ? 'pending' : eligibility.status,
    } });
    if (eligibility.status === 'unknown') throw new Error(`Eligibility unavailable: ${eligibility.reason}`);
    if (eligibility.status !== 'open') return { status: eligibility.status, projectId };
    const { filter, update } = buildProjectUpsert(candidate.payload);
    update.$set.procurement_eligibility = eligibility;
    if (current?.classification?.status !== 'manual_override') {
        update.$set.is_software = true;
        delete update.$setOnInsert.is_software;
    }
    await Projects.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after', runValidators: true });
    // Promotion is idempotent. Queue before marking promoted so a crash is retryable.
    await (dependencies.enqueue || enqueueProject)(projectId);
    await Candidate.updateOne({ _id: candidate._id }, { $set: { status: 'promoted', error: null } });
    return { status: 'promoted', projectId };
}
