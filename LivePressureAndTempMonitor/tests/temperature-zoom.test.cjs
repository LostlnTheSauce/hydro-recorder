const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(`<main style="max-width:1050px;margin:20px auto;padding:16px"><h2>Temperature chart zoom</h2><section id="a"></section><section id="b"></section></main>`);
    await page.addStyleTag({path:path.join(root,'assets/workspace.css')});
    await page.addStyleTag({path:path.join(root,'assets/temperature-zoom.css')});
    await page.addScriptTag({path:path.join(root,'assets/temperature.js')});
    await page.evaluate(()=>{
      const markup=`<div class="temperature-controls"><label class="temp-toggle"><input type="checkbox" value="pipe" checked>Pipe</label><label>History<select class="temp-history-range"><option value="all">Entire job</option><option value="official">Official test</option><option value="pretest">Pre-test</option></select></label></div><div class="temperature-canvas-wrap"><canvas class="temperature-chart"></canvas><canvas class="temperature-selection-overlay"></canvas><div class="temperature-tooltip hidden"></div></div><span class="temp-inspector-time"></span><input class="temp-scrubber" type="range" min="0" max="1000" value="1000"><button class="temp-return-live">Return to live</button><span class="temp-scrubber-end"></span>`;
      window.start=Date.UTC(2026,8,27,12);window.rows=Array.from({length:86401},(_,i)=>({at:start+i*2000,pipe:75+Math.sin(i/1000)+.1*Math.sin(i)}));
      window.opts={temperatureReadings:rows,pressureReadings:[],testStart:start+24*3600000,testEnd:start+32*3600000};
      for(const id of ['a','b']){const panel=document.getElementById(id);panel.innerHTML=markup;TemperatureChartRenderer.bindPanel(panel,()=>TemperatureChartRenderer.renderPanel(panel,opts));TemperatureChartRenderer.renderPanel(panel,opts);}
      window.render=()=>TemperatureChartRenderer.renderPanel(document.getElementById('a'),opts);
    });
    const meta=()=>page.evaluate(()=>{const m=document.querySelector('#a canvas')._temperatureMeta;return m&&{start:m.start,end:m.end,zoomed:m.zoomed,count:m.temperatures.length,fullStart:m.fullStart,fullEnd:m.fullEnd};});
    let m=await meta();assert.equal(m.end-m.start,48*3600000);
    await page.locator('#a .temp-zoom-preset').selectOption('5');
    m=await meta();assert.equal(m.end-m.start,300000);assert.equal(m.count,151,'Filter before sampling retains every two-second reading');
    assert.equal(await page.evaluate(()=>rows.length),86401,'No source readings changed');
    assert.equal(await page.evaluate(()=>document.querySelector('#b canvas')._temperatureMeta.zoomed),false,'Other panel untouched');
    assert.equal(await page.locator('#a .temp-return-live').isEnabled(),true);
    const before=m.start;await page.locator('#a [data-zoom="earlier"]').click();m=await meta();assert(m.start<before);
    const pinned=m.start;await page.evaluate(()=>{rows.push({at:rows.at(-1).at+2000,pipe:76});render();});assert.equal((await meta()).start,pinned,'Incoming readings do not move zoomed window');
    await page.locator('#a [data-zoom="reset"]').click();m=await meta();assert(!m.zoomed);
    const chart=page.locator('#a .temperature-chart');const box=await chart.boundingBox();
    await page.mouse.move(box.x+box.width*.3,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.4,{steps:8});await page.mouse.up();
    m=await meta();assert(m.zoomed && m.end-m.start<24*3600000,'Drag selects a time window');
    await page.locator('#a .temp-scrubber').fill('1000');await page.waitForTimeout(50);
    assert(!/^Live/.test(await page.locator('#a .temp-inspector-time').innerText()),'Historical right edge never labeled live');
    await page.locator('#a .temp-history-range').selectOption('official');m=await meta();assert(!m.zoomed);assert.equal(m.end-m.start,8*3600000);
    await page.locator('#a .temp-zoom-preset').selectOption('15');assert.equal((await meta()).end-(await meta()).start,900000);
    await page.locator('#a .temp-return-live').click();assert(!(await meta()).zoomed);
    await page.locator('#a .temp-history-range').selectOption('all');
    await page.locator('#a .temp-zoom-preset').selectOption('5');
    await page.locator('#a [data-zoom="in"]').focus();await page.keyboard.press('Enter');assert.equal((await meta()).end-(await meta()).start,150000);
    const out=path.resolve(root,'../tmp/temperature-zoom');fs.mkdirSync(out,{recursive:true});
    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:850});await page.evaluate(()=>render());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile has no horizontal overflow');
    await page.locator('#a [data-zoom="earlier"]').click();
    await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
    await page.evaluate(()=>{opts.temperatureReadings=[];render();});assert.equal(await meta(),null);assert(await page.locator('#a [data-zoom="in"]').isDisabled());
    assert.deepEqual(errors,[]);
    console.log('Zoom passed: 48-hour dataset, exact short-window readings, drag, keyboard/buttons, pan, live-data stability, history filters, reset, empty data, independent panels and mobile.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
