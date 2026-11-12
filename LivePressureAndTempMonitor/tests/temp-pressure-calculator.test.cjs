// Calculator card 10: pressure change from a water temperature change in a full, buried
// (restrained) steel line: dP/dT = (B - 2a) / (D(1 - v^2)/(E t) + C). Checks it against a
// hand calculation, the pipe-size picker, the expected change and pressure, and the 0.25-5 °F row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname === '/calculator.html') { res.setHeader('content-type', 'text/html'); return res.end(fs.readFileSync(path.join(root, 'calculator.html'))); }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/calculator.html`);
    // Hand calculation, 8.625" x 0.322" at 80 °F (26.67 °C), 1500 psi:
    // B = 0.2726e-3/°C, 2a = 0.0234e-3, C = 45.09e-6/bar / (1 + 3.4e-4 x 103.4) / 14.5038 = 3.004e-6/psi,
    // D(1 - v^2)/(E t) = 8.125e-7 -> 0.2492e-3 / 3.817e-6 = 65.3 psi/°C = 36.3 psi/°F.
    const hand = await page.evaluate(() => restrainedPsiPerF(80, 8.625, 0.322, 1500));
    assert.ok(Math.abs(hand - 36.3) < 0.3, `8" x 0.322" at 80°F, 1500 psi is about 36.3 psi/°F (got ${hand.toFixed(2)})`);
    const cold = await page.evaluate(() => restrainedPsiPerF(45, 8.625, 0.322, 1500)), thick = await page.evaluate(() => restrainedPsiPerF(80, 8.625, 0.5, 1500));
    assert.ok(cold < hand / 2, 'much less per degree in cold water');
    assert.ok(thick > hand, 'more per degree with a thicker wall');
    assert.ok(await page.evaluate(() => restrainedPsiPerF(80, 24, 0.322, 1500)) < hand, 'less per degree in a bigger pipe with the same wall');
    // Above ground, free to grow lengthwise: (B - 3a) / (D(5/4 - v)/(E t) + C), a little less per degree.
    const free = await page.evaluate(() => restrainedPsiPerF(80, 8.625, 0.322, 1500, true));
    assert.ok(Math.abs(free - (0.2726e-3 - 3 * 1.17e-5) / (8.625 * 0.95 / (30e6 * 0.322) + 3.004e-6) / 1.8) < 0.3 && free < hand, `above ground ${free.toFixed(2)} psi/°F`);
    // The card.
    await page.locator('#tp_size').selectOption('12.75');
    assert.equal(await page.locator('#tp_od').inputValue(), '12.75', 'pipe size fills the OD');
    await page.locator('#tp_wt').fill('0.375');
    await page.locator('#tp_p').fill('1440');
    await page.locator('#tp_t1').fill('62');
    assert.ok(await page.locator('#tpResults').evaluate((el) => el.classList.contains('visible')));
    const perF = await page.evaluate(() => restrainedPsiPerF(62, 12.75, 0.375, 1440));
    assert.match(await page.locator('#tpVerdict').innerText(), new RegExp(`About ${perF.toFixed(1)} psi per °F`));
    await page.locator('#tp_t2').fill('60');
    const change = await page.evaluate(() => pressureForTemps(62, 60, 12.75, 0.375, 1440));
    const mid = await page.evaluate(() => restrainedPsiPerF(61, 12.75, 0.375, 1440));
    assert.ok(change < 0 && Math.abs(change + 2 * mid) < 0.3, `2 °F of cooling is twice the per-degree figure at 61 °F (${change.toFixed(2)} vs ${(-2 * mid).toFixed(2)})`);
    assert.match(await page.locator('#tpVerdict').innerText(), new RegExp(`Expect about −${Math.abs(change).toFixed(1)} psi`));
    assert.match(await page.locator('#tpResultGrid').innerText(), new RegExp(`${(1440 + change).toFixed(1)}`), 'expected pressure');
    await page.locator('#tp_lay').selectOption('exposed');
    assert.match(await page.locator('#tpNote').innerText(), /Above-ground line free to grow lengthwise/);
    const exposedChange = await page.evaluate(() => pressureForTemps(62, 60, 12.75, 0.375, 1440, true));
    assert.match(await page.locator('#tpVerdict').innerText(), new RegExp(`Expect about −${Math.abs(exposedChange).toFixed(1)} psi`));
    await page.locator('#tp_lay').selectOption('buried');
    const steps = await page.locator('.tp-steps td').allInnerTexts();
    assert.equal(steps[0], 'Pressure drops about'); assert.equal(steps.length, 7);
    assert.equal(await page.locator('#tp_wt').evaluate(() => { document.getElementById('tp_wt').value = '7'; calcTempPressure(); return document.getElementById('tpResults').classList.contains('visible'); }), false, 'a wall thicker than the pipe is refused');
    assert.deepEqual(errors, []);
    console.log(`Temperature to pressure (card 10): 8" x 0.322" at 80°F is ${hand.toFixed(1)} psi/°F (hand calc 36.3), less when cold, more with thicker wall, pipe size picker, expected change and pressure, quick row passed.`);
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
