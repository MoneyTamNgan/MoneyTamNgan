import mongoose from 'mongoose';
import Project from '../models/Project.js';
import ProcessingJob from '../models/ProcessingJob.js';
import { classifyProjectMetadata } from './classifier.js';
import { loadKeywordSets } from './keywords.js';
import { assessProcurementEligibility } from './procurement-eligibility.js';
import { enqueueProject } from './job-queue.js';

const TERMINAL = new Set(['completed', 'review_required', 'irrelevant', 'software_verification_required']);

/** Cheap planning only. The existing worker remains authoritative for current
 * official eligibility, document/run identity and resumable Vertex analysis. */
export function planProjectRecovery(project, { keywords = {}, vertexEnabled = false, now = new Date() } = {}) {
    const status = project.workflow?.status || project.processing?.status;
    const needsAnnouncement = project.announcement_document_id && !project.announcement_summary_id
        && project.announcement_analysis?.status !== 'review_required';
    if (project.latest_summary_id && !needsAnnouncement) return { action: 'skip', reason: 'already_summarized' };
    if ((!needsAnnouncement && TERMINAL.has(status)) || project.processing?.status === 'review_required') {
        return { action: 'skip', reason: 'manual_review_or_terminal' };
    }
    const software = project.classification?.status === 'manual_override'
        ? project.is_software : classifyProjectMetadata({ project_name: project.project_name }, keywords).isSoftware;
    if (software !== true) return { action: 'skip', reason: software === false ? 'not_software' : 'uncertain_software' };
    if (needsAnnouncement && project.latest_summary_id) {
        if (!vertexEnabled) return { action: 'skip', reason: 'vertex_disabled' };
        if (project.procurement_eligibility?.status === 'closed' || project.tender?.status === 'closed'
            || assessProcurementEligibility(project, { now }).status === 'closed') {
            return { action: 'skip', reason: 'closed_procurement' };
        }
        return { action: 'enqueue', stage: 'resume_announcement' };
    }
    // Existing durable text can finish analysis after bidding closes. Do not
    // download new documents from ended tenders just to populate summaries.
    if (project.primary_document_id && project.latest_extraction_run_id) {
        return vertexEnabled ? { action: 'enqueue', stage: 'resume_vertex' }
            : { action: 'skip', reason: 'vertex_disabled' };
    }
    const eligibility = assessProcurementEligibility(project, { now });
    if (eligibility.status === 'closed' || project.procurement_eligibility?.status === 'closed'
        || project.tender?.status === 'closed' || status === 'procurement_closed') {
        return { action: 'skip', reason: 'closed_procurement' };
    }
    if (eligibility.status === 'not_yet_open') return { action: 'skip', reason: 'not_yet_open' };
    return { action: 'enqueue', stage: project.primary_document_id ? 'resume_document' : 'verify_and_acquire' };
}

/** Bounded, cursor-based reconciliation. Dry-run never creates jobs or changes
 * project state. A queue insertion does not itself prove official eligibility. */
export async function recoverPendingProjects(options = {}, dependencies = {}) {
    const { batchSize = 10, scanLimit = 100, afterId = null, dryRun = true, retryFailed = false,
        cooldownMs = 24 * 60 * 60 * 1000, now = new Date(),
        vertexEnabled = process.env.VERTEX_AI_ENABLED === 'true' } = options;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100
        || !Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 1000
        || typeof dryRun !== 'boolean' || typeof retryFailed !== 'boolean'
        || !Number.isFinite(cooldownMs) || cooldownMs < 0
        || (afterId !== null && !mongoose.isObjectIdOrHexString(afterId))) {
        throw new TypeError('Invalid recovery batchSize, scanLimit, afterId, dryRun, retryFailed or cooldownMs');
    }
    const Projects = dependencies.ProjectModel || Project;
    const Jobs = dependencies.JobModel || ProcessingJob;
    const enqueue = dependencies.enqueue || enqueueProject;
    const keywords = await (dependencies.loadKeywords || loadKeywordSets)({ seed: false });
    const projects = await Projects.find(afterId ? { _id: { $lt: new mongoose.Types.ObjectId(afterId) } } : {})
        .sort({ _id: -1 }).limit(scanLimit).lean();
    const report = { dryRun, scanned: 0, queued: 0, reused: 0, wouldQueue: 0, failed: 0,
        skipped: {}, jobs: [], entries: [], nextAfterId: null, exhausted: false };
    let planned = 0;
    for (const project of projects) {
        if (planned >= batchSize) break;
        report.scanned++;
        report.nextAfterId = String(project._id);
        const decision = planProjectRecovery(project, { keywords, vertexEnabled, now });
        const entry = { projectId: project.project_id,
            processingStatus: project.processing?.status || null,
            workflowStatus: project.workflow?.status || null, ...decision };
        report.entries.push(entry);
        const skip = reason => {
            entry.action = 'skip'; entry.reason = reason;
            report.skipped[reason] = (report.skipped[reason] || 0) + 1;
        };
        if (decision.action === 'skip') { skip(decision.reason); continue; }
        try {
            const active = await Jobs.findOne({ project_id: project.project_id, type: 'process_project',
                status: { $in: ['queued', 'running'] } }).lean();
            if (active) { report.reused++; skip('active_job'); continue; }
            const previous = await Jobs.findOne({ project_id: project.project_id, type: 'process_project' })
                .sort({ created_at: -1, _id: -1 }).lean();
            if ((previous?.status === 'failed' || project.processing?.status === 'failed'
                || project.workflow?.status === 'failed') && !retryFailed) { skip('failed_requires_explicit_retry'); continue; }
            const attemptedAt = previous?.completed_at || previous?.updated_at || previous?.created_at;
            const aiJustEnabled = decision.stage === 'resume_vertex' && previous?.result?.status === 'ai_pending';
            if (attemptedAt && now - new Date(attemptedAt) < cooldownMs && !aiJustEnabled && !retryFailed) {
                skip('recently_attempted'); continue;
            }
            planned++;
            if (dryRun) { report.wouldQueue++; continue; }
            const { job, reused } = await enqueue(project.project_id);
            if (reused) report.reused++; else report.queued++;
            report.jobs.push({ id: String(job._id), projectId: project.project_id, status: job.status, reused });
        } catch (error) {
            report.failed++;
            entry.action = 'error'; entry.reason = error.message;
        }
    }
    report.exhausted = report.scanned === projects.length && projects.length < scanLimit;
    return report;
}

/** One bounded page per idle interval; retain the cursor so recent active or
 * skipped projects cannot starve older stranded work. Failed sweeps keep the cursor. */
export function createRecoverySweep({ intervalMs = 60000, batchSize = 10, scanLimit = 100 } = {}, dependencies = {}) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new TypeError('Recovery interval must be at least 1000ms');
    let nextAt = 0, afterId = null;
    return async function sweep(nowMs = Date.now()) {
        if (nowMs < nextAt) return null;
        nextAt = nowMs + intervalMs;
        const report = await (dependencies.recover || recoverPendingProjects)({
            batchSize, scanLimit, afterId, dryRun: false,
        });
        afterId = report.exhausted ? null : report.nextAfterId;
        return report;
    };
}
