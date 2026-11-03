import { withRouteSecurity } from "@/lib/route-security";
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

async function handlePOST(req) {
    // withRouteSecurity requires notifications:send (admin JWT or scoped cron secret).
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
async function handleGET(req) {
    await connectDB();
    const result = await sendDailyDigest();
    return NextResponse.json({ status: 'success', ...result });
}

export const POST = withRouteSecurity(handlePOST, "/api/notifications/digest", "POST");
export const GET = withRouteSecurity(handleGET, "/api/notifications/digest", "GET");
