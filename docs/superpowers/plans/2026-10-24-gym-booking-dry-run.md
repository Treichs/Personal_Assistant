# Gym Booking (through first dry run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the gym-booking skill as far as a successful first dry run: it signs in from the cloud, matches the user's Sheet choices to real classes, walks each one to the "Confirm Your Reservation" screen, books nothing, and emails a summary.

**Architecture:** Plain-English instructions (`SKILL.md`) handle the Sheet, `plan.json`, the summary email and the Class List refresh. A small Node script runs in Playwright and does the time-critical browser work. All decision logic lives in `plan.js` (pure, unit-tested). `book.js` holds the browser and network glue.

**Tech Stack:** Node (built-ins only: `node:test`, `fetch`, `Intl`), Playwright with Chromium (pre-installed; `require('playwright')`), Google Sheets and Gmail connectors.

**Spec:** docs/superpowers/specs/2026-10-24-gym-booking-design.md

## Global Constraints

- No npm dependencies and no `package.json`; Playwright is already installed globally.
- Timezone `America/Toronto`. Weeks run Monday–Sunday. A Saturday run targets the Monday 9 days later.
- Studios: The Well `48750`, Yonge & Shuter `48717`. Region `48541`. Data host `https://sweatandtonic.marianatek.com`; login `https://sweatandtonic.marianatek.com/auth/login/`; booking page `https://sweatandtonic.com/pages/reserve`.
- Login only from the `GYM_EMAIL` / `GYM_PASSWORD` environment variables. Never print, log, screenshot or commit them. Take screenshots only after the login page has been left.
- Hard rules 1–6 and the care rules in the spec apply to every task that touches the site.
- **No code path clicks "Complete Reservation" in this plan.** That click is added in the later live-test task (L2), after the user approves it.
- Run outputs (`plan.json`, `results.json`, `classes.json`, screenshots) go to a run folder passed as `--out`, never inside the repo.
- Every task that runs anything signed-in tells the user first and runs only with their go-ahead.

## Refinements to the spec (found while planning, from a public data sample)

- Match a Sheet choice on the **class type** (`class_type.name`, exact, ignoring capitals) plus date, start time and studio. Event names change weekly ("Beat Ride: Pop Girlies") but the type stays "Beat Ride". Dropdown labels use the type name.
- Class List excludes anything with `capacity <= 1` (meeting rooms) and anything cancelled (`is_cancelled`).
- Overlap and "already booked" checks only need the target week. Bookings in other weeks cannot overlap with it. So they use `is_user_reserved` / `is_user_waitlisted` from the signed-in class data, and no separate bookings request is needed.

## Review Focus

1. Run time near midnight UTC: Saturday 8pm or later in Toronto is already Sunday in UTC. `targetWeek` must use the Toronto date (test in Task 1).
2. Daylight saving ends Sun Nov 1 2026. Week maths and the 5:00pm wait must use Toronto local time, not fixed offsets (tests in Task 1 and Task 5).
3. Messy spot text from a phone, such as `" 4-w ,5-W,, ANY"`, must become `['4-W','5-W','any']` (test in Task 1).
4. Sheet values arrive as strings (`'TRUE'`, `'1'`), and unticked or empty rows must be ignored, not treated as errors (test in Task 1).
5. Two classes with the same type, time and studio on one date, or none at all, must produce a clear "no match" or "multiple matches" reason, never a guess (test in Task 1).

---

### Task 1: Pure decision logic (`plan.js`)

**Files:**
- Create: `skills/gym-booking/plan.js`
- Test: `skills/gym-booking/plan.test.js`

**Interfaces (Produces), CommonJS `module.exports`:**
- `targetWeek(now: Date) -> { monday: 'YYYY-MM-DD', sunday: 'YYYY-MM-DD' }`: take the Toronto date of `now`, find the next Saturday on or after it, and add 9 days for the Monday (Sat Oct 24 gives Mon Nov 2).
- `formatTime(hhmmss: string) -> string`: `'06:10:00'` becomes `'6:10 AM'` and `'18:30:00'` becomes `'6:30 PM'`.
- `normalizeClass(api) -> Cls` where `Cls = { id, name, typeName, studioId, studioName, date, weekday /* 'Mon'..'Sun' */, time /* '6:10 AM' */, startMs, endMs, status /* null | 'Not Open' | 'Waitlist Only' | other */, bookingStart /* ISO */, availableSpots, layout /* 'pick-a-spot' | 'first-come-first-serve' */, reserved, waitlisted, cancelled, capacity }`. It reads `class_type.name`, `location.id/name`, `start_date`, `start_time`, `start_datetime` (UTC), `class_type.duration` (minutes), `booking_start_datetime`, `available_spot_count`, `layout_format`, `is_user_reserved`, `is_user_waitlisted`, `is_cancelled`, `capacity`, `status`.
- `classListRows(classes: Cls[], studioIds: string[]) -> { label, weekday, time, typeName, studioName, studioId }[]`: unique by weekday+label, sorted by weekday then time. Label is `` `${time} · ${typeName} · ${studioName}` ``. Excludes capacity ≤ 1, cancelled, and other studios.
- `parseSpots(text: string) -> string[]`: split on commas, trim, uppercase, keep `any` in lowercase, drop empties. An empty result becomes `['any']`.
- `buildPlan(rows: string[][], paused: boolean, week) -> Plan`. `rows` are the Booking List values with the header first: `Day | Choice | On | Time | Class | Studio | Studio id | Spots`. `Plan = { week, paused, days: [{ day, date, choices: [{ choice, time, typeName, studioId, spots }] }] }`. Keeps only `On` = `TRUE`/`true`, orders choices by number, sets `date` from `week.monday` plus the weekday offset, and leaves out days with no active choice.
- `matchClass(choice, date, classes: Cls[]) -> { cls } | { reason: 'no match' | 'multiple matches' }`: same date, same `time`, same `studioId`, and `typeName` equal ignoring capitals. Cancelled classes don't count.
- `ruleViolation(cls, { week, bookedThisRun: Cls[], weekClasses: Cls[] }) -> string | null`: returns `'cancelled'`, `'outside target week'`, `'already booked'`, `'already waitlisted'`, or `` `overlaps ${other.typeName} ${other.time}` `` when it overlaps any `weekClasses` entry with `reserved` true or any `bookedThisRun` entry. Otherwise `null`.
- `pickSpot(spots: string[], layoutSpots: { name, is_available }[]) -> string | null`: the first listed spot that is available, matched ignoring capitals. `any` means the first available spot in layout order. Returns `null` if none.
- `msUntil(isoOpen: string, now: Date) -> number`: milliseconds until the opening time, never below 0.

- [x] **Step 1: Write the failing tests** in `plan.test.js` (`node:test` plus `assert`), using small hand-made API objects:
  - `targetWeek(new Date('2026-10-24T16:00:00Z'))` gives `{monday:'2026-11-02', sunday:'2026-11-08'}`. `2026-10-25T01:30:00Z` (Sat 9:30pm Toronto) gives the same. `2026-10-31T21:00:00Z` gives `2026-11-09..2026-11-15`. `2026-10-29T12:00:00Z` (Thu) gives `2026-11-09..15`.
  - `formatTime('06:10:00') === '6:10 AM'`, `formatTime('12:00:00') === '12:00 PM'`, `formatTime('18:30:00') === '6:30 PM'`.
  - `normalizeClass` on a sample with `start_date:'2026-11-04'`, `start_time:'06:10:00'`, `start_datetime:'2026-11-04T11:10:00Z'` and `class_type.duration:45` gives `endMs - startMs === 45*60000`, `weekday === 'Wed'` and `time === '6:10 AM'`.
  - `classListRows` drops a `capacity:1` "Meeting Room South", a cancelled class and a studio `48999`, and collapses two identical Wed 6:10 Top HIIT The Well classes into one row.
  - `parseSpots(' 4-w ,5-W,, ANY') ` deep-equals `['4-W','5-W','any']`, and `parseSpots('')` deep-equals `['any']`.
  - `buildPlan` with a header row plus rows `['Wed','2','TRUE',...]`, `['Wed','1','TRUE',...]`, `['Thu','1','FALSE',...]` and `['','','',...]` gives one day, Wed, with date `2026-11-04` and choices ordered 1, 2.
  - `matchClass` gives `'no match'` for a wrong time and `'multiple matches'` for two identical classes, and matches `'top hiit'` against type `'Top HIIT'`.
  - `ruleViolation` gives `'already booked'` for `reserved:true`, `'overlaps Lift HIIT 7:10 AM'` against a reserved 7:10 class when a 6:40 class runs 45 min, `'outside target week'` for a date before `week.monday`, and `null` for a clean class.
  - `pickSpot(['4-W','5-W'], [{name:'4-W',is_available:false},{name:'5-W',is_available:true}]) === '5-W'`, `pickSpot(['4-W'], [{name:'4-W',is_available:false},{name:'9-F',is_available:true}]) === null`, and `pickSpot(['any'], …) === '9-F'`.
  - `msUntil('2026-10-31T17:00:00-04:00', new Date('2026-10-31T20:59:00Z')) === 60000`, and it returns 0 once past.
- [x] **Step 2: Run** `node --test skills/gym-booking/*.test.js` (Node 22 does not accept a bare folder) and confirm it fails with `Cannot find module './plan'`.
- [x] **Step 3: Implement `plan.js`.** Get Toronto dates with `Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'})`. Do date arithmetic on `YYYY-MM-DD` strings through `Date.UTC`, never with local offsets.
- [x] **Step 4: Run** `node --test skills/gym-booking/*.test.js` (Node 22 does not accept a bare folder) and confirm all tests pass.
- [x] **Step 5: Commit** `git add skills/gym-booking/plan.js skills/gym-booking/plan.test.js && git commit -m "Add gym-booking decision logic with tests"`

### Task 2: Public class list (`book.js --list-classes`)

This step involves no sign-in and only read-only public data.

**Files:**
- Create: `skills/gym-booking/book.js`

**Interfaces:**
- Consumes: `normalizeClass`, `classListRows`, `targetWeek` from Task 1.
- Produces: the CLI `node skills/gym-booking/book.js --list-classes --week YYYY-MM-DD --out DIR`, which writes `DIR/classes.json` = `classListRows(...)` for the Monday–Sunday starting at `--week` (defaulting to `targetWeek(new Date()).monday`). Also the internal `fetchWeek(monday, getJson) -> Cls[]`, which pages through `/api/customer/v1/classes?min_start_date&max_start_date&page_size=200&region=48541` following `next`. `getJson(url)` is injected so Task 4 can swap in a signed-in version.
- Option parsing for all later modes: `--dry-run`, `--week`, `--no-wait`, `--out`, `--plan`, `--list-classes`. `--out` is required.

- [x] **Step 1: Run** `node skills/gym-booking/book.js --list-classes --week 2026-11-02 --out "$RUN"` (with `RUN` a scratch folder). Confirm `classes.json` has rows for all seven weekdays, includes `"6:10 AM · Top HIIT · The Well"` on Wed, and contains no "Meeting Room" entries.
- [x] **Step 2: Commit** `git add skills/gym-booking/book.js && git commit -m "Add public class list mode to booking script"`

### Task 3: Build the preferences Sheet

This needs the user: they create a blank Google Sheet and paste its link. Use the `google-workspace` skill's Sheets reference before writing.

**Files:**
- Modify: `skills/gym-booking/SKILL.md` (add a `## Settings` section with the Sheet ID, and `## Setting up the Sheet` with these steps so they can be repeated).

**Interfaces:**
- Consumes: `classes.json` from Task 2.
- Produces: tabs with exact names `My Plan`, `Class List` and `Booking List`.
  - `My Plan`: B1 "Pause all bookings", C1 a tick box. Header on row 3: `Day | Book? | 1st choice | Spots | 2nd choice | Spots | 3rd choice | Spots`. Rows 4–10 are Mon–Sun, with tick boxes in B4:B10.
  - `Class List`: A1:G1 headers `Mon..Sun`, each column listing that weekday's labels (feeding the dropdowns). I1:N1 headers `Weekday | Label | Time | Class | Studio | Studio id`, then the long table.
  - `Booking List`: header `Day | Choice | On | Time | Class | Studio | Studio id | Spots` on row 1, then 21 formula rows. Each row reads from the matching `My Plan` cell. `On` = ticked AND choice not blank AND NOT pause. Time, Class, Studio and Studio id come from a `FILTER` on `Class List!I:N`, matching weekday AND label.
  - Dropdowns: row *r*'s choice cells use `ONE_OF_RANGE` on that weekday's column in `Class List` (Mon row uses `='Class List'!A2:A200`, and so on; a real week has up to 93 classes per day).
  - Warning-only protection on `Class List` and `Booking List`.

- [x] **Step 1:** Ask the user for the blank Sheet's link. Write all three tabs and the formatting in one `update_spreadsheet` batch, then the values and formulas.
- [x] **Step 2: Verify.** Read `Booking List!A1:H22` with `get_values`. Confirm 21 rows, all `On` FALSE. Then temporarily fill `My Plan` Wed with Book? ticked, 1st choice `6:10 AM · Top HIIT · The Well`, Spots `4-W`. Re-read and confirm `Wed | 1 | TRUE | 6:10 AM | Top HIIT | The Well | 48750 | 4-W`. Clear the test entry.
- [ ] **Step 3:** Ask the user to open the Sheet in the Google Sheets app and fill in their real choices. Confirm the dropdowns and tick boxes work on their phone.
- [x] **Step 4: Commit** `git add skills/gym-booking/SKILL.md && git commit -m "Record preferences Sheet and its setup steps"`

### Task 4: Sign in and read the week as the user (read-only)

Tell the user before running. This is the first sign-in from the cloud.

**Files:**
- Modify: `skills/gym-booking/book.js`

**Interfaces:**
- Produces: `signIn(page) -> void`, which fills `GYM_EMAIL`/`GYM_PASSWORD` on the login page, submits once, and throws `StopError('sign-in failed: <visible message>')` if the login page is still showing after 20s. Also `signedInGetJson(page) -> (url) => Promise<object>`.
  - Discovery (record what was found in a comment at the top of `signedInGetJson`): load the booking page while signed in, capture the widget's own request to `/api/customer/v1/classes` with `page.on('request')`, and reuse its `authorization` header, if any, for later GETs, made with `fetch` inside the widget frame using `credentials:'include'`.
  - Also `checkForBlock(page) -> void`, which throws `StopError('verification check')` if any frame shows reCAPTCHA challenge or hCaptcha iframes, or text matching `/verify you are human|are you a robot|unusual activity/i`. Called after every navigation.
- Reach the signed-in state by the same route the user takes: `https://sweatandtonic.com/account/login`, then the LOG IN button, then the Mariana Tek login page, then sign in, then return to `/pages/reserve`.

- [ ] **Step 1:** Run `node skills/gym-booking/book.js --dry-run --no-wait --week 2026-10-26 --out "$RUN" --plan "$RUN/empty-plan.json"`, where the plan has no days. The script signs in, fetches the week signed in, and writes `results.json` with `stopped:null` and `days:[]`, plus `signed-in.png`.
- [ ] **Step 2: Verify** that the user's known bookings (5 classes, Oct 26–30) come back with `reserved:true` in the week data (log a count only), and that no verification check was hit. If one was, stop and report to the user.
- [ ] **Step 3: Commit** `git commit -am "Add read-only sign-in and signed-in data reads"`

### Task 5: Walk to the confirm screen (dry run) and wait for opening

**Files:**
- Modify: `skills/gym-booking/book.js`

**Interfaces:**
- Consumes: `buildPlan`'s `Plan` shape (read from `--plan`), `matchClass`, `ruleViolation`, `pickSpot`, `msUntil`.
- Produces: `results.json` = `{ mode: 'dry-run', week, startedAt, finishedAt, stopped: null | string, days: [{ day, date, outcome: 'would-book' | 'could-not-book', choice, classId, typeName, time, studio, spot, notes: string[], screenshot }] }`. `notes` holds one line per choice tried, such as `"1st: Top HIIT 6:10 AM — class full"`.
- Per day: for each choice, call `matchClass` and then `ruleViolation`, and record the reason and move on if either fails. Re-fetch the class detail (`/classes/{id}`). If its `status` isn't null, note it and move on. If it's `pick-a-spot`, call `pickSpot` on `layout.spots`. In the widget, open the class, click the spot, and wait for "Confirm Your Reservation". Check that the screen shows the class name, time and spot, and that "Pay With" includes "Unlimited". Screenshot it, record `would-book`, then go back without clicking anything else.
- Waiting (skipped with `--no-wait`): sleep until `msUntil(bookingStart)` of the first matched class. Then, for classes still "Not Open", re-fetch every 3s for at most 120s (care rules).
- Any `StopError` sets `stopped` and ends the run, but `results.json` is still written (use `try/finally`).

- [ ] **Step 1:** Show the user a one-day plan for an already-open class in week `2026-10-26` or `2026-11-02`, then run it with `--dry-run --no-wait`. Confirm one `would-book` entry and that the screenshot shows the right class, spot and Unlimited.
- [ ] **Step 2:** Run a read-only check against a not-yet-open week (`--week 2026-11-09 --list-classes`, plus one class detail fetch). Confirm `status === 'Not Open'` and `bookingStart === '2026-10-31T17:00:00-04:00'`.
- [ ] **Step 3:** In the user's account (via a signed-in read), confirm no new bookings appeared.
- [ ] **Step 4: Commit** `git commit -am "Add dry-run booking walk-through and opening wait"`

### Task 6: Skill instructions for the weekly run

**Files:**
- Modify: `skills/gym-booking/SKILL.md` (follow `docs/skill-template.md`: Goal, Inputs, Steps, Secrets/connectors, Done when)

Steps the instructions must state, in order:
1. Read `My Plan!C1` (pause) and `Booking List!A1:H22` with the Sheets connector.
2. Write `plan.json` using `buildPlan` (`node -e` one-liner calling `plan.js`). If paused, email "Paused this week. Nothing booked." and stop.
3. Run `book.js` with `--plan`, `--out` and `--dry-run` (dry run until the live task exists).
4. Read `results.json` and send the email with the Gmail connector to treichelc@gmail.com. Subject: `Gym booking (DRY RUN) — week of <Mon date>`, or without "(DRY RUN)" when live. Body: one line per day (booked / would book / used backup / couldn't book), plus the notes, plus `stopped` if set.
5. Run `--list-classes` for the target week and rewrite `Class List`.
6. Never put the login, cookies or tokens in the email, the Sheet or the repo.

- [ ] **Step 1:** Write the instructions.
- [ ] **Step 2: Commit** `git commit -am "Write weekly run instructions for gym-booking skill"`

### Task 7: First dry run (spec testing step 1)

- [ ] **Step 1:** With the user following along, run the skill end to end from the instructions alone, against an already-open week with the user's real Sheet (`--week` set to an open Monday, `--no-wait`, `--dry-run`).
- [ ] **Step 2:** Check the spec's pass criteria. Sign-in worked, every ticked day was matched or explained, the screenshots are right, the not-yet-open week reads correctly, nothing was booked (check the account), and the email arrived. Send the screenshots to the user.
- [ ] **Step 3:** Record the findings in `docs/requirements/gym-booking.md` "Open questions": whether a verification check appeared, and whether Google reCAPTCHA hosts needed allowlisting (look for failed `www.google.com` / `www.gstatic.com` requests during the run). Commit and push.

---

## Later tasks (separate plan after the dry run)

- **L1. Scheduled dry run, Sat Oct 31.** Create a scheduled task (fresh session each run, Google Sheets plus Gmail connectors, 4:40pm Toronto) that follows SKILL.md in dry-run mode. Afterwards, review the timing and how fast classes filled.
- **L2. Live booking.** Add the Complete Reservation click behind a `--live` flag. After clicking, confirm the booking through `is_user_reserved`. If the click errors, re-check before anything else (no double-booking). Then run one live test the user approves, on a weekday, at least 9 days out.
- **L3. First live Saturday, Nov 7.** Switch the scheduled task to live. That run opens Nov 16–22.
