// Local-only integration fixture: expands the two simple PHP loops without
// loading config.php, connecting real gauges, or contacting the production API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
function fixture(filename = 'host.php') {
  let src = fs.readFileSync(path.join(root, filename), 'utf8');
  src = src.slice(src.indexOf('<!doctype html>')).replace(/<\?php if \(!is_host_signed_in\(\)\): \?>[\s\S]*?<\?php else: \?>/, '');
  src = src.replace(/<\?php if \(!\$validId\): \?>[\s\S]*?<\?php else: \?>/, '');
  const channels = [['ambient','Ambient','#3f7fbe'],['pipe','Pipe','#e07832'],['soil','Soil','#77624c'],['aux','Auxiliary','#8a55ae']];
  src = src.replace(/<\?php foreach \(\['ambient'[\s\S]*?\?>[\s\S]*?<\?php endforeach; \?>/g, block => {
    const body = block.slice(block.indexOf('?>')+2).replace(/<\?php endforeach; \?>/, '');
    return channels.map(([key,label,color]) => body.replaceAll("<?= $key !== 'aux' ? 'checked' : '' ?>", key!=='aux'?'checked':'').replaceAll('<?= $key ?>',key).replaceAll('<?= $label ?>',label).replaceAll('<?= $channel[0] ?>',label).replaceAll('<?= $channel[1] ?>',color)).join('');
  });
  src = src.replace(/<\?php foreach \(\['A'[\s\S]*?\?>[\s\S]*?<\?php endforeach; \?>/, block => {
    const body = block.slice(block.indexOf('?>')+2).replace(/<\?php[^?]*\?>/g,'');
    return ['A','B'].map((slot,i) => body.replaceAll("<?= $slot === 'B' ? ' inactive-test' : '' ?>",i?' inactive-test':'').replaceAll('<?= $slot ?>',slot).replaceAll('<?= $testNumber ?>',i+1).replaceAll('<?= $color ?>',i?'#9b3ec2':'#d43b3b')).join('');
  });
  src = src.replace(/<\?(?:php|=)[\s\S]*?\?>/g, '');
  // Cloud retry behavior has its own two-device suite. Keep the recording/demo
  // isolation fixture free of background online-history migrations.
  src = src.replace(/<script src="assets\/cloud-history\.js[^\"]*"><\/script>/g, '');
  src = src.replace('<script src="assets/host.js', '<script>const attach=HydroWorkflowUI.attach; HydroWorkflowUI.attach=(gauges,helpers)=>{window.testGauges=gauges; return attach(gauges,helpers);};</script><script src="assets/host.js');
  return src;
}
async function main() {
  let mockDevices = [], mockTemperatures = [], mockViewerConfig = {}, mockPressure = [];
  const server = http.createServer((req,res) => {
    const name = new URL(req.url,'http://localhost').pathname;
    if (name === '/' || name === '/host.php') { res.setHeader('content-type','text/html'); return res.end(fixture()); }
    if (name === '/viewer.php') { res.setHeader('content-type','text/html'); return res.end(fixture('viewer.php')); }
    if (name === '/temperature.php' || name === '/api.php') {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}'), action = new URL(req.url,'http://localhost').searchParams.get('action');
        const rows = mockTemperatures.filter(r => r.id > (payload.since_id || 0));
        const result = {ok:true, devices:mockDevices, sources:[], readings:rows.slice(0,5000), has_more:rows.length>5000, last_id:rows.slice(0,5000).at(-1)?.id || payload.since_id || 0};
        if (name === '/api.php' && action === 'view') {
          result.config=mockViewerConfig;result.readings=mockPressure.filter(r=>r.id>(payload.since_id||0));
          result.last_id=mockPressure.at(-1)?.id||0;result.has_more=false;
        }
        if (action === 'connect_device') result.source_id = 'new-source';
        res.setHeader('content-type','application/json'); res.end(JSON.stringify(result));
      }); return;
    }
    if (!/^\/assets\/[a-zA-Z0-9_.-]+$/.test(name)) { res.statusCode=404; return res.end(); }
    const file = path.join(root,name);
    if (!fs.existsSync(file)) { res.statusCode=404; return res.end(); }
    res.setHeader('content-type', name.endsWith('.css')?'text/css': /\.m?js$/.test(name)?'text/javascript':'image/png');
    if (name === '/assets/host.js') return res.end(fs.readFileSync(file,'utf8').replace('demo?.attach(gauges);','window.testPollTemperatures = pollTemperatures; demo?.attach(gauges);'));
    if (name === '/assets/viewer.js') return res.end(fs.readFileSync(file,'utf8').replace('const defaults = {','window.testViewerState = state; const defaults = {'));
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true, channel:'chrome'});
    const context=await browser.newContext({viewport:{width:1440,height:1100}});
    const page=await context.newPage();
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    page.on('dialog', dialog=>dialog.type()==='prompt'?dialog.accept('Problem at 75%; restart requested'):dialog.accept());
    await page.clock.install({time:new Date('2026-09-22T10:00:00-05:00')});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('.workflow-card');
    assert.deepEqual(errors,[]);
    assert.equal(await page.locator('.workflow-card:visible').count(),1);
    const a=page.locator('[data-gauge="A"]');
    assert.equal(await a.locator('[data-act="advance"]').count(),0);
    await a.locator('[data-input="note"]').fill('75% hold — leak check, 5 minutes');
    await a.locator('[data-act="note"]').click();
    const out=path.resolve(root,'..','tmp','workflow-review'); fs.mkdirSync(out,{recursive:true});
    await page.screenshot({path:path.join(out,'live-job.png'),fullPage:true});
    await page.reload(); await page.waitForSelector('.workflow-card');
    assert.match(await a.locator('.recent-field-entries').innerText(),/leak check/);
    await page.evaluate(()=>{testGauges[0].readings=[{at:Date.now(),pressure:750}];});
    await a.locator('.workflow-strokes summary').click();
    await a.locator('[data-input="counter"]').fill('100');
    await a.locator('[data-input="capacity"]').fill('0.0043');
    await a.locator('[data-act="stroke"]').click();
    await page.clock.setFixedTime(new Date('2026-09-22T11:01:00-05:00'));
    await page.evaluate(()=>{testGauges[0].readings.push({at:Date.now(),pressure:760}); testGauges[0].workflowController.render(true);});
    await a.locator('[data-input="counter"]').fill('110');
    await a.locator('[data-act="stroke"]').click();
    assert.equal(await page.evaluate(()=>testGauges[0].testState.workflow.strokes[0].strokes),10);
    await page.locator('#addSecondTest').click();
    assert.equal(await page.evaluate(()=>testGauges[1].testState.workflow.stage),'pretest');
    await page.locator('[data-layout-mode="A"]').click();
    assert.equal(await page.locator('[data-gauge="B"]').isVisible(),false);
    await page.locator('[data-dashboard-tab="logs"]').click();
    assert.equal(await a.locator('.workflow-records').isVisible(),true);
    assert.equal(await a.locator('.workflow-card').isVisible(),false);
    assert.equal(await a.locator('.paperwork-sync-panel').isVisible(),true);
    // Missing values cannot turn into zero; sparse live temperatures are flagged.
    await page.evaluate(()=>{
      const g=testGauges[0],s=g.testState.workflow;
      s.officialStart=Date.now()-900000;s.officialEnd=0;s.stage='official';s.since=s.officialStart;
      g.readings=[{at:s.officialStart,pressure:983.9}];
      g.temperatureReadings=[{at:s.officialStart,ambient:72.3,pipe:null,soil:70,source:'live'}];
      g.workflowController.syncOfficialFields(); g.workflowController.render(true);
    });
    const rows=await page.evaluate(()=>testGauges[0].workflowController.officialRows());
    assert.equal(rows[0].pressure,984);assert.equal(rows[0].pipe,'');assert.equal(rows[1].pressure,'');assert.equal(rows[1].ambient,'');
    await page.screenshot({path:path.join(out,'records.png'),fullPage:true});
    await page.locator('[data-dashboard-tab="pressure"]').click();
    await a.locator('[data-act="temperatures"]').click();
    assert.equal(await a.locator('.temperature-panel').isVisible(),true);
    await a.locator('.temp-history-range').selectOption('pretest');
    assert.equal(await a.locator('.temperature-chart').evaluate(el=>el._temperatureMeta),null,'pre-test chart excludes official-only data');
    await page.setViewportSize({width:650,height:1000});
    assert.equal(await page.locator('[data-gauge="B"]').isVisible(),false);
    await page.screenshot({path:path.join(out,'narrow.png'),fullPage:true});
    // Tests saved before Archive attempt was removed can still hold an archived attempt.
    const offsetCheck=await page.evaluate(()=>{
      const g=testGauges[0],cut=Date.now();
      g.testState.workflow.archives=[{endedAt:cut}];
      g.readings=[{at:cut-1000,pressure:750},{at:cut+1000,pressure:760}];
      g.reapplyPressureOffset(0,4);
      return g.readings.map(r=>r.pressure);
    });
    assert.deepEqual(offsetCheck,[750,764],'new offset must not rewrite archived attempt pressure');
    assert.deepEqual(errors,[]);
    console.log('Browser integration passed: persistent holds, strokes, independent tests, records, missing data, temperature views, archived-attempt offset and narrow layout.');
    // Practice is a separate tab with the SAME origin/storage, not an isolated browser context.
    // The one-time equipment restore check finishes on its own shortly after load.
    await page.waitForFunction(() => localStorage.getItem('grantg-hydro-equipment-recovered-v1'), null, { timeout: 15000 });
    const realStorage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
    const storedReadings = p => p.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('grantg-hydrotest-recordings', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, read = db.transaction('readings').objectStore('readings').getAll();
        read.onsuccess = () => { resolve(JSON.stringify(read.result)); db.close(); };
      };
    }));
    const realReadings = await storedReadings(page);
    const demo = await page.context().newPage();
    const demoErrors = [], demoPosts = [];
    demo.on('pageerror', e => demoErrors.push(e.message));
    demo.on('request', r => { if (r.method() === 'POST') demoPosts.push(r.url()); });
    demo.on('dialog', d => d.accept());
    await demo.clock.install({time: new Date('2026-09-22T10:00:00-05:00')});
    await demo.goto(`http://127.0.0.1:${server.address().port}/host.php?demo=1`);
    await demo.waitForSelector('.demo-pressure-panel');
    const da = demo.locator('[data-gauge="A"]');
    assert.equal(await demo.evaluate(() => testGauges[0].testState.workflow.stage), 'pretest');
    assert.equal(await demo.evaluate(() => testGauges[0].readings.length), 1);
    assert.equal(await demo.evaluate(() => testGauges[0].testState.sheet), null);
    assert.equal(await demo.locator('#remotePanel').isVisible(), false);
    const pressure = async value => {
      await da.locator('.demo-pressure-number').fill(String(value));
      await da.locator('.demo-pressure-number').dispatchEvent('change');
    };
    await pressure(750);
    const stage = () => demo.evaluate(() => testGauges[0].testState.workflow.stage);
    const slider = da.locator('.demo-pressure-slider');
    await slider.focus(); await slider.press('ArrowLeft');
    assert.equal(await demo.evaluate(() => testGauges[0].readings.at(-1).pressure), 749);
    await slider.press('ArrowRight');
    await da.locator('.workflow-strokes summary').click();
    await da.locator('[data-input="counter"]').fill('100');
    await da.locator('[data-act="stroke"]').click();
    await da.locator('.demo-pressure-step').selectOption('10');
    await slider.focus(); await slider.press('ArrowUp');
    assert.equal(await demo.evaluate(() => testGauges[0].readings.at(-1).pressure), 760);
    await da.locator('[data-input="counter"]').fill('110');
    await da.locator('[data-act="stroke"]').click();
    assert.equal(await demo.evaluate(() => testGauges[0].testState.workflow.strokes[0].strokes), 10);
    await pressure(1000);
    await demo.evaluate(()=>{
      const c=testGauges[0].workflowController,s=c.state();
      s.officialStart=HydroDemo.ClockDate.now(); c.syncOfficialFields();
    });
    await da.locator('.demo-time-step').selectOption('480');
    await da.locator('.demo-skip-time').click();
    await demo.evaluate(()=>{const c=testGauges[0].workflowController;c.state().officialEnd=c.state().officialStart+8*3600000;c.syncOfficialFields();});
    const demoRows = await demo.evaluate(() => testGauges[0].workflowController.officialRows());
    assert.equal(demoRows.length, 33);
    assert.ok(demoRows.every(r => r.pressure === 1000), 'skipped test has populated 15-minute pressures');
    await pressure(0); await slider.focus(); await slider.press('ArrowDown');
    assert.equal(await demo.evaluate(() => testGauges[0].readings.at(-1).pressure), 0);
    await demo.locator('#addSecondTest').click();
    const db = demo.locator('[data-gauge="B"]');
    await db.locator('.demo-pressure-number').fill('50');
    await db.locator('.demo-pressure-number').dispatchEvent('change');
    assert.deepEqual(await demo.evaluate(() => testGauges.map(g => g.readings.at(-1).pressure)), [0, 50]);
    await demo.evaluate(async () => {
      const g = testGauges[0];
      await g.connect(); await g.createGoogleSheet();
      g.testState.sheet = {spreadsheetId:'must-not-write'}; await g.syncGoogleSheet();
    });
    assert.deepEqual(demoPosts, [], 'practice must not contact backend APIs');
    assert.equal(await demo.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), realStorage);
    assert.equal(await storedReadings(demo), realReadings, 'practice must not touch real IndexedDB readings');
    await demo.locator('[data-layout-mode="A"]').click();
    await demo.screenshot({path:path.join(out,'demo.png'),fullPage:true});
    await demo.setViewportSize({width:650,height:1000});
    await demo.screenshot({path:path.join(out,'demo-narrow.png'),fullPage:true});
    await demo.reload(); await demo.waitForSelector('.demo-pressure-panel');
    assert.equal(await stage(), 'pretest', 'refresh resets practice, not real data');
    assert.equal(await demo.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), realStorage);
    assert.deepEqual(demoErrors, []);
    await demo.route('**/assets/demo.js*', route => route.abort());
    await demo.reload();
    assert.match(await demo.locator('#hostApp').innerText(), /Demo could not load/);
    assert.equal(await demo.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), realStorage);
    assert.deepEqual(demoPosts, []);
    console.log('Demo passed: arrow keys, complete mock test, time skipping, 33 official rows, independent pressures, reload reset, zero API writes and unchanged real storage.');
    const jobContext = await browser.newContext({viewport:{width:1440,height:1100}});
    const jobPage = await jobContext.newPage();
    const jobErrors = [];
    jobPage.on('pageerror', e => jobErrors.push(e.message));
    jobPage.on('dialog', d => d.accept());
    const at = new Date('2026-09-22T15:00:00Z').getTime();
    const session = '1111111111111111';
    mockTemperatures = Array.from({length:5002}, (_,i) => ({id:i+1, slot:'A', source_id:'old-source', at:at-86400000+i*2000, pipe:72, soil:70, ambient:75, aux:76}));
    mockTemperatures.push({id:5003,slot:'B',source_id:'source-b',at:at-1000,pipe:80});
    mockDevices = [{id:'bbbbbbbbbbbbbbbb',serial:'B-logger',session_id:session,slot:'B',online:true}];
    await jobPage.clock.install({time:new Date(at)});
    await jobPage.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await jobPage.waitForSelector('.workflow-card');
    await jobPage.evaluate(({session,at}) => {
      localStorage.setItem('grantg-live-session',JSON.stringify({session_id:session,publish_token:'a'.repeat(64),viewer_enabled:false}));
      localStorage.setItem('grantg-hydro-second-test-active','true');
      localStorage.setItem('grantg-live-test-notes',JSON.stringify([{id:'a',slot:'A',at:at-2000,text:'old A note'},{id:'b',slot:'B',at:at-1000,text:'keep B note'}]));
      const a=testGauges[0], b=testGauges[1];
      a.testState.jobNumber='Yesterday';a.testState.sheet={spreadsheetId:'old-sheet'};a.testState.offset=4;a.saveTestState();
      a.add({at:at-2000,pressure:984,unit:'PSI'});
      b.testState.jobNumber='Other running test';b.saveTestState();b.add({at:at-1000,pressure:1500,unit:'PSI'});
    },{session,at});
    // Readings are written to the browser's database in the background; let that finish before reloading.
    await jobPage.waitForFunction(() => new Promise((resolve) => {
      const open = indexedDB.open('grantg-hydrotest-recordings', 1);
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const db = open.result, all = db.transaction('readings', 'readonly').objectStore('readings').getAll();
        all.onsuccess = () => { const found = all.result.some((r) => r.pressure === 984) && all.result.some((r) => r.pressure === 1500); db.close(); resolve(found); };
        all.onerror = () => { db.close(); resolve(false); };
      };
    }));
    await jobPage.reload(); await jobPage.waitForSelector('.workflow-card');
    await jobPage.waitForFunction(() => testGauges[0].temperatureReadings.length===5002);
    const beforeOther = await jobPage.evaluate(() => JSON.stringify([testGauges[1].testState,testGauges[1].readings,testGauges[1].temperatureReadings]));
    mockDevices.push({id:'aaaaaaaaaaaaaaaa',serial:'A-logger',session_id:session,slot:'A',online:true});
    await jobPage.evaluate(() => testGauges[0].startNewJob());
    assert.match(await jobPage.locator('[data-gauge="A"] .workflow-message').innerText(), /Stop recording temps/);
    assert.equal(await jobPage.evaluate(() => testGauges[0].testState.jobNumber), 'Yesterday');
    mockDevices.pop();
    await jobPage.evaluate(async () => {
      const save=HydroJobs.save; HydroJobs.save=async()=>{throw Error('Storage quota exceeded');};
      await testGauges[0].startNewJob();HydroJobs.save=save;
    });
    assert.equal(await jobPage.evaluate(() => testGauges[0].testState.jobNumber), 'Yesterday');
    assert.equal(await jobPage.evaluate(async () => (await HydroJobs.list('A')).length), 0);
    await jobPage.evaluate(async () => {
      testGauges[0].port = {};
      await testGauges[0].startNewJob();
      testGauges[0].port = null;
    });
    assert.match(await jobPage.locator('[data-gauge="A"] .workflow-message').innerText(), /Disconnect/);
    mockDevices.push({id:'aaaaaaaaaaaaaaaa',finishing:true,pending_session_id:session,pending_slot:'A'});
    await jobPage.evaluate(() => testGauges[0].startNewJob());
    mockDevices.pop();
    const fresh = await jobPage.evaluate(async () => {
      const g=testGauges[0], list=await HydroJobs.list('A'), archive=await HydroJobs.get(list[0].id);
      return {test:g.testState,pressures:g.readings.length,temps:g.temperatureReadings.length,archive,notes:JSON.parse(localStorage.getItem('grantg-live-test-notes'))};
    });
    assert.equal(fresh.test.jobNumber,'');assert.equal(fresh.test.offset,0);assert.equal(fresh.test.sheet,null);
    assert.equal(fresh.pressures,0);assert.equal(fresh.temps,0);assert.deepEqual(fresh.test.temperatureSourceIds,[]);
    assert.equal(fresh.archive.readings[0].pressure,984);assert.equal(fresh.archive.temperatureReadings.length,5002);
    assert.equal(fresh.archive.notes[0].text,'old A note');assert.equal(fresh.archive.test.sheet.spreadsheetId,'old-sheet');
    assert.deepEqual(fresh.notes.map(n=>n.text),['keep B note']);
    assert.equal(await jobPage.evaluate(() => JSON.stringify([testGauges[1].testState,testGauges[1].readings,testGauges[1].temperatureReadings])), beforeOther);
    await jobPage.evaluate(() => testGauges[0].add({at:Date.now(),pressure:25,unit:'PSI'}));
    await jobPage.reload();await jobPage.waitForSelector('.workflow-card');
    await jobPage.waitForFunction(() => testGauges[0].readings.length === 1);
    await jobPage.evaluate(() => testPollTemperatures());
    assert.equal(await jobPage.evaluate(() => testGauges[0].temperatureReadings.length),0,'old temperatures stay out after reload');
    assert.equal(await jobPage.evaluate(() => testGauges[0].readings[0].pressure),25,'only fresh pressure namespace is restored');
    mockDevices.push({id:'aaaaaaaaaaaaaaaa',serial:'A-logger',session_id:null,slot:null,online:true});
    await jobPage.clock.runFor(5000);
    const ja=jobPage.locator('[data-gauge="A"]');
    await ja.locator('[data-act="temperatures"]').click();
    await ja.locator('.temperature-device-select').selectOption('aaaaaaaaaaaaaaaa');
    await ja.locator('.temperature-device-connect').click();
    await jobPage.waitForFunction(() => testGauges[0].testState.temperatureSourceIds.includes('new-source'));
    const freshAt = Math.max(at+6000, fresh.test.jobStartedAt+6000);
    mockTemperatures.push({id:5004,slot:'A',source_id:'old-source',at:freshAt,pipe:999});
    mockTemperatures.push({id:5005,slot:'A',source_id:'new-source',at:freshAt,pipe:73});
    await jobPage.evaluate(() => testPollTemperatures());
    assert.deepEqual(await jobPage.evaluate(() => testGauges[0].temperatureReadings.map(r=>r.pipe)),[73],'even future-dated old-source samples are excluded');
    await jobPage.locator('[data-dashboard-tab="logs"]').click();
    await ja.getByText('Local backup copies',{exact:true}).click();
    await ja.locator('[data-job-download]').waitFor();
    await jobPage.screenshot({path:path.join(out,'previous-tests.png'),fullPage:true});
    const oldTab=await jobContext.newPage(); await oldTab.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await oldTab.waitForSelector('.workflow-card');
    await jobPage.evaluate(() => testGauges[0].startNewJob());
    await oldTab.waitForFunction(() => testGauges[0].obsoleteJob === true);
    assert.equal(await oldTab.evaluate(() => testGauges[1].obsoleteJob === true),false,'only changed slot is disabled in older tab');
    assert.deepEqual(jobErrors,[]);
    console.log('Fresh jobs passed: complete durable archive, blocked active logger, failed archive leaves job intact, separate pressure storage, source isolation after reload, new recording, old-tab protection and other test unchanged.');
    mockViewerConfig={A:{active:true,temperature:{viewerVisible:true}},B:{active:true,temperature:{viewerVisible:true}}};
    mockPressure=[{id:1,slot:'A',at:at-1000,pressure:984},{id:2,slot:'B',at:at-1000,pressure:1500}];
    const view=await jobContext.newPage(); const viewerErrors=[];view.on('pageerror',e=>viewerErrors.push(e.message));
    await view.clock.install({time:new Date(at+10000)});
    await view.goto(`http://127.0.0.1:${server.address().port}/viewer.php`);
    await view.locator('#viewerLoginPassword').fill('fixture-only');
    await view.getByRole('button',{name:'View live charts'}).click();
    await view.waitForFunction(()=>testViewerState.A.liveTemperatures.length>5000);
    mockViewerConfig.A={active:true,jobStartedAt:at,temperatureSourceIds:['new-source'],temperature:{viewerVisible:true}};
    mockPressure.push({id:3,slot:'A',at:at+6000,pressure:25});
    await view.clock.runFor(3000);
    await view.waitForFunction(()=>testViewerState.A.readings.length===1&&testViewerState.A.readings[0].pressure===25);
    assert.deepEqual(await view.evaluate(()=>testViewerState.A.liveTemperatures.map(r=>r.pipe)),[73]);
    assert.equal(await view.evaluate(()=>testViewerState.B.readings[0].pressure),1500);
    assert.equal(await view.evaluate(()=>testViewerState.B.liveTemperatures[0].pipe),80);
    await view.locator('[data-dashboard-tab="logs"]').click();
    const logA=view.locator('[data-viewer-logbook="A"]'), logB=view.locator('[data-viewer-logbook="B"]');
    assert.match(await logA.innerText(),/73\.0°/,'Viewer log book includes pipe temperature');
    assert.match(await logA.locator('thead').innerText(),/pipe/i);
    mockViewerConfig.A.temperature.enabledProbes=['ambient'];
    await view.clock.runFor(3000);
    await view.waitForFunction(()=>document.querySelector('[data-view-gauge="A"] .temp-toggle input[value="pipe"]').disabled);
    assert.equal(await view.locator('[data-view-gauge="A"] .temp-toggle input[value="aux"]').isDisabled(),true);
    await view.waitForFunction(()=>!/pipe/i.test(document.querySelector('[data-viewer-logbook="A"] thead').textContent));
    assert.doesNotMatch(await logA.innerText(),/73\.0°/,'Probes the host hides are omitted from the viewer log book');
    assert.match(await logB.locator('thead').innerText(),/pipe/i,'Second test permissions independent');
    assert.deepEqual(viewerErrors,[]);
    console.log('Viewer passed: existing open viewer drops old-job pressure and temperatures while retaining the other test.');
    console.log(`Screenshots: ${out}`);
  } finally { if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
module.exports = {fixture};
if (require.main === module) main().catch(error=>{console.error(error);process.exitCode=1;});
