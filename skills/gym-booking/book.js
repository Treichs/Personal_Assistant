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
  opts.week = opts.week || targetWeek(new Date()).monday;
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

async function listClasses(opts) {
  const classes = await fetchWeek(opts.week, publicGetJson);
  const rows = classListRows(classes, STUDIOS);
  writeJson(opts.out, 'classes.json', rows);
  console.log(`classes.json: ${rows.length} rows for week of ${opts.week}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opts.out, { recursive: true });
  if (opts.listClasses) return listClasses(opts);
  throw new Error('only --list-classes is available so far');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof StopError ? `STOPPED: ${e.message}` : e.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, fetchWeek, publicGetJson, StopError, DATA_HOST, STUDIOS };
