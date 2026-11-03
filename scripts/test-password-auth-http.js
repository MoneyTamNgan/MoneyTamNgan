import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { User } from '../models/User.js';
import { verifyPassword } from '../lib/password-auth.js';

// Own test database + own server only; never use the live application's DB.
const database = `mtn_auth_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const origin = 'http://localhost:3118';
process.env.MONGODB_DB_NAME = database;
const password = `Local test ${randomBytes(18).toString('hex')}`;
let server;
let connected = false;
try {
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    connected = true;
    await User.init(); // Wait for the real unique email index before testing races.
    const secret = randomBytes(32).toString('hex');
    let serverReady = false;
    let launchError;
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3118'], {
        env: { ...process.env, APP_ORIGIN: origin, CORS_ALLOWED_ORIGINS: origin,
            JWT_SECRET: secret, PIPELINE_ADMIN_TOKEN: '', CRON_SECRET: '', MONGODB_DB_NAME: database },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.on('error', error => { launchError = error; });
    server.stdout.on('data', chunk => { if (/Ready in/i.test(String(chunk))) serverReady = true; });
    server.stderr.on('data', () => {});
    let ready = false;
    for (let i = 0; i < 60; i++) {
        if (launchError || server.exitCode !== null) throw new Error('Test server could not start (port 3118 may be occupied)');
        // Never send fixture writes to a pre-existing process on this port.
        // Wait for our own child's bind/readiness announcement first.
        if (serverReady) {
            try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Test server started');
    const post = (path, body, cookie, requestOrigin = origin) => fetch(origin + path, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const details = { email: 'auth.fixture@example.com', password, role: 'admin' };
    const registration = await post('/api/auth/register', details);
    assert.equal(registration.status, 201, 'Registration succeeds');
    const result = await registration.json();
    assert.equal(result.user.role, 'user');
    assert.equal(result.redirectTo, '/dashboard');
    assert.ok(!JSON.stringify(result).includes('password'));
    let cookie = registration.headers.get('set-cookie').split(';')[0];
    const stored = await mongoose.connection.db.collection('users').findOne({ email: details.email });
    assert.equal(stored.password, undefined);
    assert.ok(stored.passwordHash.startsWith('scrypt$v1$'));
    assert.ok(!JSON.stringify(stored).includes(password));
    assert.equal(await verifyPassword(password, stored.passwordHash), true);
    assert.equal((await User.findOne({ email: details.email }).lean()).passwordHash, undefined);
    assert.equal((await post('/api/auth/register', details)).status, 409);
    assert.equal((await post('/api/auth/login', { ...details, password: 'A wrong long test passphrase!' })).status, 401);
    const login = await post('/api/auth/login', { ...details, email: details.email.toUpperCase(), next: '//evil.example' });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).redirectTo, '/dashboard');
    cookie = login.headers.get('set-cookie').split(';')[0];
    const me = await fetch(origin + '/api/auth/me', { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, result.user.id);
    assert.equal(await User.countDocuments({ email: details.email }), 1);
    assert.equal((await fetch(origin + '/api/profiles', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await post('/api/admin/pipeline/trigger', {}, cookie)).status, 403);
    assert.equal((await post('/api/auth/login', details, undefined, 'https://evil.example')).status, 403);
    const google = await fetch(origin + '/api/auth/google/login', { redirect: 'manual' });
    assert.equal(google.status, 307);
    assert.equal(new URL(google.headers.get('location')).hostname, 'accounts.google.com');
    const logout = await post('/api/auth/logout', {}, cookie);
    assert.equal(logout.status, 200);
    assert.ok(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(logout.headers.get('set-cookie')));
    assert.equal((await fetch(origin + '/api/auth/me')).status, 401);
    console.log(JSON.stringify({ status: 'passed', database, checks: ['register', 'real salted hash persisted',
        'hash hidden from normal queries', 'duplicate prevention', 'wrong password', 'normalized login',
        'shared session and profile access', 'admin denied', 'CORS', 'Google redirect preserved', 'logout'] }, null, 2));
} catch (error) {
    console.error(`Auth HTTP test failed: ${error.name}: ${error.message}`);
    process.exitCode = 1;
} finally {
    if (server && server.exitCode === null) {
        const exited = once(server, 'exit'); server.kill('SIGTERM');
        await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
        if (server.exitCode === null) server.kill('SIGKILL');
    }
    if (connected && /^mtn_auth_test_\d+_[a-f0-9]{8}$/.test(database) && mongoose.connection.name === database) {
        await mongoose.connection.db.dropDatabase();
        console.log('Removed only the isolated auth fixture database.');
    }
    await mongoose.disconnect();
}
