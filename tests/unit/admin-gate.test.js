import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
    adminClientAddress, adminGateConfig, adminIpAllowed, checkAdminGate,
    parseAdminIpAllowlist, signAdminUnlock, verifyAdminUnlock,
} from '../../lib/admin-gate.js';

before(() => { process.env.JWT_SECRET = 'test-secret-for-admin-gate-0123456789'; });
const headers = value => new Headers(value ? { 'x-forwarded-for': value } : {});
const HASH = 'a'.repeat(64);

describe('allowlist parsing and matching', () => {
    const rules = parseAdminIpAllowlist('100.111.247.50, 100.86.134.8 ,10.0.0.0/24, direct, bogus, 300.1.1.1, 1.2.3.4/40, fd7a:115c:a1e0::4629:8609');
    test('keeps good entries and drops bad ones', () => assert.equal(rules.length, 5));
    test('matches an exact address and a CIDR range', () => {
        assert.equal(adminIpAllowed('100.111.247.50', rules), true);
        assert.equal(adminIpAllowed('10.0.0.77', rules), true);
        assert.equal(adminIpAllowed('10.0.1.1', rules), false);
        assert.equal(adminIpAllowed('100.111.247.51', rules), false);
    });
    test('matches an IPv6 address exactly and the direct marker only for direct connections', () => {
        assert.equal(adminIpAllowed('fd7a:115c:a1e0::4629:8609', rules), true);
        assert.equal(adminIpAllowed('direct', rules), true);
        assert.equal(adminIpAllowed('direct', parseAdminIpAllowlist('1.2.3.4')), false);
    });
});

describe('client address', () => {
    test('uses the last forwarded entry, so a client cannot choose it', () => {
        assert.equal(adminClientAddress(headers('9.9.9.9, 100.111.247.50')), '100.111.247.50');
    });
    test('handles ports and IPv4-mapped IPv6, and reports direct without a header', () => {
        assert.equal(adminClientAddress(headers('1.2.3.4:5555')), '1.2.3.4');
        assert.equal(adminClientAddress(headers('::ffff:1.2.3.4')), '1.2.3.4');
        assert.equal(adminClientAddress(headers(null)), 'direct');
    });
});

describe('gate configuration', () => {
    test('is off when both variables are empty', () => assert.equal(adminGateConfig({}).enabled, false));
    test('an allowlist with no usable entry denies everyone', async () => {
        const config = adminGateConfig({ ADMIN_IP_ALLOWLIST: 'nonsense' });
        assert.equal(config.enabled, true);
        const gate = await checkAdminGate({ config, headers: headers('1.2.3.4'), session: { sub: 'u1' }, requireCode: false });
        assert.equal(gate.ok, false);
    });
    test('a malformed code hash is treated as configured but unusable', () => {
        const config = adminGateConfig({ ADMIN_ACCESS_CODE_HASH: 'not-hex' });
        assert.equal(config.codeEnabled, true);
        assert.equal(config.codeHash, null);
    });
});

describe('checkAdminGate', () => {
    const config = adminGateConfig({ ADMIN_IP_ALLOWLIST: '100.111.247.50', ADMIN_ACCESS_CODE_HASH: HASH });
    const session = { sub: 'user-1' };

    test('refuses an address that is not listed, before asking for the code', async () => {
        const gate = await checkAdminGate({ config, headers: headers('8.8.8.8'), session });
        assert.deepEqual([gate.ok, gate.code], [false, 'ADMIN_IP_NOT_ALLOWED']);
    });
    test('asks for the code from a listed address', async () => {
        const gate = await checkAdminGate({ config, headers: headers('100.111.247.50'), session });
        assert.deepEqual([gate.ok, gate.code], [false, 'ADMIN_CODE_REQUIRED']);
    });
    test('the unlock endpoint itself only needs the address check', async () => {
        const gate = await checkAdminGate({ config, headers: headers('100.111.247.50'), session, requireCode: false });
        assert.equal(gate.ok, true);
    });
    test('a valid unlock token for this account and address lets the request through', async () => {
        const token = await signAdminUnlock({ sub: 'user-1', address: '100.111.247.50' });
        const gate = await checkAdminGate({ config, headers: headers('100.111.247.50'), session, unlockToken: token });
        assert.equal(gate.ok, true);
    });
    test('a token does not work for another account or another address', async () => {
        const token = await signAdminUnlock({ sub: 'user-1', address: '100.111.247.50' });
        assert.equal(await verifyAdminUnlock(token, { sub: 'user-2', address: '100.111.247.50' }), false);
        assert.equal(await verifyAdminUnlock(token, { sub: 'user-1', address: '100.86.134.8' }), false);
    });
    test('a tampered or empty token is refused', async () => {
        const token = await signAdminUnlock({ sub: 'user-1', address: '100.111.247.50' });
        assert.equal(await verifyAdminUnlock(token.slice(0, -2) + 'xx', { sub: 'user-1', address: '100.111.247.50' }), false);
        assert.equal(await verifyAdminUnlock('', { sub: 'user-1', address: '100.111.247.50' }), false);
    });
    test('does nothing when the gate is off', async () => {
        const gate = await checkAdminGate({ config: adminGateConfig({}), headers: headers('8.8.8.8'), session });
        assert.equal(gate.ok, true);
    });
});
