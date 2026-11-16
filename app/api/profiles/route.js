import { validateProfileUpdates, publicContractorProfile } from '@/lib/profile-validation';
import { withRouteSecurity } from "@/lib/route-security";
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { SESSION_COOKIE } from '@/lib/auth';
import { requestPrincipal } from '@/lib/request-authorization';
import { deleteDraftsForUser } from '@/lib/bid-prep/deletion';
import { bidPrepError, logBidPrepAudit, profileRateLimitResponse, readJson } from '@/lib/bid-prep/security';

function profileFailure(action, error) {
    try {
        console.error(JSON.stringify({ event: 'profile_error', action, name: error?.name || 'Error' }));
    } catch { /* logging must not change the response */ }
}

// Helper to get authenticated user ID from session cookie or Authorization header
async function getAuthUserId(req) {
    // Use exactly the same authenticated identity as the scope guard. Never
    // take a target user ID from the request body or switch identities here.
    return (await requestPrincipal(req))?.session?.sub || null;
}

// 1. GET: Fetch Current User Profile
async function handleGET(req) {
    try {
        const userId = await getAuthUserId(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const limited = profileRateLimitResponse(userId);
        if (limited) return limited;

        await connectDB();
        const user = await User.findById(userId).select('-googleId -passwordHash').lean();
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const profile = publicContractorProfile(user);

        return NextResponse.json({ status: 'success', data: profile }, { status: 200 });
    } catch (error) {
        profileFailure('get', error);
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
        const limited = profileRateLimitResponse(userId);
        if (limited) return limited;

        const parsed = await readJson(req, { maxBytes: 128 * 1024 });
        if (parsed.error) return bidPrepError(parsed.error.code, parsed.error.message, parsed.error.status);
        const validated = validateProfileUpdates(parsed.value);
        if (Object.keys(validated.errors).length) return NextResponse.json({ error: {
            code: 'INVALID_PROFILE', message: 'Please correct the highlighted profile fields.', fields: validated.errors,
        } }, { status: 400 });
        const updates = { ...validated.updates, updatedAt: new Date() };
        await connectDB();

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-googleId -passwordHash').lean();

        if (!updatedUser) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const profile = publicContractorProfile(updatedUser);

        return NextResponse.json({ status: 'success', data: profile }, { status: 200 });
    } catch (error) {
        profileFailure('update', error);
        return NextResponse.json({ error: { code: error?.name === 'ValidationError' ? 'INVALID_PROFILE' : 'PROFILE_UPDATE_FAILED', message: error?.name === 'ValidationError' ? 'Profile values are invalid.' : 'Unable to save profile. Please try again.' } }, { status: error?.name === 'ValidationError' ? 400 : 500 });
    }
}

async function handlePUT(req) {
    return handlePATCH(req);
}

// 3. DELETE: Delete User Account
async function handleDELETE(req) {
    try {
        const userId = await getAuthUserId(req);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const limited = profileRateLimitResponse(userId);
        if (limited) return limited;

        await connectDB();
        const drafts = await deleteDraftsForUser(userId);
        if (drafts.remaining !== 0) return bidPrepError('DELETE_INCOMPLETE', 'Account data could not be deleted.', 500);
        await User.findByIdAndDelete(userId);
        logBidPrepAudit(req, 'bid_prep_data_deleted', { userId, scope: 'account', draftsDeleted: drafts.deleted });

        const cookieStore = await cookies();
        cookieStore.delete(SESSION_COOKIE);

        return NextResponse.json({ status: 'success', message: 'Account deleted successfully' }, { status: 200 });
    } catch (error) {
        profileFailure('delete', error);
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
    }
}

export const GET = withRouteSecurity(handleGET, "/api/profiles", "GET");
export const PATCH = withRouteSecurity(handlePATCH, "/api/profiles", "PATCH");
export const PUT = withRouteSecurity(handlePUT, "/api/profiles", "PUT");
export const DELETE = withRouteSecurity(handleDELETE, "/api/profiles", "DELETE");
