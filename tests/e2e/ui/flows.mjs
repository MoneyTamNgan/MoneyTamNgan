// UI flows recorded on video. Run on the machine, see docs/testing/test-plan.md section 8.
// Every step checks something observable that would be different if the feature were broken.
import fs from 'node:fs';
import { BASE, TOR, launch, runFlow, expect, newUser, apiLogin } from './lib.mjs';

const results = [];
const browser = await launch();
const TOR2 = process.env.TOR2_ID || '69109232352';    // small checklist (11 items) keeps the videos short
const TOR_AI = process.env.TOR_AI_ID || '66089621504'; // large scope (47 items)
const nav = u => new URL(u).pathname;
// rows of the admin review queue, without the loading / empty-state row
let realRows = () => null;

async function uiLogin(page, identifier, password) {
  await page.goto(BASE + '/');
  await page.locator('#identifier').fill(identifier);
  await page.locator('#password').fill(password);
  await page.locator('button.sign-in').click();
}
async function signOut(page) {
  await page.getByRole('button', { name: /ออกจากระบบ/ }).first().click();
  await page.waitForURL(u => nav(u) === '/', { timeout: 10000 });
}
/** Waits for the sign-in notice to contain `rx` and returns its text (an old notice must not satisfy a later step). */
async function noticeMatching(page, rx, timeout = 8000) {
  const n = page.locator('.notice[role=alert]');
  await page.waitForFunction(r => { const e = document.querySelector('.notice[role=alert]'); return e && new RegExp(r).test(e.innerText); }, rx.source, { timeout });
  return (await n.innerText()).slice(0, 90);
}
const apiJson = (page, path) => page.evaluate(async p => (await (await fetch(p, { cache: 'no-store' })).json()), path);
/** Polls `cond` until it is truthy or `ms` passes (pages load data asynchronously); returns the last value. */
async function until(cond, ms = 10000) { const t0 = Date.now(); for (;;) { const v = await cond(); if (v || Date.now() - t0 > ms) return v; await new Promise(r => setTimeout(r, 300)); } }
async function counter(page, label) {
  const t = await page.locator(`xpath=//*[normalize-space(text())='${label}']/..`).first().innerText();
  return Number((t.match(/\d+/) || [NaN])[0]);
}

// ---------------------------------------------------------------- F01 guest browsing
await runFlow(browser, {
  id: 'F01-guest-browse', title: 'Guest browses TORs, searches, filters, pages, opens detail and analytics (no login)',
  async run(f) {
    const { page } = f;
    await f.step('01', 'Open the dashboard as a guest', 'Heading "ค้นหาโครงการจากหน่วยงานภาครัฐ" and at least one TOR card are visible', async () => {
      await page.goto(BASE + '/dashboard'); await page.getByText('ค้นหาโครงการจากหน่วยงานภาครัฐ').first().waitFor({ timeout: 15000 });
      await page.locator('a.feed-card').first().waitFor({ timeout: 15000 });
    });
    await f.step('02', 'Click the second hero slide indicator', 'The slide indicator state changes (markup of the indicators differs before and after)', async () => {
      const ind = page.getByRole('button', { name: /แสดงสไลด์/ });
      const snap = () => ind.evaluateAll(els => els.map(e => `${e.className}|${e.getAttribute('aria-pressed')}|${e.getAttribute('aria-current')}`).join(';'));
      const before = await snap(); await page.getByRole('button', { name: 'แสดงสไลด์ 2' }).click(); await page.waitForTimeout(600);
      expect(before !== (await snap()), 'indicator state did not change'); return 'indicator state changed';
    });
    await f.step('03', 'Type a keyword in the search box', 'After the 300 ms debounce the list is requested with q= (HTTP 200) and the URL carries q=', async () => {
      const wait = page.waitForResponse(r => r.url().includes('/api/tors?') && r.url().includes('q=') && r.request().method() === 'GET', { timeout: 15000 });
      await page.getByLabel('ค้นหา TOR').fill('ระบบ'); const r = await wait;
      expect(r.status() === 200, `status ${r.status()}`); await page.waitForFunction(() => location.search.includes('q='), null, { timeout: 5000 });
      return `${decodeURIComponent(r.url().split('/api')[1]).slice(0, 60)} -> 200`;
    });
    await f.step('04', 'Go to the next page of results', 'The URL shows page=2 and the first card is a different project than on page 1', async () => {
      const before = await page.locator('a.feed-card').first().getAttribute('href');
      await page.getByRole('button', { name: /ถัดไป/ }).first().click();
      await page.waitForFunction(() => location.search.includes('page=2'), null, { timeout: 8000 });
      let after = before; await until(async () => { after = await page.locator('a.feed-card').first().getAttribute('href'); return after !== before; }, 12000);
      expect(after !== before, `same first card ${after} 12 s after going to page 2`); return `${before} -> ${after}`;
    });
    await f.step('05', 'Use the filters: software toggle, agency, bidding status, minimum budget, sort', 'Software, agency, status and budget each change the URL; sorting by highest budget re-orders the list (sorting is applied on the page, not in the URL)', async () => {
      await page.goto(BASE + '/dashboard'); await page.locator('a.feed-card').first().waitFor({ timeout: 15000 });
      const bar = page.locator('section[aria-label="ตัวกรอง TOR"]'); const seen = [];
      await bar.locator('button.software-filter').click(); await page.waitForFunction(() => location.search.includes('software=0'), null, { timeout: 8000 }); seen.push('software=0');
      await bar.locator('button.software-filter').click(); await page.waitForTimeout(800);
      const sels = bar.locator('select');
      expect(await until(async () => (await sels.nth(0).locator('option').count()) > 1, 15000), 'agency filter has no options (facets did not load)');
      await sels.nth(0).selectOption({ index: 1 }); await page.waitForFunction(() => location.search.includes('agency='), null, { timeout: 8000 }); seen.push('agency'); await sels.nth(0).selectOption({ index: 0 });
      expect((await sels.nth(1).locator('option').count()) > 1, 'status filter has no options');
      await sels.nth(1).selectOption({ index: 1 }); await page.waitForFunction(() => location.search.includes('status='), null, { timeout: 8000 }); seen.push('status'); await sels.nth(1).selectOption({ index: 0 });
      await bar.getByLabel('งบประมาณต่ำสุด (บาท)').fill('1000000'); await page.waitForFunction(() => location.search.includes('budgetMin=1000000'), null, { timeout: 8000 }); seen.push('budgetMin');
      await page.locator('a.feed-card').first().waitFor({ timeout: 15000 });
      const ids = () => page.locator('a.feed-card').evaluateAll(a => a.map(x => x.getAttribute('href')).join(','));
      await sels.nth(2).selectOption('newest'); await page.waitForTimeout(800); const newest = await ids();
      await sels.nth(2).selectOption('budget-high'); await page.waitForTimeout(800); const high = await ids();
      expect(newest !== high, 'sorting by highest budget did not change the order'); seen.push('sort re-ordered');
      expect((await page.locator('a.feed-card').count()) > 0, 'no TOR cards after filtering'); return seen.join(', ');
    });
    await f.step('06', 'Click the first TOR card as a guest', 'Clicking a card as a guest goes to the sign-in page with ?next=/tors/<id>', async () => {
      await page.goto(BASE + '/dashboard'); await page.locator('a.feed-card').first().click();
      await page.waitForURL(u => nav(u) === '/' && new URL(u).searchParams.get('next')?.startsWith('/tors/'), { timeout: 10000 });
      return `url ${new URL(page.url()).search}`;
    });
    await f.step('07', 'Open a TOR detail page directly as a guest', 'URL is /tors/<id>; the TOR overview is shown with the notice "เข้าสู่ระบบเพื่อดูรายละเอียดโครงการฉบับเต็ม"; the comparison card with the company profile ("มูลค่าผลงานขั้นต่ำตาม TOR") is not shown to a guest', async () => {
      await page.goto(`${BASE}/tors/${TOR}`); expect(nav(page.url()) === `/tors/${TOR}`, `url ${page.url()}`);
      await page.getByText('ภาพรวมโครงการ').first().waitFor({ timeout: 10000 });
      await page.getByText('เข้าสู่ระบบเพื่อดูรายละเอียดโครงการฉบับเต็ม').first().waitFor({ timeout: 10000 });
      expect((await page.getByText('มูลค่าผลงานขั้นต่ำตาม TOR').count()) === 0, 'comparison card visible to a guest');
    });
    await f.step('08', 'Open the document page of the TOR', 'The page shows the same project title as the detail page', async () => {
      await page.goto(`${BASE}/tors/${TOR}`); const title = (await page.locator('h1').first().innerText()).trim();
      await page.goto(`${BASE}/tors/${TOR}/document`); await page.getByRole('heading').first().waitFor({ timeout: 10000 });
      const h = (await page.getByRole('heading').first().innerText()).trim(); expect(h.length > 10 && h.slice(0, 20) === title.slice(0, 20), `heading "${h.slice(0, 30)}" vs "${title.slice(0, 30)}"`);
    });
    await f.step('09', 'Open Analytics and change a filter', 'The analytics API is called again with HTTP 200 and the page stays populated', async () => {
      await page.goto(BASE + '/analytics'); await page.getByText('ภาพรวมโอกาสยื่นข้อเสนอ').first().waitFor({ timeout: 15000 });
      const sel = page.locator('select').first(); await page.waitForFunction(() => document.querySelector('select') && document.querySelector('select').options.length > 1, null, { timeout: 15000 });
      const wait = page.waitForResponse(r => r.url().includes('/api/analytics') && r.request().method() === 'GET', { timeout: 15000 });
      await sel.selectOption({ index: 1 }); const r = await wait; expect(r.status() === 200, `status ${r.status()}`);
      await page.getByText('TOR ตามปีงบประมาณ').first().waitFor({ timeout: 8000 }); expect((await page.locator('.analytics-opportunities').count()) > 0, 'analytics page lost its content');
    });
    await f.step('10', 'Clear the filters', 'The filter returns to its first option and the data reloads', async () => {
      const wait = page.waitForResponse(r => r.url().includes('/api/analytics'), { timeout: 15000 });
      await page.getByRole('button', { name: 'ล้างตัวกรอง' }).click(); const rr = await wait; expect(rr.status() === 200, `status ${rr.status()}`);
      expect((await page.locator('select').first().inputValue()) === (await page.locator('select').first().locator('option').first().getAttribute('value')), 'filter not reset');
    });
    await f.step('11', 'Switch the chart mode to "ความพร้อมเอกสาร" and back', 'The chart heading changes to "ความพร้อมของเอกสาร TOR" and returns to "TOR ตามปีงบประมาณ"', async () => {
      await page.getByRole('button', { name: 'ความพร้อมเอกสาร' }).click(); await page.getByText('ความพร้อมของเอกสาร TOR').first().waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: 'จำนวนโครงการ' }).click(); await page.getByText('TOR ตามปีงบประมาณ').first().waitFor({ timeout: 5000 });
    });
    await f.step('12', 'Export the analytics as CSV and as JSON', 'Two downloads start: a .csv and a .json file', async () => {
      const [d1] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'CSV', exact: true }).click()]);
      const [d2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'JSON', exact: true }).click()]);
      expect(d1.suggestedFilename().endsWith('.csv') && d2.suggestedFilename().endsWith('.json'), `${d1.suggestedFilename()} ${d2.suggestedFilename()}`);
      return `${d1.suggestedFilename()}, ${d2.suggestedFilename()}`;
    });
    await f.step('13', 'Toggle the theme and collapse the sidebar', 'The theme control changes the page theme and the sidebar toggle flips aria-expanded', async () => {
      await page.goto(BASE + '/dashboard');
      const tbtn = () => page.getByRole('button', { name: /ธีม/ }); const t0 = await tbtn().getAttribute('aria-label');
      await tbtn().click(); await page.waitForTimeout(500); expect(t0 !== (await tbtn().getAttribute('aria-label')), 'theme control did not change state');
      const tg = () => page.getByRole('button', { name: /ย่อเมนูด้านข้าง|ขยายเมนูด้านข้าง/ }); const e0 = await tg().getAttribute('aria-expanded');
      await tg().click(); await page.waitForTimeout(400); expect((await tg().getAttribute('aria-expanded')) !== e0, 'sidebar state did not change');
    });
  },
}, results);

// ---------------------------------------------------------------- F02 register / login / logout
const u2 = newUser();
await runFlow(browser, {
  id: 'F02-auth', title: 'Register, log out, log in by email and username, error cases, Google redirect',
  async run(f) {
    const { page } = f;
    await f.step('01', 'Open the sign-in page', 'The login form (identifier and password) is shown', async () => { await page.goto(BASE + '/'); await page.locator('#identifier').waitFor(); await page.locator('#password').waitFor(); });
    await f.step('02', 'Switch to "สร้างบัญชี" and submit with mismatching passwords', 'The alert says the two passwords do not match ("ไม่ตรงกัน")', async () => {
      await page.locator('button.text-button').click(); await page.locator('#email').fill(u2.email);
      await page.locator('#password').fill(u2.password); await page.locator('#confirmPassword').fill(u2.password + 'x');
      await page.locator('button.sign-in').click(); return await noticeMatching(page, /ไม่ตรงกัน/);
    });
    await f.step('03', 'Submit with a password shorter than 15 characters', 'The browser blocks the submit (password field reports "too short") and no account is created', async () => {
      await page.locator('#password').fill('short'); await page.locator('#confirmPassword').fill('short');
      await page.locator('button.sign-in').click(); await page.waitForTimeout(500);
      const tooShort = await page.locator('#password').evaluate(e => e.validity.tooShort); expect(tooShort === true, 'password field did not report tooShort');
      expect(nav(page.url()) === '/', 'left the sign-in page'); return 'validity.tooShort = true';
    });
    await f.step('04', 'Register with a valid email, username and password', 'The account is created and the user lands inside the app; the session belongs to the new email', async () => {
      await page.locator('#username').fill(u2.username);
      await page.locator('#password').fill(u2.password); await page.locator('#confirmPassword').fill(u2.password);
      await page.locator('button.sign-in').click(); await page.waitForURL(u => nav(u) !== '/', { timeout: 20000 });
      const me = await apiJson(page, '/api/auth/me'); expect(JSON.stringify(me).includes(u2.email), 'session is not the new account'); return `landed on ${nav(page.url())}`;
    });
    await f.step('05', 'Log out', 'Returns to the sign-in page and the session is gone (/api/auth/me = 401)', async () => {
      await signOut(page); const r = await f.ctx.request.get(`${BASE}/api/auth/me`); expect(r.status() === 401, `me ${r.status()}`);
    });
    await f.step('06', 'Log in with a wrong password', 'The same generic error is shown for a wrong password on a real account and for an account that does not exist (no account enumeration)', async () => {
      await uiLogin(page, u2.email, 'wrong-password-123456'); const known = await noticeMatching(page, /ไม่ถูกต้อง/);
      await uiLogin(page, 'nobody-' + u2.username + '@example.test', 'wrong-password-123456'); const unknown = await noticeMatching(page, /ไม่ถูกต้อง/);
      expect(known === unknown, `different messages for a known and an unknown account: "${known}" vs "${unknown}"`); return `same message for known and unknown account: ${known}`;
    });
    await f.step('07', 'Log in with the email', 'Signed in as the new account', async () => {
      await uiLogin(page, u2.email, u2.password); await page.waitForURL(u => nav(u) !== '/', { timeout: 20000 });
      expect(JSON.stringify(await apiJson(page, '/api/auth/me')).includes(u2.email), 'wrong account');
    });
    await f.step('08', 'Log out, then log in with the username in upper case', 'Signed in as the same account (username is case-insensitive)', async () => {
      await signOut(page); await uiLogin(page, u2.username.toUpperCase(), u2.password); await page.waitForURL(u => nav(u) !== '/', { timeout: 20000 });
      expect(JSON.stringify(await apiJson(page, '/api/auth/me')).includes(u2.email), 'wrong account');
    });
    await f.step('09', 'Register again with the same email', 'An alert says the email already has an account ("มีบัญชีอยู่แล้ว")', async () => {
      await signOut(page); await page.locator('button.text-button').click(); await page.locator('#email').fill(u2.email);
      await page.locator('#password').fill(u2.password); await page.locator('#confirmPassword').fill(u2.password);
      await page.locator('button.sign-in').click(); return await noticeMatching(page, /มีบัญชีอยู่แล้ว/);
    });
    await f.step('10', 'Click "เข้าสู่ระบบด้วย Google"', 'The browser is sent to accounts.google.com (we stop there; no real Google sign-in)', async () => {
      await page.goto(BASE + '/');
      await Promise.all([page.waitForURL(u => new URL(u).host.endsWith('google.com'), { timeout: 20000 }), page.locator('button.google-button').click()]);
      return `redirected to ${new URL(page.url()).host}`;
    });
    await f.step('11', 'Cleanup: sign in and delete the test account (API)', 'HTTP 200', async () => {
      await f.ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: u2.email, password: u2.password } });
      const r = await f.ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } }); expect(r.status() === 200, `status ${r.status()}`);
    });
  },
}, results);

// ---------------------------------------------------------------- F03 access control
const u3 = newUser(), u3b = newUser();
await runFlow(browser, {
  id: 'F03-access-control', title: 'Guests and normal users cannot reach protected pages and APIs; users cannot see each other\'s drafts',
  async run(f) {
    const { page } = f;
    await f.step('01', 'Guest opens /profile', 'Redirected to the sign-in page', async () => { await page.goto(BASE + '/profile'); await page.waitForURL(u => nav(u) === '/', { timeout: 10000 }); });
    await f.step('02', 'Guest opens /admin', 'Redirected to the sign-in page', async () => { await page.goto(BASE + '/admin'); await page.waitForURL(u => nav(u) === '/', { timeout: 10000 }); });
    await f.step('03', 'Guest calls the drafts API and the admin API', '401 for both', async () => {
      const a = await f.ctx.request.get(`${BASE}/api/bid-prep/drafts`); const b = await f.ctx.request.get(`${BASE}/api/admin/pipeline/status`);
      expect(a.status() === 401 && b.status() === 401, `drafts ${a.status()}, admin ${b.status()}`); return `drafts ${a.status()}, admin ${b.status()}`;
    });
    await f.step('04', 'Sign in as a normal user and open /admin', 'The page says admin permission is required and shows no admin console', async () => {
      await apiLogin(f.ctx, u3); await page.goto(BASE + '/admin'); await page.getByText('Admin permission required').first().waitFor({ timeout: 10000 });
      expect((await page.getByText('นำเข้าข้อมูลอัตโนมัติล่าสุด').count()) === 0, 'admin console visible to a normal user');
    });
    await f.step('05', 'Normal user calls the admin API', '403', async () => { const r = await f.ctx.request.get(`${BASE}/api/admin/pipeline/status`); expect(r.status() === 403, `status ${r.status()}`); });
    await f.step('06', 'User A creates a draft (API); user B opens its URL in the browser and via the API', 'B sees none of A\'s content in the page; the API answers 404 and B\'s list is empty', async () => {
      const mk = await f.ctx.request.post(`${BASE}/api/bid-prep/drafts`, { data: { projectId: TOR, title: 'A private draft', sections: [{ heading: 'h', body: 'secret body', sources: [] }] } });
      expect(mk.status() === 201, `create ${mk.status()}`); const j = await mk.json(); const id = j.draft?._id || j.id || j._id;
      await f.ctx.request.post(`${BASE}/api/auth/logout`); await apiLogin(f.ctx, u3b);
      await page.goto(`${BASE}/bid-prep/drafts/${id}`); await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText(); expect(!body.includes('secret body') && !body.includes('A private draft'), 'user B can read A\'s draft');
      const api = await f.ctx.request.get(`${BASE}/api/bid-prep/drafts/${id}`); expect(api.status() === 404, `API status ${api.status()}`);
      const list = await (await f.ctx.request.get(`${BASE}/api/bid-prep/drafts`)).json(); expect((list.drafts || []).length === 0, 'B\'s list contains A\'s draft');
      return `UI shows no content; API ${api.status()}; B has ${(list.drafts || []).length} drafts`;
    });
    await f.step('07', 'Check the security headers of a normal page response', 'Content-Security-Policy, X-Content-Type-Options and a frame-ancestors/X-Frame-Options rule are sent (this run disables CSP in the test browser, so the header is checked here)', async () => {
      const h = (await f.ctx.request.get(`${BASE}/`)).headers(); const csp = h['content-security-policy'] || '';
      expect(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"), `CSP: ${csp.slice(0, 80)}`);
      expect(h['x-content-type-options'] === 'nosniff', `nosniff: ${h['x-content-type-options']}`); return 'CSP + nosniff present';
    });
    await f.step('08', 'Cleanup: delete both test accounts', 'Both deletions return HTTP 200', async () => {
      const a = await f.ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } }); await f.ctx.request.post(`${BASE}/api/auth/logout`);
      await apiLogin(f.ctx, u3, { register: false }); const b = await f.ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } });
      expect(a.status() === 200 && b.status() === 200, `B ${a.status()}, A ${b.status()}`);
    });
  },
}, results);

// ---------------------------------------------------------------- F04 profile
const u4 = newUser();
await runFlow(browser, {
  id: 'F04-profile', title: 'Edit the company profile, validation, persistence, delete company data, delete account',
  async run(f) {
    const { page } = f;
    const seen = []; page.on('request', r => { if (r.url().includes('/api/profiles') && r.method() === 'PATCH') seen.push(r.method()); });
    const saveBtn = () => page.getByRole('button', { name: /บันทึกข้อมูลโปรไฟล์/ });
    const save = () => Promise.all([page.waitForResponse(r => r.url().includes('/api/profiles') && r.request().method() === 'PATCH', { timeout: 15000 }), saveBtn().click()]).then(([r]) => r);
    const set = async (l, v) => { await page.getByLabel(l).fill(v); expect((await page.getByLabel(l).inputValue()) === v, `${l} != ${v}`); };
    await f.step('01', 'Sign in and open the profile page', 'Heading "ตั้งค่าโปรไฟล์และทักษะบริษัท" is shown with an empty company name', async () => {
      await apiLogin(f.ctx, u4); await page.goto(BASE + '/profile'); await page.getByText('ตั้งค่าโปรไฟล์และทักษะบริษัท').first().waitFor({ timeout: 15000 });
      expect((await page.getByLabel('ชื่อบริษัท').inputValue()) === '', 'company name not empty for a new user');
    });
    await f.step('02', 'Fill company name, capital, highest past-project value and capacity', 'The fields hold exactly what was typed', async () => {
      await set('ชื่อบริษัท', 'บริษัท ทดสอบระบบ จำกัด'); await set('ทุนจดทะเบียน (บาท)', '5000000'); await set('มูลค่างานสูงสุดที่ผ่านมา (บาท)', '3000000'); await set('จำนวนโครงการที่รับพร้อมกันได้', '3');
    });
    await f.step('03', 'Fill registration number, signatory and address', 'The fields hold exactly what was typed', async () => {
      await set('เลขทะเบียนนิติบุคคล', '0105555555555'); await set('ผู้มีอำนาจลงนาม', 'นายทดสอบ ระบบ'); await set('ที่อยู่บริษัท', '99 ถนนทดสอบ กรุงเทพมหานคร 10100');
    });
    await f.step('04', 'Add a past project and fill it in', 'The counter shows "ผลงานที่ผ่านมา (1/50)" and the four fields keep their values', async () => {
      await page.getByRole('button', { name: 'เพิ่มผลงานที่ผ่านมา' }).click(); await page.getByText('ผลงานที่ผ่านมา (1/50)').waitFor({ timeout: 5000 });
      const box = page.locator('section, div').filter({ hasText: 'ผลงานที่ผ่านมา (1/50)' }).last(); const ins = box.locator('input'); const n = await ins.count();
      expect(n >= 4, `only ${n} inputs`); const vals = ['ระบบทดสอบ A', 'หน่วยงานทดสอบ', '3000000', '2568'];
      for (let i = 0; i < 4; i++) { await ins.nth(n - 4 + i).fill(vals[i]); expect((await ins.nth(n - 4 + i).inputValue()) === vals[i], `past-project field ${i}`); }
    });
    await f.step('05', 'Pick three skills and one certification', 'The skills counter shows "3 รายการ" and a picked chip looks different from an unpicked one', async () => {
      for (const t of ['React', 'Docker', 'Security']) await page.getByRole('button', { name: t, exact: true }).click();
      await page.getByRole('button', { name: 'ISO 27001', exact: true }).click();
      await page.getByText('3 รายการ', { exact: true }).first().waitFor({ timeout: 4000 });
      expect((await page.getByRole('button', { name: 'React', exact: true }).getAttribute('class') || '') !== (await page.getByRole('button', { name: 'PHP', exact: true }).getAttribute('class') || ''), 'picked chip looks the same as an unpicked one');
    });
    await f.step('06', 'Turn email notifications on and set threshold and frequency', 'The switch is on and the frequency select holds a non-default option', async () => {
      await page.locator('.profile-switch').click(); expect(await page.locator('.profile-switch input[type=checkbox]').isChecked(), 'switch is off');
      const sels = page.locator('select'); const c = await sels.count(); const th0 = await sels.nth(c - 2).inputValue();
      const last = (await sels.nth(c - 2).locator('option').count()) - 1; await sels.nth(c - 2).selectOption({ index: last }); await sels.nth(c - 1).selectOption({ index: 1 });
      expect((await sels.nth(c - 2).inputValue()) !== th0, 'threshold not changed'); expect((await sels.nth(c - 1).inputValue()) !== 'IMMEDIATE', 'frequency not changed');
    });
    await f.step('07', 'Click "บันทึกข้อมูลโปรไฟล์"', 'The save request (PATCH) succeeds with HTTP 200', async () => { const r = await save(); expect(r.status() === 200, `save status ${r.status()}`); return `PATCH -> ${r.status()}`; });
    await f.step('08', 'Reload the page', 'Company name, address, skills, certification, notification switch and the past project are all still there (screen and API)', async () => {
      await page.reload(); await page.getByLabel('ชื่อบริษัท').waitFor({ timeout: 15000 });
      await page.waitForFunction(() => [...document.querySelectorAll('input')].some(i => i.value.includes('ทดสอบระบบ')), null, { timeout: 10000 });
      const api = (await apiJson(page, '/api/profiles')); const d = api.data || api;
      expect(d.company_name === 'บริษัท ทดสอบระบบ จำกัด' && (d.address || '').includes('ถนนทดสอบ'), `API company/address: ${d.company_name}`);
      expect((d.skills || []).includes('React') && (d.skills || []).includes('Docker') && (d.certifications || []).includes('ISO 27001'), `API skills ${JSON.stringify(d.skills)}`);
      expect((d.past_projects || []).length === 1 && d.email_notifications_enabled === true, 'past project or notification setting missing');
      expect(d.match_score_threshold !== 70 && d.notification_frequency === 'DAILY_DIGEST', `threshold ${d.match_score_threshold}, frequency ${d.notification_frequency}`);
      await page.getByText('ผลงานที่ผ่านมา (1/50)').waitFor({ timeout: 5000 }); await page.getByText('3 รายการ', { exact: true }).first().waitFor({ timeout: 5000 });
      expect(await page.locator('.profile-switch input[type=checkbox]').isChecked(), 'switch is off after reload');
      expect((await page.getByLabel('ที่อยู่บริษัท').inputValue()).includes('ถนนทดสอบ'), 'screen does not show the saved address');
    });
    await f.step('09', 'Enter a negative capital and save', 'The form shows a field error, no save request is sent and the stored value is unchanged', async () => {
      seen.length = 0; await page.getByLabel('ทุนจดทะเบียน (บาท)').fill('-5'); await saveBtn().click(); await page.waitForTimeout(1200);
      await page.locator('.profile-field-error').first().waitFor({ timeout: 4000 }); expect(seen.length === 0, 'a save request was sent');
      const d = (await apiJson(page, '/api/profiles')); const x = d.data || d; expect(x.registered_capital === 5000000, `stored capital ${x.registered_capital}`);
      return (await page.locator('.profile-field-error').first().innerText()).slice(0, 70);
    });
    await f.step('10', 'Remove the past project', 'The counter returns to "ผลงานที่ผ่านมา (0/50)"; after saving, the API stores no past project', async () => {
      await page.reload(); await page.getByText('ผลงานที่ผ่านมา (1/50)').waitFor({ timeout: 10000 }); await page.getByRole('button', { name: /ลบผลงานที่ 1/ }).click();
      await page.getByText('ผลงานที่ผ่านมา (0/50)').waitFor({ timeout: 5000 });
      const r = await save(); expect(r.status() === 200, `save ${r.status()}`); const d = await apiJson(page, '/api/profiles'); expect(((d.data || d).past_projects || []).length === 0, 'the removed past project is still stored');
    });
    await f.step('11', 'Create a draft (API), then click "ลบข้อมูลบริษัท" and confirm', 'Company data and drafts are cleared (checked in the API); the account stays', async () => {
      const mk = await f.ctx.request.post(`${BASE}/api/bid-prep/drafts`, { data: { projectId: TOR, title: 'to be removed', sections: [{ heading: 'h', body: 'b', sources: [] }] } }); expect(mk.status() === 201, `draft create ${mk.status()}`);
      await page.reload(); await page.getByLabel('ชื่อบริษัท').waitFor({ timeout: 15000 });
      await page.getByLabel('ชื่อบริษัท').fill('บริษัท ทดสอบระบบ จำกัด'); await set('ทุนจดทะเบียน (บาท)', '5000000'); await save();
      await page.reload(); await page.getByRole('button', { name: 'ลบข้อมูลบริษัท' }).click(); await page.locator('[role=dialog] .profile-confirm-delete-button').click(); await page.waitForTimeout(2500);
      const d = (await apiJson(page, '/api/profiles')); const x = d.data || d; const dr = await apiJson(page, '/api/bid-prep/drafts');
      const gone = ['company_name', 'registration_number', 'address', 'authorized_signatory'].every(k => (x[k] || '') === '') && ['skills', 'certifications', 'past_projects'].every(k => (x[k] || []).length === 0) && ['registered_capital', 'highest_past_project_value', 'concurrent_project_capacity'].every(k => x[k] == null);
      expect(gone, `not cleared: ${JSON.stringify(x).slice(0, 200)}`);
      expect((dr.drafts || []).length === 0, `drafts left: ${(dr.drafts || []).length}`); expect(JSON.stringify(await apiJson(page, '/api/auth/me')).includes(u4.email), 'account was deleted too');
    });
    await f.step('12', 'Click "ลบบัญชีผู้ใช้" and confirm', 'The user is sent to the sign-in page and the session is gone', async () => {
      await page.reload(); await page.getByRole('button', { name: 'ลบบัญชีผู้ใช้' }).click(); await page.locator('[role=dialog] .profile-confirm-delete-button').click();
      await page.waitForURL(u => nav(u) === '/', { timeout: 15000 }); const r = await f.ctx.request.get(`${BASE}/api/auth/me`); expect(r.status() === 401, `me ${r.status()}`);
    });
    await f.step('13', 'Try to sign in with the deleted account', 'Sign-in is refused with the generic error', async () => { await uiLogin(page, u4.email, u4.password); return await noticeMatching(page, /ไม่ถูกต้อง/); });
  },
}, results);

// ---------------------------------------------------------------- F05 TOR detail as a signed-in user
const u5 = newUser();
await runFlow(browser, {
  id: 'F05-tor-detail', title: 'Signed-in user reads a TOR: summary, qualification checklist (own status), prepare-draft link, dashboard',
  async run(f) {
    const { page } = f;
    await f.step('01', 'Sign in and open a TOR detail page', 'No guest notice is shown, and the signed-in-only comparison cards (qualification value and checklist) are present', async () => {
      await apiLogin(f.ctx, u5); await page.goto(`${BASE}/tors/${TOR2}`); await page.getByText('ภาพรวมโครงการ').first().waitFor({ timeout: 15000 });
      expect((await page.getByText('เข้าสู่ระบบเพื่อดูรายละเอียดโครงการฉบับเต็ม').count()) === 0, 'guest notice shown to a signed-in user');
      await page.getByText('มูลค่าผลงานขั้นต่ำตาม TOR').first().waitFor({ timeout: 8000 }); await page.locator('.tor-bid-checklist-items li').first().waitFor({ timeout: 8000 });
    });
    await f.step('03', 'Scroll to the qualification checklist card', 'Items with the status buttons per item are visible', async () => {
      await page.locator('.tor-bid-checklist-items li').first().scrollIntoViewIfNeeded({ timeout: 10000 });
      expect((await page.locator('.tor-bid-checklist-items li').first().locator('.tor-bid-checklist-status-control button').count()) >= 2, 'status buttons missing');
    });
    await f.step('04', 'Mark the first item "ผ่าน"', 'The button is pressed (aria-pressed) and the API reports status pass for that item', async () => {
      const first = page.locator('.tor-bid-checklist-items li').first(); await first.locator('button[data-status=pass]').click();
      await page.waitForFunction(() => document.querySelector('.tor-bid-checklist-items li button[data-status=pass]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
      const c = await apiJson(page, `/api/bid-prep/tors/${TOR2}/checklist`); expect(c.items[0].status === 'pass', `API status ${c.items[0].status}`);
    });
    await f.step('05', 'Change the first item to "ไม่ผ่าน", then press it again', 'The API reports fail; pressing the same button again returns the item to the system value (manual)', async () => {
      const first = page.locator('.tor-bid-checklist-items li').first(); const idle = () => page.getByText('กำลังบันทึก…').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
      await idle(); await first.locator('button[data-status=fail]').click();
      await page.waitForFunction(() => document.querySelector('.tor-bid-checklist-items li button[data-status=fail]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 20000 }); await idle();
      expect((await apiJson(page, `/api/bid-prep/tors/${TOR2}/checklist`)).items[0].status === 'fail', 'API is not fail');
      await first.locator('button[data-status=fail]').click(); await page.waitForFunction(() => document.querySelector('.tor-bid-checklist-items li button[data-status=fail]')?.getAttribute('aria-pressed') === 'false', null, { timeout: 20000 }); await idle();
      expect((await apiJson(page, `/api/bid-prep/tors/${TOR2}/checklist`)).items[0].status === 'manual', 'not back to the system value');
    });
    await f.step('06', 'Page through the checklist ("ถัดไป →")', 'A different first item is shown on the next page', async () => {
      const before = await page.locator('.tor-bid-checklist-items li').first().innerText(); const next = page.locator('.tor-bid-checklist-items').locator("xpath=ancestor::*[.//button[contains(normalize-space(.),'ถัดไป')]][1]").getByRole('button', { name: /ถัดไป/ }).first();
      expect(await next.isEnabled(), 'next page is disabled (fewer items than one page)'); await next.click(); await page.waitForTimeout(500);
      expect((await page.locator('.tor-bid-checklist-items li').first().innerText()) !== before, 'same items after paging');
    });
    await f.step('07', 'Click "เตรียมร่างข้อเสนอ"', 'The BidPrep page opens with projectId in the URL', async () => {
      await page.getByRole('link', { name: 'เตรียมร่างข้อเสนอ' }).first().click(); await page.waitForURL(u => nav(u) === '/bid-prep' && new URL(u).searchParams.get('projectId') === TOR2, { timeout: 10000 });
    });
    await f.step('08', 'Open the document page of the TOR', 'The document view shows a project heading', async () => {
      await page.goto(`${BASE}/tors/${TOR2}`); const title = (await page.locator('h1').first().innerText()).trim();
      await page.goto(`${BASE}/tors/${TOR2}/document`); await page.getByRole('heading').first().waitFor({ timeout: 10000 }); const h = (await page.getByRole('heading').first().innerText()).trim();
      expect(h !== 'รอข้อมูลจากเอกสาร TOR' && h.slice(0, 20) === title.slice(0, 20), `heading "${h.slice(0, 30)}"`);
    });
    await f.step('09', 'Open the dashboard', 'Cards link to /tors/<id> (not to sign-in), unlike the guest view', async () => {
      await page.goto(BASE + '/dashboard'); await page.locator('a.feed-card').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(2500); // let /api/auth/me settle: before it answers every visitor looks like a user
      const href = await page.locator('a.feed-card').first().getAttribute('href'); expect(/^\/tors\/\d+/.test(href), `href ${href}`); return `first card -> ${href}`;
    });
    await f.step('10', 'Cleanup: delete the test account', 'HTTP 200', async () => { const r = await f.ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } }); expect(r.status() === 200, `status ${r.status()}`); });
  },
}, results);

// ---------------------------------------------------------------- F06 BidPrep manual draft, checklist, export
const u6 = newUser();
await runFlow(browser, {
  id: 'F06-bidprep-draft', title: 'BidPrep: create a draft, edit, sections, checklist gate, export DOCX, delete',
  async run(f) {
    const { page } = f;
    const saveDraft = () => Promise.all([page.waitForResponse(x => /\/api\/bid-prep\/drafts\//.test(x.url()) && ['PUT', 'PATCH'].includes(x.request().method()), { timeout: 15000 }), page.getByRole('button', { name: 'บันทึกร่าง' }).click()]).then(([r]) => r);
    await f.step('01', 'Sign in, fill a minimal profile (API) and open "เตรียมข้อเสนอ"', 'Heading "ร่างข้อเสนอของฉัน" and the empty-list message are shown', async () => {
      await apiLogin(f.ctx, u6);
      await f.ctx.request.patch(`${BASE}/api/profiles`, { data: { company_name: 'บริษัท ทดสอบระบบ จำกัด', registered_capital: 5000000, skills: ['React'] } });
      await page.goto(BASE + '/bid-prep'); await page.getByText('ร่างข้อเสนอของฉัน').first().waitFor({ timeout: 15000 }); await page.getByText('ยังไม่มีร่างที่บันทึกไว้').waitFor({ timeout: 8000 });
    });
    await f.step('02', 'Create a draft with an unknown TOR id', 'The message "TOR not found" is shown and no draft page opens', async () => {
      await page.getByRole('textbox').first().fill('00000000000'); await page.getByRole('button', { name: 'สร้างร่างเพื่อแก้ไข' }).click(); await page.getByText(/TOR not found/).first().waitFor({ timeout: 8000 });
      expect(!/\/bid-prep\/drafts\//.test(page.url()), 'draft page opened for an unknown TOR');
    });
    await f.step('03', 'Create a draft for a real TOR', 'The draft editor opens for that TOR at version 1', async () => {
      await page.getByRole('textbox').first().fill(TOR2); await page.getByRole('button', { name: 'สร้างร่างเพื่อแก้ไข' }).click(); await page.waitForURL(/\/bid-prep\/drafts\//, { timeout: 20000 });
      await page.getByText(new RegExp(`TOR ${TOR2}`)).first().waitFor({ timeout: 8000 }); await page.getByText(/รุ่น 1\b/).first().waitFor({ timeout: 5000 });
    });
    await f.step('04', 'Edit the title and the first section, then save', 'The save returns HTTP 200 and the version shown becomes 2', async () => {
      await page.getByLabel('ชื่อร่าง', { exact: true }).first().fill('ร่างทดสอบ E2E'); await page.getByLabel('หัวข้อ 1').first().fill('ข้อมูลบริษัท');
      await page.getByLabel('ข้อความร่าง').first().fill('บริษัทของเรามีประสบการณ์ [to fill in: ผลงาน]');
      const r = await saveDraft(); expect(r.status() === 200, `save ${r.status()}`); await page.getByText(/รุ่น 2\b/).first().waitFor({ timeout: 8000 }); return `save -> ${r.status()}, version 2`;
    });
    const sections = () => page.getByRole('button', { name: /ลบหัวข้อนี้/ }).count();
    let n0 = 0;
    await f.step('05', 'Add a section', 'The number of sections goes up by one', async () => {
      n0 = await sections(); await page.getByRole('button', { name: 'เพิ่มหัวข้อ' }).click(); await page.waitForTimeout(400);
      expect((await sections()) === n0 + 1, `sections ${n0} -> ${await sections()}`); return `${n0} -> ${n0 + 1} sections`;
    });
    await f.step('06', 'Delete the added section', 'The number of sections goes back down by one', async () => {
      await page.getByRole('button', { name: /ลบหัวข้อนี้/ }).last().click(); await page.waitForTimeout(400);
      expect((await sections()) === n0, `sections ${await sections()}, expected ${n0}`); return `back to ${n0} sections`;
    });
    await f.step('07', 'Save, then look at the export button before the checklist passes', 'With nothing unsaved, the DOCX button is still disabled and the page asks for every item to be "ผ่าน"', async () => {
      const sv = await saveDraft(); expect(sv.status() === 200, `save ${sv.status()}`);
      await page.getByText(/ให้ทุกข้อมีสถานะ/).first().waitFor({ timeout: 6000 }); expect((await page.getByText(/ยังไม่ได้บันทึก/).count()) === 0, 'page still reports unsaved changes');
      expect(await page.getByRole('button', { name: /ดาวน์โหลด DOCX/ }).isDisabled(), 'download is enabled');
    });
    await f.step('08', 'Open the checklist tab', 'The summary cards (ผ่าน / ไม่ผ่าน / ตรวจสอบเอง) are shown and the three numbers add up to the 11 items', async () => {
      await page.getByRole('tab', { name: /รายการตรวจสอบคุณสมบัติ/ }).click().catch(async () => { await page.getByText('รายการตรวจสอบคุณสมบัติ').first().click(); });
      await page.getByText('ตรวจสอบเอง', { exact: true }).first().waitFor({ timeout: 8000 });
      const total = (await counter(page, 'ผ่าน')) + (await counter(page, 'ไม่ผ่าน')) + (await counter(page, 'ตรวจสอบเอง')); expect(total === 11, `items add up to ${total}, expected 11`); return `${total} items`;
    });
    await f.step('09', 'Mark one item "ไม่ผ่าน"', 'The "ไม่ผ่าน" counter becomes 1', async () => {
      await page.getByRole('button', { name: 'ไม่ผ่าน', exact: true }).first().click();
      const ok = await until(async () => (await counter(page, 'ไม่ผ่าน')) === 1, 12000); expect(ok, `fail counter ${await counter(page, 'ไม่ผ่าน')} 12 s after the click`);
    });
    await f.step('10', 'Mark every item "ผ่าน" on all pages', 'The "ผ่าน" counter equals 11 and the other two are 0', async () => {
      let clicks = 0, pages = 0;
      for (let guard = 0; guard < 20; guard++) {
        const b = page.getByRole('button', { name: 'ผ่าน', exact: true }); const total = await b.count(); pages++;
        for (let i = 0; i < total; i++) { await b.nth(i).click(); clicks++; await page.waitForTimeout(350); }
        const next = page.getByRole('button', { name: /ถัดไป/ }).last(); if (!(await next.count()) || (await next.isDisabled())) break; await next.click(); await page.waitForTimeout(500);
      }
      await page.waitForTimeout(800); const c = [await counter(page, 'ผ่าน'), await counter(page, 'ไม่ผ่าน'), await counter(page, 'ตรวจสอบเอง')];
      expect(c[0] === 11 && c[1] === 0 && c[2] === 0, `counters ${c.join('/')}`); return `${clicks} clicks on ${pages} page(s), counters ${c.join('/')}`;
    });
    await f.step('11', 'Download the DOCX (saving first if the page reports unsaved changes)', 'A .docx download starts and the file is a valid zip (first bytes "PK")', async () => {
      await page.getByText('ชื่อร่างและหัวข้อ').first().click().catch(() => {});
      if ((await page.getByText(/ยังไม่ได้บันทึก/).count()) > 0) { const sv = await saveDraft(); expect(sv.status() === 200, `save before export ${sv.status()}`); }
      expect((await page.getByText(/ยังไม่ได้บันทึก/).count()) === 0, 'page still reports unsaved changes');
      const b = page.getByRole('button', { name: /ดาวน์โหลด DOCX/ }); await b.waitFor({ timeout: 8000 });
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), b.click().then(async () => { const c = page.locator('#confirm-bid-action'); await c.waitFor({ timeout: 4000 }).then(() => c.click()).catch(() => {}); })]);
      const pth = await d.path(); const buf = fs.readFileSync(pth); expect(buf.subarray(0, 2).toString() === 'PK', 'file is not a zip/docx'); expect(buf.length > 5000, `file only ${buf.length} bytes`);
      fs.copyFileSync(pth, `${f.dir}/exported-draft.docx`); return `download ${d.suggestedFilename()} (${buf.length} bytes)`;
    });
    await f.step('12', 'Return to the list and open the saved draft', 'The draft is listed with its title and opens at version 3 or higher, showing the saved title and first section heading', async () => {
      await page.goto(BASE + '/bid-prep'); await page.getByText('ร่างทดสอบ E2E').first().click(); await page.waitForURL(/\/bid-prep\/drafts\//, { timeout: 10000 });
      await page.getByText(/รุ่น (?:[3-9]|\d{2,})/).first().waitFor({ timeout: 6000 });
      expect((await page.getByLabel('ชื่อร่าง', { exact: true }).first().inputValue()) === 'ร่างทดสอบ E2E', 'saved title not shown'); expect((await page.getByLabel('หัวข้อ 1').first().inputValue()) === 'ข้อมูลบริษัท', 'saved section heading not shown');
    });
    await f.step('13', 'Delete the draft', 'The list shows the empty message and the API has 0 drafts', async () => {
      await page.getByRole('button', { name: 'ลบร่างนี้' }).click(); await page.locator('#confirm-bid-action').click(); await page.waitForURL(u => nav(u) === '/bid-prep', { timeout: 10000 });
      await page.getByText('ยังไม่มีร่างที่บันทึกไว้').waitFor({ timeout: 8000 }); expect(((await apiJson(page, '/api/bid-prep/drafts')).drafts || []).length === 0, 'draft still in the API');
    });
    await f.step('14', 'Cleanup: delete the test account', 'HTTP 200', async () => { const r = await f.ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } }); expect(r.status() === 200, `status ${r.status()}`); });
  },
}, results);

// ---------------------------------------------------------------- F07 / F07b BidPrep AI draft
for (const cfg of [
  { id: 'F07-bidprep-ai', tor: TOR2, title: 'BidPrep: generate an AI draft (queued job, local model), TOR with a small scope' },
  { id: 'F07b-bidprep-ai-large-tor', tor: TOR_AI, title: 'BidPrep: generate an AI draft for a TOR with a large scope (47 items)' },
]) {
  const u7 = newUser();
  await runFlow(browser, {
    id: cfg.id, title: cfg.title,
    async run(f) {
      const { page } = f;
      await f.step('01', 'Sign in, fill a profile and open "เตรียมข้อเสนอ"', 'The page loads with the AI warning', async () => {
        await apiLogin(f.ctx, u7);
        await f.ctx.request.patch(`${BASE}/api/profiles`, { data: { company_name: 'บริษัท ทดสอบระบบ จำกัด', registered_capital: 5000000, skills: ['React', 'Docker'], concurrent_project_capacity: 3 } });
        await page.goto(BASE + '/bid-prep'); await page.getByText('ร่างข้อเสนอของฉัน').first().waitFor({ timeout: 15000 }); await page.getByText('This is an AI draft').first().waitFor({ timeout: 5000 });
      });
      await f.step('02', 'Enter a TOR id and click "สร้างร่างด้วย AI"', 'A job is queued (HTTP 202) and the page shows "กำลังรอผล AI" with a job number', async () => {
        await page.getByRole('textbox').first().fill(cfg.tor);
        const [r] = await Promise.all([page.waitForResponse(x => x.url().includes('/proposal-draft') && x.request().method() === 'POST', { timeout: 20000 }), page.getByRole('button', { name: 'สร้างร่างด้วย AI' }).click()]);
        expect(r.status() === 202, `status ${r.status()}`); await page.getByText(/กำลังรอผล AI/).first().waitFor({ timeout: 8000 }); expect(/[0-9a-f]{24}/.test(await page.locator('body').innerText()), 'no job number shown'); return `queued -> ${r.status()}`;
      });
      await f.step('03', 'Wait for the job to finish (up to 5.5 minutes)', 'When the job completes the page opens the saved draft (or lists it under "ร่างที่บันทึกไว้"); if the job fails, the page must show why', async () => {
        const t0 = Date.now();
        for (;;) {
          if ((await page.locator('a[href*="/bid-prep/drafts/"]').count()) > 0 || /\/bid-prep\/drafts\//.test(page.url())) return `ready after ${Math.round((Date.now() - t0) / 1000)} s`;
          const err = await page.locator('[role=alert], .bid-error').first().innerText().catch(() => '');
          if (err) throw new Error(`job failed with message: ${err.slice(0, 120)}`);
          if (Date.now() - t0 > 330000) throw new Error('no draft and no error message after 330 s');
          await page.waitForTimeout(3000);
        }
      });
      await f.step('04', 'Open the AI draft', 'The editor shows at least 3 sections, source lists and at least one "[to fill in: ...]" placeholder', async () => {
        if (!/\/bid-prep\/drafts\//.test(page.url())) { const link = page.locator('a[href*="/bid-prep/drafts/"]').first(); expect((await link.count()) > 0, 'no draft to open'); await link.click(); }
        await page.waitForURL(/\/bid-prep\/drafts\//, { timeout: 10000 }); await page.getByLabel('หัวข้อ 1').first().waitFor({ timeout: 8000 });
        expect((await page.getByLabel(/หัวข้อ \d+/).count()) >= 3, 'fewer than 3 sections'); expect((await page.locator('body').innerText()).includes('[to fill in'), 'no [to fill in: ...] placeholder in the AI draft'); await page.getByText('แหล่งอ้างอิงของข้อความนี้').first().waitFor({ timeout: 5000 });
      });
      await f.step('05', 'Cleanup: delete the test account and its drafts', 'HTTP 200', async () => { const r = await f.ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } }); expect(r.status() === 200, `status ${r.status()}`); });
    },
  }, results);
}

// ---------------------------------------------------------------- F08 admin console (read only)
await runFlow(browser, {
  id: 'F08-admin', title: 'Admin console: ingestion status, health, review queue (read only, nothing is triggered)',
  async run(f) {
    const { page } = f; realRows = () => page.locator('table tbody tr').filter({ hasNot: page.locator('td.admin-review-empty') });
    const admin = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
    expect(admin.email && admin.password, 'ADMIN_EMAIL / ADMIN_PASSWORD not provided (the account must be promoted first)');
    await f.step('01', 'Sign in as an admin', 'Signed in; the session role is admin', async () => { await apiLogin(f.ctx, admin, { register: false }); await page.goto(BASE + '/dashboard'); const me = JSON.stringify(await apiJson(page, '/api/auth/me')); expect(/"role"\s*:\s*"admin"/.test(me) || me.includes('admin:write'), `session is not admin: ${me.slice(0, 80)}`); });
    await f.step('02', 'Open /admin', 'The console shows the ingestion status and the scraper health section', async () => {
      await page.goto(BASE + '/admin'); await page.getByText('นำเข้าข้อมูลอัตโนมัติล่าสุด').first().waitFor({ timeout: 20000 }); await page.getByText('สุขภาพการดึงข้อมูล').first().waitFor({ timeout: 8000 });
    });
    await f.step('03', 'Read the review queue', 'The queue finishes loading and shows rows or an empty-state message (not the loading text)', async () => {
      await page.getByText('รายการที่ต้องตรวจสอบ').first().waitFor({ timeout: 10000 });
      await page.waitForFunction(() => !document.body.innerText.includes('กำลังโหลดคิวตรวจสอบ'), null, { timeout: 20000 });
      expect((await page.getByText('โปรดตรวจสอบการเข้าสู่ระบบผู้ดูแล').count()) === 0, 'the queue shows its error state'); const rows = await realRows().count(); return `${rows} row(s) in the queue`;
    });
    await f.step('04', 'Filter the queue by reason', 'The reason filter is applied to the rows on the page: the row count does not grow', async () => {
      const sel = page.getByLabel('สาเหตุที่ต้องตรวจสอบ'); expect((await sel.locator('option').count()) > 1, 'no reason options'); const n0 = await realRows().count();
      await sel.selectOption({ index: 1 }); await page.waitForTimeout(1500); const n1 = await realRows().count(); expect(n1 <= n0, `rows grew ${n0} -> ${n1}`); return `${n0} -> ${n1} rows`;
    });
    await f.step('05', 'Search the queue for text that matches nothing', 'The queue shows no rows (or only the empty-state row)', async () => {
      await page.getByLabel('ค้นหารายการ TOR').fill('zzzz-no-such-tor'); await page.waitForTimeout(1200);
      expect((await realRows().count()) === 0, 'rows still listed for a search that matches nothing'); await page.locator('td.admin-review-empty').first().waitFor({ timeout: 4000 });
    });
    await f.step('06', 'Admin API status call', 'HTTP 200 with a pipeline status body', async () => {
      const r = await f.ctx.request.get(`${BASE}/api/admin/pipeline/status`); expect(r.status() === 200, `status ${r.status()}`); const j = await r.json(); expect(j && (j.status || j.run || j.state), 'empty body'); return `status -> ${r.status()}`;
    });
    await f.step('07', 'Cleanup: delete the admin test account', 'HTTP 200', async () => { const r = await f.ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } }); expect(r.status() === 200, `status ${r.status()}`); });
  },
}, results);

await browser.close();
console.log(JSON.stringify(results.map(r => ({ id: r.id, pass: r.steps.filter(s => s.result === 'PASS').length, fail: r.steps.filter(s => s.result === 'FAIL').length })), null, 1));
