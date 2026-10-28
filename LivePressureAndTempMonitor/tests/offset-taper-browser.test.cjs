// Pressure offset taper: blank keeps the full offset everywhere (with 0 as the floor);
// "Full offset above 50" fades the offset to 0 over the last 50 psi so a blow-down lands
// on 0, recalculating the stored series both ways without touching the hold.
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
    page.on('dialog', (dialog) => dialog.accept());
    // A new test starts with "Full offset above 100" so a blow-down lands on 0.
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.offsetTaperPsi), 100, 'new tests default to 100');
    assert.equal(await page.locator('[data-gauge="A"] .offset-taper').inputValue(), '100');
    // A test saved before that default keeps the full offset (its readings were figured that way).
    await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('grantg-hydro-test-v1-A')); delete saved.offsetTaperPsi; localStorage.setItem('grantg-hydro-test-v1-A', JSON.stringify(saved)); });
    await page.reload();
    assert.equal(await page.evaluate(() => window.testGauges[0].offsetTaper()), 0, 'older saved test stays on full offset');
    assert.equal(await page.locator('[data-gauge="A"] .offset-taper').inputValue(), '');
    const rec = (raw, offset, taper) => page.evaluate(([r, o, t]) => window.testGauges[0].recordedPressure(r, o, t), [raw, offset, taper]);
    // Blank (0): full offset everywhere, unchanged near zero, never below 0.
    assert.deepEqual([await rec(1736, 9, 0), await rec(5, 9, 0), await rec(0.3, 9, 0), await rec(1, -2, 0), await rec(1.5, -2, 0)], [1745, 14, 0.3, 0, 0]);
    // Full above 50: full offset above 50 psi, fading evenly to 0 at 0.
    assert.deepEqual([await rec(1736, 9, 50), await rec(50, 9, 50), await rec(25, 9, 50), await rec(5, 9, 50), await rec(0.3, 9, 50)], [1745, 59, 29.5, 5.9, 0.3]);
    assert.equal(await rec(10, -20, 50), 6, 'a negative offset fades too');
    assert.equal(await rec(1, -60, 50), 0, 'never below 0');
    // Stored blow-down recorded with the full +9; setting 50 recalculates the low end only.
    const series = [1736, 1000, 100, 50, 20, 5, 0.4, 0];
    await page.evaluate((raws) => {
      const g = window.testGauges[0], now = Date.now();
      g.testState.offset = 9; g.root.querySelector('.pressure-offset').value = '9';
      g.readings.splice(0, g.readings.length, ...raws.map((raw, i) => ({ at: now - (raws.length - i) * 1000, pressure: g.recordedPressure(raw), unit: 'PSI' })));
      // An event entered with the full offset on a near-zero gauge (0.4 + 9), as earlier versions did.
      g.testState.events = [{ id: 'up', at: now - 20000, type: 'note', label: 'Begin pressure up', pressure: 9.4 }];
    }, series);
    assert.deepEqual(await page.evaluate(() => window.testGauges[0].readings.map((r) => r.pressure)), [1745, 1009, 109, 59, 29, 14, 0.4, 0]);
    await page.locator('[data-dashboard-tab="setup"]').click();
    await page.locator('[data-gauge="A"] .offset-taper').fill('50');
    await page.locator('[data-gauge="A"] .offset-taper').dispatchEvent('change');
    const tapered = await page.evaluate(() => window.testGauges[0].readings.map((r) => Math.round(r.pressure * 100) / 100));
    assert.deepEqual(tapered, [1745, 1009, 109, 59, 23.6, 5.9, 0.4, 0], 'low end recalculated; hold unchanged');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.events[0].pressure), 0.4, 'a near-zero event comes back to the gauge reading');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.offsetTaperPsi), 50, 'saved with the test');
    // Back to blank restores the full offset.
    await page.locator('[data-gauge="A"] .offset-taper').fill('');
    await page.locator('[data-gauge="A"] .offset-taper').dispatchEvent('change');
    assert.deepEqual(await page.evaluate(() => window.testGauges[0].readings.map((r) => Math.round(r.pressure * 100) / 100)), [1745, 1009, 109, 59, 29, 14, 0.4, 0]);
    // Changing the offset itself still shifts the whole series once.
    await page.evaluate(() => { const o = window.testGauges[0].root.querySelector('.pressure-offset'); o.value = '7'; o.dispatchEvent(new Event('change')); });
    assert.deepEqual(await page.evaluate(() => window.testGauges[0].readings.map((r) => Math.round(r.pressure * 100) / 100)), [1743, 1007, 107, 57, 27, 12, 0.4, 0]);
    assert.deepEqual(errors, []);
    console.log('Offset taper: blank keeps the full offset with a 0 floor, "full above 50" fades to 0 for a clean landing, recalculation both ways, offset change still shifts once passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
