#!/usr/bin/env node

/**
 * CLI TOR PDF Scraper
 *
 * Usage:
 *   node scripts/scrape.js                          # Download TORs missing a primary document
 *   node scripts/scrape.js --project-id=67039549408  # Scrape a single project
 *   node scripts/scrape.js --limit=20               # Scrape up to 20 projects
 *   node scripts/scrape.js --delay=5000             # 5 second delay between requests
 *   node scripts/scrape.js --include-closed --years=2568,2569 --limit=1000
 *       Historical backfill: also download TORs of closed procurements whose
 *       project ID starts with one of the given fiscal years. Each project is
 *       attempted once, so repeated runs work through the remaining backlog.
 *   node scripts/scrape.js --include-closed --years=2568,2569 --shard=0/5
 *       Run several processes in parallel (shards 0/5 ... 4/5); each takes the
 *       projects whose ID ends in a digit d with d % n === k.
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
import { loadKeywordSets } from '../lib/keywords.js';
import { verifySoftwareProcurement } from '../lib/procurement-eligibility.js';

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

const TRANSIENT_ERROR = /Waiting failed|empty page|timed? ?out|net::ERR|ECONNRESET|socket hang up/i;
const THROTTLE_STREAK = 3;
const THROTTLE_PAUSE_MS = 5 * 60 * 1000;

/** Closed procurements still publish their TOR, so historical mode only checks the software rule. */
function admitProject(project, keywordSets, includeClosed) {
    if (!includeClosed) return verifySoftwareProcurement(project, keywordSets);
    return verifySoftwareProcurement(project, keywordSets, async () => ({ status: 'open' }));
}

function batchFilter(args) {
    const filter = { primary_document_id: { $exists: false } };
    if (!args['include-closed']) return filter;
    filter.is_software = true;
    filter['processing.download_attempts'] = { $not: { $gte: 1 } };
    const prefixes = typeof args.years === 'string'
        ? args.years.split(',').map(year => year.trim().slice(-2)).filter(year => /^\d{2}$/.test(year))
        : [];
    let lastDigits = '';
    if (typeof args.shard === 'string') {
        const [index, count] = args.shard.split('/').map(Number);
        if (![1, 2, 5, 10].includes(count) || !Number.isInteger(index) || index < 0 || index >= count) {
            throw new RangeError('shard must be k/n with n in 1, 2, 5 or 10 and 0 <= k < n');
        }
        lastDigits = `[${[...Array(10).keys()].filter(digit => digit % count === index).join('')}]`;
    }
    if (prefixes.length || lastDigits) {
        filter.project_id = { $regex: `^${prefixes.length ? `(?:${prefixes.join('|')})` : ''}${lastDigits ? `\\d*${lastDigits}$` : ''}` };
    }
    return filter;
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
    const includeClosed = Boolean(args['include-closed']);
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
        const admission = await admitProject(existingProject, await loadKeywordSets(), includeClosed);
        if (!admission.allowed) {
            console.log(`Skipped ${projectId}: ${admission.reason}`);
            await mongoose.disconnect();
            return;
        }
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
        const candidates = await Project.find(batchFilter(args))
            .select('project_id project_name is_software classification timeline project_status primary_document_id')
            .limit(limit)
            .lean();
        const projects = [];
        const keywordSets = await loadKeywordSets();
        for (const project of candidates) {
            const admission = await admitProject(project, keywordSets, includeClosed);
            if (admission.allowed) projects.push(project);
            else console.log(`Skipped ${project.project_id}: ${admission.reason}`);
        }

        if (projects.length === 0) {
            console.log('✅ All projects already have stored TOR files. Nothing to scrape.');
        } else {
            console.log(`📦 Found ${projects.length} projects missing stored TOR files\n`);
            console.log(`⏱️  Rate limit: ${delayMs}ms between projects\n`);

            const scrapeTargets = projects.map(project => ({
                projectId: project.project_id,
            }));
            // Persist each project as soon as it finishes so a long run that dies
            // part-way keeps everything downloaded so far.
            const recordResult = async (result) => {
                const project = projects.find(item => item.project_id === result.projectId);
                try {
                    if (result.pdf_path) {
                        await persistScrapeResult(project, result);
                        return true;
                    }
                    // Timeouts mean e-GP is throttling us, not that the TOR is missing; leave them queued.
                    if (includeClosed && !TRANSIENT_ERROR.test(result.error || '')) {
                        // Record the miss so the next historical run moves on to other projects.
                        await Project.updateOne({ _id: project._id }, {
                            $inc: { 'processing.download_attempts': 1 },
                            $set: { 'processing.error': String(result.error || 'No documents on page').slice(0, 1000) },
                        });
                    }
                } catch (err) {
                    console.error(`   ⚠️  Could not save ${result.projectId}: ${err.message}`);
                }
                return false;
            };
            let updated = 0;
            let transientStreak = 0;
            const { summary } = await scrapeBatch(scrapeTargets, {
                delayMs,
                onProgress: async (i, total, result) => {
                    const status = result.pdf_path ? '✅' : result.error ? '❌' : '⚠️';
                    console.log(`   ${status} [${i}/${total}] ${result.projectId}`);
                    if (await recordResult(result)) updated++;
                    transientStreak = TRANSIENT_ERROR.test(result.error || '') ? transientStreak + 1 : 0;
                    if (transientStreak >= THROTTLE_STREAK) {
                        console.log(`   ⏸️  ${transientStreak} timeouts in a row; pausing ${THROTTLE_PAUSE_MS / 60000} minutes`);
                        await new Promise(resolve => setTimeout(resolve, THROTTLE_PAUSE_MS));
                        transientStreak = 0;
                    }
                },
            });

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
