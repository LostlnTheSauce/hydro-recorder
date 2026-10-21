// Spoken pressure readout: off by default; when on, says each step reached (rising or falling)
// once, ignores jitter around a level, says only where a jump lands, follows the chosen step,
// stays quiet when off, and is saved with the test.
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    // Stand-in voice that records what would be said.
    await page.addInitScript(() => {
      window.__said = [];
      const fake = { speak: (u) => window.__said.push(u.text), cancel: () => {} };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => fake });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    const box = page.locator('[data-gauge="A"] .psi-voice-control');
    assert.equal(await box.isVisible(), true, 'next to Max rate on Live test');
    assert.equal(await box.locator('.psi-voice-on').isChecked(), false, 'off by default');
    let t = Date.now();
    const feed = (values) => page.evaluate(([list, start]) => list.forEach((p, i) => window.testGauges[0].add({ at: start + i * 1000, pressure: p, unit: 'PSI' })), [values, t]).then(() => { t += values.length * 1000; });
    const said = () => page.evaluate(() => window.__said.splice(0));
    await feed([430, 436]);
    assert.deepEqual(await said(), [], 'quiet while off');

    await box.locator('.psi-voice-on').check();
    assert.deepEqual(await said(), ['Read out on, every 5 PSI']);
    // Rising: each 5 psi once; jitter around a level stays quiet.
    await feed([432, 434.9, 435.1, 434.8, 435.2, 439, 440.2, 441, 444.9, 445]);
    assert.deepEqual(await said(), ['435 PSI', '440 PSI', '445 PSI']);
    // A jump says only where it landed; falling is read out too.
    await feed([461.3, 459.9, 455.5, 454.9]);
    assert.deepEqual(await said(), ['460 PSI', '455 PSI']);
    // Every 1 psi.
    await box.locator('.psi-voice-step').fill('1'); await box.locator('.psi-voice-step').dispatchEvent('change');
    await feed([455.2, 456.1, 456.9, 457.0, 458.3]);
    assert.deepEqual(await said(), ['456 PSI', '457 PSI', '458 PSI']);
    // Half steps are said with the decimal.
    await box.locator('.psi-voice-step').fill('0.5'); await box.locator('.psi-voice-step').dispatchEvent('change');
    // Changing the step starts over from where the pressure is (458.0), without saying it.
    await feed([458.0, 458.5, 459.1]);
    assert.deepEqual(await said(), ['458.5 PSI', '459 PSI']);
    // Saved with the test.
    assert.deepEqual(await page.evaluate(() => window.testGauges[0].testState.psiVoice), { on: true, step: 0.5 });
    await page.reload();
    assert.equal(await box.locator('.psi-voice-on').isChecked(), true);
    assert.equal(await box.locator('.psi-voice-step').inputValue(), '0.5');
    // Off: quiet again.
    await box.locator('.psi-voice-on').uncheck();
    await feed([470, 480, 490]);
    assert.deepEqual(await said(), []);
    assert.deepEqual(errors, []);
    console.log('PSI readout: off by default, each step once rising or falling, jitter quiet, jumps say where they land, 1 and 0.5 psi steps, saved with the test, quiet when off passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
