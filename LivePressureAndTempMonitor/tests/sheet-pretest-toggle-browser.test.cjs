// "Sync pre-test entries" off: Sync to Sheet sends no pre-test rows (so entries typed
// into the Sheet above the official start are left alone), and it needs a start row.
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
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    // Pressure-up checkpoints before an official start 30 minutes ago.
    await page.evaluate(() => {
      const g = window.testGauges[0], now = Date.now(), start = now - 30 * 60000;
      g.testState.events.push({ type: 'ramp', label: 'Begin pressurizing', at: start - 7200000, pressure: 0 },
        { type: 'ramp', label: '75% pressure checkpoint', at: start - 3600000, pressure: 1306 },
        { type: 'official-start', label: 'Official test start', at: start, pressure: 1738 });
      g.testState.officialStart = new Date(start).toISOString();
      g.saveTestState();
    });
    const snap = () => page.evaluate(() => { try { const s = window.testGauges[0].sheetSnapshot(); return { pre: s.preTestRows.length, official: s.officialRows.length, start: s.sheetStartRow }; } catch (error) { return { error: error.message }; } });
    assert.deepEqual(await snap(), { pre: 2, official: 3, start: 0 }, 'on by default: pre-test entries are synced');
    await page.locator('[data-dashboard-tab="logs"]').click();
    const toggle = page.locator('[data-gauge="A"] .sheet-pretest-toggle');
    assert.equal(await toggle.isChecked(), true);
    await toggle.uncheck();
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.sheetPreTest), false, 'choice saved with the test');
    assert.match((await snap()).error, /enter the LOG row the official test starts on/, 'needs a start row when off');
    assert.match(await page.locator('[data-gauge="A"] .sheet-sync-message').innerText(), /enter the LOG row/);
    await page.locator('[data-gauge="A"] .sheet-start-row-input').fill('27');
    await page.locator('[data-gauge="A"] .sheet-start-row-input').dispatchEvent('change');
    assert.deepEqual(await snap(), { pre: 0, official: 3, start: 27 }, 'off: no pre-test rows sent, official from row 27');
    assert.match(await page.locator('[data-gauge="A"] .sheet-sync-message').innerText(), /LOG rows 27–29/);
    await page.reload();
    assert.equal(await page.locator('[data-gauge="A"] .sheet-pretest-toggle').isChecked(), false, 'stays off after reload');
    assert.deepEqual(errors, []);
    console.log('Sheet pre-test toggle: on by default, off sends no pre-test rows, requires a start row, saved across reload passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
