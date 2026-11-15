const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

test('CPU upload preserves the full image; structured verification advances valuation, conflicts do not', {timeout:60000}, async()=>{
  const browser=await puppeteer.launch({headless:true,pipe:true,timeout:15000,args:['--disable-gpu']});
  try {
    const page=await browser.newPage(), errors=[], bodies=[], lookups=[];
    let recognition={schemaVersion:1,policyVersion:'text-first-v2',status:'verified',model:'i7-12700F',candidates:['i7-12700F'],requiresConfirmation:false,evidence:{text:['i7-12700F']}};
    page.on('pageerror',e=>errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request',request=>{
      const url=new URL(request.url());let contentType='text/plain',body='';
      if(url.pathname==='/chat'){contentType='text/html';body='<html><head><meta charset="UTF-8"></head><body><script src="/chat-widget.js"></script></body></html>';}
      else if(['/chat-widget.js','/psu-flow.js','/hardware-context.js'].includes(url.pathname)){contentType='application/javascript';body=fs.readFileSync(path.join(__dirname,'../public',url.pathname.slice(1)),'utf8');}
      else if(url.pathname.startsWith('/api/')){
        contentType='application/json';
        if(url.pathname==='/api/chat') bodies.push(JSON.parse(request.postData()));
        if(url.pathname==='/api/valuation/models') lookups.push(url.search);
        body=JSON.stringify(url.pathname==='/api/cpu-data'?[{'CPU型號':'i7-12700F',PL2:180}]:url.pathname==='/api/chat/status'?{available:true}:{success:true,data:[],answer:'這是 i7-12700F',
          ...(url.pathname==='/api/chat'?{imageAnalysis:'Category: CPU\nModel: i5-12400\nConfidence: high',cpuRecognition:recognition}:{})});
      }
      request.respond({status:200,contentType,body}).catch(()=>{});
    });
    await page.goto('http://localhost:3999/chat');await page.click('.ai-chat-launcher');
    const send=text=>page.evaluate(value=>{const input=document.querySelector('#ai-chat-input');input.value=value;input.form.requestSubmit();},text);
    const reply=()=>page.$eval('.ai-chat-message.assistant:last-child',node=>node.textContent);
    const upload=async(paste=false)=>{
      await page.evaluate(async isPaste=>{
        const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,400,400);ctx.fillStyle='#0000ff';ctx.fillRect(400,0,400,400);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95));
        const transfer=new DataTransfer();transfer.items.add(new File([blob],'pixel-test.jpg',{type:'image/jpeg'}));
        if(isPaste) document.querySelector('#ai-chat-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
        else {const input=document.querySelector('#ai-chat-image');input.files=transfer.files;input.dispatchEvent(new Event('change'));}
      },paste);
      await page.waitForFunction(()=>!document.querySelector('.ai-chat-preview').hidden&&document.querySelector('.ai-chat-preview img')?.naturalWidth>0);
    };
    await send('我要二手估價');await send('cpu');await upload();
    assert.equal(await page.$('.ai-chat-photo-hint'),null);
    assert.deepEqual(await page.$$eval('.ai-chat-preview button',buttons=>buttons.map(button=>button.textContent)),['移除']);
    await send('');await page.waitForFunction(()=>!document.querySelector('#ai-chat-input').disabled);
    assert.match(await reply(),/保固|使用/);
    assert.match(await page.$eval('.ai-chat-messages',n=>n.textContent),/已辨識型號「i7-12700F」/);
    assert.equal(await page.$('.ai-cpu-recognition'),null,'recognition appears only in the normal chat reply');
    assert.doesNotMatch(await page.$eval('.ai-chat-messages',n=>n.textContent),/查看上傳照片的文字證據|標籤參考|全部圖片（本機）/);
    assert.equal(bodies.at(-1).imageIntent,'cpu');
    const pixels=await page.evaluate(async base64=>{
      const bitmap=await createImageBitmap(await(await fetch('data:image/jpeg;base64,'+base64)).blob());
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      return {width:canvas.width,height:canvas.height,left:[...ctx.getImageData(100,200,1,1).data],right:[...ctx.getImageData(600,200,1,1).data]};
    },bodies.at(-1).messages.at(-1).images[0]);
    assert.equal(pixels.width,800);assert.equal(pixels.height,400);assert.ok(pixels.left[0]>240&&pixels.left[2]<10);assert.ok(pixels.right[2]>240&&pixels.right[0]<10);
    recognition={...recognition,status:'conflict',model:null,candidates:['i5-12400','i5-12400F'],requiresConfirmation:true};
    await send('我要二手估價');await send('cpu');await upload();await send('');
    await page.waitForFunction(()=>!document.querySelector('#ai-chat-input').disabled);
    assert.match(await reply(),/判讀有分歧/);const before=lookups.length;
    await send('是');assert.match(await reply(),/多個候選/);assert.equal(lookups.length,before);
    recognition={...recognition,status:'verified',model:'i7-12700F',candidates:['i7-12700F'],requiresConfirmation:false};
    await send('我要算瓦數');await upload();await send('');
    await page.waitForFunction(()=>!document.querySelector('#ai-chat-input').disabled);
    assert.match(await reply(),/GPU型號/,'verified CPU photo advances the power wizard');
    assert.equal(bodies.at(-1).imageIntent,'cpu');
    recognition={...recognition,status:'conflict',model:null,candidates:['i5-12400','i5-12400F'],requiresConfirmation:true};
    await send('我要算瓦數');await upload();await send('');
    await page.waitForFunction(()=>!document.querySelector('#ai-chat-input').disabled);
    await send('是');assert.match(await reply(),/多個候選/,'yes cannot choose one conflicting power-wizard candidate');
    await page.click('.ai-chat-clear');
    const beforePaste=bodies.length;
    await page.$eval('#ai-chat-input',field=>{field.value='幫我看這張圖片';});
    await upload(true);
    assert.equal(bodies.length,beforePaste,'pasting an image only prepares a preview, without uploading');
    assert.equal(await page.$eval('#ai-chat-input',field=>field.value),'幫我看這張圖片','pasting keeps the typed caption');
    await page.evaluate(()=>[...document.querySelectorAll('.ai-chat-preview button')].find(button=>button.textContent==='移除').click());
    assert.equal(await page.$('.ai-chat-preview img'),null,'pasted image can be removed before sending');
    await upload(true);
    assert.equal(bodies.length,beforePaste);
    await send('幫我看這張圖片');
    await page.waitForFunction(()=>!document.querySelector('#ai-chat-input').disabled);
    assert.equal(bodies.length,beforePaste+1,'only explicit submit uploads the pasted image');
    assert.equal(bodies.at(-1).messages.at(-1).content,'幫我看這張圖片');
    assert.ok(bodies.at(-1).messages.at(-1).images[0]);
    assert.equal(await page.$eval('#ai-chat-input',field=>{
      const clipboard=new DataTransfer();clipboard.setData('text/plain','一般文字');
      return field.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
    }),true,'plain text paste is not prevented');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
