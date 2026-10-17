#!/usr/bin/env node

/**
 * Test: Scrape TOR + ประกาศเชิญชวน for up to 20 projects
 *
 * Usage:
 *   node scripts/test-scrape-sections.js
 *   node scripts/test-scrape-sections.js --limit=5
 *   node scripts/test-scrape-sections.js --project-id=67039549408
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { scrapeProjectTOR } from '../lib/scraper.js';
import Project from '../models/Project.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';

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

function sep(char = '─', width = 60) {
    console.log(char.repeat(width));
}

function summarizeResult(result) {
    const lines = [];
    lines.push(`  Project ID        : ${result.projectId}`);
    lines.push(`  TOR / e-Bidding   : ${result.pdf_path ? '✅  ' + result.pdf_path : '❌  none'}`);

    if (result.invitation_attachments?.length > 0) {
        lines.push(`  ประกาศเชิญชวน     : ✅  ${result.invitation_attachments.length} file(s)`);
        result.invitation_attachments.forEach((a, i) => {
            const loc = a.local_path || a.url?.substring(0, 70) || '(no path)';
            lines.push(`    [${i + 1}] ${(a.name || '').substring(0, 55)}`);
            lines.push(`        → ${loc}`);
        });
    } else {
        lines.push(`  ประกาศเชิญชวน     : ❌  none`);
    }

    if (result.attachments?.length > 0) {
        lines.push(`  All attachments (${result.attachments.length} total):`);
        result.attachments.forEach((a, i) => {
            const tag    = a.section ? ` [${a.section}]` : ' [TOR/generic]';
            const status = a.local_path ? '✅' : a.download_error ? '❌' : '⚠️ ';
            lines.push(`    ${status}${tag} ${(a.name || '').substring(0, 50)}`);
            if (a.download_error) lines.push(`         err: ${a.download_error}`);
        });
    }

    if (result.error) lines.push(`  ❌ Scrape error   : ${result.error}`);
    return lines.join('\n');
}

async function main() {
    const args     = parseArgs();
    const singleId = args['project-id'];
    const limit    = Number(args['limit'] ?? 20);

    console.log('');
    console.log('🧪  Section Scraper Test — TOR + ประกาศเชิญชวน');
    sep('═');

    if (!process.env.MONGODB_URI) {
        console.error('❌  MONGODB_URI not set in .env'); process.exit(1);
    }

    console.log('📡  Connecting to MongoDB...');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    console.log('✅  Connected\n');

    let projectIds = [];

    if (singleId) {
        projectIds = [singleId];
        console.log(`🔍  Single-project mode: ${singleId}\n`);
    } else {
        // Prefer projects with no doc so the scraper actually has work to do.
        const withoutDoc = await Project.find({ primary_document_id: { $exists: false } })
            .select('project_id').limit(limit).lean();
        projectIds = withoutDoc.map(p => p.project_id);

        if (projectIds.length < limit) {
            const withDoc = await Project.find({ primary_document_id: { $exists: true } })
                .select('project_id').limit(limit - projectIds.length).lean();
            projectIds.push(...withDoc.map(p => p.project_id));
        }

        console.log(`📦  Testing ${projectIds.length} projects (limit=${limit})\n`);
    }

    if (projectIds.length === 0) {
        console.log('⚠️   No projects in DB. Run ingestion first:');
        console.log("    curl -X POST http://localhost:3000/api/ingestion/trigger -H 'Content-Type: application/json' -d '{\"year\":\"2568\",\"limit\":100}'");
        await mongoose.disconnect(); return;
    }

    const tally = { total: 0, both: 0, torOnly: 0, invitationOnly: 0, none: 0, errors: 0 };

    for (let i = 0; i < projectIds.length; i++) {
        const projectId = projectIds[i];
        sep();
        console.log(`[${i + 1}/${projectIds.length}] Scraping ${projectId} ...`);

        const result = await scrapeProjectTOR(projectId);
        tally.total++;

        const hasTor        = !!result.pdf_path;
        const hasInvitation = (result.invitation_attachments?.length ?? 0) > 0;

        if (hasTor && hasInvitation)   tally.both++;
        else if (hasTor)               tally.torOnly++;
        else if (hasInvitation)        tally.invitationOnly++;
        else if (result.error)         tally.errors++;
        else                           tally.none++;

        console.log(summarizeResult(result));

        if (i < projectIds.length - 1) {
            console.log('\n  ⏳ Rate-limit pause (4 s)...');
            await new Promise(r => setTimeout(r, 4000));
        }
    }

    sep('═');
    console.log('\n📊  Results:');
    console.log(`   Total scraped           : ${tally.total}`);
    console.log(`   ✅  Both TOR + ประกาศ   : ${tally.both}`);
    console.log(`   📄  TOR only            : ${tally.torOnly}`);
    console.log(`   📋  ประกาศ only         : ${tally.invitationOnly}`);
    console.log(`   ⚠️   No docs found       : ${tally.none}`);
    console.log(`   ❌  Errors              : ${tally.errors}`);
    console.log('');

    await mongoose.disconnect();
    console.log('👋  Done.');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
