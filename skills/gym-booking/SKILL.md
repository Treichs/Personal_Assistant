---
name: gym-booking
description: Use when the user wants to book gym classes at Sweat and Tonic, or set up the weekly scheduled booking.
---

# Gym class booking

Status: being built (dry run first). Requirements: docs/requirements/gym-booking.md.
Design: docs/superpowers/specs/2026-10-24-gym-booking-design.md.

## Settings

- Preferences Sheet: "Gym Planner", ID `1zRruAuUzGOcUDbq7m5aJEO1HgywdIRsMDj5hCap1U9U`
  (https://docs.google.com/spreadsheets/d/1zRruAuUzGOcUDbq7m5aJEO1HgywdIRsMDj5hCap1U9U/edit). Not a secret.
- Tabs: `My Plan` (the user edits this), `Class List` (written by this skill), `Booking List` (formulas, read by this skill).
- Studios: The Well `48750`, Yonge & Shuter `48717`.

## Setting up the Sheet

Use these steps only to rebuild the Sheet from a blank one. Load the google-workspace skill first.

1. Set the spreadsheet time zone to `America/Toronto`.
2. **My Plan** (sheetId 0). B1 "Pause all bookings", C1 a tick box. Row 2 a one-line how-to.
   Row 3 header `Day | Book? | 1st choice | Spots | 2nd choice | Spots | 3rd choice | Spots`.
   Rows 4–10 are Mon–Sun with tick boxes in B4:B10. Format D, F and H (rows 4–10) as plain text so
   spots like `4` stay as typed. Choice cells C, E and G on row *r* get a dropdown (`ONE_OF_RANGE`,
   not strict) on that weekday's column of Class List: Mon `='Class List'!A2:A200`, Tue `B2:B200`,
   and so on to Sun `G2:G200`.
3. **Class List** (sheetId 1, 17 columns). Long table headers in I1:N1:
   `Weekday | Label | Time | Class | Studio | Studio id`. Only I and J are typed (from `classes.json`).
   - K2: `=ARRAYFORMULA(IF($J$2:$J="",,REGEXEXTRACT($J$2:$J,"^(.+?) · (.+) · (.+)$")))` fills Time, Class and Studio as text.
   - N2: `=ARRAYFORMULA(IF($M$2:$M="",,VLOOKUP($M$2:$M,$P$2:$Q$3,2,FALSE)))`.
   - P1:Q3 Studios lookup: `Studio | Studio id`, `The Well | '48750`, `Yonge & Shuter | '48717`.
   - A1:G1 `Mon..Sun`; A2 `=FILTER($J$2:$J,$I$2:$I=A$1)`, copied across to G2. These feed the dropdowns.
   - A source note on I1 says where the data came from and the week it covers.
4. **Booking List** (sheetId 2). Header `Day | Choice | On | Time | Class | Studio | Studio id | Spots`,
   then 21 rows (7 days × 3 choices). For My Plan row *p* and choice column *c* (C, E, G) with spots
   column *s* (D, F, H), on Booking List row *r*:
   - A `='My Plan'!$A<p>`, B the choice number 1–3.
   - C `=AND('My Plan'!$B<p>,'My Plan'!<c><p><>"",NOT('My Plan'!$C$1))`.
   - D `=IF('My Plan'!<c><p>="","",IFERROR(INDEX(FILTER('Class List'!$K$2:$N,'Class List'!$I$2:$I=$A<r>,'Class List'!$J$2:$J='My Plan'!<c><p>),1,0),"not in Class List"))`
     fills D:G. Use `INDEX(…,1,0)`, because `INDEX(…,1)` returns only the first cell.
   - H `='My Plan'!<s><p>&""`.
5. Add warning-only protection to Class List and Booking List.
6. Verify: read `Booking List!A1:H22` (21 rows, all `On` FALSE). Then put a test choice in My Plan
   Wed (tick, `6:10 AM · Top HIIT · The Well`, spots `4-W`). The Wed choice 1 row should read
   `Wed | 1 | TRUE | 6:10 AM | Top HIIT | The Well | 48750 | 4-W`. Clear the test entry afterwards.

## Refreshing the Class List

Run `node skills/gym-booking/book.js --list-classes --week <Monday> --out <run folder>`. Clear
`'Class List'!I2:J1000`, then write `[weekday, label]` pairs from `classes.json` to `'Class List'!I2`.
Update the source note on I1 with the new week and date. Everything else recalculates.
