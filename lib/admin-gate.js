import { SignJWT, jwtVerify } from 'jose';

/**
 * Extra conditions for admin access, on top of the admin role:
 *   1. ADMIN_IP_ALLOWLIST: the request must come from a listed address.
 *   2. ADMIN_ACCESS_CODE_HASH: the admin must also enter the access code, which unlocks
 *      admin pages for a short time (cookie bound to the account and the address).
 * Both are off when their variable is empty. If a variable is set but unusable, the gate
 * fails closed (nobody gets in) instead of switching itself off.
 *
 * Uses only `jose` and plain JavaScript so it runs in the proxy and in route handlers.
 */
export const ADMIN_UNLOCK_COOKIE = 'mtn_admin_unlock';
export const ADMIN_UNLOCK_SECONDS = 30 * 60;

const HEX_SHA256 = /^[a-f0-9]{64}$/;

function ipv4ToInt(text) {
    const parts = text.split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
        value = value * 256 + Number(part);
    }
    return value;
}

/** Turns the list text into rules: "direct", one IPv4, an IPv4 CIDR, or one IPv6 address. Bad entries are dropped. */
export function parseAdminIpAllowlist(value) {
    const rules = [];
    for (const raw of String(value ?? '').split(',')) {
        const item = raw.trim().toLowerCase();
        if (!item) continue;
        if (item === 'direct') { rules.push({ kind: 'direct' }); continue; }
        const [address, bitsText, extra] = item.split('/');
        if (extra !== undefined) continue;
        const ip = ipv4ToInt(address);
        if (ip !== null) {
            const bits = bitsText === undefined ? 32 : Number(bitsText);
            if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
            const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
            rules.push({ kind: 'v4', network: (ip & mask) >>> 0, mask });
        } else if (bitsText === undefined && /^[0-9a-f:]+$/.test(address) && address.includes(':')) {
            rules.push({ kind: 'v6', address });
        }
    }
    return rules;
}

export function adminGateConfig(env = process.env) {
    const listText = String(env.ADMIN_IP_ALLOWLIST ?? '').trim();
    const codeText = String(env.ADMIN_ACCESS_CODE_HASH ?? '').trim().toLowerCase();
    const ipEnabled = listText !== '';
    const codeEnabled = codeText !== '';
    return {
        ipEnabled,
        rules: ipEnabled ? parseAdminIpAllowlist(listText) : [],
        codeEnabled,
        codeHash: HEX_SHA256.test(codeText) ? codeText : null,
        enabled: ipEnabled || codeEnabled,
    };
}

function normalizeAddress(text) {
    let value = String(text ?? '').trim().toLowerCase();
    if (!value) return '';
    if (value.startsWith('[')) value = value.slice(1, value.indexOf(']') === -1 ? undefined : value.indexOf(']'));
    else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'));
    if (value.startsWith('::ffff:') && value.includes('.')) value = value.slice(7);
    return value;
}

/**
 * The address of the caller as the nearest proxy saw it: the LAST X-Forwarded-For entry
 * (a client can add entries before it, never after it). No header at all means a direct
 * connection, reported as "direct". This is only trustworthy while the app can be reached
 * through the proxy alone, so on the demo machine the app port is bound to 127.0.0.1.
 */
export function adminClientAddress(headers) {
    const forwarded = headers.get('x-forwarded-for');
    if (!forwarded) return 'direct';
    const last = forwarded.split(',').map(part => part.trim()).filter(Boolean).pop();
    return normalizeAddress(last) || 'unknown';
}

export function adminIpAllowed(address, rules) {
    if (address === 'direct') return rules.some(rule => rule.kind === 'direct');
    const ip = ipv4ToInt(address);
    return rules.some(rule => (rule.kind === 'v4' && ip !== null && ((ip & rule.mask) >>> 0) === rule.network)
        || (rule.kind === 'v6' && rule.address === address));
}

function secretKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    return new TextEncoder().encode(secret);
}

/** A short-lived token that says: this account entered the code from this address. */
export async function signAdminUnlock({ sub, address }) {
    return new SignJWT({ typ: 'admin_unlock', sub, ip: address })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${ADMIN_UNLOCK_SECONDS}s`)
        .sign(secretKey());
}

export async function verifyAdminUnlock(token, { sub, address }) {
    if (!token || !sub) return false;
    try {
        const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
        return payload.typ === 'admin_unlock' && payload.sub === sub && payload.ip === address;
    } catch {
        return false;
    }
}

/**
 * Decide whether an admin request may continue. `requireCode` is false for the unlock
 * endpoint and page themselves, which only need the address check.
 */
export async function checkAdminGate({ config, headers, session, unlockToken, requireCode = true }) {
    if (!config.enabled) return { ok: true };
    const address = adminClientAddress(headers);
    if (config.ipEnabled && !adminIpAllowed(address, config.rules)) {
        return { ok: false, status: 403, code: 'ADMIN_IP_NOT_ALLOWED', message: 'Admin access is not allowed from this address', address };
    }
    if (requireCode && config.codeEnabled && !(await verifyAdminUnlock(unlockToken, { sub: session?.sub, address }))) {
        return { ok: false, status: 403, code: 'ADMIN_CODE_REQUIRED', message: 'Enter the admin access code first', address };
    }
    return { ok: true, address };
}
