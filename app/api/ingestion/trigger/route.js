import connectDB from '@/lib/db';
import { buildProjectUpsert, fetchAllFromEGP } from '@/lib/egp-api';
import { enqueueProject } from '@/lib/job-queue';
import Project from '@/models/Project';
import DiscoveryCandidate from '@/models/DiscoveryCandidate';
import { classifyProjectMetadata } from '@/lib/classifier';
import { loadKeywordSets } from '@/lib/keywords';
import { assessProcurementEligibility, currentThaiFiscalYear, verifyProcurementEligibility } from '@/lib/procurement-eligibility';
import { NextResponse } from 'next/server';

/**
 * POST /api/ingestion/trigger
 *
 * Manually trigger an ingestion run from the EGP-CONTRACT API.
 * Fetches project data and upserts it into MongoDB.
 *
 * Body (optional):
 *   { year?: string, keyword?: string, limit?: number, deptCode?: string,
 *     enqueueProcessing?: boolean }
 */
export async function POST(request) {
    try {
        await connectDB();

        // Parse optional body params
        let body = {};
        try {
            body = await request.json();
        } catch {
            // No body provided — use defaults
        }

        const { year = currentThaiFiscalYear(), keyword, limit, deptCode, enqueueProcessing = false, verifyInline = false } = body;
        if (typeof enqueueProcessing !== 'boolean' || typeof verifyInline !== 'boolean'
            || !/^\d{4}$/.test(String(year))
            || (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000))) {
            return NextResponse.json({
                status: 'failed',
                error: { code: 'INVALID_INGESTION_REQUEST', message: 'Invalid year, limit, enqueueProcessing or verifyInline' },
            }, { status: 400 });
        }

        console.log(`📡 Starting EGP ingestion: year=${year}, keyword=${keyword || '(all)'}`);

        // Fetch records from the EGP API (capped at maxRecords)
        const rawRecords = await fetchAllFromEGP({ year, keyword, maxRecords: limit || 500, deptCode });

        console.log(`📦 Fetched ${rawRecords.length} records from EGP API`);

        let itemsNew = 0;
        let itemsUpdated = 0;
        let itemsFailed = 0;
        let jobsQueued = 0;
        let candidatesSaved = 0;
        const errors = [];
        const skipped = { notSoftware: 0, uncertainSoftware: 0, closed: 0, notYetOpen: 0, unverified: 0 };
        const skipExamples = [];
        const keywordSets = await loadKeywordSets();

        // Upsert each record into MongoDB
        for (const raw of rawRecords) {
            try {
                const classification = classifyProjectMetadata({ project_name: raw.project_name }, keywordSets);
                let skipReason = classification.isSoftware === false ? 'notSoftware'
                    : classification.isSoftware !== true ? 'uncertainSoftware' : null;
                if (!skipReason && !verifyInline) {
                    const metadataEligibility = assessProcurementEligibility(raw);
                    if (metadataEligibility.status === 'closed') {
                        skipped.closed++;
                        continue;
                    }
                    await DiscoveryCandidate.updateOne({ project_id: String(raw.project_id) }, { $set: {
                        payload: raw, classification, eligibility: metadataEligibility, status: 'pending',
                    } }, { upsert: true, runValidators: true });
                    candidatesSaved++;
                    if (enqueueProcessing) {
                        const { reused } = await enqueueProject(raw.project_id, { type: 'verify_candidate' });
                        if (!reused) jobsQueued++;
                    }
                    continue;
                }
                const eligibility = skipReason ? null : await verifyProcurementEligibility(raw);
                if (!skipReason && eligibility.status !== 'open') {
                    skipReason = eligibility.status === 'closed' ? 'closed'
                        : eligibility.status === 'not_yet_open' ? 'notYetOpen' : 'unverified';
                }
                if (skipReason) {
                    if (['uncertainSoftware', 'unverified', 'notYetOpen'].includes(skipReason)) {
                        await DiscoveryCandidate.updateOne({ project_id: String(raw.project_id) }, { $set: {
                            payload: raw, classification, eligibility,
                            status: skipReason === 'uncertainSoftware' ? 'review_required' : 'pending',
                        } }, { upsert: true, runValidators: true });
                        candidatesSaved++;
                        if (enqueueProcessing && skipReason === 'unverified') {
                            const { reused } = await enqueueProject(raw.project_id, { type: 'verify_candidate' });
                            if (!reused) jobsQueued++;
                        }
                    }
                    skipped[skipReason]++;
                    if (skipExamples.length < 20) skipExamples.push({ project_id: raw.project_id,
                        reason: skipReason, detail: eligibility?.reason || classification.reason });
                    continue;
                }
                const { filter, update } = buildProjectUpsert(raw);
                update.$set.procurement_eligibility = eligibility;
                const current = await Project.findOne(filter).lean();
                if (current?.classification?.status !== 'manual_override') {
                    update.$set.is_software = true;
                    delete update.$setOnInsert.is_software;
                }
                const existed = await Project.exists(filter);
                await Project.findOneAndUpdate(filter, update, {
                    upsert: true,
                    returnDocument: 'after',
                    runValidators: true,
                    setDefaultsOnInsert: true,
                });

                if (!existed) {
                    itemsNew++;
                } else {
                    itemsUpdated++;
                }
                if (enqueueProcessing && !(current?.classification?.status === 'manual_override' && current.is_software !== true)) {
                    const { reused } = await enqueueProject(raw.project_id);
                    if (!reused) jobsQueued++;
                }
            } catch (err) {
                itemsFailed++;
                errors.push({
                    project_id: raw.project_id,
                    error: err.message,
                });
            }
        }

        const summary = {
            status: 'completed',
            source: 'EGP-CONTRACT',
            params: { year, keyword: keyword || null, deptCode: deptCode || null },
            itemsFound: rawRecords.length,
            itemsNew,
            itemsUpdated,
            itemsFailed,
            jobsQueued,
            candidatesSaved,
            skipped,
            skipExamples,
            errors: errors.slice(0, 10), // Only show first 10 errors
            completedAt: new Date().toISOString(),
        };

        console.log(`✅ Ingestion complete: ${itemsNew} new, ${itemsUpdated} updated, ${itemsFailed} failed`);

        return NextResponse.json(summary, { status: 202 });
    } catch (error) {
        console.error('❌ Ingestion failed:', error);
        return NextResponse.json({
            status: 'failed',
            error: {
                code: 'INGESTION_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}
