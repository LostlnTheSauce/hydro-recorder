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
    // Stroke count goes with the snapshot (start + checkpoints, pump size, step) unless switched off.
    const strokes = () => page.evaluate(() => window.testGauges[0].sheetSnapshot().strokes);
    assert.equal(await strokes(), null, 'no stroke count yet');
    await page.evaluate(() => {
      const g = window.testGauges[0], w = g.workflowController.state(), now = Date.now();
      HydroWorkflow.manualStroke(w, now - 3000, 1300, 0, 0.0043);
      HydroWorkflow.manualStroke(w, now - 2000, 1310, 103, 0.0043);
      HydroWorkflow.manualStroke(w, now - 1000, 1320, 204, 0.0043);
      w.strokePlan = { step: 10, target: 1740, skipped: [] };
      g.saveTestState();
    });
    assert.deepEqual(await strokes(), { start: { pressure: 1300, counter: 0 }, entries: [{ pressure: 1310, counter: 103 }, { pressure: 1320, counter: 204 }], capacity: 0.0043, step: 10 });
    await page.locator('[data-gauge="A"] .sheet-strokes-toggle').uncheck();
    assert.equal(await strokes(), null, 'switched off: the stroke tab is left alone');
    // Test design values: sent with the snapshot unless switched off.
    assert.equal(await page.evaluate(() => window.testGauges[0].sheetSnapshot().syncDesign), true);
    await page.locator('[data-gauge="A"] .sheet-design-toggle').uncheck();
    assert.equal(await page.evaluate(() => window.testGauges[0].sheetSnapshot().syncDesign), false, 'design switch off');
    await page.reload();
    assert.equal(await page.locator('[data-gauge="A"] .sheet-pretest-toggle').isChecked(), false, 'stays off after reload');
    assert.equal(await page.locator('[data-gauge="A"] .sheet-design-toggle').isChecked(), false, 'design choice saved');
    // No PDF: the design can be typed in by hand and applied.
    await page.locator('[data-dashboard-tab="setup"]').click();
    const reviewButton = page.locator('[data-gauge="A"] .review-saved-design');
    assert.equal(await reviewButton.innerText(), 'Enter or review values');
    await reviewButton.click();
    assert.match(await page.locator('[data-gauge="A"] .test-design-status').innerText(), /Type the values from the test design/);
    await page.locator('[data-gauge="A"] [data-design-field="lineName"]').fill('WL-248');
    await page.locator('[data-gauge="A"] [data-design-field="sectionLengthFt"]').fill('5280');
    assert.equal(await page.locator('[data-gauge="A"] .design-pipeline-table tbody tr').count(), 6, 'six Pipeline Data rows');
    const cell = (row, col) => page.locator(`[data-gauge="A"] [data-pipeline-row="${row}"][data-pipeline-col="${col}"]`);
    await cell(0, 'od').fill('8.625'); await cell(0, 'wt').fill('0.322'); await cell(0, 'grade').fill('X52');
    await cell(0, 'length').fill('5280'); await cell(0, 'buried').fill('5230'); await cell(0, 'exposed').fill('50'); await cell(0, 'remarks').fill('Road bore');
    await page.locator('[data-gauge="A"] .apply-test-design').click();
    assert.deepEqual(await page.evaluate(() => window.testGauges[0].sheetSnapshot().design.pipelineRows),
      [{ od: '8.625', wt: '0.322', grade: 'X52', length: '5280', buried: '5230', exposed: '50', remarks: 'Road bore' }], 'typed rows go to the Sheet');
    await page.reload();
    await page.locator('[data-dashboard-tab="setup"]').click();
    await page.locator('[data-gauge="A"] .review-saved-design').click();
    assert.equal(await cell(0, 'remarks').inputValue(), 'Road bore', 'rows saved with the test');
    assert.deepEqual(await page.evaluate(() => [window.testGauges[0].testState.design.lineName, window.testGauges[0].testState.design.sectionLengthFt]), ['WL-248', '5280']);
    assert.equal(await page.locator('[data-gauge="A"] .sheet-strokes-toggle').isChecked(), false, 'stroke choice saved too');
    assert.deepEqual(errors, []);
    console.log('Sheet pre-test toggle: on by default, off sends no pre-test rows, requires a start row, saved across reload passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
