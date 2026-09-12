import connectDB from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
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
