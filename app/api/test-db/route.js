import connectDB from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        await connectDB();
        return NextResponse.json({
            status: 'connected',
            message: 'Successfully connected to MongoDB Atlas!'
        });
    } catch (error) {
        return NextResponse.json({
            status: 'error',
            message: error.message
        }, { status: 500 });
    }
}