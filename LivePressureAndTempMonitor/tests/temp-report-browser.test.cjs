// Records "Probe vs chart report (PDF)": a printable page with job details, a summary of
// probe minus chart per probe, one chart per probe and every log row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const { stats, build } = require('../assets/temp-report.js');
  assert.match(build({ probeCount: 0, rows: [{ at: 1790000000000 }], channels: [] }), /No electronic probe readings were loaded/, 'says so when no probe readings are loaded');
  const s = stats([{ pipe: { probe: 78.6, chart: 77 } }, { pipe: { probe: 78.4, chart: 78 } }, { pipe: { probe: null, chart: 78 } }], 'pipe');
  assert.deepEqual([s.count, s.mean.toFixed(2), s.min.toFixed(2), s.max.toFixed(2), s.within1, s.within2], [2, '1.00', '0.40', '1.60', 50, 100]);
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addInitScript(() => { window.print = () => { window.__printed = true; }; });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await page.evaluate(() => {
      const g = window.testGauges[0], M = 60000, start = Math.floor(Date.now() / M) * M - 125 * M;
      Object.assign(g.testState, { jobNumber: 'ATM 4501', poAfe: '303.12191', location: 'East Baton Rouge, LA', ownerRep: 'Dylan Lee' });
      g.testState.events.push({ type: 'official-start', label: 'Official test start', at: start, pressure: 1738 });
      g.testState.officialStart = new Date(start).toISOString();
      for (let i = 0; i <= 125 * 30; i++) {
        g.readings.push({ at: start + i * 2000, pressure: 1738 - i / 1800, unit: 'PSI' });
        // A dropout from 35 to 55 minutes, and a slow stretch (one reading every 4 minutes) from 60 to 95.
        const minute = i / 30;
        if ((minute < 35 || minute > 55) && (minute < 60 || minute > 95 || i % 120 === 0)) g.temperatureReadings.push({ at: start + i * 2000 + 500, source: 'live', sourceId: 's', ambient: 91 + Math.sin(i / 600) * 1.5, pipe: 78.6 - i / 3750, soil: 75.6 });
      }
      for (let m = 0; m <= 120; m += 15) g.temperatureReadings.push({ at: start + m * M, source: 'sheet', ambient: 90 + (m % 30 ? 1 : 0), pipe: 77, soil: 74 });
      g.temperatureReadings.sort((a, b) => a.at - b.at);
      g.saveTestState();
    });
    await page.locator('[data-dashboard-tab="logs"]').click();
    const [report] = await Promise.all([context.waitForEvent('page'), page.locator('[data-gauge="A"] [data-export="probe-report"]').click()]);
    await report.waitForLoadState();
    await report.waitForFunction(() => window.__printed === true, null, { timeout: 5000 });
    const text = await report.locator('body').innerText();
    assert.match(text, /Temperature comparison: electronic probes and recorder charts/);
    assert.match(text, /ATM 4501[\s\S]*303\.12191[\s\S]*East Baton Rouge, LA[\s\S]*Dylan Lee/);
    assert.match(text, /electronic probe readings, /, 'states how many probe readings were used');
    const slow = await report.locator('table.rows tbody tr').nth(5).innerText();
    assert.doesNotMatch(slow, /—/, 'slow-logger stretch (a reading every 4 minutes) is still compared');
    const summary = await report.locator('table.summary tbody tr').allInnerTexts();
    assert.equal(summary.length, 3);
    assert.match(summary[2], /^Soil[\s\S]*\t8\t\+1\.6 °F\t\+1\.6 to \+1\.6 °F\t0%\t100%$/, summary[2]);
    assert.equal(await report.locator('figure svg').count(), 3, 'one chart per probe');
    assert.equal(await report.locator('table.rows tbody tr').count(), 9, 'every log row');
    const gap = await report.locator('table.rows tbody tr').nth(3).innerText();
    assert.match(gap, /—\t91\t/, 'probe gap (feed dropped out) shows a dash beside the chart value');
    await report.pdf({ path: path.join(root, '..', 'tmp', 'temp-report.pdf'), format: 'Letter', printBackground: true });
    await report.setViewportSize({ width: 820, height: 1000 });
    await report.screenshot({ path: path.join(root, '..', 'tmp', 'temp-report.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Probe vs chart report: opens printable page with print dialog, job details, per-probe summary, three charts, every log row with gaps as dashes, saved as PDF passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
