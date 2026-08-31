import connectDB from '@/lib/db';
import {
    DEFAULT_DELAY_MS,
    MAX_DELAY_MS,
    MIN_DELAY_MS,
    normalizeDelayMs,
    scrapeProjectTOR,
    scrapeBatch,
} from '@/lib/scraper';
import Project from '@/models/Project';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;

function badRequest(message) {
    return NextResponse.json({
        status: 'failed',
        error: { code: 'INVALID_SCRAPING_REQUEST', message },
    }, { status: 400 });
}

function pdfUpdateFromResult(result) {
    const update = {};
    if (result.pdf_url) {
        update.pdf_url = result.pdf_url;
        update['document.source_url'] = result.pdf_url;
        update['document.source_type'] = 'egp_browser';
        update['document.status'] = result.pdf_path ? 'downloaded' : 'url_found';
    }
    if (result.pdf_path) {
        update.pdf_path = result.pdf_path;
        update.pdf_size = result.pdf_size;
        update.pdf_content_type = result.pdf_content_type;
        update.pdf_downloaded_at = new Date();
        update['document.local_path'] = result.pdf_path;
        update['document.size_bytes'] = result.pdf_size;
        update['document.mime_type'] = result.pdf_content_type;
        update['document.downloaded_at'] = new Date();
        update['processing.status'] = 'document_downloaded';
    }
    return update;
}

/**
 * POST /api/scraping/trigger
 *
 * Trigger TOR PDF scraping for projects.
 *
 * Body (optional):
 *   {
 *     projectId?: string,       // Scrape a single specific project
 *     batchSize?: number,       // Scrape N projects missing pdf_path (default: 10)
 *     onlyMissing?: boolean,    // Only scrape projects without a stored file (default: true)
 *     delayMs?: number          // Delay between requests in ms (default: SCRAPER_DELAY_MS or 4000; min: 3000)
 *   }
 */
export async function POST(request) {
    try {
        await connectDB();

        let body = {};
        try {
            body = await request.json();
        } catch {
            // No body — use defaults
        }

        const {
            projectId,
            batchSize = DEFAULT_BATCH_SIZE,
            onlyMissing = true,
            delayMs = DEFAULT_DELAY_MS,
        } = body;

        const normalizedProjectId = projectId === undefined || projectId === null
            ? null
            : String(projectId).trim();

        if (projectId !== undefined && !normalizedProjectId) {
            return badRequest('projectId must be a non-empty string');
        }

        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
            return badRequest(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`);
        }

        if (typeof onlyMissing !== 'boolean') {
            return badRequest('onlyMissing must be a boolean');
        }

        let normalizedDelayMs;
        try {
            normalizedDelayMs = normalizeDelayMs(delayMs);
        } catch {
            return badRequest(
                `delayMs must be an integer between ${MIN_DELAY_MS} and ${MAX_DELAY_MS}`
            );
        }

        // Single project mode
        if (normalizedProjectId) {
            console.log(`🕷️  Starting scrape for single project: ${normalizedProjectId}`);

            const existingProject = await Project.findOne({ project_id: normalizedProjectId })
                .select('pdf_url')
                .lean();
            const result = await scrapeProjectTOR(normalizedProjectId, null, {
                knownPdfUrl: existingProject?.pdf_url,
            });

            // Record both the local file and its remote provenance URL.
            let dbUpdated = false;
            if (result.pdf_url || result.pdf_path) {
                const pdfUpdate = pdfUpdateFromResult(result);
                const updatedProject = await Project.findOneAndUpdate(
                    { project_id: normalizedProjectId },
                    { $set: pdfUpdate }
                );
                dbUpdated = Boolean(updatedProject);
                console.log(`✅ Updated TOR link/file metadata for project ${normalizedProjectId}: ${dbUpdated}`);
            }

            return NextResponse.json({
                status: 'completed',
                mode: 'single',
                dbUpdated,
                result,
            }, {
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
            });
        }

        // Batch mode — URL-only records are intentionally included so their
        // source documents are downloaded into local storage.
        const filter = onlyMissing
            ? { $or: [{ pdf_path: null }, { pdf_path: '' }, { pdf_path: { $exists: false } }] }
            : {};

        const projects = await Project.find(filter)
            .select('project_id pdf_url')
            .limit(batchSize)
            .lean();

        if (projects.length === 0) {
            return NextResponse.json({
                status: 'completed',
                mode: 'batch',
                message: 'No projects to scrape (all have stored TOR files or no projects exist)',
                summary: { total: 0, success: 0, failed: 0, skipped: 0 },
            }, {
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
            });
        }

        const scrapeTargets = projects.map(project => ({
            projectId: project.project_id,
            pdf_url: project.pdf_url,
        }));
        console.log(`🕷️  Starting batch scrape for ${scrapeTargets.length} projects`);

        const { results, summary } = await scrapeBatch(scrapeTargets, {
            delayMs: normalizedDelayMs,
        });

        // Update Project records with the stored path and remote provenance URL.
        let updated = 0;
        for (const result of results) {
            if (result.pdf_url || result.pdf_path) {
                await Project.findOneAndUpdate(
                    { project_id: result.projectId },
                    { $set: pdfUpdateFromResult(result) }
                );
                updated++;
            }
        }

        console.log(`✅ Batch scrape complete: ${summary.success} found, ${summary.failed} failed, ${updated} updated in DB`);

        return NextResponse.json({
            status: 'completed',
            mode: 'batch',
            rateLimit: { delayMs: normalizedDelayMs },
            summary: { ...summary, dbUpdated: updated },
            results: results.map(r => ({
                projectId: r.projectId,
                pdf_url: r.pdf_url,
                pdf_path: r.pdf_path,
                pdf_size: r.pdf_size,
                attachmentCount: r.attachments.length,
                error: r.error,
            })),
        }, {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
    } catch (error) {
        console.error('❌ Scraping failed:', error);
        return NextResponse.json({
            status: 'failed',
            error: {
                code: 'SCRAPING_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}
