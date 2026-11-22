// Dumps the visible controls of each page for a guest and for a signed-in user, to write accurate UI scenarios.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TOR = process.env.TOR_ID || '69109345522';
const tag = Math.random().toString(16).slice(2, 8);
const user = { email: `e2e-d-${tag}@example.test`, username: `e2e_d_${tag}`, password: `E2e-Test-${tag}-Zq9x`, name: 'E2E Discover' };
const browser = await chromium.launch();
async function dump(ctx, label, paths) {
  const page = await ctx.newPage(); const out = {};
  for (const p of paths) {
    await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    out[`${label} ${p}`] = await page.evaluate(() => ({
      url: location.pathname,
      headings: [...document.querySelectorAll('h1,h2,h3')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 12),
      buttons: [...document.querySelectorAll('button')].map(e => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 40),
      links: [...document.querySelectorAll('a[href]')].map(e => `${(e.innerText || '').trim().slice(0, 30)} -> ${e.getAttribute('href')}`).slice(0, 25),
      inputs: [...document.querySelectorAll('input,select,textarea')].map(e => `${e.tagName.toLowerCase()}[${e.type || ''}] name=${e.name} id=${e.id} ph=${e.placeholder || ''} label=${e.getAttribute('aria-label') || ''}`).slice(0, 40),
    }));
  }
  await page.close(); return out;
}
const paths = ['/', '/dashboard', '/projects', `/tors/${TOR}`, `/tors/${TOR}/document`, '/analytics', '/bid-prep', '/profile', '/admin'];
const result = {};
Object.assign(result, await dump(await browser.newContext(), 'guest', paths));
const uctx = await browser.newContext({ extraHTTPHeaders: { Origin: BASE } });
await uctx.request.post(`${BASE}/api/auth/register`, { data: user });
await uctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: user.email, password: user.password } });
Object.assign(result, await dump(uctx, 'user', paths));
await uctx.request.delete(`${BASE}/api/profiles`);
await browser.close();
fs.writeFileSync(process.env.OUT || 'discover.json', JSON.stringify(result, null, 1));
console.log('done', Object.keys(result).length);
