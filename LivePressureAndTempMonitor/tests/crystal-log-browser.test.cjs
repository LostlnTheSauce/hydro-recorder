// Crystal data log (History): the recorded Crystal readings as a DataLoggerXP-style Excel workbook.
// Checks the Data sheet's run details and rows, the offset taken back out (or kept), gauge-unplugged
// moments left out, the XP2i's 32,000-reading limit, and the dialog (gauge serial from the test,
// model and firmware remembered per gauge).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, '..', 'tmp', 'crystal-log');

const START = Date.UTC(2026, 10, 12, 14, 0, 0), END = START + 2 * 3600000;
function record() {
  // A +10 psi offset, full above 100 psi; the gauge reads 1500.0 rising 0.1 psi a minute.
  const readings = [];
  for (let at = START - 600000; at <= END + 300000; at += 1000) {
    const s = (at - START) / 1000;
    if (s >= 3600 && s < 3720) continue; // gauge unplugged for 2 minutes
    const gauge = 1500 + Math.floor(s / 60) * 0.1;
    readings.push({ at, pressure: gauge + 10 });
  }
  return { test: { offset: 10, offsetTaperPsi: 100, equipment: { digital_gauge: 'crystal-1' },
    events: [{ at: START, type: 'official-start' }, { at: END, type: 'official-end' }] },
    equipment: [{ id: 'crystal-1', type: 'digital_gauge', name: 'Crystal digital gauge', serial: '021863' }], readings };
}
const unzip = (file, part) => execFileSync('unzip', ['-p', file, part]).toString();

async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/history.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('history.php')); }
    if (url.pathname === '/history-api.php') { res.setHeader('content-type', 'application/json'); return res.end('{"jobs":[]}'); }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ timezoneId: 'America/Chicago', acceptDownloads: true });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/history.php`);
    const rec = record();

    // Rows: every 5 s over the official test, the gauge's own reading, the unplugged 2 minutes left out.
    const run = await page.evaluate((r) => HydroCrystalLog.runData(r, { period: 'official', intervalSec: 5, decimals: 1 }), rec);
    assert.equal(run.rows[0].seconds, 0); assert.equal(run.rows[0].value, 1500);
    assert.equal(run.rows.at(-1).seconds, 7200); assert.equal(run.rows.at(-1).value, 1512);
    assert.equal(run.skipped, 23, 'the unplugged 2 minutes are left out (3600 s still has a reading 1 s away)');
    assert.equal(run.rows.length, 1441 - 23);
    assert.ok(run.rows.every((row, i) => i === 0 || row.seconds > run.rows[i - 1].seconds), 'elapsed seconds only go up');
    // New recordings save the gauge's own reading with each one: used as is, whatever the offset.
    const stored = await page.evaluate((r) => HydroCrystalLog.runData({ ...r, readings: r.readings.map((x) => ({ ...x, gauge: Math.round((x.pressure - 10) * 10) / 10 + 0.04 })) }, { period: 'official', intervalSec: 60, decimals: 2 }), rec);
    assert.equal(stored.rows[1].value, 1500.14, 'the saved gauge reading, not worked out from the offset');
    assert.equal(await page.evaluate(() => HydroCrystalLog.gaugePressure(50.0, 10, 100)), 50 / 1.1, 'tapered offset taken out');
    const tooMany = await page.evaluate((r) => { try { HydroCrystalLog.runData(r, { period: 'all', intervalSec: 1 }); return ''; } catch (e) { return e.message; } }, { ...rec, readings: [{ at: 0, pressure: 1 }, { at: 40000000, pressure: 1 }] });
    assert.match(tooMany, /holds 32,000.*every 2 seconds/);

    // Dialog: the test's Crystal serial filled in; model and firmware required, then remembered.
    await page.evaluate((r) => HydroCrystalLog.openDialog(r), rec);
    assert.equal(await page.locator('.crystal-serial').inputValue(), '021863');
    assert.equal(await page.locator('.crystal-interval').inputValue(), '5');
    assert.equal(await page.locator('.crystal-pressure').count(), 0, 'no offset option');
    assert.match(await page.locator('.crystal-offset-note').innerText(), /offset is never included/);
    await page.locator('#crystalLogDialog [value="build"]').click();
    assert.match(await page.locator('.crystal-message').innerText(), /serial number, model and firmware/);
    await page.locator('.crystal-model').fill('5KPSIXP2I');
    await page.locator('.crystal-firmware').fill('R0324');
    const download = page.waitForEvent('download');
    await page.locator('#crystalLogDialog [value="build"]').click();
    const file = await download;
    assert.equal(file.suggestedFilename(), 'CrystalGaugeLog.xlsx');
    fs.mkdirSync(outDir, { recursive: true });
    const xlsx = path.join(outDir, 'CrystalGaugeLog.xlsx');
    await file.saveAs(xlsx);
    assert.match(await page.locator('.crystal-message').innerText(), /1,418 readings every 5 s.*23 moments with no reading/);

    // The workbook: DataLoggerXP's parts in its order, the run details and the rows.
    execFileSync('unzip', ['-tq', xlsx]);
    const parts = execFileSync('unzip', ['-Z1', xlsx]).toString().trim().split('\n');
    assert.deepEqual(parts, ['xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/charts/chart1.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels',
      'xl/worksheets/_rels/sheet1.xml.rels', 'xl/worksheets/sheet2.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'docProps/app.xml', 'docProps/core.xml', 'docProps/custom.xml', '[Content_Types].xml', '_rels/.rels']);
    const data = unzip(xlsx, 'xl/worksheets/sheet2.xml'), strings = unzip(xlsx, 'xl/sharedStrings.xml');
    assert.match(data, /<dimension ref="A1:E1428" \/>/);
    assert.match(data, /<c r="B1" s="1"><v>21863<\/v><\/c>/, 'serial as a number, like the gauge');
    assert.match(strings, /<t>5KPSIXP2I<\/t>.*<t>PSI<\/t><\/si><si><t>R0324<\/t>/s);
    assert.match(data, /<c r="B7" s="1"><v>5<\/v><\/c>/, 'logging interval in seconds');
    const start = Number(/<c r="B8" s="4"><v>([^<]+)<\/v>/.exec(data)[1]), stop = Number(/<c r="B9" s="4"><v>([^<]+)<\/v>/.exec(data)[1]);
    assert.ok(Math.abs(start - (46338 + 8 / 24)) < 1e-9, `start is 11/12/2026 8:00:00 AM local as an Excel date (${start})`);
    assert.ok(Math.abs((stop - start) * 86400 - 7200) < 1e-4, 'stop 2 hours later');
    assert.match(data, /<row r="11" spans="1:2"><c r="A11"><v>0<\/v><\/c><c r="B11"><v>1500<\/v><\/c><\/row><row r="12" spans="1:2"><c r="A12"><v>5<\/v><\/c><c r="B12"><v>1500<\/v><\/c><\/row>/);
    assert.match(data, /<c r="A1428"><v>7200<\/v><\/c><c r="B1428"><v>1512<\/v><\/c>/);
    assert.ok(!/<c r="A\d+"><v>3605<\/v>/.test(data) && /<c r="A\d+"><v>3720<\/v>/.test(data), 'unplugged moments left out, logging picks up after');
    assert.ok(unzip(xlsx, 'xl/charts/chart1.xml').includes("'Data'!$B$11:$B$32010"), 'Report chart covers the gauge memory');

    // Model and firmware come back for this gauge next time.
    await page.locator('#crystalLogDialog [value="cancel"]').click();
    await page.evaluate((r) => HydroCrystalLog.openDialog(r), rec);
    assert.equal(await page.locator('.crystal-model').inputValue(), '5KPSIXP2I');
    assert.equal(await page.locator('.crystal-firmware').inputValue(), 'R0324');
    assert.deepEqual(errors, []);
    console.log('Crystal data log: DataLoggerXP Excel workbook (Report + Data), serial/model/firmware/interval/start/stop, the gauge\'s own readings (saved, or with the offset taken out of older recordings), unplugged gaps left out, 32,000-reading limit, remembered gauge details passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
