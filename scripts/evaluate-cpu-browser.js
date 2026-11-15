// Local browser upload smoke test; known-source photos are never independent accuracy evidence.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..');
const { handleCpuReferenceRequest } = require('../src/services/cpu-library');
const cpu = require('../src/services/cpu-vision');
const api = require('../public/AiService');
async function main() {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'data/cpu-library/index.json')));
  const sku = process.argv[2] || 'i5-12400F';
  const sceneFlag=process.argv.find(arg=>arg.startsWith('--scene-index='));
  const sceneIndex=sceneFlag ? Number(sceneFlag.split('=')[1]) : null;
  const reference = sceneFlag ? JSON.parse(fs.readFileSync(path.join(root,'data/cpu-library/catalog.json'),'utf8')).images[sceneIndex] : index.images.find(row => row.model === sku);
  if (!reference) throw Error('No curated fixture for ' + sku);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (handleCpuReferenceRequest(req, res, url)) return;
    if (url.pathname === '/api/chat') return void api.handle(req, res);
    if (url.pathname === '/api/chat/status') { res.setHeader('Content-Type', 'application/json'); return res.end('{"available":true}'); }
    const files = {'/chat-widget.js':'chat-widget.js','/hardware-context.js':'hardware-context.js','/psu-flow.js':'psu-flow.js','/cpu-library.html':'cpu-library.html','/cpu-library.js':'cpu-library.js'};
    if (files[url.pathname]) { res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8'); return res.end(fs.readFileSync(path.join(root,'public',files[url.pathname]))); }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<html><head><meta charset="UTF-8"></head><body><script src="/chat-widget.js"></script></body></html>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  const results = []; let photoBytes;
  try {
    browser = await puppeteer.launch({headless:true,pipe:true,timeout:15000,args:['--disable-gpu']});
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://localhost:${server.address().port}/chat`);
    await page.click('.ai-chat-launcher');
    for (const mode of ['original','repeat','blurred',...(process.argv.includes('--conflict')?['conflicting_labels']:[])]) {
      await (await page.$('#ai-chat-image')).uploadFile(path.join(root,'data/cpu-library',reference.reference));
      await page.waitForSelector('.ai-chat-preview img');
      if (mode === 'blurred') {
        await page.evaluate(async base64 => {
          const bitmap=await createImageBitmap(await (await fetch('data:image/jpeg;base64,'+base64)).blob());
          const small=document.createElement('canvas');small.width=small.height=12;small.getContext('2d').drawImage(bitmap,0,0,12,12);bitmap.close();
          const canvas=document.createElement('canvas');canvas.width=canvas.height=600;canvas.getContext('2d').drawImage(small,0,0,600,600);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
          const transfer=new DataTransfer();transfer.items.add(new File([blob],'blurred-test.jpg',{type:'image/jpeg'}));
          const input=document.querySelector('#ai-chat-image');input.files=transfer.files;input.dispatchEvent(new Event('change'));
        }, fs.readFileSync(path.join(root,'data/cpu-library',reference.reference)).toString('base64'));
        await page.waitForFunction(()=>document.querySelector('.ai-chat-preview')?.textContent.includes('blurred-test.jpg'));
      }
      if (mode === 'conflicting_labels') {
        const first=index.images.find(row=>row.model==='i5-14400');
        const other=index.images.find(row=>row.model==='i5-14400F' && row.model!==sku);
        if(!first||!other)throw Error('Missing two-label fixtures');
        await page.evaluate(async images=>{
          const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600;
          const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,600);
          for(let i=0;i<images.length;i++){
            const bitmap=await createImageBitmap(await(await fetch('data:image/jpeg;base64,'+images[i].bytes)).blob());
            const [x,y,width,height]=images[i].box.map((v,n)=>v*(n%2===0?bitmap.width:bitmap.height));
            const scale=Math.min(1,600/width,600/height),w=width*scale,h=height*scale;
            ctx.drawImage(bitmap,x,y,width,height,i*600+(600-w)/2,(600-h)/2,w,h);bitmap.close();
          }
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
          const transfer=new DataTransfer();transfer.items.add(new File([blob],'two-cpus-test.jpg',{type:'image/jpeg'}));
          const input=document.querySelector('#ai-chat-image');input.files=transfer.files;input.dispatchEvent(new Event('change'));
        },[first,other].map(row=>({box:row.labelBox,bytes:fs.readFileSync(path.join(root,'data/cpu-library',row.reference)).toString('base64')})));
        await page.waitForFunction(()=>document.querySelector('.ai-chat-preview')?.textContent.includes('two-cpus-test.jpg'));
      }
      if(mode==='original')await page.screenshot({path:path.join(root,'.cache/cpu-library/upload-preview.png'),fullPage:true});
      const started=Date.now();
      const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/chat' && r.request().method()==='POST',{timeout:100000});
      await page.evaluate(()=>{const input=document.querySelector('#ai-chat-input');input.value='請辨識CPU完整型號';input.form.requestSubmit();});
      const response=await pending, data=await response.json();
      if(mode==='original') photoBytes=JSON.parse(response.request().postData()).messages.at(-1).images[0];
      results.push({mode,elapsedMs:Date.now()-started,success:data.success,answer:data.answer,status:data.cpuRecognition?.status,
        model:data.cpuRecognition?.model,candidates:data.cpuRecognition?.candidates,requiresConfirmation:data.cpuRecognition?.requiresConfirmation,
        verificationMethod:data.cpuRecognition?.evidence?.verificationMethod,
        evidence:data.cpuRecognition?.evidence,
        selectedRegion:data.cpuRecognition?.evidence?.regions?.find(region=>region.id===data.cpuRecognition?.evidence?.selectedRegionId),
        timingMs:data.cpuRecognition?.timingMs,message:data.message});
      const {evidence,...diagnostic}=results.at(-1);console.log(JSON.stringify(diagnostic));
      await page.waitForFunction(()=>!document.querySelector('#ai-chat-input').disabled);
    }
    await page.screenshot({path:path.join(root,'.cache/cpu-library/browser-smoke.png'),fullPage:true});
    let baseline = null;
    if (process.argv.includes('--deep-baseline')) {
      const started=Date.now(); let calls=0;
      const request=async(route,options)=>{calls++;return fetch('http://127.0.0.1:11434'+route,options);};
      const response=await request('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),
        body:JSON.stringify({model:'gemma3:4b',stream:false,keep_alive:'10m',options:{temperature:0,num_predict:160},messages:[{role:'user',images:[photoBytes],content:'Inspect this CPU photo. Verify the actual hardware category first. Return only four lines: Category: CPU|graphics card|motherboard|memory|unknown, Model: full visible model or unknown, Evidence: exact printed text, Confidence: high|low. Preserve every digit and suffix. Never infer a model from appearance or invent missing text.'}]})});
      const observation=(await response.json()).message.content;
      const result=await cpu.recognizeLocalCpu(photoBytes,{gemmaObservation:observation,timeoutMs:30000});
      let recognition;
      await cpu.collaborateCpuAnalysis(observation,result,request,{image:photoBytes,deepReview:true,signal:AbortSignal.timeout(90000),onRecognition:r=>{recognition=r;}});
      baseline={description:'Legacy sequential dialogue topology with current stricter OCR policy; timing diagnostic only',elapsedMs:Date.now()-started,llmCalls:calls,status:recognition?.status,model:recognition?.model,observation:observation.slice(0,1000)};
      console.log(JSON.stringify({baseline}));
    }
    const report={date:'2026-10-15',knownSource:true,independentEvaluation:false,sku,sceneIndex,relative:reference.relative,libraryVersion:index.version,results,baseline,browserErrors:errors};
    fs.writeFileSync(path.join(root,`models/cpu-library/browser-evaluation-${sku.replace(/[^a-z0-9-]/gi,'_')}${sceneFlag?`-scene${sceneIndex}`:''}.json`),JSON.stringify(report,null,2));
    if(errors.length || results.some(r=>!r.success || (r.mode!=='conflicting_labels' && r.status==='verified' && r.model!==sku)) || results.find(r=>r.mode==='blurred')?.requiresConfirmation!==true
      || results.some(r=>r.mode==='conflicting_labels' && r.requiresConfirmation!==true)) process.exitCode=1;
  } finally { if(browser) await browser.close(); cpu.stopWorker(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error.message);cpu.stopWorker();process.exitCode=1;});
