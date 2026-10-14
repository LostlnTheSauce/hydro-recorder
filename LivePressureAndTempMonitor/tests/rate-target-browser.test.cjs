// Pressure-up pacing: Slow down (blue) above the target rate, Speed up (green)
// well under it, On pace close to it, nothing nagging while holding, shown on
// the readout and the log book's latest row only (no row shading). Fake readings, no devices or APIs.
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    // Two minutes of readings rising at `perMinute` psi/min, ending now.
    const pump = (perMinute) => page.evaluate((rate) => {
      const gauge = window.testGauges[0], now = Date.now();
      gauge.readings.splice(0);
      for (let s = 120; s >= 0; s--) gauge.readings.push({ at: now - s * 1000, pressure: 500 + rate * (120 - s) / 60, unit: 'PSI' });
      gauge.updateUi();
    }, perMinute);
    const rate = page.locator('[data-gauge="A"] .pressure-rate');
    await pump(13);
    assert.equal(await rate.isHidden(), true, 'no indicator until a max rate is set');
    await page.locator('[data-gauge="A"] .rate-target').fill('10');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.rateTarget), 10, 'max rate saved with the test');
    await pump(13);
    assert.match(await rate.innerText(), /Slow down · 13\.0 psi\/min \(max 10\)/);
    assert.match(await rate.getAttribute('class'), /slow/);
    await pump(6);
    assert.match(await rate.innerText(), /Speed up · 6\.0 psi\/min/);
    assert.match(await rate.getAttribute('class'), /speed/);
    await pump(9.5);
    assert.match(await rate.innerText(), /On pace · 9\.5 psi\/min/);
    await pump(0.1);
    assert.match(await rate.innerText(), /Holding/, 'no Speed up nag while holding');
    await pump(-3);
    assert.match(await rate.innerText(), /Falling/);
    // Log book at 1-minute rows flags the minutes that went over 10 psi/min.
    await pump(13);
    const logbook = page.locator('[data-gauge="A"] .logbook-card');
    await logbook.locator('[data-logbook-interval="60000"]').click();
    await logbook.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => /Slow down/.test(document.querySelector('[data-gauge="A"] .logbook-latest .logbook-pace')?.textContent || ''));
    assert.match(await logbook.locator('.logbook-latest .logbook-pace').getAttribute('class'), /slow/, 'latest log book row shows live pacing');
    assert.equal(await logbook.locator('.logbook-pace').count(), 1, 'only the latest row carries the pacing indicator');
    assert.equal(await logbook.locator('.over-limit').count(), 0, 'no rows are shaded');
    await page.screenshot({ path: path.join(root, '..', 'tmp', 'rate-target-logbook.png') });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(root, '..', 'tmp', 'rate-target.png'), clip: { x: 0, y: 0, width: 1440, height: 560 } });
    await page.locator('[data-gauge="A"] .rate-target').fill('');
    assert.equal(await rate.isHidden(), true, 'clearing the box turns it off');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.rateTarget), null);
    assert.deepEqual(errors, []);
    console.log('Rate pacing: slow down / speed up / on pace / holding / falling, saved max rate, latest-row indicator only and off switch passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
