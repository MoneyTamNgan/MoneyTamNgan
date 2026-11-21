import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { proxy } from '@/proxy';
import { setAccountLookup, sessionAccountActive, clearRevokedSessions } from '@/lib/account-status';
import { POST as logout } from '@/app/api/auth/logout/route';

// ASVS V7.4.2 (#191): a valid, unexpired JWT stops working once its account is disabled or deleted.
const SUB = '64b7f0f0f0f0f0f0f0f0f0f0';
let ip = 0;
const request = (path, { token, bearer, headers = {} } = {}) => new NextRequest(`http://localhost:3000${path}`, {
    headers: { 'x-forwarded-for': `203.0.113.${++ip}`, ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers },
});
const token = (sub = SUB) => signSession({ sub, role: 'user' });

afterEach(() => {
    setAccountLookup();
    clearRevokedSessions();
});

describe('session invalidation for disabled accounts', () => {
    it('lets an active account through and looks it up by its id', async () => {
        const lookup = vi.fn(async () => ({ exists: true, disabled: false }));
        setAccountLookup(lookup);
        const response = await proxy(request('/api/auth/me', { token: await token() }));
        expect(response.status).toBe(200);
        expect(lookup).toHaveBeenCalledWith(SUB);
    });

    it('rejects a still-valid token after the account is disabled, and clears the cookie', async () => {
        const jwt = await token();
        let disabled = false;
        setAccountLookup(async () => ({ exists: true, disabled }));
        expect((await proxy(request('/api/auth/me', { token: jwt }))).status).toBe(200);
        disabled = true;
        const response = await proxy(request('/api/auth/me', { token: jwt }));
        expect(response.status).toBe(401);
        expect((await response.json()).error.code).toBe('UNAUTHORIZED');
        const cleared = response.headers.get('set-cookie');
        expect(cleared).toContain(`${SESSION_COOKIE}=;`);
        expect(cleared.toLowerCase()).toContain('max-age=0');
    });

    it('rejects a token whose account was deleted', async () => {
        setAccountLookup(async () => ({ exists: false, disabled: false }));
        expect((await proxy(request('/api/auth/me', { token: await token() }))).status).toBe(401);
    });

    it('fails closed when the account lookup errors', async () => {
        setAccountLookup(async () => { throw new Error('database down'); });
        expect((await proxy(request('/api/auth/me', { token: await token() }))).status).toBe(401);
    });

    it('also applies to bearer tokens', async () => {
        setAccountLookup(async () => ({ exists: true, disabled: true }));
        expect((await proxy(request('/api/auth/me', { bearer: await token() }))).status).toBe(401);
    });

    it('sends a disabled user to the sign-in page and clears the cookie on protected pages', async () => {
        setAccountLookup(async () => ({ exists: true, disabled: true }));
        const response = await proxy(request('/profile', { token: await token() }));
        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toBe('http://localhost:3000/?next=%2Fprofile');
        expect(response.headers.get('set-cookie').toLowerCase()).toContain('max-age=0');
    });

    it('serves a disabled user as a guest on public routes instead of failing them', async () => {
        setAccountLookup(async () => ({ exists: true, disabled: true }));
        const response = await proxy(request('/api/tors', { token: await token() }));
        expect(response.status).toBe(200);
        expect(response.headers.get('x-ratelimit-limit')).toBe('60'); // guest budget, not the signed-in 300
    });

    it('does not look anything up for guests or for non-ObjectId subjects', async () => {
        const lookup = vi.fn(async () => ({ exists: false }));
        setAccountLookup(lookup);
        expect((await proxy(request('/api/tors'))).status).toBe(200);
        expect(await sessionAccountActive({ sub: 'user-1' })).toBe(true);
        expect(lookup).not.toHaveBeenCalled();
    });

    it('revokes a copied JWT immediately when POST /api/auth/logout is called (ASVS V7.4.1)', async () => {
        setAccountLookup(async () => ({ exists: true, disabled: false, sessionVersion: 0 }));
        const jwt = await token();
        expect((await proxy(request('/api/auth/me', { bearer: jwt }))).status).toBe(200);

        const logoutResponse = await logout(new NextRequest('http://localhost:3000/api/auth/logout', {
            method: 'POST',
            headers: {
                origin: 'http://localhost:3000',
                authorization: `Bearer ${jwt}`,
            },
        }));
        expect(logoutResponse.status).toBe(200);
        expect(logoutResponse.headers.get('set-cookie')?.toLowerCase()).toContain('max-age=0');

        // Replaying the copied bearer token or cookie after logout must fail with 401.
        const replayBearer = await proxy(request('/api/auth/me', { bearer: jwt }));
        expect(replayBearer.status).toBe(401);
        const replayCookie = await proxy(request('/api/auth/me', { token: jwt }));
        expect(replayCookie.status).toBe(401);
    });

    it('rejects a token whose sv claim no longer matches the user sessionVersion', async () => {
        const jwt = await signSession({ sub: SUB, role: 'user', sv: 1 });
        setAccountLookup(async () => ({ exists: true, disabled: false, sessionVersion: 1 }));
        expect((await proxy(request('/api/auth/me', { bearer: jwt }))).status).toBe(200);

        setAccountLookup(async () => ({ exists: true, disabled: false, sessionVersion: 2 }));
        expect((await proxy(request('/api/auth/me', { bearer: jwt }))).status).toBe(401);
    });
});
