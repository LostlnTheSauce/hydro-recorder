// Temperatures typed into the Sheet (chart thermometers, a few degrees off the probes)
// must not notch the probe lines every 15 minutes: they are drawn as dots, and the log
// book shows the probes. A channel with no probe keeps its typed values as its line.
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
    // Unit: soil probed, so the typed soil value moves to a dot; aux only typed, so it stays.
    const split = await page.evaluate(() => TemperatureChartRenderer.probePreferred([
      { at: 1, source: 'live', soil: 75.6 }, { at: 2, source: 'sheet', soil: 72, aux: 60 }, { at: 3, source: 'manual', soil: 71 },
    ]));
    assert.deepEqual(split.readings, [{ at: 1, source: 'live', soil: 75.6 }, { at: 2, source: 'sheet', aux: 60 }]);
    assert.deepEqual(split.typed, [{ at: 2, key: 'soil', value: 72 }, { at: 3, key: 'soil', value: 71 }]);
    assert.deepEqual(await page.evaluate(() => TemperatureChartRenderer.probePreferred([{ at: 1, source: 'manual', pipe: 70 }]).typed), [], 'no probes: typed values stay the line');
    // Two hours of probe readings with Sheet values 4 °F lower every 15 minutes.
    await page.evaluate(() => {
      const g = window.testGauges[0], M = 60000, start = Math.floor(Date.now() / (15 * M)) * 15 * M - 120 * M;
      for (let i = 0; i <= 3600; i++) g.readings.push({ at: start + i * 2000, pressure: 1736, unit: 'PSI' });
      for (let i = 0; i <= 3600; i++) g.temperatureReadings.push({ at: start + i * 2000, source: 'live', sourceId: 's', ambient: 92 + Math.sin(i / 300), pipe: 78.6, soil: 75.6 });
      for (let m = 0; m <= 120; m += 15) g.temperatureReadings.push({ at: start + m * M, source: 'sheet', ambient: 91, pipe: 76, soil: 71.5 });
      g.temperatureReadings.sort((a, b) => a.at - b.at);
      g.updateUi(); g.drawTemperature();
    });
    await page.locator('[data-dashboard-tab="pressure"]').click();
    const logbook = page.locator('[data-gauge="A"] .logbook-card');
    await logbook.locator('[data-logbook-interval="900000"]').click();
    const soil = await logbook.locator('tbody tr:not(.logbook-day):not(.logbook-latest) td.logbook-temp').evaluateAll((cells) => cells.map((td) => td.textContent));
    // Cells run ambient, pipe, soil per row: pipe and soil must be the probes' 78.6 / 75.6, never 76 / 71.5.
    const pipe = soil.filter((_, i) => i % 3 === 1), soilOnly = soil.filter((_, i) => i % 3 === 2);
    assert.ok(soilOnly.length >= 6 && soilOnly.every((text) => text === '75.6°') && pipe.every((text) => text === '78.6°'), `log book shows probe readings, not Sheet values (${soil.slice(0, 9)})`);
    await page.locator('[data-dashboard-tab="temperature"]').click();
    await page.evaluate(() => window.testGauges[0].drawTemperature());
    await page.locator('[data-gauge="A"] .temperature-chart').screenshot({ path: path.join(root, '..', 'tmp', 'typed-temps-chart.png') });
    assert.deepEqual(errors, []);
    console.log('Typed temperatures: kept out of probe lines and shown as dots, log book shows probes, typed-only channels unchanged passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
