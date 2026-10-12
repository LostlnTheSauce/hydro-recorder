const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const filename of ['host.php', 'viewer.php']) {
      await page.setContent('<main><section id="a"></section><section id="b"></section></main>');
      await page.addStyleTag({ path: path.join(root, 'assets/workspace.css') });
      await page.addScriptTag({ path: path.join(root, 'assets/temperature.js') });
      await page.evaluate(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const controls = doc.querySelector('.temperature-controls').outerHTML;
        window.opts = {
          pressureReadings: [{ at: 100000, pressure: 980 }, { at: 200000, pressure: 984 }],
          temperatureReadings: [{ at: 100000, ambient: 70, pipe: 71, soil: 72, aux: 73 }, { at: 200000, ambient: 71, pipe: 72, soil: 73, aux: 74 }],
        };
        window.original = JSON.stringify(opts);
        for (const id of ['a', 'b']) {
          const panel = document.getElementById(id);
          panel.innerHTML = controls + '<div class="temperature-canvas-wrap"><canvas class="temperature-chart"></canvas><div class="temperature-tooltip hidden"></div></div><span class="temp-pressure-change"></span>';
          const context = panel.querySelector('canvas').getContext('2d');
          const fill = context.fillText.bind(context), stroke = context.stroke.bind(context);
          panel.drawn = { labels: [], strokes: [] };
          context.fillText = (text, ...args) => { panel.drawn.labels.push(text); fill(text, ...args); };
          context.stroke = (...args) => { panel.drawn.strokes.push(context.strokeStyle); stroke(...args); };
          panel.render = () => { panel.drawn = { labels: [], strokes: [] }; TemperatureChartRenderer.renderPanel(panel, opts); };
          TemperatureChartRenderer.bindPanel(panel, panel.render);
          panel.render();
        }
      }, fixture(filename));
      const status = () => page.evaluate(() => {
        const a = document.getElementById('a'), m = a.querySelector('canvas')._temperatureMeta;
        return { keys: m.visibleKeys, pressure: m.showPressure, labels: a.drawn.labels, strokes: a.drawn.strokes, change: a.querySelector('.temp-pressure-change').textContent, start: m.start, end: m.end };
      });
      let state = await status();
      assert.deepEqual(state.keys, ['ambient', 'pipe', 'soil'], filename + ' defaults');
      assert(state.pressure && state.labels.includes('PRESSURE (PSI)') && state.strokes.includes('#c83d3d'));
      const before = state;
      await page.locator('#a .temp-pressure-toggle').uncheck();
      state = await status();
      assert(!state.pressure && !state.labels.includes('PRESSURE (PSI)') && !state.strokes.includes('#c83d3d'));
      assert.deepEqual(state.keys, before.keys);
      assert.equal(state.change, before.change, 'Analysis unchanged');
      assert.equal(state.start, before.start); assert.equal(state.end, before.end);
      assert(await page.locator('#b .temp-pressure-toggle').isChecked(), 'Other test independent');
      const box = await page.locator('#a canvas').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 120);
      assert(!/Pressure:/.test(await page.locator('#a .temperature-tooltip').innerText()));
      await page.locator('#a .temp-pressure-toggle').check();
      await page.mouse.move(box.x + box.width / 2, box.y + 120);
      assert(/Pressure:/.test(await page.locator('#a .temperature-tooltip').innerText()));
      for (const input of await page.locator('#a .temp-toggle input').all()) await input.uncheck();
      state = await status();
      assert.deepEqual(state.keys, []); assert(!state.pressure);
      assert(!state.labels.includes('TEMPERATURE (°F)'));
      assert(await page.evaluate(() => JSON.stringify(opts) === original), 'Source readings unchanged');
      await page.locator('#a input[value="soil"]').check();
      assert.deepEqual((await status()).keys, ['soil']);
      await page.setViewportSize({ width: 390, height: 850 });
      await page.evaluate(() => document.getElementById('a').render());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile fits');
      await page.setViewportSize({ width: 1100, height: 900 });
    }
    assert.deepEqual(errors, []);
    console.log('Host/viewer defaults, pressure line/axis/tooltip toggle, independent panels, all hidden, unchanged source data/analysis, and mobile passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
