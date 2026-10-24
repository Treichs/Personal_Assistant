# Gym-booking requirements (APPROVED by user; open items below)

## Purpose
Every week, automatically book the user's preferred classes (and spots) at Sweat and Tonic the moment booking opens, and email a summary.

## Facts
- Gym: https://sweatandtonic.com/ (booking platform not yet confirmed; check during the dry run)
- Timezone: Eastern (America/New_York)
- Booking opens Saturdays at 5:00pm Eastern, for the week after the upcoming week.
  Example: Saturday Oct 24 at 5pm opens Nov 1-7 (Sun-Sat).
- Login: email + password.
- The booking page lets you choose a spot when booking.

## How it runs
- Cloud scheduled task, weekly, Saturday 5pm Eastern (user's computer is not reliably on).
- Uses the browser available in the cloud environment (Playwright/Chromium).
- Must start early enough to be logged in and on the schedule page before 5:00pm, then book as soon as classes open.
- Cloud environment needs: the gym domains on the network allowlist; the gym email and password as environment secrets.

## Preferences
- Stored in a Google Sheet or Doc the user can edit from a phone.
- Each entry: day, class time, class name, preferred spot, plus fallbacks (alternate class/time/spot, in order).
- The run reads the file each Saturday. Books every entry on the list.

## When something goes wrong
- Class full or booking fails: try the next fallback for that entry.
- Always email a summary via Gmail: booked, fell back, or could not book.

## Testing (per onboarding rules)
1. Dry run: log in, open the schedule, find each preferred class and spot, stop before the final confirm.
2. One live test the user approves.
3. Confirm the scheduled task fires on time.

## Decisions
- Membership is unlimited, so booking costs nothing extra. Late-cancel fee applies if cancelled within 12 hours of class start: the skill must never cancel or double-book, and must warn if a booking would need cancelling inside that window.
- Summary email goes to treichelc@gmail.com via Gmail.
- Preferences live in a Google Sheet (one row per class, with fallback columns).
- Spot selection details to be worked out together during the dry run.

## Open questions
- Booking platform and whether it blocks automated logins (CAPTCHA/verification).
- Waitlist behaviour.
- Google Sheets access from the cloud run (connector needed).
- Add gym domains to the cloud network allowlist and gym login to environment secrets (user action).
