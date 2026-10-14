// Feed check logic: each whole minute of a recording is classified from the
// readings that arrived (and when) and the field laptop's check-ins.
const assert = require('node:assert/strict');
const { analyze } = require('../assets/feed-check.js');

const M = 60000, start = 1790000000000 - 1790000000000 % M;
const minute = (n) => start + n * M;
const data = {
  recordings: [{ id: 'r1', interval_seconds: 2, from: start - 20000, to: null }],
  checkins_since: minute(3),
  minutes: [
    { at: minute(-1), readings: 10, late: 0 }, // partial first minute: ignored
    { at: minute(0), readings: 30, late: 0 },
    { at: minute(1), readings: 30, late: 30 }, // internet dropped, caught up
    { at: minute(2), readings: 12, late: 0 }, // before check-in logging: cause unknown
    // minute 3: nothing, laptop online, MadgeTech not ready
    // minute 4: nothing, no check-ins at all
    { at: minute(5), readings: 10, late: 0 }, // laptop fine, MadgeTech slow
    // minute 6: nothing, MadgeTech ready: taken, not received
    { at: minute(7), readings: 29, late: 0 }, // 29 of 30 still counts as on time
    { at: minute(8), readings: 30, late: 0 },
    { at: minute(9), readings: 4, late: 0 }, // current partial minute: ignored
  ],
  checkins: [
    { at: minute(3), checkins: 12, ready: 0, laptop_temp_f: 196 },
    { at: minute(5), checkins: 12, ready: 12, laptop_temp_f: 205 },
    { at: minute(6), checkins: 11, ready: 11, laptop_temp_f: null },
    { at: minute(7), checkins: 12, ready: 12, laptop_temp_f: 150 },
    { at: minute(8), checkins: 12, ready: 12, laptop_temp_f: 150 },
  ],
};
const result = analyze(data, minute(9) + 30000);
assert.deepEqual(result.rows.map((r) => r.status), ['ok', 'late', 'short', 'madgetech', 'silent', 'short', 'waiting', 'ok', 'ok']);
assert.deepEqual(result.total, { readings: 30 + 30 + 12 + 0 + 0 + 10 + 0 + 29 + 30, expected: 270, late: 30 });
assert.equal(result.rows[5].laptopTempF, 205, 'laptop temperature kept per minute');
// Consecutive minutes with the same status are one stretch.
assert.deepEqual(result.stretches.map((s) => [s.status, (s.from - start) / M, (s.to - start) / M]),
  [['ok', 0, 1], ['late', 1, 2], ['short', 2, 3], ['madgetech', 3, 4], ['silent', 4, 5], ['short', 5, 6], ['waiting', 6, 7], ['ok', 7, 9]]);
// Without a check-in log, a missing minute is "unknown" rather than blamed on anything.
const noLog = analyze({ ...data, checkins: [], checkins_since: null }, minute(9));
assert.equal(noLog.rows[3].status, 'unknown');
assert.equal(noLog.rows[1].status, 'late', 'late arrivals still prove an internet drop');
// A stopped recording ends at its stop time; a longer website interval expects fewer readings.
const stopped = analyze({ recordings: [{ interval_seconds: 10, from: start, to: minute(2) + 5000 }], minutes: [{ at: start, readings: 6, late: 0 }], checkins: [], checkins_since: null }, minute(10));
assert.deepEqual(stopped.rows.map((r) => [r.status, r.expected]), [['ok', 6], ['unknown', 6]]);
console.log('Feed check logic passed: on time, internet catch-up, MadgeTech not sending, laptop silent, fewer readings, taken but not received, unknown before logging, partial minutes, stretches and intervals.');
