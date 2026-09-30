import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from '@/lib/auth';

describe('signSession / verifySession', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = 'ci-test-secret';
    });

    it('round-trips a payload through sign and verify', async () => {
        const token = await signSession({ sub: 'user-1', email: 'a@example.com', role: 'user' });
        const payload = await verifySession(token);
        expect(payload).toMatchObject({ sub: 'user-1', email: 'a@example.com', role: 'user' });
    });

    it('returns null for a missing token', async () => {
        expect(await verifySession(undefined)).toBeNull();
        expect(await verifySession('')).toBeNull();
    });

    it('returns null for a malformed/invalid token', async () => {
        expect(await verifySession('not-a-jwt')).toBeNull();
    });

    it('rejects a token signed with a different secret', async () => {
        const token = await signSession({ sub: 'user-1' });
        process.env.JWT_SECRET = 'a-different-secret';
        expect(await verifySession(token)).toBeNull();
    });
});

describe('sessionCookieOptions', () => {
    it('uses the exported cookie name and sane defaults', () => {
        expect(SESSION_COOKIE).toBe('mtn_session');
        const options = sessionCookieOptions();
        expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
        expect(options.maxAge).toBeGreaterThan(0);
    });
});
