const assert = require('node:assert/strict');
const { fakeWorkbook, appsScript } = require('./fake-google-sheet.cjs');

const minute = 60 * 1000;
const base = new Date('2026-09-12T09:00:00-05:00').getTime();
const entry = (offsetMinutes, comments = '', pressure = 4150) => ({ at: base + offsetMinutes * minute, pressure, ambient: '', pipe: '', ground: '', comments });
const officialRows = (count, from = 60) => Array.from({ length: count }, (_, index) => entry(from + index * 15, index === 0 ? 'Begin test' : ''));
const time = (value) => (value instanceof Date ? value.getTime() : value);

function sync(snapshot, typedByOperator = () => {}) {
  const workbook = fakeWorkbook();
  const { call } = appsScript(workbook, { exposeContext: true });
  const created = call({ action: 'create', title: 'Bridge test', snapshot: {} });
  typedByOperator(workbook.tabs.LOG);
  const result = call({ action: 'sync', spreadsheetId: created.spreadsheetId, snapshot });
  return { workbook, log: workbook.tabs.LOG, summary: workbook.tabs.Summary, result, again: (next) => call({ action: 'sync', spreadsheetId: created.spreadsheetId, snapshot: next }) };
}

// Auto: pre-test from row 23, official right after, across the page break to row 51.
{
  const pre = [entry(0, 'Pressure is at 0 psi / Begin pressurizing', 0), entry(20, 'Reached 75%'), entry(50, 'Reached test pressure')];
  const { log, summary, result } = sync({ preTestRows: pre, officialRows: officialRows(33), postTestRows: [entry(600, 'Begin depressurizing')] });
  assert.equal(result.layoutVersion, 3);
  assert.equal(log.cell('F23'), 'Pressure is at 0 psi / Begin pressurizing');
  assert.equal(log.cell('F26'), 'Begin test', 'official test starts right after three pre-test rows');
  assert.equal(log.cell('B26'), 4150, 'pressure is written');
  assert.equal(time(log.cell('A48')), base + (60 + 22 * 15) * minute, 'first page is used to row 48');
  assert.equal(log.cell('A49'), '', 'blank spacer row is not used');
  assert.equal(time(log.cell('A51')), base + (60 + 23 * 15) * minute, 'second page continues at row 51');
  assert.equal(log.cell('F61'), 'Begin depressurizing', 'post-test follows the last official row');
  assert.deepEqual([result.officialFirstRow, result.officialLastRow], [26, 60]);
  assert.equal(summary.cell('C26'), '=IF(COUNT(LOG!B26:B60)=0,"",MAX(LOG!B26:B60))', 'summary covers the official rows');
  assert.equal(summary.cell('C40'), '=LOG!A60');
}

// Chosen start row: official test begins there; operator rows above it are untouched.
{
  const { log, result } = sync({ sheetStartRow: 28, preTestRows: [entry(0, 'Begin pressurizing', 0)], officialRows: officialRows(3) }, (sheet) => {
    sheet.getRange('A25:F25').setValues([[new Date(base + 30 * minute), 3100, 64, 72, 84, 'Typed by hand']]);
  });
  assert.equal(log.cell('F23'), 'Begin pressurizing', 'site pre-test entries still fill from row 23');
  assert.equal(log.cell('F25'), 'Typed by hand', 'operator row above the start row is left alone');
  assert.equal(log.cell('C25'), 64);
  assert.equal(log.cell('F28'), 'Begin test', 'official test starts on the chosen row');
  assert.equal(time(log.cell('A30')), base + 90 * minute);
  assert.equal(log.cell('A31'), '');
  assert.deepEqual([result.officialFirstRow, result.officialLastRow], [28, 30]);
}

// Chosen start row on the second page.
{
  const { log, result } = sync({ sheetStartRow: 51, officialRows: officialRows(2) });
  assert.equal(log.cell('F51'), 'Begin test');
  assert.equal(log.cell('A23'), '');
  assert.equal(result.officialFirstRow, 51);
}

// Clear errors instead of silently dropping rows.
{
  const { call } = appsScript(fakeWorkbook(), { exposeContext: true });
  const created = call({ action: 'create', title: 'Errors', snapshot: {} });
  const attempt = (snapshot) => call({ action: 'sync', spreadsheetId: created.spreadsheetId, snapshot });
  assert.match(attempt({ sheetStartRow: 50, officialRows: officialRows(1) }).error, /Row 50 is not a log row/);
  assert.match(attempt({ sheetStartRow: 24, preTestRows: [entry(0), entry(5)], officialRows: officialRows(1) }).error, /2 pre-test entries need 2 rows/);
  assert.match(attempt({ officialRows: officialRows(64) }).error, /needs 64 log rows, but the Sheet has 63/);
  assert.equal(attempt({ officialRows: officialRows(63) }).ok, true, 'all 63 rows can be used');
}

// Temperatures typed in the Sheet follow their time when rows shift, and
// temperatures typed on rows with no time yet are kept.
{
  const first = [entry(10, 'Reached 75%')];
  const run = sync({ preTestRows: first, officialRows: officialRows(2) });
  const { log } = run;
  log.getRange('C24').setValue(70);            // first official row (09:60)
  log.getRange('D40').setValue(55);            // a row with no time yet
  run.again({ preTestRows: [entry(0, 'Begin pressurizing', 0), ...first], officialRows: officialRows(2) });
  assert.equal(log.cell('F25'), 'Begin test', 'official test moved down a row');
  assert.equal(log.cell('C25'), 70, 'temperature moved with its time');
  assert.equal(log.cell('C24'), '', 'temperature did not stay on the old row position');
  assert.equal(log.cell('D40'), 55, 'temperatures on rows with no time are kept');

  run.again({ preTestRows: first, officialRows: officialRows(2), });
  assert.equal(log.cell('C24'), 70, 'and moves back again');
}

// A site temperature wins over the Sheet cell.
{
  const run = sync({ officialRows: officialRows(1) });
  run.log.getRange('C23').setValue(70);
  run.again({ officialRows: [{ ...officialRows(1)[0], pressure: 4150.4, ambient: 72.5 }] });
  assert.equal(run.log.cell('C23'), 73, 'site value wins, rounded to a whole degree');
  assert.equal(run.log.cell('B23'), 4150, 'pressure is rounded to whole psi');
}

// Temperatures are written as whole degrees.
{
  const run = sync({ officialRows: [{ ...officialRows(1)[0], ambient: 72.5, pipe: 68.4, ground: 69.49 }] });
  assert.deepEqual([run.log.cell('C23'), run.log.cell('D23'), run.log.cell('E23')], [73, 68, 69]);
}

// Columns switched off on the site are left exactly as typed in the Sheet.
{
  const run = sync({ officialRows: officialRows(2) });
  run.log.getRange('B24').setValue(4999);
  run.log.getRange('F24').setValue('Typed remark');
  run.log.getRange('C24').setValue(88);
  run.again({ sheetSkipColumns: ['pressure', 'comments', 'ambient'], officialRows: officialRows(2).map((row) => ({ ...row, pressure: 4100, ambient: 50, comments: 'Site remark' })) });
  assert.equal(run.log.cell('B24'), 4999, 'pressure column left alone');
  assert.equal(run.log.cell('F24'), 'Typed remark', 'remarks column left alone');
  assert.equal(run.log.cell('C24'), 88, 'ambient column left alone');
  assert.equal(time(run.log.cell('A24')), base + 75 * minute, 'time column still written');
  run.again({ officialRows: officialRows(2).map((row) => ({ ...row, pressure: 4100 })) });
  assert.equal(run.log.cell('B24'), 4100, 'pressure written again once switched back on');
}

console.log('Google Sheet bridge: auto and chosen start rows, page break, capacity errors, operator rows and moving temperatures, whole-degree temperatures and switched-off columns passed.');
