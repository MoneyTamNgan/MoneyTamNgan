#!/usr/bin/env node
// Disposable Atlas + local server + headless UI. Generator response is an explicit fixture; no Vertex/email/government calls.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ quiet: true });
const { randomBytes } = await import('node:crypto');
const { default: assert } = await import('node:assert/strict');
const { spawn } = await import('node:child_process');
const { mkdir, writeFile, readFile } = await import('node:fs/promises');
const { default: mongoose } = await import('mongoose');
const { default: puppeteer } = await import('puppeteer');
const { default: yauzl } = await import('yauzl');
const { connectMongoWithDnsFallback } = await import('../lib/mongo-network.js');
const { signSession } = await import('../lib/auth.js');
const { default: User } = await import('../models/User.js');
const { default: Project } = await import('../models/Project.js');
const { default: Summary } = await import('../models/DocumentSummary.js');
const { BidPrepDraft } = await import('../models/BidPrepDraft.js');
const { DELETE_COMPANY_DATA_CONFIRMATION } = await import('../lib/bid-prep/notices.js');
const database = `mtn_drafts_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
process.env.MONGODB_DB_NAME = database; process.env.JWT_SECRET = randomBytes(32).toString('hex');
const origin = 'http://localhost:3129', output = process.argv[2] || '/tmp/mtn-bid-draft-evidence';
const projectId = 'BIDPREP-E2E';
let server, browser, connected = false, stage = 'connect';
const evidence = { checked_at: new Date().toISOString(), fixtureOnly: true, generator: 'simulated at existing proposal API boundary; no Vertex call', checks: [], audit: [] };
function unzip(buffer) {
    return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
        if (error) return reject(error); const parts = {};
        zip.on('entry', entry => zip.openReadStream(entry, (err, stream) => {
            if (err) return reject(err); const chunks = [];
            stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject);
            stream.on('end', () => { parts[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
        })); zip.on('end', () => resolve(parts)); zip.on('error', reject); zip.readEntry();
    }));
}
try {
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI); connected = true; stage = 'fixtures';
    await Promise.all([User.init(), Project.init(), Summary.init(), BidPrepDraft.init()]);
    const a = await User.create({ email: 'owner-a@example.test', company_name: 'บริษัท ตัวอย่าง จำกัด', skills: ['React'], registered_capital: 1000000 });
    const b = await User.create({ email: 'owner-b@example.test', company_name: 'Other owner' });
    const summary = await Summary.create({ project_id: projectId, document_id: new mongoose.Types.ObjectId(), document_sha256: 'fixture', text_sha256: 'fixture', model: 'fixture', prompt_version: 'fixture',
        extraction: { qualifications: [{ value: 'มีประสบการณ์พัฒนาระบบสารสนเทศอย่างน้อยหนึ่งโครงการ', page: 9 }, { value: 'ทีมงานมีทักษะด้านการพัฒนาระบบและการทดสอบ', page: 10 }] } });
    await Project.create({ project_id: projectId, project_name: 'โครงการพัฒนาระบบสารสนเทศ', dept_name: 'หน่วยงานตัวอย่าง', budget: 1000000, latest_summary_id: summary._id });
    const tokenA = await signSession({ sub: String(a._id), role: 'user' }), tokenB = await signSession({ sub: String(b._id), role: 'user' });
    stage = 'server'; let ready = false, stderr = '';
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3129'], {
        env: { ...process.env, APP_ORIGIN: origin, CORS_ALLOWED_ORIGINS: origin, BID_PREP_MAX_DRAFTS: '5', BID_PREP_DRAFTS_PER_HOUR: '100', BID_PREP_READS_PER_MINUTE: '300', BID_PREP_WRITES_PER_MINUTE: '100' }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => { if (/Ready in/i.test(String(chunk))) ready = true; });
    server.stderr.on('data', chunk => { stderr += String(chunk); });
    for (let i = 0; i < 100 && !ready; i++) { if (server.exitCode !== null) throw new Error('server'); await new Promise(resolve => setTimeout(resolve, 200)); }
    assert.ok(ready);
    const call = (path, method = 'GET', body, token = tokenA) => fetch(origin + path, { method,
        headers: { Origin: origin, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.39', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const base = '/api/bid-prep/drafts';
    const content = { projectId, userId: String(b._id), title: 'ร่างข้อเสนอสำหรับการตรวจสอบ',
        sections: [{ heading: 'ความเข้าใจโครงการ', body: 'พัฒนาระบบสารสนเทศตามขอบเขต TOR\n[to fill in: team capacity]', sources: ['tor.page.9', 'profile.company_name'] }] };
    stage = 'quota';
    const parallel = await Promise.all(Array.from({ length: 8 }, () => call(base, 'POST', content)));
    assert.equal(parallel.filter(r => r.status === 201).length, 5); assert.equal(parallel.filter(r => r.status === 400).length, 3);
    assert.equal(await BidPrepDraft.countDocuments({ userId: String(a._id) }), 5);
    const ids = [];
    for (const r of parallel) if (r.status === 201) ids.push((await r.json()).id);
    const id = ids[0], item = `${base}/${id}`;
    for (const extra of ids.slice(1)) assert.equal((await call(`${base}/${extra}`, 'DELETE')).status, 200);
    evidence.checks.push('Atomic Atlas per-user quota: eight simultaneous creates yield exactly five drafts');
    stage = 'ownership';
    for (const [path, method, body] of [[item, 'GET'], [item, 'PATCH', { version: 1, title: 'stolen' }], [item, 'DELETE'], [item + '/export', 'POST']]) {
        assert.equal((await call(path, method, body, tokenB)).status, 404);
        assert.equal((await call(path, method, body, null)).status, 401);
    }
    assert.equal((await call(base, 'GET', undefined, null)).status, 401);
    assert.equal((await call(base, 'POST', content, null)).status, 401);
    assert.deepEqual((await (await call(base, 'GET', undefined, tokenB)).json()).drafts, []);
    assert.equal((await BidPrepDraft.findById(id)).userId, String(a._id));
    evidence.checks.push('HTTP BOLA: foreign read, update, delete and export are 404; every anonymous draft route is 401');
    stage = 'validation';
    assert.equal((await call(item, 'PATCH', { version: 1, sections: [{ body: 'x'.repeat(8001) }] })).status, 400);
    assert.equal((await call(item, 'PATCH', { version: 1, title: 'x'.repeat(128 * 1024) })).status, 413);
    const writers = await Promise.all([call(item, 'PATCH', { version: 1, title: 'ร่างข้อเสนอ รุ่นแก้ไข' }), call(item, 'PATCH', { version: 1, title: 'อีกหน้าต่าง' })]);
    assert.deepEqual(writers.map(r => r.status).sort(), [200, 409]);
    assert.equal((await call(item + '/export?version=999', 'POST')).status, 409);
    const empty = await (await call(base, 'POST', { projectId, title: 'Empty', sections: [] })).json();
    assert.equal((await call(`${base}/${empty.id}/export`, 'POST')).status, 400);
    assert.equal((await call(`${base}/${empty.id}`, 'DELETE')).status, 200);
    evidence.checks.push('HTTP content limits, stale export and empty draft errors; simultaneous saves yield one 200 and one 409');
    stage = 'http-docx';
    const directExport = await call(item + '/export', 'POST');
    assert.equal(directExport.status, 200);
    const directBytes = Buffer.from(await directExport.arrayBuffer());
    await mkdir(output, { recursive: true }); await writeFile(`${output}/direct-export.docx`, directBytes);
    await unzip(directBytes);
    stage = 'editor'; browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage();
    await browser.setCookie({ name: 'mtn_session', value: tokenA, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
    await page.goto(`${origin}/bid-prep/drafts/${id}`, { waitUntil: 'domcontentloaded' });
    stage = 'editor-initial-load';
    await page.waitForSelector('#section-body-0');
    await page.locator('#draft-title').fill('ร่างข้อเสนอระบบสารสนเทศ');
    await page.click('#add-draft-section');
    await page.type('#section-heading-1', 'แนวทางดำเนินงาน');
    await page.locator('#section-body-1').fill('ออกแบบ พัฒนา ทดสอบ และส่งมอบระบบตาม TOR\n[to fill in: delivery plan]');
    await page.type('#section-sources-1', 'tor.page.10');
    assert.equal(await page.$eval('#export-bid-draft', element => element.disabled), true);
    stage = 'editor-save';
    const save = page.waitForResponse(r => r.url().endsWith(item) && r.request().method() === 'PATCH');
    await page.click('#save-bid-draft'); assert.equal((await save).status(), 200);
    await page.waitForFunction(() => document.querySelector('#save-bid-draft')?.disabled && !document.querySelector('#export-bid-draft')?.disabled);
    stage = 'editor-reload';
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#section-body-1');
    assert.ok((await page.$eval('#section-body-1', element => element.value)).includes('delivery plan'));
    assert.ok(await page.$('mark'));
    await mkdir(output, { recursive: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/editor-desktop.png`, fullPage: true });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => document.querySelector('#draft-title').getBoundingClientRect().left >= document.querySelector('.app-sidebar').getBoundingClientRect().right));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/editor-mobile.png`, fullPage: true });
    evidence.checks.push('Headless editor add/edit/save/reload, visible sources/placeholders and mobile navigation separation pass');
    stage = 'export';
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output, eventsEnabled: true });
    const downloaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Download did not finish')), 30000);
        cdp.on('Browser.downloadProgress', event => {
            if (event.state === 'completed') { clearTimeout(timer); resolve(); }
            if (event.state === 'canceled') { clearTimeout(timer); reject(new Error('Download canceled')); }
        });
    });
    stage = 'export-confirmation';
    await page.locator('#export-bid-draft').click(); await page.waitForSelector('#confirm-bid-action');
    const exporting = page.waitForResponse(r => r.url().includes(`${item}/export?version=`));
    stage = 'export-request';
    await page.locator('#confirm-bid-action').click(); const exported = await exporting;
    assert.equal(exported.status(), 200);
    assert.match(exported.headers()['content-disposition'], /^attachment; filename="bid-draft-[A-Za-z0-9._-]+\.docx"$/);
    stage = 'export-read-body';
    await downloaded;
    const file = await readFile(`${output}/bid-draft-${projectId}.docx`); assert.ok(file.length < 2 * 1024 * 1024);
    await mkdir(output, { recursive: true });
    stage = 'export-unzip';
    const parts = await unzip(file), xml = parts['word/document.xml'];
    for (const text of ['มีประสบการณ์พัฒนาระบบ', 'manual', 'tor.page.10', '[to fill in:', 'does not submit a bid to e-GP']) assert.ok(xml.includes(text));
    assert.ok(xml.includes('<w:tbl>')); assert.ok(xml.includes('w:highlight'));
    assert.ok(!Object.keys(parts).some(name => /vba|macro|html/i.test(name)));
    await writeFile(`${output}/sample.docx`, file);
    evidence.checks.push('Browser confirmation downloads a valid DOCX containing Thai checklist, reasoning, pages, draft sources and highlighted placeholders');
    stage = 'generator-import';
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (!request.url().includes('/proposal-draft')) return request.continue();
        const body = request.method() === 'POST' ? { jobId: 'a'.repeat(24), status: 'accepted' } : {
            status: 'completed', draft: { company_overview: [{ text: 'บริษัท ตัวอย่าง จำกัด', sources: [{ kind: 'profile_field', field: 'company_name' }] }],
                project_understanding: [{ text: 'พัฒนาระบบตาม TOR', sources: [{ kind: 'tor_page', page: 9 }] }], scope_responses: [], past_projects: [] } };
        return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${origin}/bid-prep?projectId=${projectId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#generate-ai-bid-draft:not([disabled])');
    await page.click('#generate-ai-bid-draft');
    await page.waitForFunction(() => location.pathname.includes('/bid-prep/drafts/'));
    await page.waitForSelector('#section-body-1');
    assert.equal(await page.$eval('#section-body-0', element => element.value), 'บริษัท ตัวอย่าง จำกัด');
    evidence.checks.push('Generator output fixture imports through the existing job API shape into real owned draft storage with sources retained');
    stage = 'delete-all';
    assert.equal((await call(base, 'POST', { ...content, title: 'Other owner' }, tokenB)).status, 201);
    assert.equal((await call('/api/bid-prep/data', 'DELETE', { confirm: DELETE_COMPANY_DATA_CONFIRMATION })).status, 200);
    assert.equal(await BidPrepDraft.countDocuments({ userId: String(a._id) }), 0);
    assert.equal(await BidPrepDraft.countDocuments({ userId: String(b._id) }), 1);
    evidence.checks.push('FR-4.7 delete-all removes owner drafts and preserves another user’s draft');
    evidence.audit = stderr.split('\n').flatMap(line => { try { const row = JSON.parse(line); return row.event === 'bid_prep_draft_exported' ? [{ ...row, userId: '[fixture-owner]', draftId: '[fixture-draft]' }] : []; } catch { return []; } });
    assert.ok(evidence.audit.length); assert.ok(!JSON.stringify(evidence.audit).includes('delivery plan'));
    evidence.checks.push('Export audit includes owner, timestamp and IP without draft content');
    await writeFile(`${output}/http.json`, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ passed: true, checks: evidence.checks, output }, null, 2));
} catch (error) {
    console.error(`Draft fixture failed at ${stage}; type=${error?.name || 'unknown'}. No credentials logged.`);
    if (stage.startsWith('export')) console.error(String(error?.message || '').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]').slice(0, 300));
    if (browser) {
        const pages = await browser.pages(); const page = pages[pages.length - 1];
        await mkdir(output, { recursive: true });
        await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
        console.error(JSON.stringify(await page.evaluate(() => ({ path: location.pathname, errors: [...document.querySelectorAll('[role=alert]')].map(e => e.textContent), sections: document.querySelectorAll('.bid-editor-section').length, saveDisabled: document.querySelector('#save-bid-draft')?.disabled })).catch(() => ({}))));
    }
    process.exitCode = 1;
}
finally {
    if (browser) {
        let timer;
        await Promise.race([browser.close().catch(() => {}), new Promise(resolve => {
            timer = setTimeout(() => { browser.process()?.kill('SIGKILL'); resolve(); }, 3000);
        })]); clearTimeout(timer);
    }
    if (server && server.exitCode === null && server.signalCode === null) {
        const stopped = new Promise(resolve => server.once('exit', resolve));
        server.kill('SIGTERM');
        const forceStop = setTimeout(() => server.kill('SIGKILL'), 3000);
        await stopped; clearTimeout(forceStop);
    }
    if (connected) await mongoose.connection.dropDatabase().catch(() => { process.exitCode = 1; });
    await mongoose.disconnect();
}
