// Screenshots of key pages at 360, 768 and 1280 px (#144). Creates one throw-away account and deletes it at the end.
// docker run --rm --network host -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.49.1-noble \
//   sh -c 'npm i --no-save --no-audit --no-fund playwright@1.49.1 && node tests/e2e/screenshots.mjs'
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.SHOTS_DIR || 'shots';
const TOR = process.env.TOR_ID || '69109345522';
fs.mkdirSync(OUT, { recursive: true });
const tag = Math.random().toString(16).slice(2, 8);
const user = { email: `e2e-s-${tag}@example.test`, username: `e2e_s_${tag}`, password: `E2e-Test-${tag}-Zq9x`, name: 'E2E Shots' };
const browser = await chromium.launch();
const ctx = await browser.newContext({ extraHTTPHeaders: { Origin: BASE } });
const api = ctx.request;
await api.post(`${BASE}/api/auth/register`, { data: user });
await api.post(`${BASE}/api/auth/login`, { data: { identifier: user.email, password: user.password } });
await api.put(`${BASE}/api/profiles`, { data: { company_name: 'E2E Test Co', registered_capital: 5000000, skills: ['Next.js'] } });
const dr = await api.post(`${BASE}/api/bid-prep/drafts`, { data: { projectId: TOR, title: 'E2E draft', sections: [{ heading: 'Company overview', body: 'Test body. [to fill in: company facts]', sources: ['profile.company_name'] }] } });
const draftId = (await dr.json()).draft?._id || (await dr.json()).id || (await dr.json())._id;
const pages = { home: '/', projects: '/projects', 'tor-detail': `/tors/${TOR}`, profile: '/profile', 'bid-prep': '/bid-prep' };
if (draftId) pages['draft-editor'] = `/bid-prep/drafts/${draftId}`;
const log = [];
for (const width of [360, 768, 1280]) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
  for (const [name, path] of Object.entries(pages)) {
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => ({ status: () => 'ERR ' + e.message.slice(0, 40) }));
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1).catch(() => null);
    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
    log.push({ page: name, width, status: res.status?.(), horizontalOverflow: overflow });
  }
  await page.close();
}
await api.delete(`${BASE}/api/profiles`);
await browser.close();
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(log, null, 1));
console.table(log);
