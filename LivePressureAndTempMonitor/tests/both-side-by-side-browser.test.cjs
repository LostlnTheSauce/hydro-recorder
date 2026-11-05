// "Both" puts the two tests side by side on a wide screen (each test's panels stacked in its half,
// nothing wider than the screen) on every tab, and stacks them on a narrow one.
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
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [width, sideBySide] of [[1536, true], [1280, true], [900, false]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
      await page.locator('#addSecondTest').click();
      await page.locator('[data-layout-mode="both"]').first().click();
      for (const tab of ['pressure', 'temperature', 'setup', 'logs']) {
        await page.locator(`[data-dashboard-tab="${tab}"]`).click();
        await page.waitForTimeout(150);
        const [a, b] = await page.locator('[data-gauge]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; }));
        if (sideBySide) {
          assert.ok(Math.abs(a.top - b.top) < 2 && b.left > a.left + a.width - 1, `${width}px ${tab}: side by side`);
        } else {
          assert.ok(b.top > a.top + 100, `${width}px ${tab}: stacked`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px ${tab}: nothing wider than the screen`);
      }
      // One test at a time still uses the full width.
      await page.locator('[data-dashboard-tab="pressure"]').click();
      await page.locator('[data-layout-mode="A"]').first().click();
      const single = await page.locator('[data-gauge="A"]').evaluate((e) => e.getBoundingClientRect().width);
      assert.ok(single > width * 0.8, 'single test is full width');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Both side by side: wide screens put Test 1 and Test 2 next to each other on every tab with nothing cut off; narrow screens stack them; one test stays full width passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
