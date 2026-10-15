const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {fixture} = require('./workflow-browser.test.cjs');
const W = require('../assets/workflow.js');
const root = path.resolve(__dirname, '..');
async function main() {
  const now = new Date('2026-10-11T18:00:00-05:00').getTime();
  assert.throws(()=>W.validatePeriod(now,now-1,now), /after/);
  assert.throws(()=>W.validatePeriod(now+1,0,now), /future/);
  assert.doesNotThrow(()=>W.validatePeriod(now-1000,now,now));
  assert.equal(W.officialTimes({officialStart:now-10*3600000,officialEnd:0},now).length,41,'No eight-hour cutoff');
  const server = http.createServer((req,res)=>{
    const url = new URL(req.url,'http://localhost');
    if(url.pathname==='/host.php'){res.setHeader('content-type','text/html');return res.end(fixture());}
    if(['/api.php','/temperature.php'].includes(url.pathname)){
      res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({ok:true,devices:[],sources:[],readings:[],last_id:0,has_more:false}));
    }
    if(!/^\/assets\/[\w.-]+$/.test(url.pathname)){res.statusCode=404;return res.end();}
    const file=path.join(root,url.pathname);
    if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
    res.setHeader('content-type',url.pathname.endsWith('.css')?'text/css':/\.m?js$/.test(url.pathname)?'text/javascript':'image/png');
    res.end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1050},timezoneId:'America/Chicago'});
    const errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});page.on('dialog',d=>d.accept());
    page.setDefaultTimeout(10000);
    await page.clock.install({time:new Date(now)});
    await page.goto('http://127.0.0.1:'+server.address().port+'/host.php');
    await page.waitForSelector('.page-pressure');
    const a=page.locator('[data-gauge="A"]');
    assert.deepEqual(errors,[]);
    assert.equal(await page.locator('[data-act="advance"],.workflow-timing,.workflow-steps,.record-ramp-step,.start-official-test,.end-official-test,.ramp-profile').count(),0);
    await page.evaluate(()=>{
      const g=testGauges[0], start=new Date('2026-10-11T07:05:00-05:00').getTime();
      g.readings=Array.from({length:481},(_,i)=>({at:start+i*60000,pressure:984.1,unit:'PSI'}));
      g.temperatureReadings=g.readings.map(r=>({at:r.at,ambient:80,pipe:78,soil:76,aux:75}));
      // An already completed legacy stage must not block any late entries.
      g.testState.workflow.stage='complete'; g.testState.workflow.since=start+8*3600000;g.saveTestState();
    });
    await a.locator('[data-input="now"]').uncheck();
    // Deliberately enter out of order, after reaching test pressure.
    for(const [time,note,psi] of [['06:20','75% hold — 5 minutes','750'],['06:00','25% hold — 5 minutes','250'],['06:10','50% hold — 5 minutes','500']]){
      await a.locator('[data-input="at"]').fill('2026-10-11T'+time);
      await a.locator('[data-input="note"]').fill(note);
      await a.locator('[data-input="event-pressure"]').fill(psi);
      await a.locator('[data-act="note"]').click();
    }
    assert.equal(await page.evaluate(()=>testGauges[0].testState.events.length),3);
    assert.equal(await page.evaluate(()=>testGauges[1].testState.events.length),0);
    await a.locator('[data-input="at"]').fill('2026-10-11T07:05');
    await a.locator('[data-input="note"]').fill('At test pressure');
    await a.locator('[data-act="note"]').click();
    assert.equal(await page.evaluate(()=>testGauges[0].testState.events.at(-1).pressure),984.1);
    await a.locator('[data-act="records"]').click();
    // Test times for paperwork: a date box (today until set) and a blank time box.
    const timeBox = (sel) => a.locator(`${sel} + .split-datetime`);
    const setTime = async (sel, value) => { const [d, t] = value.split('T'); await timeBox(sel).locator('.split-date').fill(d); await timeBox(sel).locator('.split-time').fill(t); };
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    for (const sel of ['.test-start', '.test-end']) {
      assert.equal(await timeBox(sel).locator('.split-date').inputValue(), today, 'date defaults to today');
      assert.equal(await timeBox(sel).locator('.split-time').inputValue(), '', 'time left blank');
      assert.equal(await a.locator(sel).inputValue(), '', 'nothing saved until a time is typed');
    }
    await setTime('.test-start', '2026-10-11T07:05');
    await setTime('.test-end', '2026-10-11T15:05');
    assert.equal(await a.locator('.test-start').inputValue(), '2026-10-11T07:05');
    assert.equal(await page.evaluate(()=>testGauges[0].testState.workflow.officialStart),0,'Draft does not change saved boundaries');
    await a.locator('[data-act="period"]').click();
    assert.equal(await a.locator('.workflow-log-body tr').count(),33);
    assert.equal(await page.evaluate(()=>testGauges[0].sheetRows().officialRows.length),33);
    assert.equal(await page.evaluate(()=>testGauges[0].sheetRows().preTestRows.length),3);
    assert.equal(await page.evaluate(()=>testGauges[0].sheetRows().officialRows[0].pressure),984);
    await setTime('.test-end', '2026-10-11T07:00');
    await a.locator('[data-act="period"]').click();
    assert.match(await a.locator('.period-message').innerText(),/after/);
    assert.equal(await page.evaluate(()=>testGauges[0].testState.workflow.officialEnd),new Date('2026-10-11T15:05:00-05:00').getTime());
    await setTime('.test-end', '2026-10-11T15:07');
    await a.locator('[data-act="period"]').click();
    assert.equal(await a.locator('.workflow-log-body tr').count(),34,'Actual off-quarter end retained');
    assert.equal(await page.evaluate(()=>testGauges[0].testState.events.filter(e=>e.type==='official-end').length),1);
    assert.equal(await page.evaluate(()=>testGauges[0].testState.events.filter(e=>e.type==='time-correction').length),1);
    await page.locator('[data-dashboard-tab="pressure"]').click();
    await a.locator('.workflow-strokes summary').click();
    for(const [time,psi,count] of [['06:25','750','100'],['06:26','760','110']]){
      await a.locator('[data-input="at"]').fill('2026-10-11T'+time);
      await a.locator('[data-input="stroke-pressure"]').fill(psi);
      await a.locator('[data-input="counter"]').fill(count);
      if(count==='100') await a.locator('[data-input="capacity"]').fill('0.0043');
      await a.locator('[data-act="stroke"]').click();
    }
    assert.equal(await page.evaluate(()=>testGauges[0].testState.workflow.strokes[0].strokes),10);
    const out=path.resolve(root,'../tmp/freeform-logbook');fs.mkdirSync(out,{recursive:true});
    await a.locator('.workflow-strokes summary').click();
    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    await page.reload();await page.waitForSelector('.page-pressure');
    assert.equal(await page.evaluate(()=>testGauges[0].testState.workflow.strokes.length),1);
    assert.equal(await page.evaluate(()=>testGauges[0].testState.events.filter(e=>e.type==='note').length),4);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile fits');
    assert.deepEqual(errors,[]);
    const demo=await browser.newPage(); const demoErrors=[];demo.on('pageerror',e=>demoErrors.push(e.message));
    await demo.goto('http://127.0.0.1:'+server.address().port+'/host.php?demo=1');
    await demo.waitForSelector('.demo-pressure-panel');
    assert.equal(await demo.locator('.demo-skip-hold').count(),0);
    assert.deepEqual(demoErrors,[]);
    console.log('Freeform logbook passed: no stage UI, out-of-order late holds, manual and recorded PSI, retrospective period, corrected end, 15-minute rows, strokes without stages, reload, isolated tests, mobile and demo.');
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
