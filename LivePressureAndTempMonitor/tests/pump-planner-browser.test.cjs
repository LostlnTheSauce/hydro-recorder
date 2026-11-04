// Pump planner (Tools tab): water to pressure up, rise rate and time for the
// triplex and a kill truck, which pump to use, and the air check while pumping.
// Numbers from the Alanreed to Merten job (November 2026). No devices or APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname === '/pump-planner.html') {
      res.setHeader('content-type', 'text/html');
      return res.end(fs.readFileSync(path.join(root, 'pump-planner.html')));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/pump-planner.html`);

    // Pure math: TS1, 287,900 gal, 0 -> 670 psi, triplex 0.0068 x 1,500 = 10.2 gpm.
    const ts1 = await page.evaluate(() => window.pumpPlanner.plan({ volume: 287900, start: 0, target: 670, limit: 10, allowance: 1, galPerStroke: 0.0068, spm: 1500 }));
    assert.ok(Math.abs(ts1.galPerPsi - 287900 / 225000) < 1e-9, 'gal/psi uses the calculator constant');
    assert.ok(Math.abs(ts1.water - 857.3) < 0.5, `water ${ts1.water}`);
    assert.ok(Math.abs(ts1.triplex.openRate - 7.97) < 0.02, `TS1 triplex tops out near 8 psi/min (${ts1.triplex.openRate})`);
    assert.equal(ts1.triplex.limited, false, 'TS1 never reaches the 10 psi/min limit');
    assert.ok(Math.abs(ts1.triplex.minutes - 84) < 1, `TS1 about 84 min (${ts1.triplex.minutes})`);

    // TS2, 147,000 gal to 765 psi: the triplex has to be held back to 10 psi/min.
    const ts2 = await page.evaluate(() => window.pumpPlanner.plan({ volume: 147000, start: 0, target: 765, limit: 10, allowance: 1, galPerStroke: 0.0068, spm: 1500 }));
    assert.equal(ts2.triplex.limited, true);
    assert.ok(Math.abs(ts2.triplex.minutes - 76.5) < 0.01, 'held to 10 psi/min: 765 / 10');
    assert.ok(Math.abs(ts2.triplex.neededSpm - 960.8) < 1, `throttle to about 960 spm (${ts2.triplex.neededSpm})`);
    assert.equal(ts2.verdict.pick, 'triplex', 'triplex holds the limit itself, so no truck');

    // A 1 bbl/min truck on TS1 is held to the limit and saves time; one that can't slow below 0.5 bbl/min can't hold it.
    const truck = await page.evaluate(() => window.pumpPlanner.plan({ volume: 287900, start: 0, target: 670, limit: 10, allowance: 1.5, galPerStroke: 0.0068, spm: 1500, truckBpm: 1 }));
    assert.equal(truck.truck.limited, true);
    assert.ok(Math.abs(truck.truck.minutes - 67) < 0.01, 'truck held to 10 psi/min');
    assert.equal(truck.verdict.pick, 'truck', `${truck.verdict.title}`);
    const fast = await page.evaluate(() => window.pumpPlanner.plan({ volume: 287900, start: 0, target: 670, limit: 10, allowance: 1, galPerStroke: 0.0068, spm: 1500, truckBpm: 2, truckMinBpm: 0.5 }));
    assert.equal(fast.truck.cannotSlow, true, 'slowest 0.5 bbl/min = 21 gpm, needs 12.8');
    assert.equal(fast.verdict.pick, 'triplex');
    assert.match(fast.verdict.title, /can’t run slow enough/);

    // Air check: TS1 rose about 7 psi/min with the triplex -> about 1.14x theory.
    const factor = await page.evaluate(() => window.pumpPlanner.airFactor(287900, 10.2, 7));
    assert.ok(Math.abs(factor - 1.139) < 0.01, `air factor ${factor}`);
    assert.ok(Math.abs(await page.evaluate(() => window.pumpPlanner.pipeGallons(8.625, 0.25, 1000)) - 2693.4) < 0.5, '8" x 0.250" holds about 2.69 gal/ft');

    // The page: pipe rows -> volume -> plan.
    await page.locator('[data-pipe="od"]').fill('10.75');
    await page.locator('[data-pipe="wall"]').fill('0.25');
    await page.locator('[data-pipe="length"]').fill('48312');
    await page.locator('#addPipe').click();
    await page.locator('[data-pipe="od"]').nth(1).fill('8.625');
    await page.locator('[data-pipe="wall"]').nth(1).fill('0.25');
    await page.locator('[data-pipe="length"]').nth(1).fill('29990');
    assert.match(await page.locator('#volumeLine').innerText(), /287,8\d\d gal/);
    assert.equal(await page.locator('#resultsBody').isHidden(), true, 'no plan until a target is set');
    await page.locator('#target').fill('670');
    await page.locator('#limit').fill('10');
    assert.match(await page.locator('#verdictTitle').innerText(), /Triplex: about 1 h 2\d min to 670 psi/);
    assert.match(await page.locator('#compareBody').innerText(), /pump-limited/);
    await page.locator('#truckBpm').fill('1');
    assert.equal(await page.locator('#truckHead').isVisible(), true);
    assert.match(await page.locator('#verdictTitle').innerText(), /Kill truck saves about 1\d min|Use your triplex/);
    await page.locator('[data-allowance="1.5"]').click();
    assert.equal(await page.locator('#allowance').inputValue(), '1.5');
    assert.match(await page.locator('#verdictTitle').innerText(), /Kill truck saves about 5\d min/);

    await page.locator('#truckBpm').fill('2');
    await page.locator('#truckMinBpm').fill('0.5');
    assert.match(await page.locator('#verdictTitle').innerText(), /can’t run slow enough/);
    assert.equal(await page.locator('#compareBody .best').innerText(), await page.locator('#compareBody tr:nth-child(5) td:nth-child(2)').innerText(), 'over-limit truck is not the best time');
    await page.locator('#truckMinBpm').fill('');
    await page.locator('#truckBpm').fill('1');

    await page.locator('#observed').fill('7');
    assert.match(await page.locator('#observedText').innerText(), /1\.1[34]× the theoretical water\. That is a tight line/);
    await page.locator('#useObserved').click();
    assert.match(await page.locator('#allowance').inputValue(), /^1\.1[34]$/);

    // Inputs come back after a reload (this browser only).
    await page.reload();
    assert.equal(await page.locator('[data-pipe="length"]').count(), 2);
    assert.equal(await page.locator('#target').inputValue(), '670');
    assert.equal(await page.locator('#resultsBody').isVisible(), true);

    // Phone width: no sideways page scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'fits a phone');
    assert.deepEqual(errors, []);
    console.log('pump planner: ok');
  } finally {
    await browser.close(); server.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
