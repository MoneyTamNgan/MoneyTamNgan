// Browser check for issue #108 (username on register and login).
// Drives the real login/register form with headless Chromium (Playwright) and
// checks the API responses and the HTTP status of every step.
//
// Not part of `npm test` or vitest: it needs a running app and a browser.
// See tests/e2e/README.md. Use a throwaway database, because it creates users.
//
//   BASE_URL=http://localhost:3000 SHOTS_DIR=./shots node tests/e2e/auth-username-browser.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR || './shots';
const PW = 'correct-horse-battery-staple-1';
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const browser = await chromium.launch();

// Submit the form and return the HTTP status of the auth call. The page may
// navigate right after a success, so the body is read separately through the API.
async function submit(page) {
  const [resp] = await Promise.all([
    page.waitForResponse(r => /\/api\/auth\/(login|register)/.test(r.url()) && r.request().method() === 'POST'),
    page.locator('button.sign-in').click(),
  ]);
  return resp.status();
}

async function register(tag, username) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: 'สร้างบัญชี' }).last().click();
  const email = `${tag}@example.test`;
  await page.fill('#email', email);
  if (username) await page.fill('#username', username);
  await page.fill('#password', PW);
  await page.fill('#confirmPassword', PW);
  const status = await submit(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/register-${tag}.png` });
  await ctx.close();
  return { email, status };
}

async function login(identifier, password, shot) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.fill('#identifier', identifier);
  await page.fill('#password', password);
  const status = await submit(page);
  await page.waitForTimeout(1500);
  const notice = await page.locator('.notice').first().textContent().catch(() => null);
  const url = page.url();
  await page.screenshot({ path: `${SHOTS}/${shot}.png` });
  await ctx.close();
  return { status, notice, url };
}

// Same login through the API, to read the returned user (the form navigates away).
async function apiLogin(identifier) {
  const ctx = await browser.newContext();
  const resp = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { identifier, password: PW },
    headers: { Origin: BASE },
  });
  const text = await resp.text();
  await ctx.close();
  let body = {};
  try { body = JSON.parse(text); } catch { /* keep empty */ }
  return { status: resp.status(), body, text };
}

const id = Date.now().toString(36);

const a = await register(`alice-${id}`, `Alice.${id}`);
check('register with a username -> 201', a.status === 201, `status ${a.status}`);
const aApi = await apiLogin(a.email);
check('username is stored lowercase', aApi.body?.user?.username === `alice.${id}`, `username=${aApi.body?.user?.username}`);

const b = await register(`bob-${id}`);
check('register without a username -> 201', b.status === 201, `status ${b.status}`);
const bApi = await apiLogin(b.email);
check('username is derived from the email', bApi.body?.user?.username?.startsWith('bob'), `username=${bApi.body?.user?.username}`);

const l1 = await login(a.email, PW, 'login-email');
check('login with the email -> 200 and /dashboard', l1.status === 200 && l1.url.endsWith('/dashboard'), `status ${l1.status}, ${l1.url}`);

const l2 = await login(`ALICE.${id.toUpperCase()}`, PW, 'login-username-upper');
check('login with an UPPER-CASE username -> 200 and /dashboard', l2.status === 200 && l2.url.endsWith('/dashboard'), `status ${l2.status}, ${l2.url}`);

const aUpper = await apiLogin(`ALICE.${id.toUpperCase()}`);
check('email and username resolve to the same account', !!aApi.body?.user?.id && aApi.body.user.id === aUpper.body?.user?.id);

const l3 = await login(`nobody.${id}`, PW, 'login-wrong-username');
check('unknown username -> 401', l3.status === 401, `status ${l3.status}`);

const l4 = await login(a.email, 'not-the-right-password-xyz', 'login-wrong-password');
check('wrong password -> 401', l4.status === 401, `status ${l4.status}`);
check('unknown username and wrong password show the same message', !!l3.notice && l3.notice === l4.notice);

const c = await register(`carol-${id}`, `alice.${id}`);
check('taken username -> 409', c.status === 409, `status ${c.status}`);

check('no response contains passwordHash', ![aApi, bApi, aUpper].some(r => r.text.includes('passwordHash')));

await browser.close();
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
