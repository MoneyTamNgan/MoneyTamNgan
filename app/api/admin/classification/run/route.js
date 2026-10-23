import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { classifyTor } from '@/lib/classification';
import { loadKeywordSets } from '@/lib/keywords';
import { enqueueProject } from '@/lib/job-queue';
import { NextResponse } from 'next/server';

// Mutations are restricted to admin sessions/operator tokens by proxy.js.

/**
 * POST /api/admin/classification/run
 *
 * Re-run the keyword classifier over every still-unclassified TOR
 * (`is_software: null`) using the current DB-backed keyword rules. This is the
 * "next classification run" an admin triggers after editing keywords.
 *
 * Manual overrides are never touched.
 */
export async function POST() {
    try {
        await connectDB();

        const sets = await loadKeywordSets();
        const pending = await Project.find({
            is_software: null,
            'classification.status': { $ne: 'manual_override' },
        });

        let updated = 0;
        let jobsQueued = 0, jobsReused = 0, queueFailures = 0;
        const queueErrors = [];
        for (const project of pending) {
            const { is_software, classification_confidence } = classifyTor(
                project.toObject(),
                sets
            );
            if (is_software === null) continue;

            project.is_software = is_software;
            project.classification = {
                status: is_software ? 'software' : 'not_software',
                confidence: classification_confidence,
                method: 'admin_rerun',
                classified_at: new Date(),
                reason: is_software
                    ? 'Software keyword signals outweighed non-software signals'
                    : 'Non-software keyword signals outweighed software signals',
            };
            project.processing ||= {};
            project.workflow ||= {};
            project.processing.status = is_software === false ? 'irrelevant' : 'document_pending';
            project.processing.error = null;
            project.workflow.status = project.processing.status;
            project.workflow.error = null;
            project.workflow.updated_at = new Date();
            await project.save();
            updated += 1;
            if (is_software === true) {
                try {
                    const { reused } = await enqueueProject(project.project_id);
                    if (reused) jobsReused++; else jobsQueued++;
                } catch (error) {
                    queueFailures++;
                    if (queueErrors.length < 20) queueErrors.push({ projectId: project.project_id,
                        message: 'Classification saved; processing queue unavailable. Retry via the processing endpoint or recovery.' });
                }
            }
        }

        return NextResponse.json({
            scanned: pending.length,
            updated,
            remaining: pending.length - updated,
            jobsQueued, jobsReused, queueFailures, queueErrors,
        });
    } catch (error) {
        return NextResponse.json(
            { error: { code: 'CLASSIFICATION_RUN_FAILED', message: error.message } },
            { status: 500 }
        );
    }
}
