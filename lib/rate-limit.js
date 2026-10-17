/**
 * Fixed-window rate limiter for the public read-only API (FR-4.2.2).
 *
 * Counters live in process memory, which suits the single-instance
 * deployment. Behind several instances each one enforces its own limit.
 */

export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function limitFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Requests allowed per window: guests share less than signed-in users. */
export function rateLimits() {
    return {
        guest: limitFromEnv('RATE_LIMIT_GUEST_PER_MINUTE', 60),
        user: limitFromEnv('RATE_LIMIT_USER_PER_MINUTE', 300),
    };
}

/**
 * Best-effort client address. Next.js no longer exposes the socket IP, so this
 * trusts the reverse proxy's forwarding headers; without one, all guests share
 * a single bucket.
 */
export function clientAddress(headers) {
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

export function createRateLimiter({ windowMs = RATE_LIMIT_WINDOW_MS, now = Date.now } = {}) {
    const windows = new Map();
    let nextSweep = 0;

    // Drop expired windows so one-off visitors do not accumulate in memory.
    function sweep(time) {
        if (time < nextSweep) return;
        for (const [key, entry] of windows) {
            if (entry.resetAt <= time) windows.delete(key);
        }
        nextSweep = time + windowMs;
    }

    return {
        /** Count one request against `key`; `allowed` is false once over `limit`. */
        hit(key, limit) {
            const time = now();
            sweep(time);
            let entry = windows.get(key);
            if (!entry || entry.resetAt <= time) {
                entry = { count: 0, resetAt: time + windowMs };
                windows.set(key, entry);
            }
            entry.count += 1;
            return {
                allowed: entry.count <= limit,
                limit,
                remaining: Math.max(0, limit - entry.count),
                resetAt: entry.resetAt,
                retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - time) / 1000)),
            };
        },
    };
}

/** Standard rate-limit response headers for a `hit` result. */
export function rateLimitHeaders(result) {
    const headers = {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    };
    if (!result.allowed) headers['Retry-After'] = String(result.retryAfterSeconds);
    return headers;
}
