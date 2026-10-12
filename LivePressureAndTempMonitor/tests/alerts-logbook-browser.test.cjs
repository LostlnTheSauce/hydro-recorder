// Trailer alerts (gauge unplugged, field laptop power, stalled temperature feed)
// and the log book on the host and viewer pages. Fake gauge, fake API, no real devices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');
const SESSION = 'a'.repeat(16);

const setup = (session) => {
  localStorage.setItem('grantg-live-session', JSON.stringify(session));
  let reply = '1012.3 PSI', controller, open = false;
  const port = {
    readable: null, writable: null,
    getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6001 }),
    async open() { open = true; port.readable = new ReadableStream({ start(c) { controller = c; } }); port.writable = new WritableStream({ write() { if (open) controller.enqueue(new TextEncoder().encode(`${reply}\r\n`)); } }); },
    async close() { open = false; port.readable = null; port.writable = null; },
  };
  window.__unplug = () => { open = false; port.readable = null; port.writable = null; controller.error(new DOMException('The device has been lost.', 'NetworkError')); };
  const serial = new EventTarget();
  serial.requestPort = async () => port;
  serial.getPorts = async () => (open || !window.__unplugged ? [port] : []);
  Object.defineProperty(navigator, 'serial', { value: serial });
};

async function main() {
  let power = { battery_percent: 92, on_ac: true, charging: true, has_battery: true };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    if (url.pathname === '/viewer.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('viewer.php')); }
    if (url.pathname === '/temperature.php') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: true, sources: [], readings: [], last_id: 0, has_more: false, devices: [{
        id: 'd'.repeat(16), serial: 'T88206', online: true, bridge_online: true, ready: true, session_id: SESSION, slot: 'A', source_id: 's'.repeat(16),
        sample_interval_seconds: 2, whole_degrees: false, power: { ...power, reported_at: Date.now() } }] }));
    }
    if (url.pathname === '/api.php') {
      res.setHeader('content-type', 'application/json');
      const now = Date.now();
      return res.end(JSON.stringify({ title: 'Viewer test', updated_at: now, server_time: now, last_id: 3, has_more: false, viewer_token: 'x',
        config: { A: { name: 'Line 4', temperature: { viewerVisible: true, enabledProbes: ['pipe'], channels: [{ key: 'pipe', name: 'Pipe' }, { key: 'soil', name: 'Soil' }],
          readings: [{ at: now - 60000, pipe: 71.2, soil: 66.1 }, { at: now - 1000, pipe: 71.4, soil: 66.3 }] } }, notes: [] },
        readings: [{ id: 1, slot: 'A', at: now - 120000, pressure: 1001.2, unit: 'PSI' }, { id: 2, slot: 'A', at: now - 60000, pressure: 1001.6, unit: 'PSI' }, { id: 3, slot: 'A', at: now - 1000, pressure: 1001.9, unit: 'PSI' }] }));
    }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(setup, { session_id: SESSION, publish_token: 'b'.repeat(64), viewer_enabled: false, last_published_at: { A: 0, B: 0 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    const alerts = () => page.locator('#hostAlerts').innerText();
    const waitFor = async (check, label) => { for (let i = 0; i < 80; i++) { if (await check()) return; await page.waitForTimeout(100); } assert.fail(`Timed out waiting for ${label}`); };
    await page.goto(`${base}/host.php`);
    await page.evaluate(() => window.testGauges[0].connect());
    await waitFor(async () => await page.evaluate(() => window.testGauges[0].readings.length) > 2, 'gauge readings');
    assert.equal(await page.locator('#hostAlerts').isHidden(), true, 'no alerts while everything is fine');

    // Log book on the Live test page shows tenths and the newest reading first.
    const logbook = page.locator('[data-gauge="A"] .logbook-card');
    await waitFor(async () => /1012\.3 psi/.test(await logbook.innerText()), 'host log book');
    assert.match(await logbook.locator('tbody tr').nth(1).innerText(), /latest/);
    await logbook.locator('[data-logbook-interval="5000"]').click();
    assert.match(await logbook.locator('[data-logbook-interval="5000"]').getAttribute('class'), /active/);

    // Gauge unplugged → alert with a Silence button; replugged → alert clears.
    await page.evaluate(() => { window.__unplugged = true; window.__unplug(); });
    await waitFor(async () => /gauge disconnected/.test(await alerts()), 'gauge alert');
    await page.locator('[data-silence-alert="gauge-lost-A"]').click();
    assert.match(await page.locator('.host-alert.silenced').innerText(), /gauge disconnected/, 'silenced alert stays visible until fixed');
    await page.evaluate(() => { window.__unplugged = false; navigator.serial.dispatchEvent(new Event('connect')); });
    await waitFor(async () => await page.locator('#hostAlerts').isHidden(), 'gauge alert cleared');

    // Field laptop unplugged and under 75%.
    power = { battery_percent: 60, on_ac: false, charging: false, has_battery: true };
    await waitFor(async () => /unplugged/.test(await alerts()) && /battery is at 60%/.test(await alerts()), 'field laptop alerts');
    power = { battery_percent: 80, on_ac: true, charging: false, has_battery: true };
    await waitFor(async () => /not charging/.test(await alerts()) && !/unplugged/.test(await alerts()), 'not charging alert');
    power = { battery_percent: 92, on_ac: true, charging: true, has_battery: true };
    await waitFor(async () => await page.locator('#hostAlerts').isHidden(), 'power alerts cleared');

    // Temperature feed silent for over a minute.
    await page.evaluate(() => window.testGauges[0].temperatureReadings.push({ at: Date.now() - 95000, source: 'live', sourceId: 's'.repeat(16), pipe: 70.2 }));
    await waitFor(async () => /temperature feed stopped/.test(await alerts()), 'temperature alert');
    await page.evaluate(() => window.testGauges[0].temperatureReadings.push({ at: Date.now(), source: 'live', sourceId: 's'.repeat(16), pipe: 70.4 }));
    await waitFor(async () => await page.locator('#hostAlerts').isHidden(), 'temperature alert cleared');
    await page.screenshot({ path: path.join(root, '..', 'tmp', 'alerts-logbook-host.png'), fullPage: true });

    // Viewer: same log book, only the probes the host shares (Pipe, not Soil).
    const viewer = await context.newPage();
    viewer.on('pageerror', (error) => errors.push(error.message));
    await viewer.goto(`${base}/viewer.php?id=${SESSION}`);
    await viewer.locator('#viewerLoginPassword').fill('pw');
    await viewer.locator('#viewerLogin button[type="submit"], #viewerLogin button').first().click();
    await viewer.locator('[data-dashboard-tab="logs"]').click();
    const viewerLog = viewer.locator('[data-viewer-logbook="A"]');
    await viewerLog.locator('tbody tr').nth(1).waitFor();
    const header = await viewerLog.locator('thead').innerText();
    assert.match(header, /Pipe/i); assert.doesNotMatch(header, /Soil/i, 'probes the host hides stay hidden');
    assert.match(await viewerLog.innerText(), /1001\.9 psi/);
    assert.match(await viewerLog.locator('h3').innerText(), /Line 4 log book/);
    await viewer.screenshot({ path: path.join(root, '..', 'tmp', 'alerts-logbook-viewer.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Alerts and log book: gauge unplug, silence, field laptop unplugged/not charging/under 75%, stalled temperatures, host and viewer log books passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
