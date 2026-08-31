import connectDB from '@/lib/db';
import { buildProjectUpsert, fetchAllFromEGP } from '@/lib/egp-api';
import Project from '@/models/Project';
import { NextResponse } from 'next/server';

/**
 * POST /api/ingestion/trigger
 *
 * Manually trigger an ingestion run from the EGP-CONTRACT API.
 * Fetches project data and upserts it into MongoDB.
 *
 * Body (optional):
 *   { year?: string, keyword?: string, limit?: number, deptCode?: string }
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

        const { year = '2568', keyword, limit, deptCode } = body;

        console.log(`📡 Starting EGP ingestion: year=${year}, keyword=${keyword || '(all)'}`);

        // Fetch records from the EGP API (capped at maxRecords)
        const rawRecords = await fetchAllFromEGP({ year, keyword, maxRecords: limit || 500, deptCode });

        console.log(`📦 Fetched ${rawRecords.length} records from EGP API`);

        let itemsNew = 0;
        let itemsUpdated = 0;
        let itemsFailed = 0;
        const errors = [];

        // Upsert each record into MongoDB
        for (const raw of rawRecords) {
            try {
                const { filter, update } = buildProjectUpsert(raw);
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
