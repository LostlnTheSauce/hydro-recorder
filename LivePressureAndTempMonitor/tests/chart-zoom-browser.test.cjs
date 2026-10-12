// Full-screen recorder chart: tap to open, pinch/scroll/buttons to zoom, drag
// to pan, live redraws while open, Back/Close/Escape to leave. Fake API only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');
const SESSION = 'a'.repeat(16);

async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/viewer.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('viewer.php')); }
    if (url.pathname === '/api.php') {
      const now = Date.now(), readings = [];
      for (let i = 600; i >= 0; i--) readings.push({ id: 601 - i, slot: 'A', at: now - i * 10000, pressure: 800 + Math.sin(i / 20) * 40, unit: 'PSI' });
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ title: 'Zoom test', updated_at: now, server_time: now, last_id: 601, has_more: false, viewer_token: 'x', config: { A: { name: 'Test 1', chartMax: 1000 }, notes: [] }, readings }));
    }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  const signIn = async (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/viewer.php?id=${SESSION}`);
    await page.locator('#viewerLoginPassword').fill('pw');
    await page.locator('#viewerLogin button').first().click();
    await page.locator('[data-view-gauge="A"] .chart-zoom-open').waitFor();
  };
  const zoomState = (page) => page.evaluate(() => {
    const canvas = document.querySelector('.chart-zoom-canvas'); if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    return { width: box.width, height: box.height, backing: canvas.width, overflow: document.body.style.overflow,
      // Pixel at the screen centre, to see the view change.
      centre: Array.from(canvas.getContext('2d').getImageData(canvas.width / 2 | 0, canvas.height / 2 | 0, 1, 1).data).join() };
  });
  try {
    // Phone: tap opens a sharp full-screen view.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const phone = await context.newPage();
    await signIn(phone);
    await phone.locator('[data-view-gauge="A"] .pressure-chart').tap();
    const opened = await zoomState(phone);
    assert.ok(opened && opened.width === 390 && opened.height > 700, 'chart fills the phone screen');
    assert.equal(opened.backing, 1170, 'drawn at full device resolution');
    assert.equal(opened.overflow, 'hidden', 'page behind does not scroll');

    // Two-finger pinch zooms in; a one-finger drag pans.
    const pinch = await phone.evaluate(async () => {
      const canvas = document.querySelector('.chart-zoom-canvas'), box = canvas.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      const fire = (type, id, cx, cy) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: cx, clientY: cy, pointerType: 'touch', bubbles: true, isPrimary: id === 1 }));
      const before = canvas.toDataURL();
      fire('pointerdown', 1, x - 20, y); fire('pointerdown', 2, x + 20, y);
      for (let i = 1; i <= 10; i++) { fire('pointermove', 1, x - 20 - i * 6, y); fire('pointermove', 2, x + 20 + i * 6, y); await new Promise((r) => requestAnimationFrame(r)); }
      fire('pointerup', 1, x, y); fire('pointerup', 2, x, y);
      await new Promise((r) => requestAnimationFrame(r));
      const zoomed = canvas.toDataURL();
      fire('pointerdown', 3, x, y);
      for (let i = 1; i <= 5; i++) { fire('pointermove', 3, x - i * 10, y + i * 10); await new Promise((r) => requestAnimationFrame(r)); }
      fire('pointerup', 3, x - 50, y + 50);
      await new Promise((r) => requestAnimationFrame(r));
      return { zoomedChanged: zoomed !== before, panChanged: canvas.toDataURL() !== zoomed };
    });
    assert.ok(pinch.zoomedChanged, 'pinch zooms the chart');
    assert.ok(pinch.panChanged, 'drag moves the chart');

    // New readings redraw the open chart.
    const live = await phone.evaluate(async () => {
      const canvas = document.querySelector('.chart-zoom-canvas'), before = canvas.toDataURL();
      const source = document.querySelector('[data-view-gauge="A"] .pressure-chart');
      window.PressureChartRenderer.draw(source, [], { chartMax: 500 });
      await new Promise((r) => requestAnimationFrame(r));
      return canvas.toDataURL() !== before;
    });
    assert.ok(live, 'open chart follows live redraws');

    // Phone Back closes the chart and stays on the viewer.
    await phone.goBack();
    await phone.waitForFunction(() => !document.querySelector('.chart-zoom-dialog'));
    assert.match(phone.url(), /viewer\.php/);
    assert.equal(await phone.evaluate(() => document.body.style.overflow), '');
    // Close button leaves browser history as it was.
    const length = await phone.evaluate(() => history.length);
    await phone.locator('[data-view-gauge="A"] .chart-zoom-open').tap();
    await phone.locator('.chart-zoom-close').tap();
    await phone.waitForFunction(() => !document.querySelector('.chart-zoom-dialog'));
    assert.equal(await phone.evaluate(() => history.length), length);
    assert.match(phone.url(), /viewer\.php/);

    // Desktop: scroll wheel and buttons zoom; Fit resets; Escape closes.
    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await signIn(desk);
    await desk.locator('[data-view-gauge="A"] .chart-zoom-open').click();
    const fit = (await zoomState(desk)).centre;
    await desk.mouse.move(640, 420);
    await desk.mouse.wheel(0, -600);
    await desk.locator('[data-chart-zoom="in"]').click();
    await desk.waitForTimeout(100);
    await desk.locator('[data-chart-zoom="reset"]').click();
    await desk.waitForTimeout(100);
    assert.equal((await zoomState(desk)).centre, fit, 'Fit returns to the whole chart');
    await desk.keyboard.press('Escape');
    await desk.waitForFunction(() => !document.querySelector('.chart-zoom-dialog'));
    assert.deepEqual(errors, []);
    console.log('Full-screen chart passed: phone tap, device resolution, pinch, pan, live redraw, Back, Close, wheel, buttons, Fit and Escape.');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
