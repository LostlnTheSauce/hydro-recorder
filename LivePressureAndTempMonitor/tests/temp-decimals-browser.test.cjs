// Temperature decimals: 1 place by default; 2 or 3 shown on the readout and log book,
// saved with the test, sent to viewers; Whole degrees still shows none. Stored readings unchanged.
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
    const decimals = page.locator('[data-gauge="A"] .temp-decimals');
    assert.equal(await decimals.inputValue(), '1', 'one decimal place by default');
    await page.locator('[data-dashboard-tab="temperature"]').click();
    await page.locator('[data-gauge="A"] .temp-smoothing').selectOption('0');
    await page.evaluate(() => {
      const gauge = window.testGauges[0], now = Date.now();
      for (let i = 10; i >= 0; i--) gauge.temperatureReadings.push({ at: now - i * 2000, source: 'live', sourceId: 's', pipe: 78.43167 });
      gauge.drawTemperature();
    });
    const tile = page.locator('[data-gauge="A"] [data-temp-value="pipe"]');
    assert.equal(await tile.innerText(), '78.4');
    await decimals.selectOption('3');
    assert.equal(await tile.innerText(), '78.432', 'three places on the readout');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.temperatureDecimals), 3, 'saved with the test');
    assert.equal(await page.evaluate(() => window.testGauges[0].settings().temperature.decimals), 3, 'viewers receive the choice');
    await page.locator('[data-dashboard-tab="pressure"]').click();
    await page.waitForFunction(() => /78\.432°/.test(document.querySelector('[data-gauge="A"] .logbook-card tbody')?.textContent || ''));
    await page.locator('[data-dashboard-tab="temperature"]').click();
    await decimals.selectOption('2');
    assert.equal(await tile.innerText(), '78.43', 'two places');
    // Whole degrees wins and greys out the picker.
    await page.locator('[data-gauge="A"] .temperature-whole-degrees').check();
    assert.equal(await tile.innerText(), '78');
    assert.equal(await decimals.isDisabled(), true, 'no decimals to pick with Whole degrees');
    assert.equal(await page.evaluate(() => window.testGauges[0].settings().temperature.decimals), 0);
    await page.locator('[data-gauge="A"] .temperature-whole-degrees').uncheck();
    assert.equal(await decimals.isDisabled(), false);
    // Reload: the choice comes back with the test.
    await page.reload();
    assert.equal(await page.locator('[data-gauge="A"] .temp-decimals').inputValue(), '2', 'choice restored after reload');
    assert.deepEqual(errors, []);
    console.log('Temperature decimals: 1 by default, 2 and 3 on readout and log book, saved and sent to viewers, Whole degrees overrides, restored on reload passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
