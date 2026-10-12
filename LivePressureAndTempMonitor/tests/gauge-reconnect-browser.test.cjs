// Fake USB gauge: dropped cable, automatic reconnect, reload reconnect,
// non-PSI warning and laptop-backup failure banner. No real devices or APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

const fakeSerial = () => {
  let reply = '1234.5 PSI';
  const ports = []; // filled below: the gauge is plugged in when the page loads
  function makePort() {
    let controller, open = false;
    const port = {
      readable: null, writable: null,
      getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6001 }),
      async open() {
        if (open) throw new DOMException('Port already open', 'InvalidStateError');
        open = true;
        port.readable = new ReadableStream({ start(c) { controller = c; } });
        port.writable = new WritableStream({ write() { if (open) controller.enqueue(new TextEncoder().encode(`${reply}\r\n`)); } });
      },
      async close() { open = false; port.readable = null; port.writable = null; },
      lose() { open = false; port.readable = null; port.writable = null; controller.error(new DOMException('The device has been lost.', 'NetworkError')); },
    };
    return port;
  }
  window.__gauge = {
    plugIn() { const port = makePort(); ports.splice(0, ports.length, port); navigator.serial.dispatchEvent(new Event('connect')); return port; },
    unplug() { const port = ports.pop(); port.lose(); },
    setReply(text) { reply = text; },
  };
  ports.push(makePort());
  const serial = new EventTarget();
  serial.requestPort = async () => { if (!ports.length) ports.push(makePort()); return ports[0]; };
  serial.getPorts = async () => [...ports];
  Object.defineProperty(navigator, 'serial', { value: serial });
};

async function main() {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (name === '/' || name === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    const file = path.join(root, name);
    if (name.startsWith('/assets/') && fs.existsSync(file)) {
      res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/host.php`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  await context.addInitScript(fakeSerial);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const status = () => page.locator('[data-gauge="A"] .connection-status').innerText();
  const count = () => page.evaluate(() => window.testGauges[0].readings.length);
  const waitFor = async (check, label) => {
    for (let i = 0; i < 60; i++) { if (await check()) return; await page.waitForTimeout(100); }
    assert.fail(`Timed out waiting for ${label}`);
  };
  try {
    await page.goto(url);
    await page.evaluate(() => window.testGauges[0].connect());
    await waitFor(async () => await count() >= 1, 'first reading');
    assert.match(await status(), /Connected/);
    assert.equal(await page.evaluate(() => window.testGauges[0].readings.at(-1).pressure), 1234.5);

    await page.evaluate(() => window.__gauge.unplug());
    await waitFor(async () => /reconnecting automatically/.test(await status()), 'lost status');
    assert.match(await page.locator('[data-gauge="A"] .gauge-error').innerText(), /dropped/);
    assert.equal(await page.locator('[data-gauge="A"] .connect-button').innerText(), 'Stop reconnecting');
    const before = await count();
    await page.waitForTimeout(1500);
    assert.equal(await count(), before, 'no readings while unplugged');

    await page.evaluate(() => { window.testGauges[0].reconnectNoticeMs = 1500; window.__gauge.plugIn(); });
    await waitFor(async () => /Reconnected/.test(await status()), 'automatic reconnect');
    await waitFor(async () => await count() > before, 'readings after reconnect');
    assert.match(await page.locator('[data-gauge="A"] .gauge-error').innerText(), /reconnected automatically/);
    await waitFor(async () => (await page.locator('[data-gauge="A"] .gauge-error').innerText()) === '', 'reconnect notice clears itself');

    await page.evaluate(() => window.__gauge.setReply('85.0 BAR'));
    await waitFor(async () => /not PSI/.test(await page.locator('[data-gauge="A"] .gauge-error').innerText()), 'unit warning');
    await page.evaluate(() => window.__gauge.setReply('1234.5 PSI'));
    await waitFor(async () => (await page.locator('[data-gauge="A"] .gauge-error').innerText()) === '', 'unit warning cleared');

    await page.evaluate(() => { window.__realPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('disk full', 'QuotaExceededError'); }; });
    await waitFor(async () => /Laptop backup is failing/.test(await page.locator('#localSaveAlert').innerText()), 'backup failure banner');
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.__realPut; });
    await waitFor(async () => /recovered/.test(await page.locator('#localSaveAlert').innerText()), 'backup recovery banner');

    // A reload or crash reopens the remembered gauge without a click.
    await page.reload();
    await waitFor(async () => /Reconnected/.test(await status()), 'reconnect after reload');

    // Manual disconnect forgets the gauge, so the next reload stays disconnected.
    await page.evaluate(() => window.testGauges[0].disconnect());
    await page.reload();
    await page.waitForTimeout(800);
    assert.match(await status(), /Not connected/);
    assert.deepEqual(errors, []);
    console.log('Gauge reconnect: dropped USB, automatic reconnect, reload reconnect, non-PSI warning and laptop-backup banner passed.');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
