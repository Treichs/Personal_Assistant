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
- Waitlist behaviour (out of scope for now).
- Re-check at the live test (L2): whether the Complete Reservation click needs Google reCAPTCHA (`www.google.com`, `www.gstatic.com`) or Stripe (`js.stripe.com`, blocked today). The dry run never reaches that click.

## Dry-run findings (2026-10-24/25)
- Verification: no "verify you're human" check appeared in about 9 cloud sign-ins over two days.
- reCAPTCHA hosts: no request to `www.google.com` or `www.gstatic.com` failed during any run, so they are not needed up to the confirm screen.
- Blocked hosts that matter: `cdn.shopify.com` (the website's own scripts). Without it, picking a studio in the schedule widget sends the page back to the home page. Worked around by opening each class directly: `https://sweatandtonic.com/pages/reserve?_mt=/classes/<id>/reserve` goes straight to "Select Your Spot".
- Membership: Pay With shows "The Well Unlimited (Upgrade from In-Studio Unlimited) (Exp. <date>)". The user confirmed the date is a monthly renewal date, not an end date.
- Spot labels: rides and yoga use plain numbers (`26`); HIIT uses number plus zone (`4-W`).
- First full dry run (week of Nov 2, user's real Sheet plus a Wednesday test day): Mon and Tue correctly skipped (already booked / overlaps), Wed reached the confirm screen with the right class, spot and Unlimited membership. Nothing booked; summary email sent.
