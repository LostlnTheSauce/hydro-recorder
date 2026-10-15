// Changing the pump after a stroke count: the Stroke count panel (or the Setup pump select)
// figures the gallons again at the new pump's rate after a confirmation, leaving the counter
// readings and strokes as typed. A saved test whose count used another rate can build its
// post-test package at either rate.
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      if (localStorage.getItem('grantg-hydro-equipment-v1')) return;
      localStorage.setItem('grantg-hydro-equipment-v1', JSON.stringify([
        { id: 'pump-pdq', type: 'pump', name: 'PDQ Pump', capacity: '0.0043', isDefault: true, intervalMonths: 6 },
        { id: 'pump-triplex', type: 'pump', name: 'Triplex', capacity: '0.0068', isDefault: false, intervalMonths: 6 },
        { id: 'pump-blank', type: 'pump', name: 'Old pump', capacity: '', isDefault: false, intervalMonths: 6 }]));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    let answer = true, asked = '';
    page.on('dialog', (dialog) => { asked = dialog.message(); return answer || dialog.type() === 'alert' ? dialog.accept() : dialog.dismiss(); });
    await page.evaluate(() => { const g = window.testGauges[0]; g.readings.push({ at: Date.now(), pressure: 1300, unit: 'PSI' }); g.updateUi(); g.strokeCount.render(); });
    const card = page.locator('[data-gauge="A"] .stroke-card');
    await card.locator('[data-stroke="toggle"]').click();
    // Before starting, the pump is picked from the equipment list (a pump with no rate cannot be).
    const startPump = card.locator('[data-stroke-input="setup-pump"]');
    assert.deepEqual(await startPump.locator('option').evaluateAll((o) => o.map((x) => [x.value, x.textContent, x.disabled])),
      [['pump-pdq', 'PDQ Pump · 0.0043 gal/stroke', false], ['pump-triplex', 'Triplex · 0.0068 gal/stroke', false], ['pump-blank', 'Old pump · no rate set', true], ['other', 'Other rate…', false]]);
    assert.equal(await startPump.inputValue(), 'pump-pdq');
    // Other rate: type one that is not in the list.
    await startPump.selectOption('other');
    assert.equal(await card.locator('.stroke-other-rate').isVisible(), true);
    await card.locator('[data-stroke="start"]').click();
    assert.match(await card.locator('.stroke-message').innerText(), /Type the pump’s gallons per stroke/);
    await card.locator('[data-stroke-input="capacity"]').fill('0.005');
    await card.locator('[data-stroke="start"]').click();
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.workflow.baseline.capacity), 0.005);
    await card.locator('[data-stroke="undo"]').click();
    // Picking the Triplex starts at its rate and makes it the test's pump.
    await card.locator('[data-stroke-input="setup-pump"]').selectOption('pump-triplex');
    await card.locator('[data-stroke="start"]').click();
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.workflow.baseline.capacity), 0.0068);
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.equipment.pump), 'pump-triplex');
    assert.equal(await page.locator('[data-gauge="A"] .equipment-select[data-equipment-role="pump"]').inputValue(), 'pump-triplex');
    await card.locator('[data-stroke="undo"]').click();
    await card.locator('[data-stroke-input="setup-pump"]').selectOption('pump-pdq');
    await card.locator('[data-stroke-input="target"]').fill('1320');
    await card.locator('[data-stroke="start"]').click();
    const counter = card.locator('[data-stroke-input="counter"]');
    await counter.fill('1000'); await counter.press('Enter');
    await counter.fill('1600'); await counter.press('Enter');
    const state = () => page.evaluate(() => { const g = window.testGauges[0], w = g.testState.workflow; return { rate: w.baseline.capacity, rows: w.strokes.map((r) => [r.counter, r.strokes, Math.round(r.gallons * 1000) / 1000, Math.round(r.totalGallons * 1000) / 1000]), pump: g.testState.equipment.pump }; });
    assert.deepEqual(await state(), { rate: 0.0043, rows: [[1000, 1000, 4.3, 4.3], [1600, 600, 2.58, 6.88]], pump: 'pump-pdq' });
    const pump = card.locator('[data-stroke-input="pump"]');
    assert.equal(await pump.inputValue(), 'pump-pdq', 'the panel shows the pump the gallons use');

    // Declining keeps everything as it was.
    answer = false; await pump.selectOption('pump-triplex');
    assert.match(asked, /Triplex at 0\.0068 gal\/stroke instead of 0\.0043\? 1600 strokes would be 10\.88 gal \(now 6\.88\)/);
    assert.deepEqual(await state(), { rate: 0.0043, rows: [[1000, 1000, 4.3, 4.3], [1600, 600, 2.58, 6.88]], pump: 'pump-pdq' });
    assert.equal(await pump.inputValue(), 'pump-pdq');

    // Accepting refigures the gallons only and selects the pump in Setup too.
    answer = true; await pump.selectOption('pump-triplex');
    assert.deepEqual(await state(), { rate: 0.0068, rows: [[1000, 1000, 6.8, 6.8], [1600, 600, 4.08, 10.88]], pump: 'pump-triplex' });
    assert.equal(await page.locator('[data-gauge="A"] .equipment-select[data-equipment-role="pump"]').inputValue(), 'pump-triplex');
    assert.match(await card.locator('.stroke-table tbody tr').first().innerText(), /1320 psi\s+1600\s+600\s+4\.08/);

    // The Setup pump select does the same; a pump with no rate is refused.
    await page.locator('[data-dashboard-tab="setup"]').click();
    const setupPump = page.locator('[data-gauge="A"] .equipment-select[data-equipment-role="pump"]');
    await setupPump.selectOption('pump-blank');
    assert.match(asked, /no gal\/stroke set/);
    assert.equal((await state()).rate, 0.0068);
    await setupPump.selectOption('pump-pdq');
    assert.deepEqual(await state(), { rate: 0.0043, rows: [[1000, 1000, 4.3, 4.3], [1600, 600, 2.58, 6.88]], pump: 'pump-pdq' });
    // Saved across a reload.
    await page.reload();
    assert.equal((await state()).rate, 0.0043);

    // Saved test: the package can figure gallons at the test pump's rate.
    if (!(await page.evaluate(() => Boolean(window.HydroTempReport)))) await page.addScriptTag({ path: path.join(root, 'assets/temp-report.js') });
    const result = await page.evaluate(() => {
      const record = { test: { equipment: { pump: 'pump-triplex' }, workflow: { officialStart: 1, officialEnd: 2, baseline: { at: 0, pressure: 1300, counter: 0, capacity: 0.0043 }, strokes: [{ target: 1310, counter: 1000, strokes: 1000, gallons: 4.3, totalGallons: 4.3, at: 1 }] } },
        equipment: [{ id: 'pump-triplex', type: 'pump', name: 'Triplex', capacity: '0.0068' }], readings: [], temperatureReadings: [] };
      const asCounted = HydroTempReport.packageFromRecord(record), atPump = HydroTempReport.packageFromRecord(record, { pumpRate: 0.0068 });
      return { mismatch: asCounted.pumpMismatch, counted: asCounted.strokes.rows[0].totalGallons, pump: atPump.strokes.rows[0].totalGallons, name: atPump.strokes.pumpName, original: record.test.workflow.strokes[0].totalGallons };
    });
    assert.deepEqual(result.mismatch, { name: 'Triplex', rate: 0.0068, counted: 0.0043 });
    assert.equal(result.counted, 4.3); assert.equal(Math.round(result.pump * 1000) / 1000, 6.8); assert.equal(result.name, 'Triplex');
    assert.equal(result.original, 4.3, 'the saved record is not changed');
    assert.deepEqual(errors, []);
    console.log('Stroke pump: panel and Setup pump change refigure gallons after confirming (strokes unchanged), decline keeps it, no-rate pump refused, saved; package can use the test pump rate.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
