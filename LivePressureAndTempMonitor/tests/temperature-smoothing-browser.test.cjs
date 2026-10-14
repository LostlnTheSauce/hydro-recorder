// Temperature smoothing: on by default (2 min), changes the chart readout and
// log book, can be turned off, and never alters the stored readings.
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
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    assert.equal(await page.locator('[data-gauge="A"] .temp-smoothing').inputValue(), '120', 'smoothing defaults to 2 minutes');
    await page.locator('[data-dashboard-tab="temperature"]').click();
    await page.locator('[data-gauge="A"] .temp-smoothing').selectOption('20');
    // Noisy logger readings around 78 °F, newest one a high spike.
    await page.evaluate(() => {
      const gauge = window.testGauges[0], now = Date.now();
      for (let i = 30; i >= 1; i--) gauge.temperatureReadings.push({ at: now - i * 2000, source: 'live', sourceId: 's', pipe: 78 + (i % 2 ? 0.8 : -0.8) });
      gauge.temperatureReadings.push({ at: now, source: 'live', sourceId: 's', pipe: 81 });
      gauge.drawTemperature();
    });
    const tile = page.locator('[data-gauge="A"] [data-temp-value="pipe"]');
    const smoothed = Number(await tile.innerText());
    assert.ok(smoothed >= 77.9 && smoothed <= 78.3, `readout shows the 20-second trimmed average, not the 81° spike (got ${smoothed})`);
    await page.locator('[data-dashboard-tab="pressure"]').click();
    const logbook = page.locator('[data-gauge="A"] .logbook-card');
    await page.waitForFunction(() => /avg/.test(document.querySelector('[data-gauge="A"] .logbook-card thead')?.textContent || ''));
    assert.match(await logbook.locator('thead').innerText(), /pipe \(20 s avg\)/i, 'log book labels averaged columns');
    await page.locator('[data-dashboard-tab="temperature"]').click();
    // A loose-connection burst (30 s of -330 °F) inside a 2-minute window is ignored.
    await page.locator('[data-gauge="A"] .temp-smoothing').selectOption('120');
    await page.evaluate(() => {
      const gauge = window.testGauges[0], now = Date.now();
      gauge.temperatureReadings.splice(0);
      for (let i = 60; i >= 0; i--) gauge.temperatureReadings.push({ at: now - i * 2000, source: 'live', sourceId: 's', ambient: i <= 20 && i > 5 ? -330 : 75 + (i % 2 ? 0.4 : -0.4) });
      gauge.drawTemperature();
    });
    const ambient = Number(await page.locator('[data-gauge="A"] [data-temp-value="ambient"]').innerText());
    assert.ok(ambient > 74 && ambient < 76, `a -330 °F burst does not reach the readout (got ${ambient})`);
    await page.locator('[data-gauge="A"] .temp-smoothing').selectOption('0');
    assert.equal(await page.locator('[data-gauge="A"] [data-temp-value="ambient"]').innerText(), '74.6', 'Off shows the raw latest reading');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.temperatureSmoothing), 0, 'choice is saved with the test');
    assert.equal(await page.evaluate(() => window.testGauges[0].settings().temperature.smoothingSeconds), 0, 'viewers receive the host choice');
    assert.equal(await page.evaluate(() => window.testGauges[0].temperatureReadings.filter((r) => r.ambient === -330).length), 15, 'stored readings are never changed');
    assert.deepEqual(errors, []);
    console.log('Temperature smoothing: default 2 min, 20 s trimmed average on readout and log book, loose-connection burst ignored, off switch, saved choice, raw data untouched passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
