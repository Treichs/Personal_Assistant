// Pure decision logic for gym booking: no browser, no network.
// All dates are Toronto dates as 'YYYY-MM-DD' strings; arithmetic goes through Date.UTC.

const TZ = 'America/Toronto';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const torontoParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
});

function torontoDate(now) {
  const p = Object.fromEntries(torontoParts.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday };
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' -> 'Mon'..'Sun'
function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

// Next Saturday on or after today's Toronto date, plus 9 days for the Monday.
function targetWeek(now) {
  const { date } = torontoDate(now);
  const toSaturday = (5 - WEEKDAYS.indexOf(weekdayOf(date)) + 7) % 7;
  const monday = addDays(date, toSaturday + 9);
  return { monday, sunday: addDays(monday, 6) };
}

function formatTime(hhmmss) {
  const [h, m] = hhmmss.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// '6:10 AM' -> minutes after midnight, for sorting.
function timeMinutes(label) {
  const [, h, m, ap] = label.match(/^(\d+):(\d+) (AM|PM)$/);
  return (Number(h) % 12 + (ap === 'PM' ? 12 : 0)) * 60 + Number(m);
}

function normalizeClass(api) {
  const startMs = Date.parse(api.start_datetime);
  return {
    id: String(api.id),
    name: api.name,
    typeName: api.class_type.name,
    studioId: String(api.location.id),
    studioName: api.location.name,
    date: api.start_date,
    weekday: weekdayOf(api.start_date),
    time: formatTime(api.start_time),
    startMs,
    endMs: startMs + api.class_type.duration * 60000,
    status: api.status || null,
    bookingStart: api.booking_start_datetime,
    availableSpots: api.available_spot_count,
    layout: api.layout_format,
    reserved: Boolean(api.is_user_reserved),
    waitlisted: Boolean(api.is_user_waitlisted),
    cancelled: Boolean(api.is_cancelled),
    capacity: api.capacity,
  };
}

function classListRows(classes, studioIds) {
  const seen = new Map();
  for (const c of classes) {
    if (c.capacity <= 1 || c.cancelled || !studioIds.includes(c.studioId)) continue;
    const label = `${c.time} · ${c.typeName} · ${c.studioName}`;
    const key = `${c.weekday}|${label}`;
    if (!seen.has(key)) {
      seen.set(key, { label, weekday: c.weekday, time: c.time, typeName: c.typeName,
        studioName: c.studioName, studioId: c.studioId });
    }
  }
  return [...seen.values()].sort((a, b) =>
    WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday)
    || timeMinutes(a.time) - timeMinutes(b.time)
    || a.label.localeCompare(b.label));
}

function parseSpots(text) {
  const spots = String(text || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => (s.toLowerCase() === 'any' ? 'any' : s.toUpperCase()));
  return spots.length ? spots : ['any'];
}

// rows: Booking List values, header first: Day | Choice | On | Time | Class | Studio | Studio id | Spots
function buildPlan(rows, paused, week) {
  const byDay = new Map();
  for (const r of rows.slice(1)) {
    const [day, choice, on, time, typeName, , studioId, spots] = r;
    if (String(on).toUpperCase() !== 'TRUE') continue;
    const d = String(day).trim().slice(0, 3);
    if (!WEEKDAYS.includes(d)) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ choice: Number(choice), time, typeName, studioId: String(studioId),
      spots: parseSpots(spots) });
  }
  const days = WEEKDAYS.filter((d) => byDay.has(d)).map((d) => ({
    day: d,
    date: addDays(week.monday, WEEKDAYS.indexOf(d)),
    choices: byDay.get(d).sort((a, b) => a.choice - b.choice),
  }));
  return { week, paused: Boolean(paused), days };
}

function matchClass(choice, date, classes) {
  const found = classes.filter((c) => !c.cancelled && c.date === date && c.time === choice.time
    && c.studioId === String(choice.studioId)
    && c.typeName.toLowerCase() === String(choice.typeName).toLowerCase());
  if (found.length === 0) return { reason: 'no match' };
  if (found.length > 1) return { reason: 'multiple matches' };
  return { cls: found[0] };
}

function ruleViolation(cls, { week, bookedThisRun, weekClasses }) {
  if (cls.cancelled) return 'cancelled';
  if (cls.date < week.monday || cls.date > week.sunday) return 'outside target week';
  if (cls.reserved) return 'already booked';
  if (cls.waitlisted) return 'already waitlisted';
  const others = [...weekClasses.filter((c) => c.reserved), ...bookedThisRun];
  const other = others.find((o) => o.id !== cls.id && o.startMs < cls.endMs && cls.startMs < o.endMs);
  if (other) return `overlaps ${other.typeName} ${other.time}`;
  return null;
}

function pickSpot(spots, layoutSpots) {
  const free = layoutSpots.filter((s) => s.is_available);
  for (const want of spots) {
    const hit = want === 'any' ? free[0] : free.find((s) => s.name.toUpperCase() === want.toUpperCase());
    if (hit) return hit.name;
  }
  return null;
}

// A missing or unreadable opening time counts as already open (0), never NaN.
function msUntil(isoOpen, now) {
  const open = Date.parse(isoOpen);
  return Number.isNaN(open) ? 0 : Math.max(0, open - now.getTime());
}

module.exports = {
  WEEKDAYS, targetWeek, formatTime, normalizeClass, classListRows, parseSpots,
  buildPlan, matchClass, ruleViolation, pickSpot, msUntil, addDays,
};
