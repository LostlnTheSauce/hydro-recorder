// Log book selection: click a row, shift-click another, and the summary shows the time span and the
// pressure (and temperature) change between them; stays through live updates; tap-tap on a touch
// screen; Clear; changing the interval clears it.
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
    for (const touch of [false, true]) {
      const page = await browser.newPage(touch ? { viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 1000 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
      // Five hours of readings, losing 0.1 psi every 10 minutes from 270.5.
      await page.evaluate(() => {
        const g = window.testGauges[0], now = Date.now(), start = now - 5 * 3600000;
        g.readings.splice(0);
        for (let at = start; at <= now; at += 60000) g.readings.push({ at, pressure: Math.round((270.5 - (at - start) / 600000 * 0.1) * 10) / 10, unit: 'PSI' });
        g.updateUi();
      });
      const log = page.locator('[data-gauge="A"] .logbook-card');
      await log.scrollIntoViewIfNeeded();
      await log.locator('[data-logbook-interval="3600000"]').click();
      const rows = log.locator('tbody tr.logbook-row');
      const pressureAt = async (i) => Number((await rows.nth(i).locator('.logbook-pressure').innerText()).replace(/[^\d.]/g, ''));
      const timeAt = async (i) => (await rows.nth(i).locator('.logbook-time').innerText()).replace(/\s*·.*$/, '').trim();
      const [p1, p4, t1, t4] = [await pressureAt(1), await pressureAt(4), await timeAt(1), await timeAt(4)];
      const summary = log.locator('.logbook-selection');
      assert.equal(await summary.isHidden(), true, 'nothing until a row is picked');
      if (touch) await rows.nth(4).tap(); else await rows.nth(4).click();
      assert.match(await summary.innerText(), /another row/);
      if (touch) await rows.nth(1).tap(); else await rows.nth(1).click({ modifiers: ['Shift'] });
      const loss = (p4 - p1).toFixed(1);
      const text = await summary.innerText();
      assert.ok(text.startsWith(`${t4} → ${t1} · 3 hours · ▼ ${loss} psi lost (${p4.toFixed(1)} → ${p1.toFixed(1)})`), text);
      assert.equal(await log.locator('tr.logbook-selected').count(), 4, 'four rows highlighted');
      // A new live reading does not lose the selection.
      await page.evaluate(() => { const g = window.testGauges[0]; g.add({ at: Date.now(), pressure: 268, unit: 'PSI' }); });
      await page.waitForTimeout(200);
      assert.equal(await log.locator('tr.logbook-selected').count(), 4);
      assert.ok((await summary.innerText()).includes('3 hours'));
      await summary.locator('button', { hasText: 'Clear' }).click();
      assert.equal(await summary.isHidden(), true);
      assert.equal(await log.locator('tr.logbook-selected').count(), 0);
      // Changing the interval clears it.
      if (touch) { await rows.nth(2).tap(); await rows.nth(0).tap(); } else { await rows.nth(2).click(); await rows.nth(0).click({ modifiers: ['Shift'] }); }
      assert.ok(!(await summary.isHidden()));
      await log.locator('[data-logbook-interval="900000"]').click();
      assert.equal(await summary.isHidden(), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Log book selection: click + shift-click (and tap + tap) shows span and psi gained/lost, highlighted rows, survives live updates, Clear, interval change clears passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
