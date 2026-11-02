#!/usr/bin/env node

/**
 * Historical metadata backfill from the e-GP Open Data API.
 *
 * Normal ingestion only admits procurements that are still open. This script
 * pulls past fiscal years so the projects collection has enough history for
 * analytics. It searches the API with each software keyword, classifies the
 * project names locally, and upserts only software projects.
 *
 * New projects are inserted as `metadata_only` and no processing jobs are
 * queued. Existing projects only get their metadata refreshed; their
 * classification, eligibility and processing state are left alone.
 *
 * Only e-bidding procurements are kept by default: they are the ones that
 * publish a TOR, and the keyword classifier is too loose on the many small
 * direct purchases whose names merely mention a "development" programme.
 *
 * Raw API results are cached per year in storage/historical/ so later runs
 * (or a different filter) do not have to page through the API again.
 *
 * Usage:
 *   node scripts/backfill-history.js                       # fiscal years 2558 to last year
 *   node scripts/backfill-history.js --from=2565 --to=2568
 *   node scripts/backfill-history.js --all-methods         # also keep non e-bidding projects
 *   node scripts/backfill-history.js --refresh             # ignore the cached API results
 *   node scripts/backfill-history.js --dry-run             # fetch and classify, no database writes
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import Project from '../models/Project.js';
import { buildProjectUpsert, fetchFromEGP } from '../lib/egp-api.js';
import { classifyProjectMetadata } from '../lib/classifier.js';
import { loadKeywordSets } from '../lib/keywords.js';
import { assessProcurementEligibility, currentThaiFiscalYear } from '../lib/procurement-eligibility.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';

const PAGE_SIZE = 1000;
const WRITE_BATCH = 500;
const FIRST_YEAR = 2558; // Earliest fiscal year the Open Data API returns data for.
const CACHE_DIR = 'storage/historical';
const E_BIDDING = /e-bidding|ประกวดราคาอิเล็กทรอนิกส์/i;

function parseArgs() {
    const args = {};
    for (const arg of process.argv.slice(2)) {
        if (!arg.startsWith('--')) continue;
        const [key, ...rest] = arg.slice(2).split('=');
        args[key] = rest.length ? rest.join('=') : true;
    }
    return args;
}

/**
 * The API does a loose text search, so very short Latin keywords ("ai", "api")
 * return tens of thousands of unrelated records per year (drugs, "maintenance").
 * Projects that really are software also match a longer keyword.
 */
export function searchKeywords(softwareKeywords) {
    return [...new Set(softwareKeywords.map(keyword => keyword.trim()))]
        .filter(keyword => keyword && !/^[a-z]{1,3}$/i.test(keyword));
}

async function withRetry(task, attempts = 4) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await task();
        } catch (error) {
            if (attempt >= attempts) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }
}

async function fetchKeyword(year, keyword) {
    const records = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await withRetry(() => fetchFromEGP({ year, keyword, limit: PAGE_SIZE, offset }));
        records.push(...page.records);
        if (page.records.length < PAGE_SIZE || records.length >= page.total) return records;
    }
}

/** Insert-only classification so a backfill never overrides newer or manual decisions. */
export function buildHistoricalUpsert(raw, classification, now = new Date()) {
    const { filter, update } = buildProjectUpsert(raw);
    delete update.$setOnInsert.is_software;
    delete update.$setOnInsert['classification.status'];
    Object.assign(update.$setOnInsert, {
        is_software: true,
        'classification.status': classification.status,
        'classification.confidence': classification.confidence,
        'classification.method': classification.method,
        'classification.reason': classification.reason,
        'classification.classified_at': now,
        procurement_eligibility: assessProcurementEligibility(raw, { now }),
        'processing.status': 'metadata_only',
        'workflow.status': 'metadata_only',
    });
    return { updateOne: { filter, update, upsert: true } };
}

async function fetchYear(year, keywords, refresh) {
    const cachePath = `${CACHE_DIR}/egp-${year}.json`;
    if (!refresh) {
        try {
            const cached = JSON.parse(await readFile(cachePath, 'utf8'));
            console.log(`   ${year}: ${cached.length} records from ${cachePath}`);
            return cached;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    const byId = new Map();
    for (const keyword of keywords) {
        const records = await fetchKeyword(year, keyword);
        for (const record of records) {
            if (record?.project_id) byId.set(String(record.project_id), record);
        }
        console.log(`   ${year} "${keyword}": ${records.length} records (${byId.size} unique so far)`);
    }
    const records = [...byId.values()];
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, JSON.stringify(records));
    return records;
}

async function backfillYear(year, keywords, keywordSets, { dryRun, refresh, allMethods }) {
    const records = await fetchYear(year, keywords, refresh);
    const candidates = allMethods ? records : records.filter(raw => E_BIDDING.test(raw.purchase_method_name || ''));

    const software = [];
    for (const raw of candidates) {
        const classification = classifyProjectMetadata({ project_name: raw.project_name }, keywordSets);
        if (classification.isSoftware === true && raw.project_name && raw.dept_name) {
            software.push({ raw, classification });
        }
    }

    const stats = { year, unique: records.length, candidates: candidates.length,
        software: software.length, inserted: 0, updated: 0 };
    if (dryRun) return stats;

    for (let i = 0; i < software.length; i += WRITE_BATCH) {
        const ops = software.slice(i, i + WRITE_BATCH)
            .map(({ raw, classification }) => buildHistoricalUpsert(raw, classification));
        const result = await Project.bulkWrite(ops, { ordered: false });
        stats.inserted += result.upsertedCount;
        stats.updated += result.matchedCount;
    }
    return stats;
}

async function main() {
    const args = parseArgs();
    const from = Number(args.from ?? FIRST_YEAR);
    const to = Number(args.to ?? Number(currentThaiFiscalYear()) - 1);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 2500 || from > to) {
        throw new RangeError('--from and --to must be Buddhist-era years with from <= to');
    }
    const dryRun = Boolean(args['dry-run']);
    if (!dryRun && !process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');

    console.log(`📚 Historical backfill, fiscal years ${from}-${to}${dryRun ? ' (dry run)' : ''}`);
    if (!dryRun) await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const keywordSets = await loadKeywordSets();
    const keywords = searchKeywords(keywordSets.softwareKeywords);
    console.log(`   Searching with ${keywords.length} keywords\n`);

    const totals = [];
    try {
        for (let year = to; year >= from; year--) {
            const stats = await backfillYear(String(year), keywords, keywordSets, {
                dryRun, refresh: Boolean(args.refresh), allMethods: Boolean(args['all-methods']),
            });
            totals.push(stats);
            console.log(`✅ ${year}: ${stats.unique} unique, ${stats.candidates} `
                + `${args['all-methods'] ? 'candidates' : 'e-bidding'}, ${stats.software} software, `
                + `${stats.inserted} inserted, ${stats.updated} already present\n`);
        }
    } finally {
        if (!dryRun) await mongoose.disconnect();
    }

    console.log('📊 Summary');
    for (const stats of totals) {
        console.log(`   ${stats.year}: ${stats.software} software (${stats.inserted} new)`);
    }
    const sum = key => totals.reduce((total, stats) => total + stats[key], 0);
    console.log(`   Total: ${sum('software')} software projects, ${sum('inserted')} new`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exitCode = 1;
});
