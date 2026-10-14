// "Set up another field laptop": the host downloads a fresh field-device.settings
// for the chosen logger (same ID, new token) after confirming. No real devices or APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const requests = [];
  const device = { id: 'c'.repeat(16), serial: 'T88206', online: false, ready: false, power: null, source_id: null, session_id: null, slot: null };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    if (url.pathname === '/temperature.php') {
      let body = ''; req.on('data', (chunk) => { body += chunk; });
      return req.on('end', () => {
        const action = url.searchParams.get('action');
        requests.push({ action, body: JSON.parse(body || '{}'), csrf: req.headers['x-csrf-token'] });
        res.setHeader('content-type', 'application/json');
        if (action === 'list_devices') return res.end(JSON.stringify({ devices: [device], server_time: Date.now() }));
        if (action === 'reissue_device') return res.end(JSON.stringify({ settings: { website: 'https://grantgsolutions.com/hydro', device_id: device.id, device_token: 'f'.repeat(64), serial: 'T88206' } }));
        res.statusCode = 403; res.end('{"error":"offline fixture"}');
      });
    }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await page.locator('[data-dashboard-tab="temperature"]').click();
    const panel = page.locator('[data-gauge="A"]');
    await page.waitForFunction(() => document.querySelector('[data-gauge="A"] .temperature-device-select')?.options.length > 1);
    // Cancelling the confirmation changes nothing.
    page.once('dialog', (dialog) => dialog.dismiss());
    await panel.locator('.temperature-device-reissue').click();
    await page.waitForTimeout(300);
    assert.equal(requests.filter((r) => r.action === 'reissue_device').length, 0, 'cancel does not replace the key');
    page.once('dialog', (dialog) => { assert.match(dialog.message(), /T88206[\s\S]*stops sending/); dialog.accept(); });
    const [download] = await Promise.all([page.waitForEvent('download'), panel.locator('.temperature-device-reissue').click()]);
    assert.equal(download.suggestedFilename(), 'field-device.settings');
    const saved = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(Object.keys(saved), ['website', 'device_id', 'device_token', 'serial']);
    assert.equal(saved.device_id, device.id);
    const call = requests.find((r) => r.action === 'reissue_device');
    assert.deepEqual(call.body, { device_id: device.id });
    assert.ok(call.csrf !== undefined, 'host-only request carries the CSRF header');
    assert.match(await panel.locator('.temperature-bridge-status').innerText(), /Downloaded field-device\.settings for T88206/);
    assert.deepEqual(errors, []);
    console.log('Set up another field laptop: confirm, cancel keeps the key, download named field-device.settings with the same logger ID, host-only request passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
