#!/usr/bin/env node
// Browser and network glue for gym booking. Decisions live in plan.js.
//
// Usage:
//   node book.js --list-classes [--week YYYY-MM-DD] --out DIR
//   node book.js --dry-run [--no-wait] [--week YYYY-MM-DD] --plan FILE --out DIR
//
// Run outputs go to --out (a scratch folder), never inside the repo.
// SAFETY: no code in this file clicks "Complete Reservation", Cancel, Join Waitlist,
// or anything that buys or pays.

const fs = require('node:fs');
const path = require('node:path');
const { targetWeek, normalizeClass, classListRows, addDays } = require('./plan');

const DATA_HOST = 'https://sweatandtonic.marianatek.com';
const ACCOUNT_URL = 'https://sweatandtonic.com/account/login';
const RESERVE_URL = 'https://sweatandtonic.com/pages/reserve';
const WIDGET_HOST = 'marianaiframes.com';
const REGION = '48541';
const STUDIOS = ['48750', '48717']; // The Well, Yonge & Shuter
const PAGE_PAUSE_MS = 500; // be gentle: one careful person, not a crawler

class StopError extends Error {}

function parseArgs(argv) {
  const opts = { dryRun: false, noWait: false, listClasses: false, week: null, out: null, plan: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-wait') opts.noWait = true;
    else if (a === '--list-classes') opts.listClasses = true;
    else if (a === '--week') opts.week = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--plan') opts.plan = argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  if (!opts.out) throw new Error('--out DIR is required');
  if (opts.week && !/^\d{4}-\d{2}-\d{2}$/.test(opts.week)) throw new Error('--week must be YYYY-MM-DD');
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function publicGetJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new StopError(`class data request failed: HTTP ${res.status}`);
  return res.json();
}

// All classes in the region for Monday..Sunday, following the API's `next` links.
async function fetchWeek(monday, getJson) {
  const params = new URLSearchParams({ min_start_date: monday, max_start_date: addDays(monday, 6),
    page_size: '200', region: REGION });
  let url = `${DATA_HOST}/api/customer/v1/classes?${params}`;
  const all = [];
  while (url) {
    if (!url.startsWith(`${DATA_HOST}/`)) throw new StopError(`unexpected data link ${new URL(url).host}`);
    const page = await getJson(url);
    all.push(...page.results);
    url = page.next;
    if (url) await sleep(PAGE_PAUSE_MS);
  }
  return all.map(normalizeClass);
}

function writeJson(dir, name, data) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
}

// ---- Signed-in browser work ----

const BLOCK_TEXT = /verify you('|’)?re (a )?human|are you a robot|unusual activity/i;

// Throws StopError if any frame shows a human-verification challenge. We never try to get past one.
// (The invisible reCAPTCHA "anchor" frame is always there; only a visible challenge counts.)
async function checkForBlock(page) {
  for (const f of page.frames()) {
    const u = f.url();
    if (/recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com/.test(u)) {
      const el = await f.frameElement().catch(() => null);
      if (el && await el.isVisible().catch(() => false)) throw new StopError('verification check');
    }
    const text = await f.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    if (BLOCK_TEXT.test(text)) throw new StopError('verification check');
  }
}

const widgetFrame = (page, part) => page.frames().find((f) => f.url().includes(WIDGET_HOST) && f.url().includes(part));

async function waitForWidget(page, part, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = widgetFrame(page, part);
    if (f) return f;
    await sleep(500);
  }
  throw new StopError(`booking widget did not load (${part})`);
}

// Same route the user takes: account page, LOG IN, Mariana Tek login page, back to the site.
// Submits the form once; no retries. Never prints the login.
async function signIn(page) {
  const email = process.env.GYM_EMAIL;
  const password = process.env.GYM_PASSWORD;
  if (!email || !password) throw new StopError('GYM_EMAIL / GYM_PASSWORD are not set');
  await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const account = await waitForWidget(page, '/iframe/account');
  await checkForBlock(page);
  await account.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/marianatek\.com\/auth\/login/, { timeout: 30000 });
  await checkForBlock(page);
  await page.fill('#id_username', email);
  await page.fill('#id_password', password);
  await page.locator('button[type=submit]').click();
  const left = await page.waitForURL((u) => !/\/auth\/login/.test(u.pathname), { timeout: 20000 })
    .then(() => true, () => false);
  if (!left) {
    await checkForBlock(page);
    const msg = await page.locator('.errorlist, .error, [role=alert], .alert').allInnerTexts().catch(() => []);
    const text = msg.join(' ').replace(/\s+/g, ' ').trim().split(email).join('[email]').slice(0, 200);
    throw new StopError(`sign-in failed: ${text || 'still on the login page'}`);
  }
  // The login hands back through the widget's callback to the website; let that redirect finish
  // before navigating anywhere else, or the next page load is aborted.
  const back = await page.waitForURL((u) => u.hostname === 'sweatandtonic.com', { timeout: 30000 })
    .then(() => true, () => false);
  if (!back) throw new StopError(`sign-in did not return to the website (at ${new URL(page.url()).host})`);
  await page.waitForLoadState('load').catch(() => {});
  await waitForWidget(page, '/iframe/account');
  await sleep(3000);
  await checkForBlock(page);
}

// Reads class data as the signed-in user.
// Discovery (2026-10-24, first signed-in run): after sign-in the widget on /pages/reserve calls
// /api/customer/v1/... with an `authorization` header (its own session token); no cookies needed.
// Re-using that header from inside the widget frame with a plain fetch works. Adding
// credentials:'include' makes the browser refuse the request (cross-site rules), so it is left out.
// If the in-frame fetch ever fails, the same GET is made directly with the same header.
async function signedInGetJson(page) {
  let auth = null;
  const onRequest = (req) => {
    if (req.url().startsWith(`${DATA_HOST}/api/customer/v1/`) && req.headers().authorization) auth = req.headers().authorization;
  };
  page.on('request', onRequest);
  await page.goto(RESERVE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const widget = await waitForWidget(page, '/iframe/');
  for (let i = 0; i < 40 && !auth; i++) await sleep(500);
  page.off('request', onRequest);
  await checkForBlock(page);
  console.log(`widget sends an authorization header: ${auth ? 'yes' : 'no'}`);
  if (!auth) throw new StopError('could not find the signed-in session in the booking widget');
  const headers = { accept: 'application/json', authorization: auth };
  let via = null;
  return async (url) => {
    let res = null;
    if (via !== 'node') {
      res = await widget.evaluate(async ({ url, headers }) => {
        try {
          const r = await fetch(url, { headers });
          return { status: r.status, body: r.ok ? await r.json() : null };
        } catch (e) { return null; }
      }, { url, headers });
    }
    if (!res) {
      const r = await fetch(url, { headers });
      res = { status: r.status, body: r.ok ? await r.json() : null };
      if (!via) { via = 'node'; console.log('signed-in reads: made directly with the widget\'s session'); }
    } else if (!via) { via = 'widget'; console.log('signed-in reads: made inside the booking widget'); }
    if (!res.body) throw new StopError(`signed-in data request failed: HTTP ${res.status}`);
    return res.body;
  };
}

async function runDry(opts) {
  const plan = JSON.parse(fs.readFileSync(opts.plan, 'utf8'));
  const monday = opts.week || (plan.week && plan.week.monday) || targetWeek(new Date()).monday;
  const results = { mode: 'dry-run', week: { monday, sunday: addDays(monday, 6) },
    startedAt: new Date().toISOString(), finishedAt: null, stopped: null, days: [], blockedHosts: [] };
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const blocked = new Set();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('requestfailed', (r) => blocked.add(new URL(r.url()).host));
    await signIn(page);
    const getJson = await signedInGetJson(page);
    await page.screenshot({ path: path.join(opts.out, 'signed-in.png') });
    const weekClasses = await fetchWeek(monday, getJson);
    const count = (k) => weekClasses.filter((c) => c[k]).length;
    console.log(`signed-in week ${monday}: ${weekClasses.length} classes, ${count('reserved')} reserved, ${count('waitlisted')} waitlisted`);
    // Booking walk-through for plan.days is added in Task 5.
  } catch (e) {
    results.stopped = e instanceof StopError ? e.message : `script error: ${e.message}`;
  } finally {
    results.blockedHosts = [...blocked].sort();
    results.finishedAt = new Date().toISOString();
    writeJson(opts.out, 'results.json', results);
    await browser.close();
  }
  console.log(`results.json written; stopped: ${results.stopped}`);
}

async function listClasses(opts) {
  opts.week = opts.week || targetWeek(new Date()).monday;
  const classes = await fetchWeek(opts.week, publicGetJson);
  const rows = classListRows(classes, STUDIOS);
  writeJson(opts.out, 'classes.json', rows);
  console.log(`classes.json: ${rows.length} rows for week of ${opts.week}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opts.out, { recursive: true });
  if (opts.listClasses) return listClasses(opts);
  if (!opts.dryRun) throw new Error('only --dry-run is available (live booking is not built yet)');
  if (!opts.plan) throw new Error('--plan FILE is required');
  return runDry(opts);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof StopError ? `STOPPED: ${e.message}` : e.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, fetchWeek, publicGetJson, signIn, signedInGetJson, checkForBlock,
  StopError, DATA_HOST, STUDIOS };
