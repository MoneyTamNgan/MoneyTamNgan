import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createRateLimiter, clientAddress, rateLimitHeaders } from './rate-limit.js';

const scrypt = promisify(scryptCallback);
const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;
const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000 });
let activeHashes = 0;
async function derive(password, salt) {
    // Each hash uses about 128 MiB. Bound concurrent work rather than allowing
    // an auth burst to exhaust the app's memory or queue unlimited KDF jobs.
    if (activeHashes >= 2) throw new Error('Password service is busy');
    activeHashes++;
    try { return await scrypt(password, salt, 64, options); }
    finally { activeHashes--; }
}

export function normalizeEmail(value) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Case-insensitive lookup also recognizes legacy Google users created before
// email normalization. New writes always use normalized email + its unique index.
export function emailFilter(email) {
    return { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } };
}

export function validPassword(password) {
    return typeof password === 'string' && [...password].length >= PASSWORD_MIN_LENGTH
        && [...password].length <= PASSWORD_MAX_LENGTH && Buffer.byteLength(password, 'utf8') <= 512;
}

export async function hashPassword(password) {
    if (!validPassword(password)) throw new TypeError('Password must contain 15–128 characters');
    const salt = randomBytes(16);
    const derived = await derive(password, salt);
    return `scrypt$v1$131072$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

// A fixed dummy record makes absent/Google-only accounts perform the same KDF
// as wrong-password attempts. Never log passwords, stored hashes or bodies.
const dummy = `scrypt$v1$131072$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;
export async function verifyPassword(password, stored) {
    if (!validPassword(password)) return false;
    const record = typeof stored === 'string' && /^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored) ? stored : dummy;
    const parts = record.split('$');
    const derived = await derive(password, Buffer.from(parts[5], 'hex'));
    return timingSafeEqual(derived, Buffer.from(parts[6], 'hex')) && record !== dummy;
}

export function safeAuthDestination(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f]/.test(value)) return '/dashboard';
    try {
        const url = new URL(value, 'http://auth.local');
        return url.origin === 'http://auth.local' ? url.pathname + url.search + url.hash : '/dashboard';
    } catch { return '/dashboard'; }
}

export function authAttemptLimit(request, email) {
    if (!email) {
        const result = limiter.hit(`auth-ip:${clientAddress(request.headers)}`, 30);
        return { allowed: result.allowed, headers: rateLimitHeaders(result) };
    }
    // Hash the email bucket key to avoid retaining raw email addresses in memory.
    const key = createHash('sha256').update(email || 'invalid').digest('hex');
    const accountResult = limiter.hit(`auth-account:${key}`, 10);
    return { allowed: accountResult.allowed, headers: rateLimitHeaders(accountResult) };
}
