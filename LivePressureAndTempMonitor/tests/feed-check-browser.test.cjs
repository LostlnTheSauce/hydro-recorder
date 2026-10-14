// Feed check card on the host Temperatures page: opens, asks the server for this
// test's per-minute readings and laptop check-ins, and explains each gap.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const M = 60000, now = Date.now(), start = Math.floor(now / M) * M - 30 * M;
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    if (url.pathname === '/temperature.php' && url.searchParams.get('action') === 'feed_check') {
      let body = ''; req.on('data', (chunk) => { body += chunk; });
      return req.on('end', () => {
        requests.push({ body: JSON.parse(body), csrf: req.headers['x-csrf-token'] });
        const minutes = [], checkins = [];
        for (let i = 0; i < 30; i++) {
          const at = start + i * M;
          // 11-14: MadgeTech stopped with the laptop online; 20-21: internet drop, caught up.
          if (i < 11 || i > 14) minutes.push({ at, readings: 30, late: i === 20 || i === 21 ? 30 : 0 });
          checkins.push({ at, checkins: 12, ready: i >= 11 && i <= 14 ? 0 : 12, laptop_temp_f: i >= 11 && i <= 14 ? 203 : 160 });
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ recordings: [{ id: 'r', device_id: 'd', interval_seconds: 2, from: start, to: null }], minutes, checkins, checkins_since: start, server_time: start + 30 * M + 1000 }));
      });
    }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await page.locator('[data-dashboard-tab="temperature"]').click();
    const card = page.locator('[data-gauge="A"] .feed-check-panel');
    await card.locator('summary').click();
    await page.waitForFunction(() => /No temperatures have been recorded online/.test(document.querySelector('[data-gauge="A"] .feed-check-status')?.textContent || ''));
    await page.evaluate(() => localStorage.setItem('grantg-live-session', JSON.stringify({ session_id: 'a'.repeat(16), publish_token: 'b'.repeat(64) })));
    await page.reload();
    await page.locator('[data-dashboard-tab="temperature"]').click();
    await card.locator('summary').click();
    await card.locator('.feed-problems').waitFor();
    assert.deepEqual(requests[0].body, { session_id: 'a'.repeat(16), publish_token: 'b'.repeat(64), slot: 'A', since: await page.evaluate(() => Number(window.testGauges[0].testState.jobStartedAt) || 0) });
    assert.ok(requests[0].csrf !== undefined, 'host request carries the CSRF header');
    assert.match(await card.locator('.feed-summary').innerText(), /86\.7% of expected readings received \(780 of 900\) · 60 arrived late/);
    const problems = await card.locator('.feed-problems li').allInnerTexts();
    assert.equal(problems.length, 2);
    assert.match(problems[0], /MadgeTech not sending · 0 of 120 readings · laptop up to 203 °F/);
    assert.match(problems[0], /check the logger USB cable/i);
    assert.match(problems[1], /Internet dropped, caught up · 60 of 60 readings/);
    assert.equal(await card.locator('.feed-strip .feed-seg').count(), 5, 'strip: on time, missing, on time, caught up, on time');
    await card.screenshot({ path: path.join(root, '..', 'tmp', 'feed-check.png') });
    // Running again asks the server again.
    await card.locator('.feed-check-run').click();
    await page.waitForFunction(() => /Checked/.test(document.querySelector('[data-gauge="A"] .feed-check-status')?.textContent || ''));
    assert.equal(requests.length, 2);
    assert.deepEqual(errors, []);
    console.log('Feed check card: no-session message, host-only request, summary, MadgeTech gap with laptop temperature, internet catch-up, strip and re-check passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
