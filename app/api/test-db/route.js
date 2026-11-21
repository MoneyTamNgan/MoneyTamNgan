import { withRouteSecurity } from "@/lib/route-security";
import connectDB from '@/lib/db';
import { NextResponse } from 'next/server';

async function handleGET() {
    try {
        await connectDB();
        return NextResponse.json({
            status: 'connected',
            message: 'Successfully connected to MongoDB Atlas!'
        });
    } catch {
        return NextResponse.json({
            status: 'error',
            message: 'Database connection failed'
        }, { status: 500 });
    }
}

export const GET = withRouteSecurity(handleGET, "/api/test-db", "GET");
