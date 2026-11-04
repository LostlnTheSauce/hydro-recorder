// Local, practice-only preview. No PHP config, accounts, credentials or live API access.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {fixture}=require('./workflow-browser.test.cjs');
const root=path.resolve(__dirname,'..');
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'||url.pathname==='/host.php') {
    if(url.searchParams.get('demo')!=='1'){res.writeHead(302,{Location:'/host.php?demo=1'});return res.end();}
    res.setHeader('content-type','text/html');return res.end(fixture().replace('href="?logout=1"','href="/host.php?demo=1"'));
  }
  const name=url.pathname;
  if(!/^\/assets\/[\w.-]+$/.test(name)&&!['/calculator.html','/recorder-report.html'].includes(name)) {res.writeHead(404);return res.end('Practice preview only.');}
  const file=path.join(root,name);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('content-type',name.endsWith('.css')?'text/css':/\.m?js$/.test(name)?'text/javascript':name.endsWith('.html')?'text/html':'image/png');res.end(fs.readFileSync(file));
}).listen(49328,'127.0.0.1',()=>console.log('Practice preview: http://127.0.0.1:49328/host.php?demo=1'));
