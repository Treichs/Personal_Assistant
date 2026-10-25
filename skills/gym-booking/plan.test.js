const test = require('node:test');
const assert = require('node:assert');
const {
  targetWeek, formatTime, normalizeClass, classListRows, parseSpots,
  buildPlan, matchClass, ruleViolation, pickSpot, msUntil,
} = require('./plan');

// A small hand-made class in the shape the Mariana Tek API returns.
function apiClass(over = {}) {
  return {
    id: '1',
    name: 'Top HIIT',
    class_type: { name: 'Top HIIT', duration: 45 },
    location: { id: '48750', name: 'The Well' },
    start_date: '2026-11-04',
    start_time: '06:10:00',
    start_datetime: '2026-11-04T11:10:00Z',
    booking_start_datetime: '2026-10-24T17:00:00-04:00',
    available_spot_count: 40,
    layout_format: 'pick-a-spot',
    is_user_reserved: false,
    is_user_waitlisted: false,
    is_cancelled: false,
    capacity: 60,
    status: null,
    ...over,
  };
}

const week = { monday: '2026-11-02', sunday: '2026-11-08' };

test('targetWeek uses the Toronto date', () => {
  assert.deepStrictEqual(targetWeek(new Date('2026-10-24T16:00:00Z')), week);
  // Sat 9:30pm in Toronto is already Sunday in UTC.
  assert.deepStrictEqual(targetWeek(new Date('2026-10-25T01:30:00Z')), week);
  assert.deepStrictEqual(targetWeek(new Date('2026-10-31T21:00:00Z')),
    { monday: '2026-11-09', sunday: '2026-11-15' });
  assert.deepStrictEqual(targetWeek(new Date('2026-10-29T12:00:00Z')),
    { monday: '2026-11-09', sunday: '2026-11-15' });
  // Daylight saving ends Sun Nov 1. Sat Nov 7 8:30pm EST is already Sunday in UTC.
  assert.deepStrictEqual(targetWeek(new Date('2026-11-08T01:30:00Z')),
    { monday: '2026-11-16', sunday: '2026-11-22' });
  // Sun Nov 1, the changeover day itself, looks ahead to Sat Nov 7.
  assert.deepStrictEqual(targetWeek(new Date('2026-11-01T06:30:00Z')),
    { monday: '2026-11-16', sunday: '2026-11-22' });
});

test('formatTime', () => {
  assert.strictEqual(formatTime('06:10:00'), '6:10 AM');
  assert.strictEqual(formatTime('12:00:00'), '12:00 PM');
  assert.strictEqual(formatTime('18:30:00'), '6:30 PM');
  assert.strictEqual(formatTime('00:15:00'), '12:15 AM');
});

test('normalizeClass', () => {
  const c = normalizeClass(apiClass());
  assert.strictEqual(c.endMs - c.startMs, 45 * 60000);
  assert.strictEqual(c.weekday, 'Wed');
  assert.strictEqual(c.time, '6:10 AM');
  assert.strictEqual(c.typeName, 'Top HIIT');
  assert.strictEqual(c.studioId, '48750');
  assert.strictEqual(c.status, null);
  assert.strictEqual(normalizeClass(apiClass({ status: '' })).status, null);
  assert.strictEqual(normalizeClass(apiClass({ status: 'Not Open' })).status, 'Not Open');
});

test('classListRows filters and de-duplicates', () => {
  const classes = [
    apiClass({ id: '1' }),
    apiClass({ id: '2' }),
    apiClass({ id: '3', class_type: { name: 'Meeting Room South', duration: 60 }, capacity: 1 }),
    apiClass({ id: '4', class_type: { name: 'Beat Ride', duration: 45 }, is_cancelled: true }),
    apiClass({ id: '5', location: { id: '48999', name: 'Elsewhere' } }),
    apiClass({ id: '6', class_type: { name: 'Lift HIIT', duration: 45 }, start_date: '2026-11-02',
      start_time: '18:30:00', start_datetime: '2026-11-02T23:30:00Z' }),
    apiClass({ id: '7', class_type: { name: 'Lift HIIT', duration: 45 }, start_date: '2026-11-02',
      start_time: '07:10:00', start_datetime: '2026-11-02T12:10:00Z' }),
  ].map(normalizeClass);
  const rows = classListRows(classes, ['48750', '48717']);
  assert.deepStrictEqual(rows.map((r) => r.weekday + ' ' + r.label), [
    'Mon 7:10 AM · Lift HIIT · The Well',
    'Mon 6:30 PM · Lift HIIT · The Well',
    'Wed 6:10 AM · Top HIIT · The Well',
  ]);
  assert.deepStrictEqual(rows[2], {
    label: '6:10 AM · Top HIIT · The Well', weekday: 'Wed', time: '6:10 AM',
    typeName: 'Top HIIT', studioName: 'The Well', studioId: '48750',
  });
});

test('parseSpots cleans up phone typing', () => {
  assert.deepStrictEqual(parseSpots(' 4-w ,5-W,, ANY'), ['4-W', '5-W', 'any']);
  assert.deepStrictEqual(parseSpots(''), ['any']);
  assert.deepStrictEqual(parseSpots(undefined), ['any']);
});

test('buildPlan keeps only ticked rows, in choice order', () => {
  const header = ['Day', 'Choice', 'On', 'Time', 'Class', 'Studio', 'Studio id', 'Spots'];
  const rows = [
    header,
    ['Wed', '2', 'TRUE', '7:10 AM', 'Booty HIIT', 'The Well', '48750', ''],
    ['Wed', '1', 'TRUE', '6:10 AM', 'Top HIIT', 'The Well', '48750', '4-w, 5-W'],
    ['Thu', '1', 'FALSE', '6:10 AM', 'Top HIIT', 'The Well', '48750', ''],
    ['', '', '', '', '', '', '', ''],
    [],
  ];
  const plan = buildPlan(rows, false, week);
  assert.strictEqual(plan.paused, false);
  assert.deepStrictEqual(plan.week, week);
  assert.strictEqual(plan.days.length, 1);
  assert.strictEqual(plan.days[0].day, 'Wed');
  assert.strictEqual(plan.days[0].date, '2026-11-04');
  assert.deepStrictEqual(plan.days[0].choices.map((c) => c.choice), [1, 2]);
  assert.deepStrictEqual(plan.days[0].choices[0], {
    choice: 1, time: '6:10 AM', typeName: 'Top HIIT', studioId: '48750', spots: ['4-W', '5-W'],
  });
  assert.deepStrictEqual(plan.days[0].choices[1].spots, ['any']);
  // Sundays land at the end of the week, not before Monday.
  const sun = buildPlan([header, ['Sun', '1', 'true', '9:00 AM', 'Beat Ride', 'The Well', '48750', '']], false, week);
  assert.strictEqual(sun.days[0].date, '2026-11-08');
});

test('matchClass never guesses', () => {
  const choice = { time: '6:10 AM', typeName: 'top hiit', studioId: '48750' };
  const one = [normalizeClass(apiClass({ id: '1' }))];
  assert.strictEqual(matchClass(choice, '2026-11-04', one).cls.id, '1');
  assert.deepStrictEqual(matchClass({ ...choice, time: '7:10 AM' }, '2026-11-04', one), { reason: 'no match' });
  const two = [normalizeClass(apiClass({ id: '1' })), normalizeClass(apiClass({ id: '2' }))];
  assert.deepStrictEqual(matchClass(choice, '2026-11-04', two), { reason: 'multiple matches' });
  const cancelled = [normalizeClass(apiClass({ id: '1' })), normalizeClass(apiClass({ id: '2', is_cancelled: true }))];
  assert.strictEqual(matchClass(choice, '2026-11-04', cancelled).cls.id, '1');
});

test('ruleViolation', () => {
  const ctx = { week, bookedThisRun: [], weekClasses: [] };
  assert.strictEqual(ruleViolation(normalizeClass(apiClass({ is_user_reserved: true })), ctx), 'already booked');
  assert.strictEqual(ruleViolation(normalizeClass(apiClass({ is_user_waitlisted: true })), ctx), 'already waitlisted');
  assert.strictEqual(ruleViolation(normalizeClass(apiClass({ is_cancelled: true })), ctx), 'cancelled');
  assert.strictEqual(ruleViolation(normalizeClass(apiClass({ start_date: '2026-11-01',
    start_datetime: '2026-11-01T11:10:00Z' })), ctx), 'outside target week');
  assert.strictEqual(ruleViolation(normalizeClass(apiClass()), ctx), null);

  const early = normalizeClass(apiClass({ id: '10', start_time: '06:40:00', start_datetime: '2026-11-04T11:40:00Z' }));
  const lift = normalizeClass(apiClass({ id: '11', class_type: { name: 'Lift HIIT', duration: 45 },
    start_time: '07:10:00', start_datetime: '2026-11-04T12:10:00Z', is_user_reserved: true }));
  assert.strictEqual(ruleViolation(early, { ...ctx, weekClasses: [lift] }), 'overlaps Lift HIIT 7:10 AM');
  const liftThisRun = { ...lift, reserved: false };
  assert.strictEqual(ruleViolation(early, { ...ctx, bookedThisRun: [liftThisRun] }), 'overlaps Lift HIIT 7:10 AM');
  // An unreserved class in the week data is not a clash.
  assert.strictEqual(ruleViolation(early, { ...ctx, weekClasses: [liftThisRun] }), null);
  // Back-to-back classes do not overlap.
  const after = normalizeClass(apiClass({ id: '12', start_time: '07:25:00', start_datetime: '2026-11-04T12:25:00Z',
    is_user_reserved: true }));
  assert.strictEqual(ruleViolation(early, { ...ctx, weekClasses: [after] }), null);
});

test('pickSpot', () => {
  const layout = [{ name: '4-W', is_available: false }, { name: '5-W', is_available: true }];
  assert.strictEqual(pickSpot(['4-W', '5-W'], layout), '5-W');
  const layout2 = [{ name: '4-W', is_available: false }, { name: '9-F', is_available: true }];
  assert.strictEqual(pickSpot(['4-W'], layout2), null);
  assert.strictEqual(pickSpot(['any'], layout2), '9-F');
  assert.strictEqual(pickSpot(['9-f'], layout2), '9-F');
  assert.strictEqual(pickSpot(['4-W', 'any'], layout2), '9-F');
});

test('msUntil', () => {
  assert.strictEqual(msUntil('2026-10-31T17:00:00-04:00', new Date('2026-10-31T20:59:00Z')), 60000);
  assert.strictEqual(msUntil('2026-10-31T17:00:00-04:00', new Date('2026-10-31T21:05:00Z')), 0);
  // After daylight saving ends (Nov 1), 5:00pm Toronto is 22:00 UTC.
  assert.strictEqual(msUntil('2026-11-07T17:00:00-05:00', new Date('2026-11-07T21:59:00Z')), 60000);
  assert.strictEqual(msUntil(null, new Date()), 0);
});
