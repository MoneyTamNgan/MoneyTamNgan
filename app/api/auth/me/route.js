import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/models/User';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

/** GET /api/auth/me — the signed-in user, or 401. */
export async function GET() {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = await verifySession(token);
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
                picture: user.picture ?? null,
                role: user.role,
            },
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
