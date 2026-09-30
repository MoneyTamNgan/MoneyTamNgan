/**
 * POST /api/notifications/digest
 *
 * Sends the daily digest to all DAILY_DIGEST users.
 * Should be called by a cron job / scheduled task.
 *
 * Protected by a shared secret header:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Body:
 *   { "projects": [...] }   — optionally pass pre-fetched projects.
 *                              When omitted, the route fetches the latest 200
 *                              processed projects from the database.
 */
import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { hydrateProjectsCompatibility } from '@/lib/project-compat';
import { sendDailyDigest } from '@/lib/services/notification-service';

function unauthorized() {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req) {
    // ── Auth: CRON_SECRET or omit header check in dev ─────────────────────────
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const auth = req.headers.get('authorization') ?? '';
        if (auth !== `Bearer ${cronSecret}`) return unauthorized();
    }

    await connectDB();

    let projects;
    try {
        const body = await req.json().catch(() => ({}));
        projects = Array.isArray(body.projects) ? body.projects : null;
    } catch {
        projects = null;
    }

    if (!projects) {
        // Fetch last 200 projects that have been processed (have tech_stack data)
        const raw = await Project.find({
            'extracted_data.tech_stack': { $exists: true, $not: { $size: 0 } },
        })
            .sort({ updated_at: -1 })
            .limit(200)
            .lean();
        projects = await hydrateProjectsCompatibility(raw);
    }

    const result = await sendDailyDigest(projects);

    return NextResponse.json({ status: 'success', ...result });
}
