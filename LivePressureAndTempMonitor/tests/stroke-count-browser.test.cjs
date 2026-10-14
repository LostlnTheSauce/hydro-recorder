// Stroke count: start at the post-hold pressure with counter 0, then type the
// counter and press Enter at each 10 psi checkpoint; the box moves to the next
// one and keeps focus. Skip, undo, completion and the Records table.
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
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    const gaugeAt = (pressure) => page.evaluate((p) => { const g = window.testGauges[0]; g.readings.push({ at: Date.now(), pressure: p, unit: 'PSI' }); g.updateUi(); g.strokeCount.render(); }, pressure);
    await gaugeAt(1300.4);
    const card = page.locator('[data-gauge="A"] .stroke-card');
    assert.equal(await card.locator('[data-stroke-input="start"]').inputValue(), '1300', 'start pressure prefilled from the gauge');
    assert.equal(await card.locator('[data-stroke-input="start-counter"]').inputValue(), '0');
    await card.locator('[data-stroke-input="target"]').fill('1340');
    await card.locator('[data-stroke-input="capacity"]').fill('0.0043');
    await card.locator('[data-stroke="start"]').click();
    const counter = card.locator('[data-stroke-input="counter"]');
    assert.match(await card.locator('.stroke-entry label').innerText(), /Counter at\s+1310 psi/);
    assert.equal(await counter.evaluate((el) => el === document.activeElement), true, 'counter box has focus after starting');

    // Type, Enter, next checkpoint, keep typing.
    await page.keyboard.type('103'); await page.keyboard.press('Enter');
    assert.match(await card.locator('.stroke-entry label').innerText(), /Counter at\s+1320 psi/);
    assert.equal(await counter.evaluate((el) => el === document.activeElement && el.value === ''), true, 'focus stays, box cleared');
    await page.keyboard.type('204'); await page.keyboard.press('Enter');
    assert.match(await card.locator('.stroke-entry label').innerText(), /1330 psi/);

    // Gauge reaching the checkpoint is shown; typing is not blocked before it.
    await gaugeAt(1331.2);
    assert.match(await card.locator('.stroke-status').innerText(), /Gauge reached 1330 psi/);
    await page.keyboard.type('308'); await page.keyboard.press('Enter');
    await card.locator('[data-stroke="skip"]').click();
    assert.match(await card.locator('.stroke-done').innerText(), /complete/i, 'skipping the last point finishes the count');
    await card.locator('[data-stroke="undo"]').click();
    assert.match(await card.locator('.stroke-entry label').innerText(), /Counter at\s+1340 psi/, 'undo brings the skipped point back');
    await counter.fill('410'); await counter.press('Enter');
    assert.match(await card.locator('.stroke-done').innerText(), /complete · 410 strokes/, 'stops at the target');

    const rows = await card.locator('.stroke-table tbody tr').allInnerTexts();
    assert.deepEqual(rows.map((r) => r.split('\t').slice(0, 3).join(' ')), ['1340 psi 410 102', '1330 psi 308 104', '1320 psi 204 101', '1310 psi 103 103', '1300 psi 0 start']);
    const saved = await page.evaluate(() => window.testGauges[0].testState.workflow);
    assert.equal(saved.baseline.pressure, 1300); assert.equal(saved.strokes.length, 4);
    assert.ok(saved.strokes[2].crossingAt > 0, 'time the gauge reached the checkpoint is kept');
    await page.screenshot({ path: path.join(root, '..', 'tmp', 'stroke-count.png'), fullPage: true });
    // Undo after completion removes the last entry for correction.
    await card.locator('[data-stroke="undo"]').click();
    assert.match(await card.locator('.stroke-entry label').innerText(), /Counter at\s+1340 psi/);
    // Finish here ends the count short of the target; Reopen brings the next point back.
    await card.locator('[data-stroke="finish"]').click();
    assert.match(await card.locator('.stroke-done').innerText(), /complete · 308 strokes/, 'finished at the last entry');
    assert.equal(await card.locator('[data-stroke-input="counter"]').count(), 0);
    await card.locator('[data-stroke="undo"]').click();
    assert.match(await card.locator('.stroke-entry label').innerText(), /Counter at\s+1340 psi/, 'reopen asks for the next point again');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.workflow.strokes.length), 3, 'reopening keeps the entries');
    assert.deepEqual(errors, []);
    console.log('Stroke count: prefilled start, type + Enter to the next checkpoint with focus kept, gauge reached status, skip, undo, finish here, stop at target and saved record passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
