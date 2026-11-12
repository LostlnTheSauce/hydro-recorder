// Records "Download all readings CSV": every pressure reading recorded so far (no official test
// needed), with each temperature probe's latest reading beside it; probes with no readings left out.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    if (url.pathname === '/history.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('history.php')); }
    if (url.pathname === '/history-api.php') { res.setHeader('content-type', 'application/json'); return res.end('{"jobs":[]}'); }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await page.locator('[data-dashboard-tab="logs"]').click();
    const readCsv = async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-gauge="A"] [data-export="readings"]').click()]);
      const raw = fs.readFileSync(await download.path(), 'utf8');
      return { name: download.suggestedFilename(), raw, lines: raw.split('\r\n').map((line) => JSON.parse(`[${line}]`)) };
    };
    // Pressures only (no probe hooked up), no official test started.
    const start = await page.evaluate(() => {
      const g = window.testGauges[0], start = Date.UTC(2026, 10, 12, 14, 0, 0);
      for (let i = 0; i < 600; i++) g.readings.push({ at: start + i * 1000, pressure: 1500 + i * 0.1 + 10.00000001, gauge: 1500 + i * 0.1, unit: 'PSI' });
      return start;
    });
    let csv = await readCsv();
    assert.match(csv.name, /_all-readings\.csv$/);
    assert.deepEqual(csv.lines[0], ['Date', 'Time', 'Pressure PSI'], 'no temperature columns without probe readings');
    assert.equal(csv.lines.length, 601, 'every reading');
    assert.deepEqual(csv.lines[1], ['11/12/2026', '8:00:00 AM', '1510']);
    assert.deepEqual(csv.lines.at(-1), ['11/12/2026', '8:09:59 AM', '1569.9']);
    assert.match(await page.locator('[data-gauge="A"] .workflow-records').innerText(), /Downloaded 600 pressure readings.*no temperature probe readings/s);
    // With the pipe probe recording for the second half: its latest reading beside each pressure.
    await page.evaluate((start) => {
      const g = window.testGauges[0];
      for (let i = 300; i < 600; i += 10) g.temperatureReadings.push({ at: start + i * 1000 - 500, source: 'live', sourceId: 's', pipe: 61.234 + i / 1000 });
    }, start);
    csv = await readCsv();
    assert.deepEqual(csv.lines[0], ['Date', 'Time', 'Pressure PSI', 'Pipe F']);
    assert.equal(csv.lines[1][3], '', 'blank before the probe started');
    assert.equal(csv.lines[301][3], '61.534');
    assert.equal(csv.lines[311][3], '61.544', 'the latest reading before each pressure');
    // Test history makes the same file from a saved test's readings.
    const saved = await page.evaluate(() => ({ readings: window.testGauges[0].readings, temperatureReadings: window.testGauges[0].temperatureReadings }));
    const history = await context.newPage();
    history.on('pageerror', (error) => errors.push(error.message));
    await history.goto(`http://127.0.0.1:${server.address().port}/history.php`);
    assert.equal(await history.locator('#replayReadingsCsv').innerText(), 'All readings (CSV)');
    const historyCsv = await history.evaluate((rec) => HydroReadingsCsv.text(HydroReadingsCsv.table(rec.readings, rec.temperatureReadings, { pipe: 'Pipe' })), saved);
    assert.equal(historyCsv, csv.raw, 'History CSV is byte-for-byte the Live one');
    assert.equal(await history.evaluate(() => HydroReadingsCsv.fileName('', 'A')), 'Test-A_all-readings.csv');
    assert.deepEqual(errors, []);
    console.log('All readings CSV (Live and History): every pressure reading without an official test, date and time columns, probe columns only when the probe recorded, latest probe reading beside each pressure passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
