import { withRouteSecurity } from "@/lib/route-security";
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { SESSION_COOKIE } from '@/lib/auth';
import { requestPrincipal } from '@/lib/request-authorization';

// Helper to get authenticated user ID from session cookie or Authorization header
async function getAuthUserId(req) {
    // Use exactly the same authenticated identity as the scope guard. Never
    // take a target user ID from the request body or switch identities here.
    return (await requestPrincipal(req))?.session?.sub || null;
}

// Helper to clean array of strings
function cleanStringArray(arr) {
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map(item => String(item).trim()).filter(Boolean))];
}

// 1. GET: Fetch Current User Profile
async function handleGET(req) {
    try {
        const userId = await getAuthUserId(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const user = await User.findById(userId).select('-googleId').lean();
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Format profile response
        const profile = {
            _id: String(user._id),
            email: user.email,
            name: user.name || '',
            company_name: user.company_name || '',
            skills: user.skills && user.skills.length > 0 ? user.skills : (user.techStack || []),
            techStack: user.techStack && user.techStack.length > 0 ? user.techStack : (user.skills || []),
            registered_capital: user.registered_capital ?? null,
            highest_past_project_value: user.highest_past_project_value ?? null,
            concurrent_project_capacity: user.concurrent_project_capacity ?? null,
            certifications: user.certifications || [],
            email_notifications_enabled: user.email_notifications_enabled ?? false,
            match_score_threshold: user.match_score_threshold ?? 70,
            notification_frequency: user.notification_frequency ?? 'IMMEDIATE',
            updatedAt: user.updatedAt || new Date(),
        };

        return NextResponse.json({ status: 'success', data: profile }, { status: 200 });
    } catch (error) {
        console.error('GET /api/profiles error:', error);
        return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }
}

// 2. PATCH / PUT: Update User Profile
async function handlePATCH(req) {
    try {
        const userId = await getAuthUserId(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const body = await req.json();

        const updates = { updatedAt: new Date() };

        if (typeof body.name === 'string') updates.name = body.name.trim();
        if (typeof body.company_name === 'string') updates.company_name = body.company_name.trim();

        // Support both skills and techStack interchangeably
        if (Array.isArray(body.skills)) {
            const cleanedSkills = cleanStringArray(body.skills);
            updates.skills = cleanedSkills;
            if (!body.techStack) updates.techStack = cleanedSkills;
        }
        if (Array.isArray(body.techStack)) {
            const cleanedTech = cleanStringArray(body.techStack);
            updates.techStack = cleanedTech;
            if (!body.skills) updates.skills = cleanedTech;
        }

        if (body.registered_capital !== undefined) {
            updates.registered_capital = body.registered_capital === null || body.registered_capital === '' ? null : Number(body.registered_capital);
        }
        if (body.highest_past_project_value !== undefined) {
            updates.highest_past_project_value = body.highest_past_project_value === null || body.highest_past_project_value === '' ? null : Number(body.highest_past_project_value);
        }
        if (body.concurrent_project_capacity !== undefined) {
            updates.concurrent_project_capacity = body.concurrent_project_capacity === null || body.concurrent_project_capacity === '' ? null : Number(body.concurrent_project_capacity);
        }
        if (Array.isArray(body.certifications)) {
            updates.certifications = cleanStringArray(body.certifications);
        }
        if (typeof body.email_notifications_enabled === 'boolean') {
            updates.email_notifications_enabled = body.email_notifications_enabled;
        }
        if (body.match_score_threshold !== undefined) {
            const t = Number(body.match_score_threshold);
            if (!Number.isNaN(t) && t >= 0 && t <= 100) {
                updates.match_score_threshold = t;
            }
        }
        if (body.notification_frequency !== undefined) {
            if (['IMMEDIATE', 'DAILY_DIGEST'].includes(body.notification_frequency)) {
                updates.notification_frequency = body.notification_frequency;
            }
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-googleId').lean();

        if (!updatedUser) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const profile = {
            _id: String(updatedUser._id),
            email: updatedUser.email,
            name: updatedUser.name || '',
            company_name: updatedUser.company_name || '',
            skills: updatedUser.skills && updatedUser.skills.length > 0 ? updatedUser.skills : (updatedUser.techStack || []),
            techStack: updatedUser.techStack && updatedUser.techStack.length > 0 ? updatedUser.techStack : (updatedUser.skills || []),
            registered_capital: updatedUser.registered_capital ?? null,
            highest_past_project_value: updatedUser.highest_past_project_value ?? null,
            concurrent_project_capacity: updatedUser.concurrent_project_capacity ?? null,
            certifications: updatedUser.certifications || [],
            email_notifications_enabled: updatedUser.email_notifications_enabled ?? false,
            match_score_threshold: updatedUser.match_score_threshold ?? 70,
            notification_frequency: updatedUser.notification_frequency ?? 'IMMEDIATE',
            updatedAt: updatedUser.updatedAt || new Date(),
        };

        return NextResponse.json({ status: 'success', data: profile }, { status: 200 });
    } catch (error) {
        console.error('PATCH /api/profiles error:', error);
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 400 });
    }
}

async function handlePUT(req) {
    return PATCH(req);
}

// 3. DELETE: Delete User Account
async function handleDELETE(req) {
    try {
        const userId = await getAuthUserId(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        await User.findByIdAndDelete(userId);

        const cookieStore = await cookies();
        cookieStore.delete(SESSION_COOKIE);

        return NextResponse.json({ status: 'success', message: 'Account deleted successfully' }, { status: 200 });
    } catch (error) {
        console.error('DELETE /api/profiles error:', error);
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
    }
}

export const GET = withRouteSecurity(handleGET, "/api/profiles", "GET");
export const PATCH = withRouteSecurity(handlePATCH, "/api/profiles", "PATCH");
export const PUT = withRouteSecurity(handlePUT, "/api/profiles", "PUT");
export const DELETE = withRouteSecurity(handleDELETE, "/api/profiles", "DELETE");
