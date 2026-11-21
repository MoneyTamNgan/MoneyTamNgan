// Small flow runner: one browser context per flow, a video of the whole flow, a banner with the current step,
// a screenshot after every step, and a results.json that feeds the test sheet.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE_URL || 'http://localhost:3000';
export const OUT = process.env.EVIDENCE_DIR || 'evidence';
export const TOR = process.env.TOR_ID || '69109345522';
const only = (process.env.FLOWS || '').split(',').filter(Boolean);

const BANNER = `
(() => {
  const draw = () => {
    let el = document.getElementById('__step_banner');
    if (!el) { el = document.createElement('div'); el.id = '__step_banner';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#111c;color:#fff;font:600 15px/1.35 system-ui,sans-serif;padding:8px 14px;pointer-events:none;white-space:pre-wrap';
      (document.body || document.documentElement).appendChild(el); }
    let t = ''; try { t = sessionStorage.getItem('__step') || ''; } catch {}
    el.textContent = t; el.style.display = t ? 'block' : 'none';
  };
  addEventListener('DOMContentLoaded', draw); addEventListener('load', draw);
  setInterval(draw, 400);
})();`;

export const randomId = () => Math.random().toString(16).slice(2, 8);
export const newUser = (tag = randomId()) => ({
  email: `e2e-ui-${tag}@example.test`, username: `e2e_ui_${tag}`, password: `E2e-Test-${tag}-Zq9xLong`, name: `E2E UI ${tag}`,
});

export async function apiLogin(ctx, user, { register = true } = {}) {
  const h = { Origin: BASE };
  // sign-in and registration share a limit of 30 per 15 minutes per address: honour Retry-After instead of failing the flow
  const post = async (path, data) => {
    for (let i = 0; i < 3; i++) {
      const r = await ctx.request.post(`${BASE}${path}`, { data, headers: h }); if (r.status() !== 429) return r;
      const wait = Math.min(Number(r.headers()['retry-after'] || 60), 960); await new Promise(res => setTimeout(res, (wait + 2) * 1000));
    }
    return ctx.request.post(`${BASE}${path}`, { data, headers: h });
  };
  if (register) { const rr = await post('/api/auth/register', user); if (rr.status() === 201 && (await ctx.request.get(`${BASE}/api/auth/me`)).ok()) return; }  // registering already signs in
  const r = await post('/api/auth/login', { identifier: user.email, password: user.password });
  if (!r.ok()) throw new Error(`api login failed ${r.status()}`);
}
export async function apiDeleteAccount(ctx) { await ctx.request.delete(`${BASE}/api/profiles`, { headers: { Origin: BASE } }).catch(() => {}); }

/** Runs one flow. `body(f)` calls `await f.step(id, action, expected, fn)`. */
export async function runFlow(browser, flow, results) {
  if (only.length && !only.includes(flow.id)) return;
  const dir = path.join(OUT, flow.id);
  fs.mkdirSync(dir, { recursive: true });
  const viewport = flow.viewport || { width: 1280, height: 720 };
  const ctx = await browser.newContext({ viewport, recordVideo: { dir, size: viewport }, extraHTTPHeaders: { Origin: BASE }, acceptDownloads: true, locale: 'th-TH', bypassCSP: true });
  await ctx.addInitScript(BANNER);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const rec = { id: flow.id, title: flow.title, video: `${flow.id}/${flow.id}.webm`, steps: [] };
  let n = 0;
  const f = {
    page, ctx, dir,
    async step(id, action, expected, fn) {
      n += 1;
      const label = `${flow.id} ${id}  ${action}`;
      await page.evaluate(l => { try { sessionStorage.setItem('__step', l); } catch {} }, label).catch(() => {});
      const s = { id, action, expected, at: Math.round((Date.now() - t0) / 1000), result: 'PASS', actual: '' };
      try { s.actual = (await fn()) || 'as expected'; }
      catch (e) { s.result = 'FAIL'; s.actual = String(e.message || e).split('\n')[0].slice(0, 220); }
      await page.waitForTimeout(700);
      const shot = `${String(n).padStart(2, '0')}-${id}.png`;
      await page.screenshot({ path: path.join(dir, shot) }).catch(() => {});
      s.screenshot = `${flow.id}/${shot}`;
      rec.steps.push(s);
      console.log(`${s.result === 'PASS' ? 'PASS' : 'FAIL'} ${flow.id} ${id} ${s.actual}`);
    },
  };
  try { await flow.run(f); }
  catch (e) { rec.steps.push({ id: 'ABORT', action: 'flow setup', expected: 'flow runs', result: 'FAIL', actual: String(e.message).slice(0, 220), at: Math.round((Date.now() - t0) / 1000) }); }
  await page.evaluate(() => { try { sessionStorage.removeItem('__step'); } catch {} }).catch(() => {});
  const video = page.video();
  await ctx.close();
  if (video) { const p = await video.path(); fs.renameSync(p, path.join(dir, `${flow.id}.webm`)); }
  rec.seconds = Math.round((Date.now() - t0) / 1000);
  results.push(rec);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
}

export async function launch() { return chromium.launch(); }
export function expect(cond, msg) { if (!cond) throw new Error(msg); }
