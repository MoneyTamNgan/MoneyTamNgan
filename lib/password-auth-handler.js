import { NextResponse } from 'next/server';
import connectDB from './db.js';
import { User } from '../models/User.js';
import { SESSION_COOKIE, signSession, sessionCookieOptions } from './auth.js';
import { normalizeEmail, emailFilter, validPassword, hashPassword, verifyPassword, safeAuthDestination, authAttemptLimit } from './password-auth.js';

const fail = (code, message, status, headers) => NextResponse.json({ error: { code, message } }, { status, headers });

export function passwordAuthHandler(mode) {
    return async request => {
        // Bound the body before decoding/hashing. Content-Length alone is untrusted.
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail('INVALID_REQUEST', 'กรุณาส่งข้อมูลแบบ JSON', 415);
        const earlyLimit = authAttemptLimit(request, null);
        if (!earlyLimit.allowed) return fail('RATE_LIMITED', 'ลองใหม่ภายหลัง มีคำขอมากเกินไป', 429, earlyLimit.headers);
        let body;
        try {
            const reader = request.body?.getReader();
            if (!reader) throw new Error('Missing body');
            const chunks = []; let size = 0;
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 8192) { await reader.cancel(); return fail('INVALID_REQUEST', 'ข้อมูลมีขนาดใหญ่เกินไป', 413); }
                chunks.push(Buffer.from(value));
            }
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch { return fail('INVALID_REQUEST', 'ข้อมูลไม่ถูกต้อง', 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('INVALID_REQUEST', 'ข้อมูลไม่ถูกต้อง', 400);
        const email = normalizeEmail(body.email);
        if (!email || !validPassword(body.password)) return fail('INVALID_CREDENTIALS', 'กรุณาระบุอีเมลและรหัสผ่าน 15–128 ตัวอักษร', 400);
        const attempt = authAttemptLimit(request, email);
        if (!attempt.allowed) return fail('RATE_LIMITED', 'ลองใหม่ภายหลัง มีคำขอมากเกินไป', 429, attempt.headers);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (mode === 'register' && name.length > 100) return fail('INVALID_NAME', 'ชื่อต้องไม่เกิน 100 ตัวอักษร', 400);
        try {
            await connectDB();
            let user = await User.findOne(emailFilter(email)).select('+passwordHash');
            if (mode === 'register') {
                if (user) return fail('ACCOUNT_EXISTS', 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม', 409);
                // On a fresh database, wait for the unique email index before
                // the first write so simultaneous registrations cannot race it.
                await User.init();
                const passwordHash = await hashPassword(body.password);
                // Explicit allowlist: request role/scopes/Google IDs are ignored.
                user = await User.create({ email, ...(name ? { name } : {}), passwordHash, role: 'user' });
            } else if (!(await verifyPassword(body.password, user?.passwordHash))) {
                return fail('INVALID_CREDENTIALS', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือโปรดใช้ Google หากสมัครด้วย Google', 401);
            }
            const token = await signSession({ sub: String(user._id), email: user.email, role: user.role });
            const response = NextResponse.json({ user: { id: String(user._id), email: user.email, name: user.name ?? null, role: user.role },
                redirectTo: safeAuthDestination(body.next) }, { status: mode === 'register' ? 201 : 200 });
            response.headers.set('Cache-Control', 'private, no-store');
            response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
            return response;
        } catch (error) {
            if (error?.code === 11000) return fail('ACCOUNT_EXISTS', 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม', 409);
            return fail('AUTH_UNAVAILABLE', 'ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ กรุณาลองใหม่', 503);
        }
    };
}
