import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { classifyTor } from '@/lib/classification';
import { loadKeywordSets } from '@/lib/keywords';
import { NextResponse } from 'next/server';

// TODO(auth): restrict to admin once the auth branch lands.

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
        for (const project of pending) {
            const { is_software, classification_confidence } = classifyTor(
                project.toObject(),
                sets
            );
            if (is_software === null) continue;

            project.is_software = is_software;
            project.classification_confidence = classification_confidence;
            project.classification = {
                status: is_software ? 'software' : 'not_software',
                confidence: classification_confidence,
                method: 'admin_rerun',
                classified_at: new Date(),
                reason: is_software
                    ? 'Software keyword signals outweighed non-software signals'
                    : 'Non-software keyword signals outweighed software signals',
            };
            project.processing.status = is_software === false ? 'irrelevant' : 'document_pending';
            project.processing.error = null;
            await project.save();
            updated += 1;
        }

        return NextResponse.json({
            scanned: pending.length,
            updated,
            remaining: pending.length - updated,
        });
    } catch (error) {
        return NextResponse.json(
            { error: { code: 'CLASSIFICATION_RUN_FAILED', message: error.message } },
            { status: 500 }
        );
    }
}
