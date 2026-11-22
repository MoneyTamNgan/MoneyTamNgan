import { chromium } from 'playwright';
import { BASE, newUser, apiLogin } from './lib.mjs';
const TOR2 = '69109232352';
const b = await chromium.launch(); const ctx = await b.newContext({ bypassCSP: true, extraHTTPHeaders: { Origin: BASE } }); const page = await ctx.newPage();
await apiLogin(ctx, newUser());
page.on('response', async r => { if (r.url().includes('/checklist')) console.log(r.request().method(), r.status(), (await r.text().catch(() => '')).slice(0, 120)); });
await page.goto(`${BASE}/tors/${TOR2}`); await page.locator('.tor-bid-checklist-items li').first().scrollIntoViewIfNeeded();
const first = page.locator('.tor-bid-checklist-items li').first();
for (const st of ['pass', 'fail', 'fail', 'pass']) { console.log('click', st); await first.locator(`button[data-status=${st}]`).click({ timeout: 15000 }); await page.waitForTimeout(4000); console.log('pressed', await first.locator(`button[data-status=${st}]`).getAttribute('aria-pressed'), '| saving text:', await page.getByText('กำลังบันทึก…').count()); }
await ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } }); await b.close();
