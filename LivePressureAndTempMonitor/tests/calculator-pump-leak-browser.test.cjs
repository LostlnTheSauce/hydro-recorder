// Calculator cards 08 (pump-up planner: triplex vs kill truck) and 09 (leak
// estimate from a pressure drop). Numbers from the Alanreed to Merten job,
// November 2026. The older cards are checked to still calculate. No devices or APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname === '/calculator.html') {
      res.setHeader('content-type', 'text/html');
      return res.end(fs.readFileSync(path.join(root, 'calculator.html')));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/calculator.html`);

    // ── Card 08 math. TS1: 287,900 gal, 0 -> 670 psi, triplex 0.0068 x 1,500 = 10.2 gpm.
    const plan = (input) => page.evaluate((i) => planPumpUp(i), input);
    const base = { volume: 287900, start: 0, target: 670, limit: 10, allowance: 1, galPerStroke: 0.0068, spm: 1500 };
    const ts1 = await plan(base);
    assert.ok(Math.abs(ts1.galPerPsi - 287900 / 225000) < 1e-9, 'gal/psi uses the Card 02 constant');
    assert.ok(Math.abs(ts1.water - 857.3) < 0.5, `water ${ts1.water}`);
    assert.ok(Math.abs(ts1.triplex.openRate - 7.97) < 0.02, `TS1 triplex tops out near 8 psi/min (${ts1.triplex.openRate})`);
    assert.equal(ts1.triplex.limited, false, 'TS1 never reaches 10 psi/min');
    assert.ok(Math.abs(ts1.triplex.minutes - 84) < 1, `TS1 about 84 min (${ts1.triplex.minutes})`);
    const ts2 = await plan({ ...base, volume: 147000, target: 765 });
    assert.equal(ts2.triplex.limited, true);
    assert.ok(Math.abs(ts2.triplex.minutes - 76.5) < 0.01, 'TS2 held to 10 psi/min: 765 / 10');
    assert.ok(Math.abs(ts2.triplex.neededSpm - 960.8) < 1, `throttle to about 960 spm (${ts2.triplex.neededSpm})`);
    const truck = await plan({ ...base, allowance: 1.5, truckBpm: 1 });
    assert.equal(truck.truck.limited, true);
    assert.ok(Math.abs(truck.truck.minutes - 67) < 0.01, 'truck held to 10 psi/min');
    assert.equal(truck.verdict.kind, 'info', truck.verdict.title);
    const fast = await plan({ ...base, truckBpm: 2, truckMinBpm: 0.5 });
    assert.equal(fast.truck.cannotSlow, true, 'slowest 0.5 bbl/min = 21 gpm, needs 12.8');
    assert.match(fast.verdict.title, /can’t run slow enough/);
    const factor = await page.evaluate(() => pumpAirFactor(287900, 10.2, 7));
    assert.ok(Math.abs(factor - 1.139) < 0.01, `air factor ${factor}`);

    // ── Card 08 on the page, volume from Card 01.
    await page.locator('#pipeList .pipe-id').fill('10.25');
    await page.locator('#pipeList .pipe-len').fill('48312');
    await page.getByRole('button', { name: '+ Add Pipe Section' }).click();
    await page.locator('#pipeList .pipe-id').nth(1).fill('8.125');
    await page.locator('#pipeList .pipe-len').nth(1).fill('29990');
    await page.getByRole('button', { name: 'Calculate Volume' }).click();
    assert.match(await page.locator('#volResultGrid').innerText(), /287867\.321/, 'Card 01 still calculates');
    const card8 = page.locator('#pumpPlanner');
    await card8.getByRole('button', { name: '↓ Use Volume from Card 01' }).click();
    assert.equal(await page.locator('#pp_volume').inputValue(), '287867.3');
    assert.equal(await page.locator('#ppResults').isVisible(), false, 'no plan until a target is set');
    await page.locator('#pp_target').fill('670');
    await page.locator('#pp_limit').fill('10');
    assert.match(await page.locator('#ppVerdict').innerText(), /Triplex: about 1 h 2\d min to 670 psi/);
    assert.match(await page.locator('#ppCompare').innerText(), /pump-limited/);
    await page.locator('#pp_truck').fill('1');
    assert.match(await page.locator('#ppCompare').innerText(), /Kill truck/i);
    assert.match(await page.locator('#ppVerdict').innerText(), /Kill truck saves about 1\d min/);
    await card8.locator('[data-allowance="1.5"]').click();
    assert.equal(await page.locator('#pp_allowance').inputValue(), '1.5');
    assert.match(await page.locator('#ppVerdict').innerText(), /Kill truck saves about 5\d min/);
    await page.locator('#pp_truck').fill('2');
    await page.locator('#pp_truck_min').fill('0.5');
    assert.match(await page.locator('#ppVerdict').innerText(), /can’t run slow enough/);
    assert.equal(await page.locator('#ppCompare td.best').count(), 1);
    assert.equal(await page.locator('#ppCompare tr:nth-child(5) td.best').evaluate((td) => td.cellIndex), 1, 'an over-limit truck is never the best time');
    await page.locator('#pp_observed').fill('7');
    assert.match(await page.locator('#ppObservedText').innerText(), /1\.14× the theoretical water\. That is a tight line/);
    await page.locator('#ppUseObserved').click();
    assert.equal(await page.locator('#pp_allowance').inputValue(), '1.14');

    // ── Card 09 math. 670 -> 664 psi from 2:05 to 3:25 on TS1.
    const leak = (input) => page.evaluate((i) => estimateLeak(i), input);
    const noTemps = await leak({ volume: 287900, p1: 670, p2: 664, minutes: 80, allowance: 1, hours: 8, galPerStroke: 0.0068 });
    assert.ok(Math.abs(noTemps.allIfLeak - 7.68) < 0.01, `6 psi x 1.28 gal/psi (${noTemps.allIfLeak})`);
    assert.ok(Math.abs(noTemps.perHour - 4.5) < 1e-9);
    assert.ok(Math.abs(noTemps.projected - 634) < 1e-9, '4.5 psi/hr for 8 h from 670');
    assert.equal(await page.evaluate(() => minutesBetween('14:05', '15:25')), 80);
    assert.equal(await page.evaluate(() => minutesBetween('23:30', '00:15')), 45, 'past midnight');
    const perDegree = await page.evaluate(() => psiPerDegreeF(60));
    assert.ok(perDegree > 14 && perDegree < 16.5, `about 15 psi/°F at 60°F (${perDegree})`);
    const cooled = await leak({ volume: 287900, p1: 670, p2: 664, minutes: 80, allowance: 1, temp1: 60.5, temp2: 60.0, galPerStroke: 0.0068 });
    assert.ok(cooled.tempDrop > 6, `half a degree of cooling explains the 6 psi (${cooled.tempDrop})`);
    assert.equal(cooled.leakGal, 0);
    const partial = await leak({ volume: 287900, p1: 670, p2: 664, minutes: 80, allowance: 1, temp1: 60.1, temp2: 60.0, galPerStroke: 0.0068 });
    assert.ok(partial.unexplained > 4 && partial.unexplained < 5, `0.1°F explains about 1.5 psi (${partial.unexplained})`);
    assert.ok(Math.abs(partial.strokes - partial.leakGal / 0.0068) < 1e-6);

    // ── Card 09 on the page.
    await page.locator('#leakEstimate').getByRole('button', { name: '↓ Use Volume from Card 01' }).click();
    await page.locator('#lk_p1').fill('670');
    await page.locator('#lk_p2').fill('664');
    await page.locator('#lk_t1').fill('14:05');
    await page.locator('#lk_t2').fill('15:25');
    assert.match(await page.locator('#lkVerdict').innerText(), /Up to about 7\.7 gal if it is all leak/);
    assert.match(await page.locator('#lkResultGrid').innerText(), /1 h 20 min/);
    assert.match(await page.locator('#lkResultGrid').innerText(), /4\.5\s*psi\/hr/);
    assert.match(await page.locator('#lkResultGrid').innerText(), /634\s*psi/);
    await page.locator('#lk_temp1').fill('60.5');
    await page.locator('#lk_temp2').fill('60');
    assert.match(await page.locator('#lkVerdict').innerText(), /Temperature explains the whole drop/);
    await page.locator('#lk_temp1').fill('60.1');
    assert.match(await page.locator('#lkVerdict').innerText(), /not explained by temperature/);
    assert.match(await page.locator('#lkResultGrid').innerText(), /Strokes to Put Back/i);
    assert.match(await page.locator('#lkNote').innerText(), /psi per °F at 60\.\d°F/);
    await page.locator('#lk_p2').fill('671');
    assert.match(await page.locator('#lkVerdict').innerText(), /No water lost/);

    // Card 02 still uses its own button and formula.
    await page.locator('#pf_volume').fill('225000'); await page.locator('#pf_start').fill('0'); await page.locator('#pf_target').fill('100');
    await page.getByRole('button', { name: 'Calculate', exact: true }).first().click();
    assert.match(await page.locator('#fillResultGrid').innerText(), /100\.0000\s*gal/);

    // Phone width: no sideways page scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'fits a phone');
    assert.deepEqual(errors, []);
    console.log('calculator pump-up planner and leak estimate: ok');
  } finally {
    await browser.close(); server.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
