import { withRouteSecurity } from "@/lib/route-security";
import connectDB from '@/lib/db';
import { NextResponse } from 'next/server';

async function handleGET() {
    try {
        await connectDB();
        return NextResponse.json({
            status: 'ok',
            database: 'connected',
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return NextResponse.json({
            status: 'error',
            database: 'disconnected',
            message: error.message,
            timestamp: new Date().toISOString(),
        }, { status: 503 });
    }
}

export const GET = withRouteSecurity(handleGET, "/api/health", "GET");
