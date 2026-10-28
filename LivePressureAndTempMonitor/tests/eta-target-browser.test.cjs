// Target pressure ETA: blank by default; with a target set, shows how long and about what time at
// the pace of the last 2 minutes; reached / past; holding or moving away; blow-down (falling);
// saved with the test. Fake readings, no devices or APIs.
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Chicago' });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    // Two minutes of readings changing at `perMinute`, ending at `end` psi at 10:00:00 AM local.
    const now = Date.parse('2026-10-28T10:00:00-05:00');
    const pump = (perMinute, end, extraBefore = 0) => page.evaluate(([rate, last, at, extra]) => {
      const gauge = window.testGauges[0];
      gauge.readings.splice(0);
      for (let s = 120 + extra; s >= 0; s--) gauge.readings.push({ at: at - s * 1000, pressure: last - rate * s / 60, unit: 'PSI' });
      gauge.updateUi();
    }, [perMinute, end, now, extraBefore]);
    const eta = page.locator('[data-gauge="A"] .pressure-eta');
    await pump(33, 1300);
    assert.equal(await eta.isHidden(), true, 'nothing until a target is set');
    assert.equal(await page.locator('[data-gauge="A"] .eta-target').isVisible(), true, 'Target box beside Max rate');
    await page.locator('[data-gauge="A"] .eta-target').fill('1740');
    assert.equal(await page.evaluate(() => window.testGauges[0].testState.etaTarget), 1740, 'saved with the test');
    // 440 psi to go at 33 psi/min = 13.3 min -> 13 min, about 10:13 AM.
    assert.equal(await eta.innerText(), '10:13 AM ~ 13 minutes');
    assert.equal(await eta.getAttribute('title'), 'Reaching 1,740 psi at the pace of the last 2 minutes');
    await pump(60, 1680);
    assert.equal(await eta.innerText(), '10:01 AM ~ 1 minute');
    // Hours.
    await pump(5, 1300);
    assert.equal(await eta.innerText(), '11:28 AM ~ 1 hour 28 minutes');
    await pump(33, 1735);
    assert.equal(await eta.innerText(), '10:00 AM ~ under 1 minute');
    await pump(33, 1739.7);
    assert.equal(await eta.innerText(), 'Reached 1,740 psi');
    assert.match(await eta.getAttribute('class'), /reached/);
    await pump(10, 1745);
    assert.equal(await eta.innerText(), 'Past 1,740 psi');
    await pump(0.05, 1730);
    assert.equal(await eta.innerText(), '10 psi to 1,740 psi · holding');
    await pump(-2, 1730);
    assert.equal(await eta.innerText(), '10 psi to 1,740 psi · falling');
    // Blow-down to 0.
    await page.locator('[data-gauge="A"] .eta-target').fill('0');
    await pump(-100, 900);
    assert.equal(await eta.innerText(), '10:09 AM ~ 9 minutes');
    // The 2-minute pace ignores a burst before then.
    await page.locator('[data-gauge="A"] .eta-target').fill('1740');
    await page.evaluate(([at]) => { const g = window.testGauges[0]; g.readings.unshift({ at: at - 400000, pressure: 100, unit: 'PSI' }); g.updateUi(); }, [now]);
    await pump(20, 1340);
    assert.equal(await eta.innerText(), '10:20 AM ~ 20 minutes');
    // Kept after a reload; blank turns it off.
    await page.reload();
    assert.equal(await page.locator('[data-gauge="A"] .eta-target').inputValue(), '1740');
    await page.locator('[data-gauge="A"] .eta-target').fill('');
    await pump(20, 1340);
    assert.equal(await eta.isHidden(), true);
    assert.deepEqual(errors, []);
    console.log('Target ETA: off by default, minutes and hours with clock time from the 2-minute pace, reached/past, holding/moving away, blow-down to 0, saved, blank turns it off passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
