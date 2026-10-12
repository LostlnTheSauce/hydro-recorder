// Round temperature recorder chart: folded away on the Temperatures view, draws
// pipe, soil and ambient on a 0–150 °F scale, leaves unplugged (-300 °F)
// readings out, and opens the same full-screen zoom as the pressure chart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');
const SESSION = 'b'.repeat(16);

async function main() {
  const now = Date.now();
  const temperatures = [];
  for (let i = 240; i >= 0; i--) {
    const at = now - i * 300000;
    // Soil probe unplugged for the most recent two hours.
    temperatures.push({ at, source: 'manual', ambient: 65 + Math.sin(i / 30) * 25, pipe: 55 + Math.sin(i / 50) * 4, soil: i < 24 ? -300 : 48, aux: 110 });
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/viewer.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('viewer.php')); }
    if (url.pathname === '/api.php') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ title: 'Round temp test', updated_at: now, server_time: now, last_id: 1, has_more: false, viewer_token: 'x',
        config: { A: { name: 'Test 1', chartMax: 1000, temperature: { viewerVisible: true, readings: temperatures } }, notes: [] },
        readings: [{ id: 1, slot: 'A', at: now, pressure: 800, unit: 'PSI' }] }));
    }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/viewer.php?id=${SESSION}`);
    await page.locator('#viewerLoginPassword').fill('pw');
    await page.locator('#viewerLogin button').first().click();
    await page.locator('[data-dashboard-tab="temperature"]:not(.hidden)').waitFor();
    await page.locator('[data-dashboard-tab="temperature"]').click();
    const section = page.locator('[data-view-gauge="A"] .temperature-round-panel');
    await section.waitFor();
    assert.equal(await section.evaluate((el) => el.open), false, 'round chart starts folded away');
    assert.equal(await page.locator('[data-view-gauge="A"] .temperature-chart').isVisible(), true, 'line graph still shown');

    await section.locator('summary').click();
    const canvas = section.locator('.temperature-round-chart');
    await canvas.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-view-gauge="A"] .temperature-round-chart').width > 700);
    const colours = await canvas.evaluate((el) => {
      const data = el.getContext('2d').getImageData(0, 0, el.width, el.height).data, found = {};
      const want = { ambient: [0x3f, 0x7f, 0xbe], pipe: [0xe0, 0x78, 0x32], soil: [0x77, 0x62, 0x4c], aux: [0x8a, 0x55, 0xae] };
      for (let i = 0; i < data.length; i += 4) for (const [key, rgb] of Object.entries(want)) if (Math.abs(data[i] - rgb[0]) < 6 && Math.abs(data[i + 1] - rgb[1]) < 6 && Math.abs(data[i + 2] - rgb[2]) < 6) found[key] = (found[key] || 0) + 1;
      return found;
    });
    assert.ok(colours.ambient > 50 && colours.pipe > 50 && colours.soil > 50, `pipe, soil and ambient drawn: ${JSON.stringify(colours)}`);
    assert.ok(!colours.aux, 'auxiliary probe left off the round chart');
    await canvas.screenshot({ path: process.env.ROUND_SHOT || path.join(require('node:os').tmpdir(), 'round-temp.png') });

    await canvas.tap();
    const dialog = page.locator('.chart-zoom-dialog');
    await dialog.waitFor();
    assert.equal(await dialog.getAttribute('aria-label'), 'Full-screen temperature chart');
    if (process.env.ROUND_ZOOM_SHOT) await page.screenshot({ path: process.env.ROUND_ZOOM_SHOT });
    await dialog.locator('.chart-zoom-close').click();
    await dialog.waitFor({ state: 'detached' });

    // Folding it away again stops drawing it but keeps the log untouched.
    await section.locator('summary').click();
    assert.equal(temperatures.filter((t) => t.soil === -300).length, 24);
    assert.deepEqual(errors, []);
    console.log('temperature round chart browser test passed');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
