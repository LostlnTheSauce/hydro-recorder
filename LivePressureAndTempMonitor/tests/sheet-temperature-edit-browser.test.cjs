// A temperature the operator corrects in the Google Sheet must survive the next
// Sync to Sheet, and the official test can start on a LOG row the operator picks. Runs the real Apps Script (Code.gs) against an in-memory workbook.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const { fakeWorkbook, appsScript } = require('./fake-google-sheet.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const workbook = fakeWorkbook();
  const bridge = appsScript(workbook);
  const log = workbook.tabs.LOG;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    if (url.pathname === '/api.php' && req.method === 'POST' && /^sheet_(create|sync)$/.test(url.searchParams.get('action') || '')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        const action = url.searchParams.get('action');
        const result = action === 'sheet_create'
          ? bridge({ action: 'create', title: payload.title, snapshot: payload.snapshot })
          : bridge({ action: 'sync', spreadsheetId: payload.spreadsheet_id, snapshot: payload.snapshot });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result));
      });
      return;
    }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`${base}/host.php`);
    await page.waitForFunction(() => window.testGauges && window.testGauges[0]);

    // New tests start with the Remarks column switched off; this test syncs remarks too.
    assert.equal(await page.locator('[data-sheet-column="comments"]').first().isChecked(), false, 'Remarks off by default');
    assert.deepEqual(await page.evaluate(() => window.testGauges[0].sheetColumnsOff()), ['comments']);
    await page.evaluate(() => { const box = document.querySelector('[data-sheet-column="comments"]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.deepEqual(await page.evaluate(() => window.testGauges[0].sheetColumnsOff()), []);

    // Official test started 20 minutes ago: rows at start and start + 15 min.
    const start = await page.evaluate(() => {
      const g = window.testGauges[0];
      const at = Date.now() - 20 * 60 * 1000;
      g.testState.officialStart = new Date(at).toISOString();
      g.testState.events = [...(g.testState.events || []), { type: 'official-start', at, label: 'Official test start' }];
      return at;
    });
    await page.evaluate(() => window.testGauges[0].createGoogleSheet());
    await page.waitForFunction(() => window.testGauges[0].testState.sheet?.spreadsheetId);
    const row = 23; // Auto: no pre-test entries, so the official test starts on the first log row
    assert.equal(Number(log.cell(`A${row}`)), start, 'first official row is the start time');

    // Operator types 60 °F ambient in the Sheet, then syncs: the site picks it up.
    log.getRange(`C${row}`).setValue(60);
    const sync = async () => {
      const before = await page.evaluate(() => window.testGauges[0].testState.sheet.lastSyncedAt);
      await page.evaluate(() => window.testGauges[0].syncGoogleSheet());
      await page.waitForFunction((b) => window.testGauges[0].testState.sheet.lastSyncedAt !== b && !window.testGauges[0].sheetSyncInFlight, before);
    };
    await sync();
    const siteAmbient = () => page.evaluate((at) => window.testGauges[0].temperatureReadings.find((e) => e.source === 'sheet' && e.at === at)?.ambient, start);
    assert.equal(await siteAmbient(), 60);

    // Operator corrects it to 62 in the Sheet. The next sync must keep 62.
    log.getRange(`C${row}`).setValue(62);
    await sync();
    assert.equal(log.cell(`C${row}`), 62, 'Sheet edit survives Sync to Sheet');
    assert.equal(await siteAmbient(), 62, 'site picks up the corrected value');

    // Operator clears it in the Sheet. The next sync keeps it cleared.
    log.getRange(`C${row}`).setValue('');
    await sync();
    assert.equal(log.cell(`C${row}`), '', 'Sheet deletion survives Sync to Sheet');
    assert.equal(await siteAmbient(), undefined, 'site drops the cleared value');

    // A replacement Sheet still carries the temperatures already pulled from the old one.
    log.getRange(`D${row}`).setValue(71);
    await sync();
    await page.evaluate(() => window.testGauges[0].createGoogleSheet());
    await page.waitForFunction(() => !window.testGauges[0].sheetSyncInFlight && /Created/.test(document.querySelector('.sheet-sync-message').textContent));
    assert.equal(log.cell(`D${row}`), 71, 'replacement Sheet keeps Sheet temperatures');

    // Operator picks LOG row 30 for the official start; their own row 24 is left alone.
    log.getRange('A24:F24').setValues([[new Date(start - 30 * 60 * 1000), 3100, 64, 72, 84, 'Typed by hand']]);
    await page.evaluate(() => document.querySelector('[data-dashboard-tab="logs"]')?.click());
    const startRow = page.locator('.sheet-start-row-input').first();
    await startRow.fill('49');
    await startRow.dispatchEvent('change');
    assert.match(await page.locator('.sheet-sync-message').first().innerText(), /Row 49 is not a log row/);
    await startRow.fill('30');
    await startRow.dispatchEvent('change');
    assert.match(await page.locator('.sheet-sync-message').first().innerText(), /official test will go on LOG rows 30–31/);
    await sync();
    assert.match(log.cell('F30'), /^Begin test/, 'official test starts on the chosen row');
    assert.equal(log.cell('F24'), 'Typed by hand', 'operator row above the start row is untouched');
    assert.equal(log.cell('D30'), 71, 'Sheet temperature followed its time to the new row');
    assert.match(await page.locator('.sheet-sync-message').first().innerText(), /on LOG rows 30–31/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => JSON.parse(localStorage.getItem(k) || 'null')?.sheetStartRow !== undefined))).sheetStartRow), 30, 'start row is saved with the test');
    await page.screenshot({ path: path.join(root, '..', 'tmp', 'sheet-start-row.png'), fullPage: false });

    // Test times typed with the planned end still ahead: the start is saved, the end waits.
    const local = (ms) => { const d = new Date(ms); const pad = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
    const lateStart = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 60000) * 60000;
    await page.evaluate(([startValue, endValue]) => {
      for (const [selector, value] of [['.test-start', startValue], ['.test-end', endValue]]) {
        const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, [local(lateStart), local(Date.now() + 6 * 60 * 60 * 1000)]);
    await page.locator('[data-act="period"]').first().click();
    assert.match(await page.locator('.period-message').first().innerText(), /end time is still ahead, so only the start was saved/);
    assert.equal(await page.evaluate(() => window.testGauges[0].sheetRows().officialRows.length), 9, 'a start entered two hours late builds every 15-minute row back to it');
    assert.equal(await page.locator('.test-end').first().inputValue(), '', 'planned end is not saved');

    // An unplugged ambient probe (-321 °F) with the Ambient switch off: the Sheet's
    // ambient cell is left alone; other temperatures go in as whole degrees.
    await page.evaluate((at) => {
      const g = window.testGauges[0];
      g.temperatureReadings.push({ at, source: 'manual', ambient: -321.754, pipe: 68.9936, soil: 69.7874 });
      g.temperatureReadings.sort((x, y) => x.at - y.at);
    }, lateStart);
    log.getRange('C30').setValue(77);
    await page.locator('[data-sheet-column="ambient"]').first().uncheck();
    await sync();
    assert.deepEqual([log.cell('C30'), log.cell('D30'), log.cell('E30')], [77, 69, 70], 'ambient untouched, others whole degrees');
    await page.locator('[data-sheet-column="ambient"]').first().check();

    // Pipe column switched off: the Sheet's pipe value is left as typed.
    log.getRange('D30').setValue(55);
    const pipeBox = page.locator('[data-sheet-column="pipe"]').first();
    await pipeBox.uncheck();
    assert.match(await page.locator('.sheet-sync-message').first().innerText(), /leave the pipe column/);
    await sync();
    assert.equal(log.cell('D30'), 55, 'switched-off column is not overwritten');
    assert.equal(log.cell('E30'), 70, 'other columns still sync');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.sheetColumns.pipe), false, 'switch is saved with the test');

    // A test saved before the Remarks default existed keeps every column on after a reload.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('A') && JSON.parse(localStorage.getItem(k) || 'null')?.sheetColumns);
      const saved = JSON.parse(localStorage.getItem(key)); delete saved.sheetColumns; localStorage.setItem(key, JSON.stringify(saved));
    });
    await page.reload();
    await page.waitForFunction(() => window.testGauges && window.testGauges[0]);
    assert.deepEqual(await page.evaluate(() => window.testGauges[0].sheetColumnsOff()), [], 'older saved test keeps Remarks on');
    assert.equal(await page.locator('[data-sheet-column="comments"]').first().isChecked(), true);

    assert.deepEqual(errors, []);
    console.log('Google Sheet temperature edits: correction, deletion and replacement Sheet passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
