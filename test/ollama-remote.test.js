const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createOllamaClient}=require('../src/services/ollama-client');
const {createAiGateway}=require('../scripts/ai-gateway');
const token='a'.repeat(64);
test('remote client authenticates tags and chat without forwarding redirects',async()=>{
  const calls=[];
  const client=createOllamaClient({OLLAMA_BASE_URL:'https://ai.example.test/',OLLAMA_API_KEY:token,OLLAMA_CF_ACCESS_CLIENT_ID:'client',OLLAMA_CF_ACCESS_CLIENT_SECRET:'secret'},async(url,options)=>{calls.push({url,options});return {ok:true};});
  await client.request('/api/tags');await client.request('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(client.serviceMode,'shared');assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.options.headers.get('authorization'),'Bearer '+token);assert.equal(call.options.headers.get('CF-Access-Client-Id'),'client');assert.equal(call.options.headers.get('CF-Access-Client-Secret'),'secret');assert.equal(call.options.redirect,'error');}
  assert.equal(calls[0].url,'https://ai.example.test/api/tags');assert.equal(calls[1].options.headers.get('content-type'),'application/json');
});
test('remote configuration rejects plaintext, missing authentication and partial Access credentials',async()=>{
  let called=false;const fetchImpl=async()=>{called=true;};
  for(const env of [{OLLAMA_BASE_URL:'http://ai.example.test',OLLAMA_API_KEY:token},{OLLAMA_BASE_URL:'https://ai.example.test'},{OLLAMA_BASE_URL:'https://ai.example.test',OLLAMA_CF_ACCESS_CLIENT_ID:'client'}]){
    await assert.rejects(createOllamaClient(env,fetchImpl).request('/api/tags'));
  }
  assert.equal(called,false);
  const local=createOllamaClient({},async()=>({ok:true}));assert.equal(local.serviceMode,'local');await local.request('/api/tags');
});
async function withGateway(fetchImpl,run,options={}){
  const server=createAiGateway({token,fetchImpl,...options});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run('http://127.0.0.1:'+server.address().port);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('gateway rejects unauthenticated calls and model-management endpoints',async()=>{
 let calls=0;
 await withGateway(async()=>{calls++;return {ok:true,json:async()=>({models:[]})};},async base=>{
   assert.equal((await fetch(base+'/api/tags')).status,401);
   assert.equal((await fetch(base+'/api/tags',{headers:{authorization:'Bearer wrong'}})).status,401);
   assert.equal((await fetch(base+'/api/pull',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'})).status,404);
   assert.equal((await fetch(base+'/api/tags',{headers:{authorization:'Bearer '+token}})).status,200);
 });assert.equal(calls,1);
});
test('gateway forwards text and image chat, but keeps its secret out of Ollama',async()=>{
 const calls=[];
 await withGateway(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({message:{content:'回答'}})};},async base=>{
  for(const model of ['llama3.1:8b','gemma3:4b']){
   const data={model,messages:[{role:'user',content:'問題',...(model==='gemma3:4b'?{images:['aGVsbG8=']}:{})}]};
   const response=await fetch(base+'/api/chat',{method:'POST',headers:{authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});
   assert.equal(response.status,200);assert.equal((await response.json()).message.content,'回答');
  }
  for(const body of ['not json',JSON.stringify({model:'other',messages:[]}),JSON.stringify({model:'llama3.1:8b',messages:[],stream:true})]){
   assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{authorization:'Bearer '+token},body})).status,400);
  }
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{authorization:'Bearer '+token},body:'x'.repeat(3000001)})).status,413);
 });
 assert.equal(calls.length,2);for(const call of calls){assert.equal(call.url,'http://127.0.0.1:11434/api/chat');assert.equal(call.options.headers.authorization,undefined);assert.equal(JSON.parse(call.options.body).stream,false);}
 assert.deepEqual(JSON.parse(calls[1].options.body).messages[0].images,['aGVsbG8=']);
});
test('gateway limits parallel requests and releases a slot after an upstream failure',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve;});let calls=0;
 await withGateway(async()=>{calls++;await waiting;throw new Error('private upstream detail');},async base=>{
  const first=fetch(base+'/api/tags',{headers:{authorization:'Bearer '+token}});
  for(let i=0;i<100&&calls===0;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal((await fetch(base+'/api/tags',{headers:{authorization:'Bearer '+token}})).status,503);
  release();const failed=await first;assert.equal(failed.status,502);assert.equal((await failed.text()).includes('private upstream detail'),false);
  assert.equal((await fetch(base+'/api/tags',{headers:{authorization:'Bearer '+token}})).status,502);
 },{maxConcurrent:1});
});
test('AI service uses authenticated remote requests for status, text and vision without exposing credentials',async()=>{
 const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {Readable}=require('node:stream');const {createRequire}=require('node:module');
 const requireAi=createRequire(path.resolve('public/AiService.js'));const calls=[];
 const client=createOllamaClient({OLLAMA_BASE_URL:'https://ai.example.test',OLLAMA_API_KEY:token},async(url,options)=>{
  calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/api/tags')?{models:[{name:'llama3.1:8b'},{name:'gemma3:4b'}]}:{message:{role:'assistant',content:'測試模型回覆'}}};
 });
 const context={require:name=>name==='../src/services/ollama-client'?{createOllamaClient:()=>client}:name==='fs'?{existsSync:()=>true,appendFile:()=>{}}:requireAi(name),module:{exports:{}},__dirname:path.resolve('public'),process:{env:{}},console,URL,AbortController,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync('public/AiService.js','utf8'),context);
 const status=await context.module.exports.getStatus();assert.equal(status.available,true);assert.equal(status.serviceMode,'shared');assert.equal(status.visionModelInstalled,true);assert.equal(JSON.stringify(status).includes(token),false);
 for(const {content,image,expectedProvider} of [
  {content:'你好',image:false,expectedProvider:'conversation'},
  {content:'你好，我想找電腦推薦',image:false,expectedProvider:'ollama'},
  {content:'你好',image:true,expectedProvider:'ollama'}
 ]){
  let result;const req=Readable.from([JSON.stringify({messages:[{role:'user',content,...(image?{images:['aGVsbG8=']}:{})}]})]);
  await context.module.exports.handle(req,{writeHead:code=>assert.equal(code,200),end:body=>{result=JSON.parse(body);}});
  assert.equal(result.success,true);assert.equal(result.provider,expectedProvider);
  assert.equal(result.answer,expectedProvider==='conversation'?context.module.exports.getConversationalReply(content):'測試模型回覆');
 }
 assert.ok(calls.some(call=>call.options.body&&JSON.parse(call.options.body).model==='gemma3:4b'));
 for(const call of calls)assert.equal(call.options.headers.get('authorization'),'Bearer '+token);
});

test('short social and off-topic turns use a consistent reply without swallowing hardware requests',()=>{
 const {getConversationalReply}=require('../public/AiService');
 for(const message of ['你好！','你是誰？','你是啥','Hello','謝謝你','掰掰','今天天氣如何？','誰是周杰倫？','測試','手機可以估價嗎']){
  assert.ok(getConversationalReply(message),message);
 }
 for(const message of ['你好，我想查 RTX 5060 市價','謝謝，順便幫我算 650W 夠不夠','筆電推薦','手機跟顯卡都想估價']){
  assert.equal(getConversationalReply(message),null,message);
 }
});
