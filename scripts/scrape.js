#!/usr/bin/env node

/**
 * CLI TOR PDF Scraper
 *
 * Usage:
 *   node scripts/scrape.js                          # Download TORs missing a primary document
 *   node scripts/scrape.js --project-id=67039549408  # Scrape a single project
 *   node scripts/scrape.js --limit=20               # Scrape up to 20 projects
 *   node scripts/scrape.js --delay=5000             # 5 second delay between requests
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import {
    DEFAULT_DELAY_MS,
    normalizeDelayMs,
    scrapeProjectTOR,
    scrapeBatch,
} from '../lib/scraper.js';
import Project from '../models/Project.js';
import Document from '../models/Document.js';
import { hashFile } from '../lib/document-storage.js';
import { persistPdfRecords } from '../lib/mongo-artifacts.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';

// ── Parse CLI arguments ──
function parseArgs() {
    const args = {};
    process.argv.slice(2).forEach(arg => {
        if (arg.startsWith('--')) {
            const [key, value] = arg.substring(2).split('=');
            args[key] = value || true;
        }
    });
    return args;
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

// ── Main ──
async function main() {
    const args = parseArgs();
    const projectId = args['project-id'];
    const limit = args['limit'] === undefined ? 10 : Number(args['limit']);
    const delayMs = normalizeDelayMs(args['delay'] ?? DEFAULT_DELAY_MS);

    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new RangeError('limit must be an integer between 1 and 1000');
    }

    console.log('🕷️  MoneyTamNgan TOR PDF Scraper');
    console.log('='.repeat(50));

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not set in .env');
        process.exit(1);
    }

    console.log('📡 Connecting to MongoDB...');
    await connectMongoWithDnsFallback(mongoose, mongoUri);
    console.log('✅ Connected to MongoDB\n');

    if (projectId) {
        // Single project mode
        console.log(`🔍 Scraping single project: ${projectId}`);
        const existingProject = await Project.findOne({ project_id: projectId }).lean();
        const existingDocument = existingProject?.primary_document_id
            ? await Document.findById(existingProject.primary_document_id).lean()
            : null;
        const result = await scrapeProjectTOR(projectId, null, {
            knownPdfUrl: existingDocument?.source_url,
        });

        if (result.pdf_path) {
            await persistScrapeResult(existingProject, result);
            if (result.pdf_path) console.log(`\n✅ Stored TOR file: ${result.pdf_path}`);
            if (result.pdf_url) console.log(`   Source URL: ${result.pdf_url}`);
            if (result.archive_path) console.log(`   Source archive: ${result.archive_path}`);
            if (result.extracted_pdfs.length > 0) {
                console.log(`   Extracted PDFs: ${result.extracted_pdfs.length}`);
            }
        } else {
            console.log(`\n⚠️  No PDF found. Error: ${result.error || 'No documents on page'}`);
        }

        if (result.attachments.length > 0) {
            console.log(`\n📎 Attachments found:`);
            result.attachments.forEach(a => {
                console.log(`   [${a.type}] ${a.name} → ${a.url}`);
            });
        }
    } else {
        // Batch mode
        const projects = await Project.find({ primary_document_id: { $exists: false } })
            .select('project_id project_name primary_document_id')
            .limit(limit)
            .lean();

        if (projects.length === 0) {
            console.log('✅ All projects already have stored TOR files. Nothing to scrape.');
        } else {
            console.log(`📦 Found ${projects.length} projects missing stored TOR files\n`);
            console.log(`⏱️  Rate limit: ${delayMs}ms between projects\n`);

            const scrapeTargets = projects.map(project => ({
                projectId: project.project_id,
            }));
            const { results, summary } = await scrapeBatch(scrapeTargets, {
                delayMs,
                onProgress: (i, total, result) => {
                    const status = result.pdf_path ? '✅' : result.error ? '❌' : '⚠️';
                    console.log(`   ${status} [${i}/${total}] ${result.projectId}`);
                },
            });

            // Update DB
            let updated = 0;
            for (const result of results) {
                if (result.pdf_path) {
                    const project = projects.find(item => item.project_id === result.projectId);
                    await persistScrapeResult(project, result);
                    updated++;
                }
            }

            console.log('\n' + '='.repeat(50));
            console.log(`📊 Summary:`);
            console.log(`   Total:     ${summary.total}`);
            console.log(`   Stored TOR: ${summary.success}`);
            console.log(`   Failed:    ${summary.failed}`);
            console.log(`   No docs:   ${summary.skipped}`);
            console.log(`   DB updated: ${updated}`);
        }
    }

    await mongoose.disconnect();
    console.log('\n👋 Done.');
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
