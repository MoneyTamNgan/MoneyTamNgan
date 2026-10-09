#!/usr/bin/env node

/**
 * Open-tender ingestion: TOR + invitation PDF per project (FR-1.1.2, FR-1.1.3)
 *
 * Discovers open tenders from the e-GP announcement RSS feed, classifies
 * them by title, then fetches both documents with the hybrid pipeline
 * (benchmark P5) and links them to the project record.
 *
 * Usage:
 *   node scripts/ingest-open-tenders.js                       # all known departments
 *   node scripts/ingest-open-tenders.js --depts=1507,0703     # selected departments
 *   node scripts/ingest-open-tenders.js --limit=20            # stop after 20 fetched projects
 *   node scripts/ingest-open-tenders.js --all                 # include non-software projects
 *   node scripts/ingest-open-tenders.js --force               # re-fetch projects already paired
 *   node scripts/ingest-open-tenders.js --enqueue             # queue OCR/AI processing afterwards
 *   node scripts/ingest-open-tenders.js --no-browser          # feed documents only (e-GP site down)
 *   node scripts/ingest-open-tenders.js --dry-run             # discover and classify only
 *   node scripts/ingest-open-tenders.js --announcement-storage=local  # default gridfs (MongoDB)
 *   node scripts/ingest-open-tenders.js --discover-only      # save a feed snapshot, no database
 *   node scripts/ingest-open-tenders.js --tenders=storage/tenders/latest.json
 *       Reuse a saved feed snapshot instead of re-reading the RSS feed
 */

import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import { collectOpenTenders, tenderStatus } from '../lib/egp-rss.js';
import { classifyProjectMetadata } from '../lib/classifier.js';
import { loadKeywordSets } from '../lib/keywords.js';
import { persistDocument } from '../lib/document-storage.js';
import { persistAnnouncementRecord, persistPdfRecords } from '../lib/mongo-artifacts.js';
import {
    acquireTenderDocuments,
    closeAcquisitionContext,
    createAcquisitionContext,
} from '../lib/tender-acquisition.js';
import { enqueueProject } from '../lib/job-queue.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';

function parseArgs() {
    const args = {};
    for (const arg of process.argv.slice(2)) {
        if (!arg.startsWith('--')) continue;
        const [key, ...rest] = arg.slice(2).split('=');
        args[key] = rest.length ? rest.join('=') : true;
    }
    return args;
}

function inferFiscalYear(projectId) {
    const match = String(projectId).match(/^(\d{2})/);
    return match ? String(2500 + Number(match[1])) : 'unknown';
}

const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '-');

async function departmentIds(args) {
    if (typeof args.depts === 'string') return args.depts.split(',').map(id => id.trim()).filter(Boolean);
    return JSON.parse(await readFile(new URL('../lib/egp-rss-depts.json', import.meta.url), 'utf8'));
}

/** Create RSS-only projects and refresh feed fields without touching API metadata. */
async function upsertTenderProject(tender) {
    const published = tender.pubDate ? new Date(`${tender.pubDate}T00:00:00+07:00`) : undefined;
    await Project.updateOne({ project_id: tender.projectId }, {
        $set: {
            'tender.rss_dept_id': tender.deptId,
            'tender.method': tender.method || undefined,
            'tender.draft_url': tender.draftLink || undefined,
            'tender.invitation_url': tender.invitationLink || undefined,
            'tender.published_at': published,
        },
        $setOnInsert: {
            project_id: tender.projectId,
            project_name: tender.title,
            'timeline.announce_date': published,
            'source.provider': 'egp_rss',
            'source.fetched_at': new Date(),
            is_software: null,
            'classification.status': 'pending',
            'processing.status': 'metadata_ingested',
            'processing.attempts': 0,
            'workflow.status': 'metadata_ingested',
            'anomalies.high_budget_flag': false,
            'anomalies.budget_deviation_multiplier': 1,
        },
    }, { upsert: true });
    return Project.findOne({ project_id: tender.projectId }).lean();
}

async function classify(project, keywordSets) {
    if (project.classification?.status === 'manual_override') {
        return { isSoftware: project.is_software, status: 'manual_override' };
    }
    const classification = classifyProjectMetadata(project, keywordSets);
    await Project.updateOne({ _id: project._id }, { $set: {
        is_software: classification.isSoftware,
        classification: {
            status: classification.status,
            confidence: classification.confidence,
            method: classification.method,
            classified_at: new Date(),
            reason: classification.reason,
        },
        ...(classification.isSoftware === false && !project.primary_document_id
            ? { 'processing.status': 'irrelevant' }
            : {}),
    } });
    return classification;
}

async function persistDocuments(project, tender, outcome, announcementStorage) {
    const fiscalYear = inferFiscalYear(project.project_id);
    const set = {};
    let announcementDocument = null;
    let torDocument = null;

    if (outcome.announcement) {
        const persisted = await persistDocument({
            projectId: project.project_id, fiscalYear,
            localPath: outcome.announcement.path, mimeType: 'application/pdf',
            backend: announcementStorage,
        });
        announcementDocument = await persistAnnouncementRecord(project, outcome.announcement, persisted);
        set.announcement_document_id = announcementDocument._id;

        const { agency, referencePrice, submission } = outcome.announcement.invitation;
        if (submission) {
            set['tender.submission_date'] = submission.date;
            set['tender.submission_start_time'] = submission.startTime;
            set['tender.submission_end_time'] = submission.endTime;
            set['tender.closes_at'] = submission.closesAt ? new Date(submission.closesAt) : undefined;
        }
        if (referencePrice) set['tender.reference_price'] = referencePrice;
        // Open Data metadata stays authoritative; only RSS-created records are filled in.
        if (project.source?.provider === 'egp_rss') {
            if (agency && !project.dept_name) set.dept_name = agency;
            if (referencePrice && !project.budget) set.budget = referencePrice;
        }
    }

    if (outcome.tor) {
        const persisted = await persistDocument({
            projectId: project.project_id, fiscalYear,
            localPath: outcome.tor.pdf_path, mimeType: outcome.tor.pdf_content_type,
        });
        torDocument = await persistPdfRecords(
            project, outcome.tor, persisted, outcome.tor.resolver_source || 'egp_browser'
        );
        Object.assign(set, {
            primary_document_id: torDocument._id,
            'tender.tor_route': outcome.torRoute,
            'processing.status': 'document_downloaded',
            'processing.error_code': null,
            'processing.error': null,
            'workflow.status': 'document_downloaded',
            'workflow.error': null,
            'workflow.updated_at': new Date(),
        });
    }

    const closesAt = outcome.announcement?.invitation.submission?.closesAt || project.tender?.closes_at;
    Object.assign(set, {
        'tender.status': tenderStatus({
            hasDraft: Boolean(tender.draftLink),
            hasInvitation: Boolean(tender.invitationLink),
            closesAt,
        }),
        'tender.checked_at': new Date(),
        'tender.error': [outcome.torError && `TOR: ${outcome.torError}`,
            outcome.announcementError && `announcement: ${outcome.announcementError}`]
            .filter(Boolean).join('; ').slice(0, 1000) || null,
    });
    if (!outcome.tor && !project.primary_document_id) {
        set['processing.status'] = 'retry_pending';
        set['processing.error'] = outcome.torError;
    }
    const update = { $set: Object.fromEntries(Object.entries(set).filter(([, value]) => value !== undefined)) };
    if (!outcome.tor) update.$inc = { 'processing.download_attempts': 1 };
    await Project.updateOne({ _id: project._id }, update);
    return { torDocument, announcementDocument };
}

const SNAPSHOT_DIR = 'storage/tenders';

/** Read the feed and save a snapshot, since discovery takes minutes and can be reused. */
async function discoverTenders(args, limit) {
    const deptIds = await departmentIds(args);
    console.log(`📡 Reading the e-GP announcement feed for ${deptIds.length} departments...`);
    const tenders = await collectOpenTenders({
        deptIds,
        // With --all every tender is a candidate, so discovery can stop at the limit.
        maxProjects: args.all ? limit : Infinity,
        onError: ({ deptId, type, error, disabled }) => console.warn(`   ⚠️  ${deptId}/${type}: ${error.message}`
            + (disabled ? ` — skipping ${type} for the rest of this run` : '')),
        onProgress: ({ deptId, projects }) => console.log(`   ${deptId}: ${projects} projects so far`),
    });
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    const json = JSON.stringify(tenders, null, 2);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(`${SNAPSHOT_DIR}/${stamp}.json`, json);
    await writeFile(`${SNAPSHOT_DIR}/latest.json`, json);
    console.log(`   Saved feed snapshot to ${SNAPSHOT_DIR}/latest.json`);
    return tenders;
}

async function main() {
    const args = parseArgs();
    const limit = args.limit === undefined ? Infinity : Number(args.limit);
    if (!(limit >= 1)) throw new RangeError('--limit must be a positive number');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');

    const tenders = typeof args.tenders === 'string'
        ? JSON.parse(await readFile(args.tenders, 'utf8'))
        : await discoverTenders(args, limit);
    console.log(`   ${tenders.length} open tenders\n`);
    if (args['discover-only']) return;

    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const keywordSets = await loadKeywordSets();
    // Invitations are ~100KB, so they live in MongoDB; TORs follow TOR_STORAGE_BACKEND.
    const announcementStorage = typeof args['announcement-storage'] === 'string'
        ? args['announcement-storage'] : 'gridfs';
    const ctx = createAcquisitionContext({ allowBrowser: !args['no-browser'] });
    const stats = {
        discovered: tenders.length, candidates: 0, skippedDone: 0, attempted: 0,
        tor: 0, torFeed: 0, announcement: 0, closingDate: 0, paired: 0,
    };

    try {
        for (const tender of tenders) {
            if (stats.attempted >= limit) break;
            if (args['dry-run']) {
                const preview = classifyProjectMetadata({ project_name: tender.title }, keywordSets);
                if (preview.isSoftware === false && !args.all) continue;
                stats.candidates += 1;
                console.log(`   · ${tender.projectId} ${preview.status} ${tender.title.slice(0, 70)}`);
                continue;
            }
            const project = await upsertTenderProject(tender);
            const classification = await classify(project, keywordSets);
            if (classification.isSoftware === false && !args.all) continue;
            stats.candidates += 1;
            if (!args.force && project.primary_document_id && project.announcement_document_id) {
                stats.skippedDone += 1;
                continue;
            }
            stats.attempted += 1;
            const started = Date.now();
            const outcome = await acquireTenderDocuments(tender, ctx);
            await persistDocuments(project, tender, outcome, announcementStorage);

            if (outcome.tor) stats.tor += 1;
            if (outcome.torRoute === 'feed') stats.torFeed += 1;
            if (outcome.announcement) stats.announcement += 1;
            if (outcome.announcement?.invitation.submission) stats.closingDate += 1;
            if (outcome.tor && outcome.announcement) stats.paired += 1;
            if (outcome.tor && args.enqueue) await enqueueProject(tender.projectId);

            const marks = `${outcome.tor ? '✅' : '❌'} TOR${outcome.torRoute ? `(${outcome.torRoute})` : ''} `
                + `${outcome.announcement ? '✅' : tender.invitationLink ? '❌' : '–'} ประกาศ`;
            console.log(`   [${stats.attempted}] ${tender.projectId} ${marks} ${Date.now() - started}ms`
                + (outcome.torError && !outcome.tor ? `\n       ${outcome.torError.slice(0, 160)}` : ''));
        }
    } finally {
        await closeAcquisitionContext(ctx);
    }

    console.log('\n📊 Summary');
    console.log(`   Open tenders found:      ${stats.discovered}`);
    console.log(`   Software candidates:     ${stats.candidates}${args.all ? ' (all projects)' : ''}`);
    console.log(`   Already paired, skipped: ${stats.skippedDone}`);
    console.log(`   Fetched this run:        ${stats.attempted}`);
    console.log(`   TOR stored:              ${stats.tor} (${pct(stats.tor, stats.attempted)}; ${stats.torFeed} via feed)`);
    console.log(`   Announcement stored:     ${stats.announcement} (${pct(stats.announcement, stats.attempted)})`);
    console.log(`   Closing date parsed:     ${stats.closingDate} (${pct(stats.closingDate, stats.attempted)})`);
    console.log(`   TOR + announcement pair: ${stats.paired} (${pct(stats.paired, stats.attempted)})`);

    await mongoose.disconnect();
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exitCode = 1;
});
