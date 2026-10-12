// Offline UI sandbox. No production calls, instrument I/O or disk mutations.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {fixture}=require('../LivePressureAndTempMonitor/tests/workflow-browser.test.cjs');
const root=path.resolve(__dirname,'..'),app=path.join(root,'LivePressureAndTempMonitor');
const jobs=new Map(),chunks=new Map();
for(const entry of JSON.parse(fs.readFileSync(path.join(root,'recordings/index.json'),'utf8'))) {
  const record=JSON.parse(fs.readFileSync(path.join(root,entry.file),'utf8'));
  const manifest={readings:[],temperatureReadings:[]};
  for(const key of Object.keys(manifest)) for(let i=0;i<(record[key]||[]).length;i+=2000) {
    const text=JSON.stringify(record[key].slice(i,i+2000)),hash=crypto.createHash('sha256').update(text).digest('hex'); chunks.set(hash,text);manifest[key].push(hash);
  }
  const {readings,temperatureReadings,...metadata}=record;
  jobs.set(entry.id,{id:entry.id,label:entry.name,folder:entry.folder||'',deleted_at:entry.deletedAt||0,updated_at:entry.updatedAt,status:record.archivedAt?'archived':'recording',organization_version:0,metadata,manifest});
}
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/' || url.pathname==='/host.php') {
    if(url.searchParams.get('demo')!=='1'){res.writeHead(302,{Location:'/host.php?demo=1'});return res.end();}
    res.setHeader('Content-Type','text/html');return res.end(fixture());
  }
  if(url.pathname==='/history.php'){res.setHeader('Content-Type','text/html');return res.end(fixture('history.php'));}
  if(url.pathname==='/history-api.php') {
    const action=url.searchParams.get('action');
    if(req.method==='POST') {
      let body='';for await(const part of req){body+=part;if(body.length>10000)return json({error:'Request too large'},413);}
      let payload;try{payload=JSON.parse(body);}catch{return json({error:'Invalid JSON'},400);}
      const job=jobs.get(payload.id);if(!job)return json({error:'Test not found'},404);
      if(payload.version!==job.organization_version)return json({error:'Refresh before retrying'},409);
      if(action==='rename')job.label=String(payload.value).trim();
      else if(action==='move')job.folder=String(payload.value).trim();
      else if(action==='trash')job.deleted_at=Date.now();
      else if(action==='restore')job.deleted_at=0;
      else return json({error:'Preview does not record or upload'},403);
      job.organization_version++;return json({ok:true});
    }
    if(action==='list')return json({ok:true,jobs:[...jobs.values()].map(({metadata,manifest,...summary})=>summary)});
    const job=jobs.get(url.searchParams.get('id'));if(!job)return json({error:'Test not found'},404);
    if(action==='read')return json({ok:true,metadata:job.metadata,manifest:job.manifest,updatedAt:job.updated_at});
    if(action==='chunk')return json({ok:true,data:chunks.get(url.searchParams.get('hash'))});
    return json({error:'Unknown action'},400);
  }
  if(/^\/assets\/[\w.-]+$/.test(url.pathname) || ['/calculator.html','/recorder-report.html'].includes(url.pathname)) {
    const file=path.join(app,url.pathname);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.html')?'text/html':'image/png');return res.end(fs.readFileSync(file));
  }
  return json({error:'Local preview only; external services disabled'},403);
}).listen(49328,'127.0.0.1',()=>console.log('Current UI: http://127.0.0.1:49328 | Saved recordings: http://127.0.0.1:49328/history.php'));
