import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/models/User';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
        return NextResponse.json({ error: 'Authorization code is missing' }, { status: 400 });
    }

    try {
        // 1. Exchange authorization code for Google Tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.NEXT_PUBLIC_REDIRECT_URI,
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
            return NextResponse.json({ error: 'Token exchange failed', details: tokenData }, { status: 400 });
        }

        // 2. Fetch User Profile from Google API
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const googleUser = await userResponse.json();

        // 3. Connect to Mongo Atlas & Upsert User Record
        await connectToDatabase();
        const user = await User.findOneAndUpdate(
            { email: googleUser.email },
            {
                $set: {
                    name: googleUser.name,
                    googleId: googleUser.id,
                    picture: googleUser.picture,
                    updatedAt: new Date(),
                },
            },
            { upsert: true, new: true }
        );

        // 4. Generate Node-signed Session JWT
        const appJwt = jwt.sign(
            {
                sub: user._id.toString(),
                email: user.email,
                role: user.role,
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        return NextResponse.json({
            status: 'success',
            access_token: appJwt,
            token_type: 'Bearer',
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                picture: user.picture,
                role: user.role,
            },
        });
    } catch (error) {
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}