# Gym-booking requirements (APPROVED by user; open items below)

## Purpose
Every week, automatically book the user's preferred classes (and spots) at Sweat and Tonic the moment booking opens, and email a summary.

## Facts
- Gym: https://sweatandtonic.com/ (booking platform: Mariana Tek; booking page https://sweatandtonic.com/pages/reserve)
- Timezone: Eastern (America/Toronto; all studios are in Toronto)
- Booking opens Saturdays at 5:00pm Eastern (Unlimited members), for the week after the upcoming week.
  Weeks run Monday-Sunday. Example: Saturday Oct 24 at 5pm opens Nov 2-8 (Mon-Sun).
- Login: email + password.
- The booking page lets you choose a spot when booking.

## How it runs
- Cloud scheduled task, weekly, Saturday 5pm Eastern (user's computer is not reliably on).
- Uses the browser available in the cloud environment (Playwright/Chromium).
- Must start early enough to be logged in and on the schedule page before 5:00pm, then book as soon as classes open.
- Cloud environment needs: the gym domains on the network allowlist; the gym email and password as environment secrets.

## Preferences
- Stored in a Google Sheet the user can edit from a phone (Google Sheets app).
- Each entry: day, then up to three class choices picked from dropdowns, each with preferred spots in order. Backups are on the same day only. Layout: see the design spec.
- The run reads the file each Saturday. Books every entry on the list.

## When something goes wrong
- Class full or booking fails: try the next fallback for that entry. Never join a waitlist (for now).
- Always email a summary via Gmail: booked, fell back, or could not book.

## Testing (per onboarding rules)
1. Dry run: log in, open the schedule, find each preferred class and spot, stop before the final confirm.
2. One live test the user approves.
3. Confirm the scheduled task fires on time.

## Decisions
- Membership is unlimited, so booking costs nothing extra. Late-cancel fee ($19) applies if cancelled within 12 hours of class start, and a no-show costs $24: the skill must never cancel or double-book, and must warn if a booking would need cancelling inside that window.
- Summary email goes to treichelc@gmail.com via Gmail.
- Preferences live in a Google Sheet with three tabs (My Plan, Class List, Booking List); see docs/superpowers/specs/2026-10-24-gym-booking-design.md.
- Approach: instructions plus one small booking script that clicks the real page (approach B). Direct booking requests (approach C) may be considered after a few successful weeks.
- Automation is a grey area under the website's terms; the user accepted it under care rules (behave like one careful person, stop on any verification check).
- Spot selection details to be worked out together during the dry run.

## Open questions
- Whether the sign-in from the cloud triggers any verification (checked in the dry run).
- Whether Google's reCAPTCHA hosts must be on the network allowlist for booking to work (checked in the dry run).
- Waitlist behaviour (out of scope for now).
