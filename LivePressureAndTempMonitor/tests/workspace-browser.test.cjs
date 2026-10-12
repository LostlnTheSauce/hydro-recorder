const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {fixture} = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname,'..');
async function main() {
  const calls=[], devices=[{id:'a'.repeat(16),serial:'T88206',online:true,bridge_online:true,ready:true,source_id:'b'.repeat(16),session_id:'old-session',slot:'A'}];
  let failConnect=false;
  devices[0].power={battery_percent:84,on_ac:true,charging:true,has_battery:true,reported_at:Date.now()};
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/host.php') {res.setHeader('content-type','text/html');return res.end(fixture());}
    if(['/api.php','/temperature.php'].includes(url.pathname)) {
      let body='';req.on('data',s=>body+=s);req.on('end',()=>{
        const payload=JSON.parse(body||'{}'), action=url.searchParams.get('action');calls.push({action,payload});
        let result={ok:true,devices,readings:[],last_id:0,has_more:false};
        if(action==='create_private') result={session_id:'c'.repeat(16),publish_token:'d'.repeat(64),viewer_enabled:false};
        if(action==='connect_device') {
          if(failConnect) {res.statusCode=409;result={error:'Fixture: recording changed. Refresh and try again.'};}
          else {Object.assign(devices[0],{session_id:payload.session_id,slot:payload.slot,source_id:'e'.repeat(16),finishing:false,sample_interval_seconds:payload.sample_interval_seconds,whole_degrees:payload.whole_degrees});result.source_id=devices[0].source_id;}
        }
        if(action==='disconnect_device') Object.assign(devices[0],{session_id:null,slot:null,finishing:true});
        res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
      });return;
    }
    if(!/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {res.statusCode=404;return res.end();}
    const file=path.join(root,url.pathname);if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
    res.setHeader('content-type',url.pathname.endsWith('.css')?'text/css':/\.m?js$/.test(url.pathname)?'text/javascript':'image/png');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER:',e.message);});
    page.setDefaultTimeout(12000);
    let accept=true;page.on('dialog',d=>accept?d.accept():d.dismiss());
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await page.waitForSelector('.page-pressure');assert.deepEqual(errors,[]);
    const a=page.locator('[data-gauge="A"]');
    assert.equal(await page.locator('.gauge-card:visible').count(),1);
    assert.equal(await page.locator('[data-dashboard-tab]').count(),6);
    assert.equal(await a.locator('.workflow-config').isVisible(),false);
    const output=path.resolve(root,'../tmp/rebuild-review');fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'live.png'),fullPage:true});
    await page.locator('[data-dashboard-tab="temperature"]').click();
    await a.locator('[data-enabled-probe="soil"]').uncheck();
    await a.locator('[data-enabled-probe="aux"]').uncheck();
    assert.deepEqual(await page.evaluate(()=>testGauges[0].settings().temperature.enabledProbes),['ambient','pipe']);
    assert.deepEqual(await page.evaluate(()=>testGauges[1].settings().temperature.enabledProbes),['ambient','pipe','soil','aux'],'Probe selection is per-test');
    await a.locator('.temperature-device-select').selectOption('a'.repeat(16));
    assert.match(await a.locator('.temperature-laptop-power').innerText(),/84%.*Plugged in.*Charging/);
    assert.equal(await a.locator('.temperature-device-connect').isVisible(),true);
    assert.equal(await a.locator('.temperature-device-connect').isEnabled(),true);
    assert.match(await a.locator('.temperature-device-connect').innerText(),/Move logger/);
    accept=false;await a.locator('.temperature-device-connect').click();
    assert.equal(calls.filter(c=>c.action==='connect_device').length,0,'cancel leaves the other recording untouched');
    accept=true;
    await a.locator('.temperature-sample-interval').fill('10');
    await a.locator('.temperature-whole-degrees').check();
    await a.locator('.temperature-device-connect').click();
    await page.waitForFunction(()=>document.querySelector('.temperature-device-disconnect').disabled===false);
    const start=calls.find(c=>c.action==='connect_device');
    assert.equal(start.payload.replace_recording,true);assert.equal(start.payload.expected_source_id,'b'.repeat(16));
    assert.equal(start.payload.sample_interval_seconds,10);assert.equal(start.payload.whole_degrees,true);
    assert.equal(calls.filter(c=>c.action==='start_viewer'||c.action==='create').length,0);
    await page.screenshot({path:path.join(output,'temperatures.png'),fullPage:true});
    await a.locator('.temp-chart-expand').click();
    assert.equal(await a.locator('.temp-chart-dialog').evaluate(d=>d.open),true);
    await a.locator('.temp-chart-close').click();
    assert.equal(await a.locator('.controlroom-temperature-chart .temperature-canvas-wrap').count(),1,'Expanded chart returns to new layout');
    await a.locator('.temperature-device-disconnect').click();
    await page.waitForFunction(()=>document.querySelector('.temperature-device-connect').disabled===false);
    assert.match(await a.locator('.temperature-bridge-status').innerText(),/ready/);
    failConnect=true;await a.locator('.temperature-device-connect').click();
    await a.locator('.temperature-connection-error').waitFor();
    await a.locator('.temperature-device-refresh').click();
    assert.match(await a.locator('.temperature-connection-error').innerText(),/recording changed/,'polling does not erase an actionable error');
    failConnect=false;await a.locator('.temperature-device-connect').click();
    await page.waitForFunction(()=>document.querySelector('.temperature-device-disconnect').disabled===false);
    assert.equal(calls.filter(c=>c.action==='connect_device').at(-1).payload.replace_recording,false,'stopped backlog never blocks Start');
    await page.locator('[data-dashboard-tab="setup"]').click();
    assert.equal(await a.locator('[data-config="hold75"]').count(),0);
    assert.equal(await a.locator('.pressure-offset').isVisible(),true);
    assert.equal(await a.locator('.window-top').isVisible(),true);
    assert.equal(await a.locator('[data-act="advance"]').count(),0);
    await page.screenshot({path:path.join(output,'setup.png'),fullPage:true});
    await page.locator('[data-dashboard-tab="logs"]').click();
    assert.equal(await a.locator('.paperwork-sync-panel').isVisible(),true);
    assert.equal(await a.locator('.workflow-card').isVisible(),false);
    await page.screenshot({path:path.join(output,'records.png'),fullPage:true});
    await page.locator('[data-dashboard-tab="sharing"]').click();
    assert.equal(await page.locator('#viewerPassword').isVisible(),true);
    assert.equal(await page.locator('#hostGaugeGrid').isVisible(),false);
    await page.locator('[data-dashboard-tab="pressure"]').click();
    await page.locator('#addSecondTest').click();
    assert.equal(await page.locator('.gauge-card:visible').count(),1);
    await page.locator('[data-layout-mode="A"]').click();
    await page.setViewportSize({width:390,height:844});
    for(const view of ['pressure','temperature','setup','logs','sharing']) {
      await page.locator(`[data-dashboard-tab="${view}"]`).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${view} fits a phone`);
      await page.screenshot({path:path.join(output,`${view}-mobile.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    console.log('Workspace passed: six explicit screens, visible settings, transfer confirmation/cancel, fresh start while finishing, interval/rounding, manual sharing, durable errors, two tests, responsive layout.');
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
