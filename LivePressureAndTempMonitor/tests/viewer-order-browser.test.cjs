// Viewer trace stays in time order: a double sign-in during a slow multi-page load starts only one
// load, and readings that arrive out of order (e.g. the host catching up) are put back in order
// with one reading per moment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const base = Date.now() - 3 * 3600000;
  // Three pages by id; the third holds readings the host sent late (older times).
  const rows = [];
  let id = 0;
  for (let i = 0; i < 30; i++) rows.push({ id: ++id, slot: 'A', at: base + i * 60000, pressure: 100 + i, unit: 'PSI' });
  for (let i = 40; i < 60; i++) rows.push({ id: ++id, slot: 'A', at: base + i * 60000, pressure: 100 + i, unit: 'PSI' });
  for (let i = 30; i < 40; i++) rows.push({ id: ++id, slot: 'A', at: base + i * 60000, pressure: 100 + i, unit: 'PSI' });
  rows.push({ id: ++id, slot: 'A', at: base + 5 * 60000, pressure: 105, unit: 'PSI' }); // a repeat
  let viewCalls = 0, firstPageCalls = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/viewer.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('viewer.php').replace('data-session-id=""', 'data-session-id="0123456789abcdef"')); }
    if (url.pathname === '/api.php') {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      return req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        res.setHeader('content-type', 'application/json');
        const action = url.searchParams.get('action');
        if (action === 'viewer_title') return res.end(JSON.stringify({ title: null }));
        if (action !== 'view') { res.writeHead(404); return res.end('{}'); }
        viewCalls++;
        const since = Number(body.since_id) || 0;
        if (!since) firstPageCalls++;
        const page = rows.filter((r) => r.id > since).slice(0, 25);
        const reply = { title: 'Order test', updated_at: Date.now(), server_time: Date.now(), config: { A: { name: 'Test 1', chartMax: 1000 } },
          readings: page, last_id: page.length ? page.at(-1).id : since, has_more: rows.some((r) => r.id > (page.at(-1)?.id ?? since)), viewer_token: 't'.repeat(64) };
        setTimeout(() => res.end(JSON.stringify(reply)), since ? 50 : 400);
      });
    }
    const file = path.join(root, url.pathname);
    if (url.pathname === '/assets/viewer.js') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file, 'utf8').replace('const defaults = {', 'window.testViewerState = state; const defaults = {')); }
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(404); res.end('');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/viewer.php?id=0123456789abcdef`);
    await page.locator('#viewerLoginPassword').fill('1234');
    // Two submits in a row (double tap / password manager).
    await page.evaluate(() => { const form = document.getElementById('viewerLogin'); form.requestSubmit(); form.requestSubmit(); });
    await page.locator('#viewerDashboard:not(.hidden)').waitFor();
    assert.equal(firstPageCalls, 1, 'only one full load started');
    const ats = await page.evaluate(() => window.testViewerState.A.readings.map((r) => r.at));
    assert.equal(ats.length, 60, 'every moment once');
    assert.equal(ats.every((at, i) => i === 0 || at > ats[i - 1]), true, 'in time order');
    const pressures = await page.evaluate(() => window.testViewerState.A.readings.map((r) => r.pressure));
    assert.deepEqual(pressures, Array.from({ length: 60 }, (_, i) => 100 + i));
    assert.equal(await page.locator('#viewerLogin button[type="submit"]').isDisabled(), false, 'button usable again');
    assert.deepEqual(errors, []);
    console.log(`Viewer order: double sign-in starts one load (${viewCalls} page requests), late readings put back in time order, repeats dropped passed.`);
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
