const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./workflow-browser.test.cjs');
const root=path.resolve(__dirname,'..'), jobs=new Map(), chunks=new Map();
let rejectCommit=false, commits=0;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/history.php'){res.setHeader('content-type','text/html');return res.end(fixture('history.php'));}
  if(url.pathname==='/'){res.setHeader('content-type','text/html');return res.end('<div id="hostApp" data-csrf="fixture"></div><p id="cloudSaveStatus"></p><script src="assets/jobs.js"></script><script src="assets/cloud-history.js"></script>');}
  if(url.pathname==='/history-api.php'){
    const action=url.searchParams.get('action');let raw='';for await(const data of req)raw+=data;
    const p=JSON.parse(raw||'{}');res.setHeader('content-type','application/json');
    const reply=(data,status=200)=>{res.statusCode=status;res.end(JSON.stringify(data));};
    if(req.method==='POST'){
      if(['rename','move','trash','restore'].includes(action)){
        const j=jobs.get(p.id);
        if(p.version!==(j.organization_version||0))return reply({error:'Stale organization version'},409);
        if(action==='rename')j.custom_label=p.value;
        if(action==='move')j.folder=p.value;
        if(action==='trash')j.deleted_at=Date.now();
        if(action==='restore')j.deleted_at=0;
        j.organization_version=(j.organization_version||0)+1;return reply({ok:true});
      }
      if(action==='claim'){
        if(!jobs.has(p.id))jobs.set(p.id,{id:p.id,writer:p.writer,revision:0,manifest:{},label:'New',status:'recording'});
        const j=jobs.get(p.id);if(j.writer!==p.writer)return reply({error:'Different writer'},409);
        return reply({revision:j.revision,manifest:j.manifest});
      }
      if(action==='chunk'){assert.equal(crypto.createHash('sha256').update(p.data).digest('hex'),p.hash);chunks.set(p.hash,p.data);return reply({ok:true});}
      if(action==='commit'){
        if(rejectCommit)return reply({error:'Fixture connection interrupted'},503);
        const j=jobs.get(p.id);assert.equal(p.revision,j.revision);for(const h of Object.values(p.manifest).flat())assert(chunks.has(h));
        Object.assign(j,{metadata:p.metadata,manifest:p.manifest,revision:j.revision+1,label:p.metadata.test.jobNumber,status:p.metadata.archivedAt?'archived':'recording',updated_at:Date.now()});commits++;return reply({ok:true});
      }
    }
    if(action==='list')return reply({jobs:[...jobs.values()].filter(j=>j.revision).map(({id,label,custom_label,status,updated_at,folder,deleted_at,organization_version})=>({id,label:custom_label||label,status,updated_at,folder,deleted_at,organization_version}))});
    const j=jobs.get(url.searchParams.get('id'));
    if(action==='read')return reply({metadata:j.metadata,manifest:j.manifest,updatedAt:j.updated_at});
    if(action==='chunk')return reply({data:chunks.get(url.searchParams.get('hash'))});
    return reply({error:'Unknown'},400);
  }
  if(/^\/assets\/[\w.-]+$/.test(url.pathname)){
    const file=path.join(root,url.pathname);res.setHeader('content-type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(file));
  }
  res.statusCode=404;res.end();
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const trailer=await browser.newContext(), page=await trailer.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
    await page.evaluate(()=>{
      const at=Date.UTC(2026,9,6,11);window.record={id:'fixture-job-0000001',format:'grantg-hydrotest-backup',version:1,archivedAt:0,test:{slot:'A',jobNumber:'Trailer test',events:[{at,label:'25% leak check',pressure:250}],workflow:{officialStart:at,officialEnd:at+3600000,baseline:{at:at-600000,pressure:900,counter:0,capacity:0.0043},strokes:[{target:910,counter:1000,strokes:1000,gallons:4.3,totalGallons:4.3,at:at-300000}],strokePlan:{step:10}},equipment:{pump:'pump-triplex'}},equipment:[{id:'pump-triplex',type:'pump',name:'Triplex',capacity:'0.0068'}],notes:[],readings:Array.from({length:4001},(_,i)=>({at:at+i*1000,pressure:980+i/10000})),temperatureReadings:Array.from({length:2001},(_,i)=>({at:at+i*2000,pipe:75+i/10000,ambient:72,soil:71,source:'live'}))};
      window.gauge={checkJobCurrent:()=>true};HydroCloud.attach([gauge],async()=>structuredClone(record));
    });
    await page.waitForFunction(()=>document.getElementById('cloudSaveStatus').textContent.startsWith('Saved online'),null,{timeout:20000});
    assert.equal(jobs.size,1);assert.equal(commits,1);const initialChunks=chunks.size;
    const second=await trailer.newPage();await second.goto(base);
    await second.evaluate(()=>{window.captures=0;HydroCloud.attach([{checkJobCurrent:()=>true}],async()=>{captures++;return null;});});
    await second.waitForTimeout(1800);assert.equal(await second.evaluate(()=>captures),0,'Only one tab uploads');
    rejectCommit=true;
    await page.evaluate(()=>{record.readings.push({at:record.readings.at(-1).at+1000,pressure:999});HydroCloud.schedule();});
    await page.waitForFunction(()=>document.getElementById('cloudSaveStatus').textContent.startsWith('Online save pending'));
    assert.equal(jobs.get('fixture-job-0000001').manifest.readings.length,3,'Old complete snapshot survives failed commit');
    assert.equal((await page.evaluate(()=>HydroJobs.pending())).length,1,'Retry remains durable');
    rejectCommit=false;await page.evaluate(()=>HydroCloud.schedule());
    await page.waitForFunction(()=>document.getElementById('cloudSaveStatus').textContent.startsWith('Saved online'));
    assert.equal(chunks.size,initialChunks+1,'Unchanged chunks are not duplicated');
    await page.evaluate(async()=>{gauge.jobTransition=true;const old=await HydroJobs.get(record.id);old.archivedAt=Date.now();await HydroJobs.save(old);HydroCloud.schedule();});
    await page.waitForFunction(()=>document.getElementById('cloudSaveStatus').textContent.startsWith('Saved online'));
    await page.waitForTimeout(1800);assert.equal(jobs.get('fixture-job-0000001').status,'archived');
    // A new browser/device has no local data, yet can open and replay the saved job.
    const phone=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
    const view=await phone.newPage();view.on('pageerror',e=>errors.push(e.message));await view.goto(base+'/history.php');
    await view.getByRole('button',{name:'Open & replay'}).click();await view.waitForSelector('#replay:not([hidden])');
    assert.equal(await view.locator('#historyLibrary').isVisible(),false,'Opened tests hide library controls');
    assert.match(await view.locator('#replaySummary').innerText(),/4,002 pressure readings/);
    // Digital vs physical report straight from the saved test.
    await phone.addInitScript(()=>{window.print=()=>{window.__printed=true;};});
    assert.equal(await view.locator('#replaySheet').isHidden(),true,'no Sheet link when the test has no Sheet');
    const [report]=await Promise.all([phone.waitForEvent('page'),view.locator('#replayReport').click()]);
    await report.waitForLoadState();
    assert.match(await report.locator('h1').innerText(),/digital probes vs physical charts/);
    const reportRows=await report.locator('table.rows tbody tr').allInnerTexts();
    assert.equal(reportRows.length,5,'official start to end every 15 minutes');
    assert.match(reportRows[0],/980\t72\.0\t—\t\t75\.0\t—\t\t71\.0\t—\t\tBegin test/,reportRows[0]);
    assert.match(reportRows[4],/End test/);
    await report.close();
    // Post-test package: round recorder charts, the combined graph, details, charts and the log.
    // The count used 0.0043 but the test's pump is the Triplex: History asks which rate.
    await view.locator('#replayPackage').click();
    assert.match(await view.locator('#pumpChoiceHelp').innerText(),/figured at 0\.0043 gal\/stroke, but this test's pump is Triplex at 0\.0068/);
    const [full]=await Promise.all([phone.waitForEvent('page'),view.locator('#pumpChoicePump').click()]);
    await full.waitForLoadState();
    assert.match(await full.locator('h1').innerText(),/post-test package/);
    assert.match(await full.locator('.tiles').first().innerText(),/Start of test\s+980\.0 psi[\s\S]*Duration\s+1\.0 h/);
    assert.match(await full.locator('.said').innerText(),/official test ran 1\.0 hours/);
    const images=await full.locator('figure img').evaluateAll(list=>list.map(i=>({alt:i.alt,png:i.src.startsWith('data:image/png'),w:i.naturalWidth})));
    assert.deepEqual(images.map(i=>i.alt),['Round pressure recorder chart','Round temperature recorder chart','Pressure and temperatures over the official test']);
    assert(images.every(i=>i.png&&i.w>300),JSON.stringify(images));
    assert.equal(await full.locator('figure svg').count(),4,'pressure chart plus ambient, pipe and soil');
    assert.equal(await full.locator('h2:has-text("Test log") + table tbody tr').count(),5);
    assert.match(await full.locator('body').innerText(),/Gallons figured at 0\.0068 gal\/stroke \(Triplex\)/);
    assert.match(await full.locator('.halves').innerText(),/910 psi\s+1000\s+1000\s+6\.80\s+6\.80/);
    await full.close();
    const m=()=>view.locator('.temperature-chart').evaluate(c=>({start:c._temperatureMeta.start,end:c._temperatureMeta.end,selected:c._temperatureMeta.selectedAt}));
    const before=await m();await view.locator('.temp-scrubber').fill('5000');await view.waitForTimeout(100);
    assert((await m()).selected>before.start,'Finger-friendly scrubber selects recording time');
    await view.locator('#playReplay').click();await view.waitForTimeout(500);await view.locator('#playReplay').click();
    assert((await m()).selected>(before.start+before.end)/2,'Replay advances');
    await view.locator('.temp-history-range').selectOption('official');assert.equal((await m()).end-(await m()).start,3600000);
    assert(!/Live/.test(await view.locator('.temp-inspector-time').innerText()),'Saved replay not labeled live');
    assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Replay fits phone');
    await view.locator('.temp-chart-expand').click();
    assert.equal(await view.locator('.temp-chart-dialog').evaluate(d=>d.open),true);
    await view.locator('.temp-chart-close').click();
    assert.equal(await view.locator('.temperature-chart').count(),1,'History expansion preserves one chart');
    const dir=path.resolve(root,'../tmp/cloud-history');fs.mkdirSync(dir,{recursive:true});await view.screenshot({path:path.join(dir,'phone-replay.png'),fullPage:true});
    await view.locator('[data-history-view="log"]').click();
    assert.equal(await view.locator('.replay-layout').isVisible(),false,'Graph is not cluttering log view');
    assert.equal(await view.locator('#historyLogInterval').inputValue(),'900000');
    assert.equal(await view.locator('#historyLogTable tbody tr').count(),6,'Quarter-hour rows plus final sample');
    await view.locator('[data-log-probe="soil"]').uncheck();
    assert.equal(await view.locator('[data-log-probe="aux"]').isChecked(),false);
    assert.deepEqual(await view.locator('#historyLogTable th').allTextContents(),['Date','Log time','Pressure PSI','Pipe °F','Ambient °F']);
    assert.equal(await view.locator('#historyLogTable tbody tr').first().locator('[data-column="pressure"] summary').innerText(),'980');
    await view.locator('#historyLogInterval').selectOption('1000');
    assert.equal(await view.locator('#historyLogTable tbody tr').count(),100);
    assert.match(await view.locator('#historyLogPage').innerText(),/4,002/);
    await view.locator('#historyLogNext').click();
    assert.match(await view.locator('#historyLogPage').innerText(),/101–200/);
    await view.locator('#historyLogInterval').selectOption('900000');
    await view.locator('#historyLogPeriod').selectOption('official');
    assert.equal(await view.locator('#historyLogTable tbody tr').count(),5);
    await view.locator('#historyLogTable tbody tr').first().locator('[data-column="pressure"] summary').click();
    assert.match(await view.locator('#historyLogTable tbody tr').first().locator('[data-column="pressure"] small').innerText(),/Recorded/);
    assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Log fits phone');
    await view.screenshot({path:path.join(dir,'phone-reading-log.png'),fullPage:true});
    await view.locator('[data-history-view="graph"]').click();
    assert.equal(await view.locator('.temperature-channel-toggles input[value="soil"]').isChecked(),false,'Log probe selection applies to graph');
    assert.equal(await view.locator('[data-temp-inspector-value="soil"]').isVisible(),false);
    await view.locator('[data-history-view="events"]').click();
    assert.equal(await view.locator('#replayEvents tr').count(),1);
    await view.locator('[data-history-view="log"]').click();
    // Rename and move without leaving the opened test.
    await view.getByRole('button',{name:'Rename',exact:true}).click();
    await view.locator('#historyEditValue').fill('Line D <test>');
    await view.locator('#historyEditSave').click();
    await view.waitForFunction(()=>document.querySelector('#replayTitle').textContent==='Line D <test>');
    assert.equal(await view.locator('#replay').isVisible(),true);
    await view.getByRole('button',{name:'Move',exact:true}).click();
    await view.locator('#historyEditValue').fill('Atmos 2026');
    await view.locator('#historyEditSave').click();
    await view.waitForFunction(()=>document.querySelector('#historyStatus').textContent==='Test moved.');
    assert.match(await view.locator('#replayFolder').innerText(),/Atmos 2026/);
    await view.getByRole('button',{name:'Delete',exact:true}).click();
    await view.locator('#historyEditCancel').click();
    assert.equal(await view.locator('#replay').isVisible(),true,'Cancel keeps recording open');
    assert.equal(await view.locator('#historyLibrary').isVisible(),false);
    await view.getByRole('button',{name:'Delete',exact:true}).click();
    await view.locator('#historyEditSave').click();
    await view.waitForSelector('#historyLibrary:not([hidden])');
    assert.equal(await view.locator('#replay').isVisible(),false,'Trash returns to library');
    await view.locator('#historyFolder').selectOption('folder:Atmos 2026');
    await view.waitForFunction(()=>document.querySelectorAll('.history-job').length===0);
    await view.locator('#historyFolder').selectOption('trash');
    assert.equal(await view.locator('.history-job').count(),1);
    await view.reload();await view.waitForSelector('#historyFolder');
    await view.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('saved online'));
    assert.equal(await view.locator('.history-job').count(),0,'Trash survives reload and is not in All tests');
    await view.locator('#historyFolder').selectOption('trash');
    await view.locator('.history-action-menu summary').click();
    await view.getByRole('button',{name:'Restore',exact:true}).click();
    await view.locator('#historyEditSave').click();
    await view.waitForFunction(()=>document.querySelector('#historyStatus').textContent==='Test restored to its folder.');
    await view.locator('#historyFolder').selectOption('folder:Atmos 2026');
    assert.equal(await view.locator('.history-job h3').innerText(),'Line D <test>');
    await view.getByRole('button',{name:'Open & replay'}).click();
    await view.waitForSelector('#replay:not([hidden])');
    assert.match(await view.locator('#replaySummary').innerText(),/4,002 pressure readings/,'Restored data complete');
    await view.locator('[data-history-view="log"]').click();
    assert.equal(await view.locator('[data-log-probe="soil"]').isChecked(),false,'Probe choice survives reopening');
    assert.equal(await view.locator('#historyLogPeriod').inputValue(),'official','Log preference survives page reload');
    await view.locator('[data-history-view="graph"]').click();
    await view.locator('#closeReplay').click();
    await view.locator('.history-action-menu summary').click();
    await view.getByRole('button',{name:'Rename',exact:true}).click();
    await view.locator('#historyEditValue').fill('Canceled name');
    await view.keyboard.press('Escape');
    assert.equal(await view.locator('.history-job h3').innerText(),'Line D <test>','Escape leaves name unchanged');
    await view.setViewportSize({width:1440,height:1000});
    await view.screenshot({path:path.join(dir,'control-room-history-desktop.png'),fullPage:true});
    await view.getByRole('button',{name:'Open & replay'}).click();
    await view.waitForSelector('#replay:not([hidden])');
    await view.screenshot({path:path.join(dir,'control-room-replay-desktop.png'),fullPage:true});
    await view.locator('#closeReplay').click();
    await view.setViewportSize({width:390,height:844});
    await view.screenshot({path:path.join(dir,'phone-history-controls.png'),fullPage:true});
    assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Management fits phone');
    await page.close();await second.waitForFunction(()=>captures>0);
    await second.reload();await second.evaluate(()=>HydroCloud.attach([],async()=>null));await second.waitForTimeout(1800);
    assert.equal((await second.evaluate(()=>HydroJobs.pending())).length,0,'Acknowledgements survive reload and leadership handoff');
    assert.deepEqual(errors,[]);
    console.log('Cloud browser: automatic incremental save, failure/retry, archival, separate-device history, full dataset, scrub/play, official range and mobile passed.');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
