// "Window lines" on the chart header turns the top and bottom pressure test window
// lines off and on, stays in step with the Setup switch, and is saved with the test.
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    // A window at 1700-1780 psi on a 2000 psi chart; count the window colours' pixels.
    const windowPixels = () => page.evaluate(() => {
      const g = window.testGauges[0];
      g.root.querySelector('.window-bottom').value = '1700'; g.root.querySelector('.window-top').value = '1780';
      g.root.querySelector('.chart-max').value = '2000';
      g.testState.officialStart = new Date(Date.now() - 4 * 3600000).toISOString();
      g.draw();
      const canvas = g.root.querySelector('.pressure-chart'), data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, gr, b] = [data[i], data[i + 1], data[i + 2]];
        if ((Math.abs(r - 0x16) < 30 && Math.abs(gr - 0xa3) < 30 && Math.abs(b - 0x5b) < 30) || (Math.abs(r - 0x16) < 30 && Math.abs(gr - 0x88) < 30 && Math.abs(b - 0xc8) < 30)) count++;
      }
      return count;
    });
    const header = page.locator('[data-gauge="A"] .chart-controls .live-show-window');
    assert.equal(await header.isChecked(), true, 'on by default, in the chart header');
    const shown = await windowPixels();
    assert.ok(shown > 200, `window lines drawn (${shown})`);
    await header.uncheck();
    assert.ok(await windowPixels() < shown / 10, 'window lines hidden');
    assert.equal(await page.locator('[data-gauge="A"] .show-window').isChecked(), false, 'Setup switch follows');
    assert.equal(await page.evaluate(() => window.testGauges[0].settings().showWindow), false, 'viewers get the choice');
    await page.reload();
    assert.equal(await page.locator('[data-gauge="A"] .live-show-window').isChecked(), false, 'saved with the test');
    await page.locator('[data-gauge="A"] .live-show-window').check();
    assert.ok(await windowPixels() > 200, 'back on');
    assert.deepEqual(errors, []);
    console.log('Window lines switch: in the chart header, hides and shows the window lines, Setup switch in step, viewers follow, saved across reload passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
