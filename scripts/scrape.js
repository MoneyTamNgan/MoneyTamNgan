#!/usr/bin/env node

/**
 * CLI TOR PDF Scraper
 *
 * Usage:
 *   node scripts/scrape.js                          # Download TORs missing pdf_path
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
        const existingProject = await Project.findOne({ project_id: projectId })
            .select('pdf_url')
            .lean();
        const result = await scrapeProjectTOR(projectId, null, {
            knownPdfUrl: existingProject?.pdf_url,
        });

        if (result.pdf_url || result.pdf_path) {
            await Project.findOneAndUpdate(
                { project_id: projectId },
                { $set: pdfUpdateFromResult(result) }
            );
            if (result.pdf_path) console.log(`\n✅ Stored TOR file: ${result.pdf_path}`);
            if (result.pdf_url) console.log(`   Source URL: ${result.pdf_url}`);
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
        const projects = await Project.find({
            $or: [{ pdf_path: null }, { pdf_path: '' }, { pdf_path: { $exists: false } }],
        })
            .select('project_id project_name pdf_url')
            .limit(limit)
            .lean();

        if (projects.length === 0) {
            console.log('✅ All projects already have stored TOR files. Nothing to scrape.');
        } else {
            console.log(`📦 Found ${projects.length} projects missing stored TOR files\n`);
            console.log(`⏱️  Rate limit: ${delayMs}ms between projects\n`);

            const scrapeTargets = projects.map(project => ({
                projectId: project.project_id,
                pdf_url: project.pdf_url,
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
                if (result.pdf_url || result.pdf_path) {
                    await Project.findOneAndUpdate(
                        { project_id: result.projectId },
                        { $set: pdfUpdateFromResult(result) }
                    );
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
