// Host page (and its pressure gauge) closes while the field laptop keeps sending
// temperatures. Live must follow the newest temperature, not the last pressure.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chrome'})});
  try {
    const page=await browser.newPage({viewport:{width:390,height:850}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<section id="a"></section>');
    await page.addScriptTag({path:path.join(root,'assets/temperature.js')});
    await page.evaluate(()=>{
      const panel=document.getElementById('a');
      panel.innerHTML=`<div class="temperature-controls"><label class="temp-toggle"><input type="checkbox" value="pipe" checked>Pipe</label></div><div class="temperature-canvas-wrap"><canvas class="temperature-chart"></canvas><canvas class="temperature-selection-overlay"></canvas><div class="temperature-tooltip hidden"></div></div><span class="temp-inspector-time"></span><span class="temp-inspector-pressure"></span><span data-temp-inspector-value="pipe"></span><input class="temp-scrubber" type="range" min="0" max="1000" value="1000"><button class="temp-return-live" disabled>Return to live</button><span class="temp-scrubber-end"></span>`;
      const start=Date.UTC(2026,9,12,22);
      // Pressure for 48 minutes, then the host closes; temperatures continue 4 more minutes.
      window.lastPressureAt=start+48*60000;window.lastTempAt=start+52*60000;
      const pressure=[],temps=[];
      for(let at=start;at<=lastPressureAt;at+=2000) pressure.push({at,pressure:0});
      for(let at=start;at<=lastTempAt;at+=2000) temps.push({at,pipe:at>lastPressureAt?71:68});
      window.opts={pressureReadings:pressure,temperatureReadings:temps};
      window.render=()=>TemperatureChartRenderer.renderPanel(panel,opts);
      TemperatureChartRenderer.bindPanel(panel,render);render();
    });
    const selected=()=>page.evaluate(()=>document.querySelector('#a canvas')._temperatureMeta.selectedAt);
    assert.equal(await selected(),await page.evaluate(()=>lastTempAt),'Live follows the newest temperature');
    assert.equal(await page.locator('#a [data-temp-inspector-value="pipe"]').innerText(),'71.0°F');
    assert(/^Live/.test(await page.locator('#a .temp-inspector-time').innerText()));
    assert(await page.locator('#a .temp-return-live').isDisabled());
    // Slide back, then all the way to the end: live again at the newest temperature.
    await page.locator('#a .temp-scrubber').fill('300');await page.waitForTimeout(60);
    assert(await page.locator('#a .temp-return-live').isEnabled());
    await page.locator('#a .temp-scrubber').fill('1000');await page.waitForTimeout(60);
    assert(/^Live/.test(await page.locator('#a .temp-inspector-time').innerText()));
    assert.equal(await selected(),await page.evaluate(()=>lastTempAt));
    // Return to live works the same way.
    await page.locator('#a .temp-scrubber').fill('300');await page.waitForTimeout(60);
    await page.locator('#a .temp-return-live').click();
    assert.equal(await selected(),await page.evaluate(()=>lastTempAt));
    // New temperatures keep moving the live cursor.
    await page.evaluate(()=>{lastTempAt+=2000;opts.temperatureReadings.push({at:lastTempAt,pipe:72});render();});
    assert.equal(await selected(),await page.evaluate(()=>lastTempAt));
    assert.equal(await page.locator('#a [data-temp-inspector-value="pipe"]').innerText(),'72.0°F');
    // While the gauge is still running, a scrub still snaps to pressure readings.
    await page.evaluate(()=>{opts.temperatureReadings=opts.temperatureReadings.filter(r=>r.at<=lastPressureAt);render();});
    assert.equal(await selected(),await page.evaluate(()=>lastPressureAt));
    assert.deepEqual(errors,[]);
    console.log('Live after host closed passed: live cursor, readout, slider end and Return to live follow the newest temperature.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
