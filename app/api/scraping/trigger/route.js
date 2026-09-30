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
import Document from '@/models/Document';
import { hashFile } from '@/lib/document-storage';
import { persistPdfRecords } from '@/lib/mongo-artifacts';
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

async function persistScrapeResult(project, result) {
    if (!project || !result.pdf_path) return null;
    const hashed = await hashFile(result.pdf_path);
    const document = await persistPdfRecords(
        project,
        result,
        { ...hashed, backend: 'local', gcsUri: null },
        result.resolver_source || 'egp_browser'
    );
    await Project.updateOne({ _id: project._id }, { $set: {
        primary_document_id: document._id,
        'processing.status': 'document_downloaded',
        'processing.error': null,
        'workflow.status': 'document_downloaded',
        'workflow.error': null,
        'workflow.updated_at': new Date(),
    } });
    return document;
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

            const existingProject = await Project.findOne({ project_id: normalizedProjectId }).lean();
            const existingDocument = existingProject?.primary_document_id
                ? await Document.findById(existingProject.primary_document_id).lean()
                : null;
            const result = await scrapeProjectTOR(normalizedProjectId, null, {
                knownPdfUrl: existingDocument?.source_url,
            });

            // Record both the local file and its remote provenance URL.
            let dbUpdated = false;
            if (result.pdf_path) {
                dbUpdated = Boolean(await persistScrapeResult(existingProject, result));
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
        const filter = onlyMissing ? { primary_document_id: { $exists: false } } : {};

        const projects = await Project.find(filter)
            .select('project_id primary_document_id')
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

        const knownDocuments = await Document.find({
            _id: { $in: projects.map(project => project.primary_document_id).filter(Boolean) },
        }).lean();
        const documentMap = new Map(knownDocuments.map(document => [String(document._id), document]));
        const scrapeTargets = projects.map(project => ({
            projectId: project.project_id,
            pdf_url: documentMap.get(String(project.primary_document_id))?.source_url,
        }));
        console.log(`🕷️  Starting batch scrape for ${scrapeTargets.length} projects`);

        const { results, summary } = await scrapeBatch(scrapeTargets, {
            delayMs: normalizedDelayMs,
        });

        // Update Project records with the stored path and remote provenance URL.
        let updated = 0;
        for (const result of results) {
            if (result.pdf_path) {
                const project = projects.find(item => item.project_id === result.projectId);
                await persistScrapeResult(project, result);
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
                pdf_content_type: r.pdf_content_type,
                archive_path: r.archive_path,
                archive_size: r.archive_size,
                archive_content_type: r.archive_content_type,
                extracted_pdfs: r.extracted_pdfs,
                aggregator_url: r.aggregator_url,
                official_detail_url: r.official_detail_url,
                resolver_source: r.resolver_source,
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
