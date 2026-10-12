// Log book rows: actual nearby readings, clock-aligned intervals, change column,
// blanks for gaps, never averaged.
const assert = require('node:assert/strict');
const { buildRows } = require('../assets/logbook.js');
const base = Date.UTC(2026, 9, 12, 15, 0, 0);
const pressure = [];
for (let s = 0; s <= 1200; s++) if (s < 400 || s > 700) pressure.push({ at: base + s * 1000, pressure: 1000 + s / 100 });
const temperatures = [];
for (let s = 0; s <= 1200; s += 10) temperatures.push({ at: base + s * 1000, pipe: 70 + s / 1000, ambient: s > 600 ? 80 : undefined });
const channels = [{ key: 'pipe', name: 'Pipe' }, { key: 'ambient', name: 'Ambient' }];

let { rows, more } = buildRows({ pressure, temperatures, channels, intervalMs: 300000 });
assert.equal(rows[0].latest, true, 'newest row is the latest reading');
assert.equal(rows[0].at, base + 1200000);
assert.deepEqual(rows.slice(1).map((r) => (r.at - base) / 60000), [15, 10, 5, 0], 'clock-aligned 5-minute rows, newest first');
assert.equal(rows[2].pressure, null, 'minute 10 falls inside the gauge gap and stays blank');
assert.equal(rows[1].pressure.value, 1009, 'value is the recorded reading, not an average');
assert.equal(rows[3].change, rows[3].pressure.value - rows[4].pressure.value, 'change compares with the next older row');
assert.equal(rows[1].change, null, 'no change across a blank row');
assert.equal(rows[4].temps.ambient, null, 'probe with no reading at that time stays blank');
assert.equal(rows[1].temps.ambient.value, 80);
assert.equal(more, false);

({ rows, more } = buildRows({ pressure, temperatures, channels, intervalMs: 5000, maxRows: 50 }));
assert.equal(rows.length, 50);
assert.equal(more, true, 'older rows are paged, not dropped');
assert.ok(rows.every((r, i) => i === 0 || r.at % 5000 === 0));
assert.ok(Math.abs(rows[3].pressure.at - rows[3].at) <= 2500, '5-second rows only use readings within 2.5 s');

assert.deepEqual(buildRows({ pressure: [], temperatures: [], channels }).rows, []);
console.log('Log book: aligned intervals, actual readings, blanks for gaps, change column and paging passed.');
