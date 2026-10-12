const assert=require('node:assert/strict'), http=require('node:http'),path=require('node:path'),{spawn}=require('node:child_process');
const bridge=path.resolve(__dirname,'..');
const calls=[];
const server=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const payload=JSON.parse(body),action=new URL(req.url,'http://localhost').searchParams.get('action');calls.push({action,payload});
    res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,accepted:payload.samples?.length}));
  });
});
server.listen(0,'127.0.0.1',()=>{
  const child=spawn(path.join(bridge,'ClosedRunTests.exe'),[`http://127.0.0.1:${server.address().port}`,'C:\\Program Files (x86)\\MadgeTech\\MadgeTech 4'],{stdio:'inherit'});
  child.on('error',e=>{console.error(e);process.exitCode=1;server.close();});
  child.on('exit',code=>{
    try {
      assert.equal(code,0);assert.equal(calls.length,2);
      assert.equal(calls[0].action,'device_ingest');assert.equal(calls[0].payload.source_id,'bbbbbbbbbbbbbbbb');
      assert.deepEqual(calls[0].payload.samples.map(s=>s.at),[100,200]);
      assert.equal(calls[1].action,'device_complete');assert.equal(calls[1].payload.source_id,'bbbbbbbbbbbbbbbb');
      console.log('HTTP fixture verified: old window only, no pre/post-window samples, no duplicate replay or current-source writes.');
    }catch(e){console.error(e);process.exitCode=1;}finally{server.close();}
  });
});
