// Sync to Sheet never blanks what was typed in the Sheet: with an older Sheet script (before
// version 7, which rewrote the remarks column) an empty sync is refused and any other sync asks
// first; with the current script it syncs, and the confirm says typed remarks are kept.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const syncs = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    if (url.searchParams.get('action') === 'sheet_sync') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => { syncs.push(JSON.parse(body)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, layoutVersion: 7, officialRowsWritten: 0, temperatureReadings: [], updatedAt: new Date().toISOString() })); });
      return;
    }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    const dialogs = []; let answer = true;
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); answer ? dialog.accept() : dialog.dismiss(); });
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    const setSheet = (scriptVersion) => page.evaluate((v) => {
      const g = window.testGauges[0];
      g.testState.sheet = { spreadsheetId: 'abcdefghijklmnopqrstuvwxyz0123', url: 'https://docs.google.com/spreadsheets/d/abc', title: 'Test', scriptVersion: v };
      g.saveTestState(); g.renderSheetStatus();
    }, scriptVersion);
    await page.locator('[data-dashboard-tab="logs"]').click();
    const sync = page.locator('[data-gauge="A"] .sync-google-sheet'), message = page.locator('[data-gauge="A"] .sheet-sync-message');

    // Old script, nothing to sync (no official start, no entries): refused, nothing sent.
    await setSheet(6);
    await sync.click();
    assert.match(await message.innerText(), /Nothing to sync yet.*older version that would blank what you typed/s);
    assert.equal(syncs.length, 0, 'nothing sent to the Sheet');

    // Old script with rows to sync: warned first; Cancel sends nothing.
    await page.evaluate(() => { const g = window.testGauges[0]; g.testState.events.push({ type: 'note', label: 'Begin pressurizing', at: Date.now() - 60000, pressure: 0 }); g.saveTestState(); });
    answer = false; dialogs.length = 0;
    await sync.click();
    assert.match(dialogs[0], /older version: syncing rewrites the remarks column/);
    assert.equal(syncs.length, 0, 'cancel: nothing sent');

    // Current script: the confirm says typed remarks are kept, and it syncs.
    await setSheet(7);
    answer = true; dialogs.length = 0;
    await sync.click();
    await page.waitForFunction(() => /Synced/.test(document.querySelector('[data-gauge="A"] .sheet-sync-message').textContent));
    assert.match(dialogs[0], /Temperatures and remarks you typed in the Sheet are kept/);
    assert.match(dialogs[0], /Rows the site has nothing for are left as they are/);
    assert.equal(syncs.length, 1);
    // Only the stroke count: every LOG column and pre-test entries off. No start row needed, no LOG rows sent.
    await page.evaluate(() => {
      const g = window.testGauges[0], w = g.workflowController.state(), now = Date.now();
      HydroWorkflow.manualStroke(w, now - 3000, 1300, 0, 0.0043);
      HydroWorkflow.manualStroke(w, now - 2000, 1310, 103, 0.0043);
      w.strokePlan = { step: 10, target: 1740, skipped: [] };
      g.saveTestState();
    });
    await page.locator('[data-gauge="A"] .sheet-pretest-toggle').uncheck();
    await page.locator('[data-gauge="A"] .sheet-design-toggle').uncheck();
    for (const column of ['pressure', 'ambient', 'pipe', 'ground', 'comments']) {
      const box = page.locator(`[data-gauge="A"] [data-sheet-column="${column}"]`);
      if (await box.isChecked()) await box.uncheck();
    }
    assert.match(await message.innerText(), /All LOG columns are off: Sync to Sheet will leave the LOG rows as they are \(no start row needed\)/);
    dialogs.length = 0;
    await sync.click();
    await page.waitForFunction(() => /LOG rows were left as they are/.test(document.querySelector('[data-gauge="A"] .sheet-sync-message').textContent));
    assert.match(dialogs[0], /All LOG columns are off, so the LOG rows are left as they are\. Only the job details at the top and the stroke count are written/);
    const sent = syncs.at(-1).snapshot;
    assert.deepEqual([sent.preTestRows.length, sent.officialRows.length, sent.postTestRows.length], [0, 0, 0], 'no LOG rows sent');
    assert.equal(sent.strokes.entries.length, 1, 'stroke count sent');
    // The same with an older Sheet script: refused, since it would blank the LOG rows.
    await setSheet(6);
    const before = syncs.length;
    await sync.click();
    assert.match(await message.innerText(), /All LOG columns are off, but your Google Sheet script is an older version/);
    assert.equal(syncs.length, before);
    assert.deepEqual(errors, []);
    console.log('Sheet sync safety: stroke count alone with every LOG column off (no start row, LOG untouched), old Sheet script refused when there is nothing to sync and warned otherwise (cancel sends nothing), current script syncs with a confirm that says typed remarks are kept passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
