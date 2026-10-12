const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const touch = await page.context().newCDPSession(page);
    const out = path.resolve(root, '../tmp/temperature-mobile'); fs.mkdirSync(out, { recursive: true });
    for (const filename of ['host.php', 'viewer.php']) {
      await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main style="padding:16px"><section id="a"></section><section id="b"></section></main>');
      await page.addStyleTag({ path: path.join(root, 'assets/workspace.css') });
      await page.addStyleTag({ path: path.join(root, 'assets/temperature-zoom.css') });
      await page.addStyleTag({ path: path.join(root, 'assets/control-room.css') });
      await page.addScriptTag({ path: path.join(root, 'assets/temperature.js') });
      await page.evaluate(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const original = doc.querySelector('[data-temperature-panel]');
        const markup = ['.temperature-controls', '.temperature-canvas-wrap', '.temperature-inspector'].map(s => original.querySelector(s).outerHTML).join('');
        const start = Date.UTC(2026, 9, 1);
        window.opts = { temperatureReadings: Array.from({ length: 86401 }, (_, i) => ({ at: start + i * 2000, ambient: 72 + Math.sin(i / 1800), pipe: 74 + Math.sin(i / 1200), soil: 71 + Math.cos(i / 2200) })), pressureReadings: [] };
        window.originalData = JSON.stringify(opts);
        for (const id of ['a', 'b']) {
          const p = document.getElementById(id); p.innerHTML = markup;
          p.render = () => TemperatureChartRenderer.renderPanel(p, opts);
          TemperatureChartRenderer.bindPanel(p, p.render); p.render();
        }
      }, fixture(filename));
      await page.locator('#a .temp-chart-expand').tap();
      const dialog = page.locator('#a dialog');
      assert(await dialog.evaluate(d => d.open));
      assert(await dialog.locator('.temp-chart-close').evaluate(b => b === document.activeElement), 'Accessible initial focus');
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      assert(await dialog.evaluate(d => d.scrollWidth <= d.clientWidth), 'No horizontal scrolling');
      await dialog.locator('.temp-zoom-preset').selectOption('15');
      const meta = () => page.evaluate(() => { const m = document.querySelector('#a .temperature-chart')._temperatureMeta; return { start: m.start, end: m.end, height: m.height, zoomed: m.zoomed }; });
      assert.equal((await meta()).end - (await meta()).start, 900000);
      const chart = dialog.locator('.temperature-chart');
      await chart.scrollIntoViewIfNeeded();
      const box = await chart.boundingBox();
      assert(box.width > 365 && box.height > 400, 'Expanded portrait uses screen width and larger height');
      const x1 = box.x + box.width * .3, x2 = box.x + box.width * .65, y = box.y + 120;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
      for (let step = 1; step <= 8; step++) {
        await page.waitForTimeout(25);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * step / 8, y }] });
      }
      await page.waitForTimeout(80);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert((await meta()).end - (await meta()).start < 900000, 'Real touch drag zooms');
      assert.equal(await page.evaluate(() => document.querySelector('#b canvas')._temperatureMeta.zoomed), false);
      await page.screenshot({ path: path.join(out, filename + '-portrait.png') });
      const selected = await meta();
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(150);
      assert((await chart.boundingBox()).width > 800, 'Rotation expands width');
      assert.equal((await meta()).start, selected.start, 'Rotation preserves zoom');
      assert(await dialog.evaluate(d => d.scrollWidth <= d.clientWidth));
      await chart.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, filename + '-landscape.png') });
      await page.waitForTimeout(500); // Let mobile scrolling settle before tapping the sticky header.
      const closeBox = await dialog.locator('.temp-chart-close').boundingBox();
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: closeBox.x + 20, y: closeBox.y + 20 }] });
      await page.waitForTimeout(80);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => !document.querySelector('#a dialog').open, null, { timeout: 3000 });
      assert(!(await dialog.evaluate(d => d.open)));
      assert.equal(await page.locator('#a .temperature-controls').count(), 1);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.equal((await meta()).start, selected.start, 'Close preserves zoom');
      assert.equal((await meta()).height, 330, 'Inline drawing height restored');
      await page.locator('#a .temp-chart-expand').tap();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      assert(!(await dialog.evaluate(d => d.open)), 'Escape closes dialog');
      assert(await page.evaluate(() => JSON.stringify(opts) === originalData), 'No reading changes');
      await page.setViewportSize({ width: 390, height: 844 });
    }
    assert.deepEqual(errors, []);
    console.log('Host/viewer phone expansion, high-DPI portrait/landscape, real touch drag, presets, independent panels, close/reopen/Escape, focus, preserved data and zoom passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
