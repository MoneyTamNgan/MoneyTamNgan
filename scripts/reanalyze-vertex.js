#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { reanalyzeStoredProject } from '../lib/vertex/reanalyze-project.js';

async function main() {
    const projectId = process.argv[2];
    if (!projectId) throw new Error('Usage: npm run vertex:reanalyze -- <PROJECT_ID>');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const result = await reanalyzeStoredProject(projectId);
    const output = process.argv.includes('--full') ? result : {
        projectId: result.projectId,
        status: result.status,
        reused: result.reused,
        documentSummaryId: result.documentSummaryId,
        riskFindingCount: result.extraction?.risk_findings?.length || 0,
        riskFindings: (result.extraction?.risk_findings || []).map(finding => ({
            category: finding.category,
            severity: finding.severity,
            page: finding.page,
            highlightReason: finding.highlight_reason,
        })),
    };
    console.log(JSON.stringify(output, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect().catch(() => {}));
