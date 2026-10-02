const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createRequire } = require('node:module');
const { createMarketCache } = require('../src/services/market-cache');
function service(vision = 'Category: graphics card\nModel: ASUS RTX 4070 SUPER\nConfidence: high') {
  const queries = [];
  const requireAi = createRequire(path.resolve('public/AiService.js'));
  const context = {
    require: name => name === '../src/services/search' ? { searchProductsWithMeta: async options => {
      queries.push(options);
      return { data: [{ name: '測試商品', price: '25000', platform: 'PChome', url: 'https://24h.pchome.com.tw/prod/TEST' }], meta: { updatedAt: 1800000000000, stale: false } };
    } } : name === '../src/services/ollama-client' ? { createOllamaClient: () => ({serviceMode:'shared',request:async route => ({ok:true,json:async()=>route==='/api/tags'?{models:[{name:'gemma3:4b'}]}:{message:{content:vision}}})}) }
      : name === 'fs' ? {existsSync:()=>true,appendFile:()=>{}} : requireAi(name),
    module:{exports:{}},__dirname:path.resolve('public'),process:{env:{}},console,URL,AbortController,setTimeout,clearTimeout
  };
  vm.runInNewContext(fs.readFileSync('public/AiService.js','utf8'),context);
  return { queries, async ask(content, images) {
    let result;
    const req=Readable.from([JSON.stringify({intent:'market',messages:[{role:'user',content,...(images?{images}:{})}]})]);
    await context.module.exports.handle(req,{writeHead:code=>assert.equal(code,200),end:body=>{result=JSON.parse(body);}});
    return result;
  } };
}
test('explicit market queries preserve full product names and force current prices with links',async()=>{
 const agent=service();const result=await agent.ask('查詢 ASUS TUF RTX 4070 SUPER 的目前資訊與市價');
 assert.equal(agent.queries[0].keyword,'ASUS TUF RTX 4070 SUPER');assert.equal(agent.queries[0].forceRefresh,true);
 assert.match(result.answer,/\[測試商品\]\(https:\/\/24h.pchome.com.tw\/prod\/TEST\)/);assert.match(result.answer,/25000/);assert.match(result.answer,/資料更新時間/);
});
test('clear product images search their identified model directly',async()=>{
 const agent=service();const result=await agent.ask('請查詢照片中產品的資訊與市價',['aGVsbG8=']);
 assert.equal(agent.queries[0].keyword,'ASUS RTX 4070 SUPER');assert.match(result.answer,/通路結果/);assert.ok(result.imageAnalysis);
});
test('unreadable or low-confidence photos ask for a better image without guessing prices',async()=>{
 for(const analysis of ['Model: unknown\nConfidence: low','Model: RTX 4070\nConfidence: low']){
  const agent=service(analysis);const result=await agent.ask('請查詢照片中產品的資訊與市價',['aGVsbG8=']);
  assert.equal(agent.queries.length,0);assert.match(result.answer,/型號不夠清楚/);
 }
});
test('user-provided product name overrides unclear image recognition',async()=>{
 const agent=service('Model: unknown');await agent.ask('MSI RTX 5070',['aGVsbG8=']);assert.equal(agent.queries[0].keyword,'MSI RTX 5070');
});
test('latest corrected model is used and generic product prompts ask for detail',async()=>{
 const agent=service();await agent.ask('不是 RTX 4070，改成 RTX 5070');assert.equal(agent.queries[0].keyword,'RTX 5070');
 const empty=service();assert.match((await empty.ask('查詢產品')).answer,/請輸入想查詢/);assert.equal(empty.queries.length,0);
});
test('explicit fresh searches bypass the daily cache and flag stale fallback on failure',async()=>{
 let calls=0,fail=false;const cache=createMarketCache({cachePath:null,scrape:async()=>{calls++;if(fail)throw Error('offline');return [{name:'商品'+calls}];}});
 await cache.get('RTX 5070',['pchome']);await cache.get('RTX 5070',['pchome']);assert.equal(calls,1);
 const fresh=await cache.get('RTX 5070',['pchome'],{forceRefresh:true});assert.equal(calls,2);assert.equal(fresh.meta.cached,false);
 fail=true;const stale=await cache.get('RTX 5070',['pchome'],{forceRefresh:true});assert.equal(stale.meta.stale,true);assert.equal(stale.products[0].name,'商品2');
});
