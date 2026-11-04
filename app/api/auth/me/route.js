import { withRouteSecurity } from "@/lib/route-security";
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/models/User';
import { requestPrincipal } from '@/lib/request-authorization';

/** GET /api/auth/me — the signed-in user, or 401. */
async function handleGET(request) {
    const session = (await requestPrincipal(request))?.session;
    if (!session) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    try {
        await connectToDatabase();
        const user = await User.findById(session.sub).lean();
        if (!user) {
            return NextResponse.json({ error: 'User no longer exists' }, { status: 401 });
        }
        return NextResponse.json({
            user: {
                id: String(user._id),
                email: user.email,
                name: user.name ?? null,
                companyName: user.company_name ?? null,
                picture: user.picture ?? null,
                role: user.role,
            },
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const GET = withRouteSecurity(handleGET, "/api/auth/me", "GET");
