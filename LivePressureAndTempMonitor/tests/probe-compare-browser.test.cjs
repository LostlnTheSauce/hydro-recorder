// Records "Download probe vs Sheet temps CSV": each Sheet log row with the electronic
// probes' readings beside the temperatures from the Sheet, for comparing them.
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
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await page.evaluate(() => {
      const g = window.testGauges[0], M = 60000, start = Math.floor(Date.now() / M) * M - 20 * M;
      g.testState.events.push({ type: 'official-start', label: 'Official test start', at: start, pressure: 1738 });
      g.testState.officialStart = new Date(start).toISOString();
      for (let i = 0; i <= 20 * 30; i++) g.readings.push({ at: start + i * 2000, pressure: 1738 - i / 600, unit: 'PSI' });
      // Probes every 2 s; the Sheet holds the chart temperatures (a degree or two lower) at 15-minute rows.
      for (let i = 0; i <= 20 * 30; i++) g.temperatureReadings.push({ at: start + i * 2000 + 500, source: 'live', sourceId: 's', ambient: 92.34, pipe: 78.56, soil: 75.61 });
      g.temperatureReadings.push({ at: start, source: 'sheet', ambient: 91, pipe: 77, soil: 74 }, { at: start + 15 * M, source: 'sheet', ambient: 90, pipe: 77, soil: 74 });
      g.temperatureReadings.sort((a, b) => a.at - b.at);
      g.saveTestState();
    });
    await page.locator('[data-dashboard-tab="logs"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-gauge="A"] [data-export="probes"]').click()]);
    assert.match(download.suggestedFilename(), /digital-vs-physical-temps\.csv$/);
    const lines = fs.readFileSync(await download.path(), 'utf8').split('\r\n').map((line) => JSON.parse(`[${line}]`));
    assert.deepEqual(lines[0], ['Date / time', 'Pressure PSI', 'Ambient digital F', 'Ambient physical F', 'Pipe digital F', 'Pipe physical F', 'Soil digital F', 'Soil physical F', 'Remarks']);
    assert.equal(lines.length, 3, 'header + the 0 and 15 minute rows');
    assert.deepEqual(lines[1].slice(1, 8), ['1738', '92.3', '91', '78.6', '77', '75.6', '74']);
    assert.deepEqual(lines[2].slice(2, 8), ['92.3', '90', '78.6', '77', '75.6', '74']);
    assert.match(lines[1][8], /Begin test/);
    assert.deepEqual(errors, []);
    console.log('Probe vs Sheet CSV: every log row, probe readings to 0.1 °F beside the Sheet temperatures, pressure and remarks passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
