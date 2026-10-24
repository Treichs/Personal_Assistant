# Gym booking: design (dry run first)

Status: design approved in chat on 2026-10-24; awaiting review of this written spec.
Requirements: docs/requirements/gym-booking.md

## Goal

Every Saturday at 5:00pm Toronto time (America/Toronto), book the user's chosen Sweat and Tonic classes and spots for the week that has just opened, then email a summary. Build it in stages, starting with a dry run that goes all the way to the confirm screen and books nothing.

## Facts this design relies on

From the Chrome research (2026-10-24) and the gym's public pages:

- Booking platform: Mariana Tek. The widget is at `https://sweatandtonic.marianaiframes.com/iframe/schedule/daily/48541` (48541 is the Toronto region). It loads data from `https://sweatandtonic.marianatek.com`.
- Sign-in is a full page at `https://sweatandtonic.marianatek.com/auth/login/` (email and password; no visible CAPTCHA). An invisible Google reCAPTCHA runs on the site.
- Studios: The Well = 48750, Yonge & Shuter = 48717.
- Data requests the widget uses:
  - `GET /api/customer/v1/classes?min_start_date&max_start_date&page_size&region` returns the schedule.
  - `GET /api/customer/v1/classes/{classId}` returns one class, including the full spot layout (each spot's name, type, position, free or taken).
  - Useful fields: `booking_start_datetime`, `status` (empty when bookable, "Not Open", "Waitlist Only"), `available_spot_count`, `waitlist_count`, `layout_format` (pick-a-spot or first-come-first-serve), `is_user_reserved`, `is_user_waitlisted`.
- Booking flow on the page: RESERVE in the list, then "Select Your Spot" (map; skipped for classes without one), then click a spot, then "Confirm Your Reservation" (class, spot, Pay With dropdown), then COMPLETE RESERVATION.
- Spot labels are a number plus a zone letter, for example `4-W`, `5-T`, `15-F`.
- Weeks run Monday to Sunday. Unlimited members book on Saturday at 5:00pm for the week starting 9 days later (for example, Sat Oct 31 opens Mon Nov 9 to Sun Nov 15).
- Fees: a late cancel (within 12 hours) costs $19 and a no-show costs $24. Overlapping bookings are against the gym's rules.
- The website's terms ban "spider, crawl, or scrape" and getting around its security features. The user accepted this grey area under the care rules below.

## Decisions

| Topic | Decision |
|---|---|
| Approach | Instructions plus one small script (approach B). The script signs in on the real page, reads class data the widget uses, and clicks the real spot and the real Complete Reservation button. It never sends booking requests directly. Approach C (direct requests) may be considered after a few successful weeks. |
| Fallbacks | Other spots first, then the 2nd and 3rd choice classes on the same day. No waitlist for now. |
| Preferences | A Google Sheet with three tabs (below). It is read with the Google Sheets connector. |
| Emails | Sent with the Gmail connector to treichelc@gmail.com. |
| Risk posture | Go ahead under the care rules. Stop on any sign of a block. |

## Pieces

1. **Preferences Sheet.** It belongs to the user. Claude builds its tabs through the Sheets connector.
2. **`skills/gym-booking/SKILL.md`.** Plain-English instructions for Claude: read the Sheet, write the plan, run the script, refresh the Class List, send the email.
3. **`skills/gym-booking/plan.js`.** Pure logic, with no browser and no network: it works out the target week, turns Sheet rows into an ordered plan, checks overlaps and duplicates, and picks spots in order. It is tested by `plan.test.js` (`node --test`).
4. **`skills/gym-booking/book.js`.** The browser part (Playwright, already installed in the cloud environment). It signs in, waits, books or stops in a dry run, and writes the results.
5. **Scheduled task.** Saturdays at about 4:40pm Toronto time, starting a fresh cloud session each time with the Google Sheets and Gmail connectors.

## The Sheet

**Tab "My Plan" (the user edits only this tab)**

- A "Pause all bookings" tick box. When it is ticked, the run books nothing and emails "paused".
- A table with one row per weekday (Mon–Sun) and these columns: Day | Book? (tick box) | 1st choice (dropdown) | Spots | 2nd choice (dropdown) | Spots | 3rd choice (dropdown) | Spots.
- Each dropdown lists only that weekday's classes from the Class List, shown as `6:10 AM · Top HIIT · The Well`.
- Spots is free text, tried left to right: `4-W, 5-W`, or `any`. Blank means any spot.
- Each day books at most one class. Backups are on the same day only. One class per day is assumed; a second row per day can be added later.

**Tab "Class List" (written by the skill, with a warning on edit)**

- One column per weekday listing the labels that feed the dropdowns.
- A long table (weekday, label, time, class name, studio, studio id) used for lookups.
- It covers The Well and Yonge & Shuter only.
- It is filled during setup, then refreshed after each Saturday run from the newly opened week.

**Tab "Booking List" (formulas, read by the skill, with a warning on edit)**

- 21 fixed rows (7 days × 3 choices) with these columns: Day | Choice | On | Time | Class | Studio | Studio id | Spots.
- On is TRUE only if the day is ticked, the choice is filled in and the plan isn't paused.
- The other columns are looked up from the Class List by weekday plus label, because the same label can appear on several weekdays.

The user creates a blank Sheet and shares its link. Claude builds the tabs, dropdowns, tick boxes and warnings. The Sheet ID is stored in SKILL.md (it is not a secret). On a phone, the user edits in the Google Sheets app.

## Weekly run

| Time (Toronto) | Who | What |
|---|---|---|
| ~4:40pm | Claude | Read "Booking List" and the pause box. If paused, email and stop. Otherwise write `plan.json`: an ordered list per day of choices, each with time, class name, studio id and spots. |
| ~4:50pm | Script | Sign in once. Load existing bookings and the target week's classes. Match each choice to exactly one class (same date, start time, studio, and a name containing the Sheet's class name). Drop and flag anything that fails a hard rule. Expect every target class to show "Not Open" with a 5:00pm opening time. |
| 5:00:00pm | Script | For each day in order: take the first choice whose class is open and has an allowed spot free, click the spot, check the confirm screen, then click Complete Reservation (or stop in a dry run). If no choice works, record "couldn't book". |
| ~5:05pm | Claude | Read `results.json` and email the summary: booked (class, spot), used a backup, couldn't book (and why). Refresh the "Class List" tab from `classes.json`. |

The hard rules are enforced in the script, so they never depend on Claude remembering them.

**Script interface**

- Inputs: `plan.json`; the environment variables `GYM_EMAIL` and `GYM_PASSWORD`; and the options `--dry-run`, `--week YYYY-MM-DD` (Monday of the week to target, for testing) and `--no-wait` (skip waiting for 5:00pm).
- Outputs: `results.json` (one entry per day: outcome, class, spot, reason), `classes.json` (the target week's classes for the Class List), and screenshots of each confirm screen and any error. These are kept in the session's scratch folder and never committed.

## Hard rules (enforced in code)

1. Never click Cancel, Join Waitlist or any buy or pay control.
2. Click Complete Reservation only if Pay With shows the Unlimited membership.
3. Book only classes in the target week.
4. Skip any class that overlaps an existing booking or one booked earlier in the run, and skip any class already reserved or waitlisted.
5. Book at most one class per ticked day.
6. The dry run never clicks Complete Reservation.

## Care rules

- Sign in once per run, with no sign-in retries.
- No rapid refreshing. If a class still says "Not Open" at 5:00:00, recheck every few seconds for up to 2 minutes, then give up on it.
- Any "verify you're human" check, unexpected page or unknown screen means stop the whole run and email. Never try to get past a check.
- Act only on the user's own account.

## Error handling

| Situation | Behaviour |
|---|---|
| Sign-in fails, or the Sheet can't be read | Book nothing; email the reason. |
| A choice matches no class, or more than one | Skip that choice, try the next, note it. |
| The listed spots are taken | Try the next listed spot. If none is free and `any` isn't listed, move to the next choice. |
| The class is full or "Waitlist Only" | Next choice. |
| A click errors or the confirm screen looks wrong | Reload the bookings list to see whether the booking went through before doing anything else; never double-book. |
| Script crash | Claude still emails from whatever `results.json` holds. If no email arrives by about 5:15pm, the user checks the app. |

## Testing and rollout

0. **Offline:** unit tests for `plan.js` (target week, matching, overlaps, choice and spot order) using made-up schedules.
1. **Dry run in a cloud session** at a normal time, against an already-open week (`--week`, `--no-wait`, `--dry-run`).
   - Passes if sign-in works, every ticked day is matched or clearly explained, the confirm-screen screenshots show the right class and spot, one not-yet-open week reads as "Not Open" opening at Saturday 5:00pm, nothing is booked, and the summary email arrives.
2. **Scheduled dry run on Sat Oct 31 at 4:40pm.** It watches the real 5:00pm opening and checks start-up time, timing and how quickly classes fill. It books nothing.
3. **One live test the user approves.** On a weekday, book one chosen class at least 9 days out in an already-open week.
4. **First live Saturday: Nov 7.** That run opens Mon Nov 16 to Sun Nov 22.

## Environment

- Network allowlist: `sweatandtonic.com`, `*.marianatek.com`, `*.marianaiframes.com`. The dry run checks whether Google's reCAPTCHA hosts (`www.google.com`, `www.gstatic.com`) are also needed for booking to work.
- Secrets: `GYM_EMAIL` and `GYM_PASSWORD` (already set).
- Connectors for the scheduled task: Google Sheets and Gmail.

## Out of scope for now

Waitlists; backups on other days; more than one class per day; booking for guests; direct booking requests (approach C); writing results back to the Sheet.
