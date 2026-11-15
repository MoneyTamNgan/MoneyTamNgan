#!/usr/bin/env node
// Real Atlas + running Next.js + headless UI in a disposable database only.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ quiet: true });
const { randomBytes } = await import('node:crypto');
const { default: assert } = await import('node:assert/strict');
const { spawn } = await import('node:child_process');
const { mkdir, writeFile } = await import('node:fs/promises');
const { default: mongoose } = await import('mongoose');
const { default: puppeteer } = await import('puppeteer');
const { connectMongoWithDnsFallback } = await import('../lib/mongo-network.js');
const { signSession } = await import('../lib/auth.js');
const { default: User } = await import('../models/User.js');
const { DELETE_COMPANY_DATA_CONFIRMATION } = await import('../lib/bid-prep/notices.js');
const database = `mtn_profile_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
process.env.MONGODB_DB_NAME = database;
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const origin = 'http://localhost:3128';
const output = process.argv[2] || '/tmp/mtn-company-profile-evidence';
const evidence = { checked_at: new Date().toISOString(), checks: [], responses: {}, fixtureOnly: true };
let server, browser, connected = false, stage = 'connect';
try {
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI); connected = true;
    stage = 'fixtures'; await User.init();
    const a = await User.create({ email: 'owner-a@example.test', googleId: 'fixture-google', passwordHash: 'fixture-hidden', company_name: 'บริษัท ตัวอย่าง จำกัด' });
    const b = await User.create({ email: 'owner-b@example.test', company_name: 'Other owner private company' });
    const token = await signSession({ sub: String(a._id), role: 'user' });
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3128'], {
        env: { ...process.env, APP_ORIGIN: origin, CORS_ALLOWED_ORIGINS: origin, BID_PREP_PROFILE_PER_MINUTE: '200' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    stage = 'server'; let ready = false;
    server.stdout.on('data', chunk => { if (/Ready in/i.test(String(chunk))) ready = true; });
    server.stderr.on('data', () => {});
    for (let i = 0; i < 100 && !ready; i++) {
        if (server.exitCode !== null) throw new Error('Server exited');
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready);
    const headers = { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' };
    const call = async (method, body, path = '/api/profiles') => fetch(origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    stage = 'http';
    assert.equal((await fetch(origin + '/api/profiles')).status, 401);
    assert.equal((await fetch(origin + '/api/profiles', { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const legacy = await (await call('GET')).json(); assert.equal(legacy.data.address, ''); assert.deepEqual(legacy.data.past_projects, []);
    const body = { registration_number: ' 0105555555555 ', address: ' 99 ถนนตัวอย่าง กรุงเทพฯ ', authorized_signatory: ' ผู้ลงนามตัวอย่าง ',
        past_projects: [{ name: 'ระบบคลังข้อมูล', client: 'หน่วยงานตัวอย่าง', value: 1500000, year: 2568 },
            { name: 'ระบบบริการออนไลน์', client: 'หน่วยงานตัวอย่าง 2', value: 2500000, year: 2569 }],
        userId: String(b._id), role: 'admin', passwordHash: 'attempt' };
    assert.equal((await call('PUT', body)).status, 200);
    const loaded = await (await call('GET', undefined, `/api/profiles?userId=${b._id}`)).json();
    assert.equal(loaded.data.registration_number, '0105555555555'); assert.equal(loaded.data.past_projects.length, 2);
    assert.ok(!JSON.stringify(loaded).includes('fixture-hidden')); assert.ok(!('googleId' in loaded.data));
    assert.equal((await User.findById(b._id)).company_name, 'Other owner private company');
    assert.equal((await User.findById(a._id)).role, 'user');
    assert.equal((await User.findById(a._id).select('+passwordHash')).passwordHash, 'fixture-hidden');
    evidence.responses.profile = { ...loaded.data, _id: '[fixture-owner]', updatedAt: '[timestamp]' };
    const bad = await call('PUT', { past_projects: [{ ...body.past_projects[0], value: -1 }] }); assert.equal(bad.status, 400);
    evidence.responses.invalid = await bad.json();
    evidence.checks.push('Real HTTP 401, legacy defaults, PUT/GET persistence, trim, protected fields and cross-user isolation');
    stage = 'browser'; browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await browser.setCookie({ name: 'mtn_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
    await page.goto(origin + '/profile', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.getElementById('registration_number')?.value === '0105555555555');
    await page.click('button[aria-label="ลบผลงานที่ 1"]');
    await page.click('#add-past-project');
    for (const [field, value] of Object.entries({ name: 'โครงการที่เพิ่มผ่านฟอร์ม', client: 'ลูกค้าตัวอย่าง', value: '3000000', year: '2569' })) {
        await page.type(`[id="past_projects.1.${field}"]`, value);
    }
    const saved = page.waitForResponse(r => r.url().endsWith('/api/profiles') && r.request().method() === 'PATCH');
    await page.click('#save-company-profile'); assert.equal((await saved).status(), 200);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[id="past_projects.1.name"]')?.value === 'โครงการที่เพิ่มผ่านฟอร์ม');
    const persisted = await User.findById(a._id).lean(); assert.equal(persisted.past_projects[0].name, 'ระบบบริการออนไลน์');
    assert.equal(persisted.past_projects[1].value, 3000000);
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: `${output}/company-profile-desktop.png`, fullPage: true });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => document.getElementById('registration_number').getBoundingClientRect().left >= document.querySelector('.app-sidebar').getBoundingClientRect().right));
    await page.screenshot({ path: `${output}/company-profile-mobile.png`, fullPage: true });
    evidence.checks.push('Headless form add/remove/save/reload round trip against Atlas; mobile 390px has no horizontal overflow');
    stage = 'company-clear';
    const cleared = await call('DELETE', { confirm: DELETE_COMPANY_DATA_CONFIRMATION }, '/api/bid-prep/data'); assert.equal(cleared.status, 200);
    const after = await (await call('GET')).json(); assert.equal(after.data.registration_number, ''); assert.equal(after.data.address, '');
    assert.equal(after.data.authorized_signatory, ''); assert.deepEqual(after.data.past_projects, []);
    assert.equal((await User.findById(b._id)).company_name, 'Other owner private company');
    evidence.checks.push('Existing FR-4.7 company deletion clears all bid fields and retains the other user');
    await writeFile(`${output}/company-profile-http.json`, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ passed: true, checks: evidence.checks, output }, null, 2));
} catch (error) {
    console.error(`Company profile fixture failed at ${stage}; type=${error?.name || 'unknown'}. No credentials logged.`);
    process.exitCode = 1;
} finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await stopped; }
    if (connected) await mongoose.connection.dropDatabase().catch(() => { process.exitCode = 1; });
    await mongoose.disconnect();
}
