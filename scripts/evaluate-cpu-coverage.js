// Full known-source coverage through the real browser upload and /api/chat.
// No filename or expected SKU is sent to the recognition models.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events');
const puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..');
const cpu=require('../src/services/cpu-vision');
let uploadWorkerResult=null;
const createClient=cpu.createCpuVisionClient;
cpu.createCpuVisionClient=(...args)=>{
  const client=createClient(...args);
  return {recognize:async(...input)=>{const result=await client.recognize(...input);uploadWorkerResult=result;return result;}};
};
const api=require('../public/AiService');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
function metrics(rows,key){
  const adopted=rows.filter(row=>row[key]?.status==='verified' && row[key]?.requiresConfirmation===false);
  return {samples:rows.length,adopted:adopted.length,correct:adopted.filter(row=>row[key].model===row.truth).length,
    wrong:adopted.filter(row=>row[key].model!==row.truth).length,coverage:rows.length?adopted.length/rows.length:0,
    precision:adopted.length?adopted.filter(row=>row[key].model===row.truth).length/adopted.length:null,
    confirmationRate:rows.length?(rows.length-adopted.length)/rows.length:0,
    unreadable:rows.filter(row=>row[key]?.status==='unreadable').length,
    conflicts:rows.filter(row=>row[key]?.status==='conflict').length};
}
async function main(){
  const library=read('data/cpu-library/index.json'),entries=library.images;
  const baseline=new Map(read('.cache/cpu-library/ocr-baseline-all.json').map(row=>[row.id,row]));
  const results=[],errors=[],workerEvidence=[];let browser;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/chat')return void api.handle(req,res);
    if(url.pathname==='/api/chat/status'){res.setHeader('Content-Type','application/json');return res.end('{"available":true}');}
    if(['/chat-widget.js','/psu-flow.js','/hardware-context.js'].includes(url.pathname)){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(path.join(root,'public',url.pathname.slice(1))));}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><head><meta charset="UTF-8"></head><body><script src="/chat-widget.js"></script></body></html>');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const save=complete=>{
    const times=results.map(row=>row.elapsedMs).sort((a,b)=>a-b);
    const report={date:'2026-10-15',complete,knownSource:true,independentEvaluation:false,libraryVersion:library.version,
      comparison:'Same browser-upload pixels and Gemma observation, with previous OCR baseline versus separate-region OCR/fusion. Not an independent accuracy result.',
      totalModels:entries.length,before:metrics(results,'before'),after:metrics(results,'after'),
      latencyMs:times.length?{median:times[Math.floor(times.length*.5)],p95:times[Math.min(times.length-1,Math.ceil(times.length*.95)-1)],max:times.at(-1)}:null,
      actualRephotoRate:null,rephotoNote:'Single upload per model; actual user rephoto behaviour was not measured. confirmationRate records cases requiring a follow-up.',
      localWorkerEvidence:'.cache/cpu-library/coverage-worker-evidence.json',
      browserErrors:errors,results};
    fs.writeFileSync(path.join(root,'models/cpu-library/coverage-evaluation.json'),JSON.stringify(report,null,2));
    fs.writeFileSync(path.join(root,'.cache/cpu-library/coverage-worker-evidence.json'),JSON.stringify(workerEvidence));
    return report;
  };
  try{
    browser=await puppeteer.launch({headless:true,pipe:true,timeout:15000,args:['--disable-gpu']});
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://localhost:${server.address().port}/chat`);await page.click('.ai-chat-launcher');
    for(const entry of entries){
      uploadWorkerResult=null;
      await(await page.$('#ai-chat-image')).uploadFile(path.join(root,'data/cpu-library',entry.reference));
      await page.waitForFunction(()=>!document.querySelector('.ai-chat-preview').hidden&&document.querySelector('.ai-chat-preview img')?.naturalWidth>0);
      const started=Date.now(),pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/chat'&&r.request().method()==='POST',{timeout:70000});
      await page.evaluate(()=>{const field=document.querySelector('#ai-chat-input');field.value='請辨識這張 CPU 的完整型號';field.form.requestSubmit();});
      const response=await pending,data=await response.json();
      const after=data.cpuRecognition || {status:'unreadable',model:null,requiresConfirmation:true};
      const observation=after.evidence?.gemma?.observation || data.imageAnalysis || 'Category: CPU\nModel: unknown';
      const before=cpu.buildCpuRecognition(observation,baseline.get(entry.id)?.result);
      workerEvidence.push({id:entry.id,truth:entry.model,observation,worker:uploadWorkerResult});
      const compact=value=>value?{status:value.status,model:value.model,candidates:value.candidates,requiresConfirmation:value.requiresConfirmation,
        verificationMethod:value.evidence?.verificationMethod,failureReason:value.evidence?.failureReason}:null;
      results.push({id:entry.id,truth:entry.model,kind:entry.kind,relative:entry.relative,elapsedMs:Date.now()-started,success:data.success,
        answer:data.answer,before:compact(before),after:compact(after),gemma:after.evidence?.gemma,regions:after.evidence?.regions,
        failure:data.message,ocrText:after.evidence?.text});
      await page.waitForFunction(()=>!document.querySelector('#ai-chat-input').disabled);
      if(results.length%10===0){const report=save(false);console.log(JSON.stringify({done:results.length,total:entries.length,before:report.before,after:report.after}),null,0);}
    }
    const report=save(true);console.log(JSON.stringify({complete:true,before:report.before,after:report.after,errors:errors.length}));
    if(errors.length||results.some(row=>!row.success)||report.after.wrong)process.exitCode=1;
  }finally{save(results.length===entries.length);if(browser)await browser.close();cpu.stopWorker();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.message);cpu.stopWorker();process.exitCode=1;});
