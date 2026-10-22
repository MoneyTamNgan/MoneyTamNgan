import DiscoveryCandidate from '../models/DiscoveryCandidate.js';
import Project from '../models/Project.js';
import { buildProjectUpsert } from './egp-api.js';
import { classifyProjectMetadata } from './classifier.js';
import { loadKeywordSets } from './keywords.js';
import { verifyProcurementWithAnnouncement } from './project-announcement.js';
import { enqueueProject } from './job-queue.js';

/** Unverified metadata stays outside the published project collection. */
export async function verifyDiscoveryCandidate(projectId, dependencies = {}) {
    const Candidate = dependencies.CandidateModel || DiscoveryCandidate;
    const Projects = dependencies.ProjectModel || Project;
    const candidate = await Candidate.findOne({ project_id: String(projectId) }).lean();
    if (!candidate) throw new Error(`Discovery candidate ${projectId} not found`);
    const current = await Projects.findOne({ project_id: String(projectId) }).lean();
    // An admin override on the candidate itself (it has no project yet) is as final as one on the project.
    const candidateOverride = !current && candidate.classification?.status === 'manual_override'
        ? candidate.classification : null;
    const classification = current?.classification?.status === 'manual_override'
        ? { isSoftware: current.is_software, ...current.classification }
        : candidateOverride || classifyProjectMetadata(candidate.payload, await (dependencies.loadKeywords || loadKeywordSets)());
    if (classification.isSoftware !== true) {
        const status = candidateOverride ? 'rejected' : 'review_required';
        await Candidate.updateOne({ _id: candidate._id }, { $set: { status, classification } });
        return { status, projectId };
    }
    const eligibility = await (dependencies.verifyEligibility || verifyProcurementWithAnnouncement)(candidate.payload);
    await Candidate.updateOne({ _id: candidate._id }, { $set: { eligibility,
        status: eligibility.status === 'open' ? 'pending' : eligibility.status === 'unknown' ? 'pending' : eligibility.status,
    } });
    if (eligibility.status === 'unknown') throw new Error(`Eligibility unavailable: ${eligibility.reason}`);
    if (eligibility.status !== 'open') return { status: eligibility.status, projectId };
    const { filter, update } = buildProjectUpsert(candidate.payload);
    update.$set.procurement_eligibility = eligibility;
    if (eligibility.announcement_url) update.$set['tender.invitation_url'] = eligibility.announcement_url;
    if (eligibility.rss_dept_id) update.$set['tender.rss_dept_id'] = eligibility.rss_dept_id;
    if (current?.classification?.status !== 'manual_override') {
        update.$set.is_software = true;
        delete update.$setOnInsert.is_software;
    }
    if (candidateOverride) {
        delete update.$setOnInsert['classification.status'];
        Object.assign(update.$set, {
            'classification.status': 'manual_override',
            'classification.method': candidateOverride.method,
            'classification.confidence': null,
            'classification.reason': candidateOverride.reason,
            'classification.tags': candidateOverride.tags || [],
            'classification.reviewed_by': candidateOverride.reviewed_by,
            'classification.reviewed_at': candidateOverride.reviewed_at,
            'classification.classified_at': candidateOverride.reviewed_at,
        });
    }
    await Projects.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after', runValidators: true });
    // Promotion is idempotent. Queue before marking promoted so a crash is retryable.
    await (dependencies.enqueue || enqueueProject)(projectId);
    await Candidate.updateOne({ _id: candidate._id }, { $set: { status: 'promoted', error: null } });
    return { status: 'promoted', projectId };
}
