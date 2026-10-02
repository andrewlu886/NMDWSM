const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createRequire } = require('node:module');
const { createMarketCache } = require('../src/services/market-cache');
function service(vision = 'Category: GPU\nModel: ASUS RTX 4070 Ti\nConfidence: high') {
  const queries = [];
  const requireAi = createRequire(path.resolve('public/AiService.js'));
  const context = {
    require: name =>
      name === '../src/services/search'
        ? {
            searchProductsWithMeta: async options => {
              queries.push(options);
              return {
                data: [
                  {
                    name: 'ASUS RTX 4070 Ti 顯示卡',
                    price: '25000',
                    platform: 'PChome',
                    url: 'https://24h.pchome.com.tw/prod/TEST'
                  }
                ],
                meta: { updatedAt: 1800000000000 }
              };
            }
          }
        : name === '../src/services/ollama-client'
          ? {
              createOllamaClient: () => ({
                serviceMode: 'local',
                request: async route => ({
                  ok: true,
                  json: async () =>
                    route === '/api/tags'
                      ? { models: [{ name: 'gemma3:4b' }] }
                      : { message: { content: vision } }
                })
              })
            }
          : name === 'fs'
            ? { existsSync: () => true, appendFile: () => {} }
            : requireAi(name),
    module: { exports: {} },
    __dirname: path.resolve('public'),
    process: { env: {} },
    console,
    URL,
    AbortController,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(fs.readFileSync('public/AiService.js', 'utf8'), context);
  return { api: context.module.exports, queries };
}
async function ask(api, body) {
  let result;
  await api.handle(Readable.from([JSON.stringify(body)]), {
    writeHead: status => assert.equal(status, 200),
    end: text => {
      result = JSON.parse(text);
    }
  });
  return result;
}
test('market intent searches the entered product, ignoring older conversation models', async () => {
  const { api, queries } = service();
  const answer = await ask(api, {
    intent: 'market',
    messages: [
      { role: 'user', content: 'RTX 5070' },
      { role: 'user', content: '查詢 ASUS RTX 4070 Ti 的市價' }
    ]
  });
  assert.equal(queries[0].keyword, 'ASUS RTX 4070 Ti');
  assert.equal(queries[0].forceRefresh, true);
  assert.match(
    answer.answer,
    /\[ASUS RTX 4070 Ti 顯示卡\]\(https:\/\/24h.pchome.com.tw\/prod\/TEST\)/
  );
  assert.match(answer.answer, /資料更新時間/);
});
test('market photo searches the identified model and does not reuse old text keywords', async () => {
  const { api, queries } = service();
  const answer = await ask(api, {
    intent: 'market',
    messages: [
      { role: 'user', content: 'RTX 5070' },
      { role: 'user', content: '請查詢照片中產品的資訊與市價', images: ['aGVsbG8='] }
    ]
  });
  assert.equal(queries[0].keyword, 'ASUS RTX 4070 Ti');
  assert.match(answer.imageAnalysis, /ASUS RTX 4070 Ti/);
  assert.equal(answer.provider, 'tools');
});
test('unreadable photo asks for clarification without performing a market search', async () => {
  const { api, queries } = service('Category: GPU\nModel: unknown\nEvidence: RTX 4070 maybe');
  const answer = await ask(api, {
    intent: 'market',
    messages: [{ role: 'user', content: '請查詢照片中產品的資訊與市價', images: ['aGVsbG8='] }]
  });
  assert.equal(queries.length, 0);
  assert.match(answer.answer, /型號不夠清楚/);
});
test('general product names are preserved and empty market queries ask for a product', async () => {
  const { api, queries } = service();
  await ask(api, {
    intent: 'market',
    messages: [{ role: 'user', content: 'Kingston Fury DDR5 32GB' }]
  });
  assert.equal(queries[0].keyword, 'Kingston Fury DDR5 32GB');
  assert.equal(api.getMarketQueryKeyword('我要查詢市價'), null);
});
test('fresh lookup bypasses daily cache and failed refresh is explicitly marked stale', async () => {
  let calls = 0;
  let failure = false;
  const cache = createMarketCache({
    cachePath: null,
    scrape: async () => {
      if (failure) throw Error('offline');
      return [{ name: 'product ' + ++calls }];
    }
  });
  await cache.get('RTX 4070');
  await cache.get('RTX 4070');
  assert.equal(calls, 1);
  const fresh = await cache.get('RTX 4070', 'all', { forceRefresh: true });
  assert.equal(calls, 2);
  assert.equal(fresh.meta.cached, false);
  failure = true;
  const stale = await cache.get('RTX 4070', 'all', { forceRefresh: true });
  assert.equal(stale.meta.stale, true);
});


test('photo lookup without a quick-action intent uses this photo rather than previous CPU or GPU models', async () => {
  const { api, queries } = service('Category: GPU\nModel: GIGABYTE RTX 5060\nConfidence: high');
  const answer = await ask(api, {
    messages: [
      { role: 'user', content: '查詢 i5 14400 的市價' },
      { role: 'assistant', content: '上一張照片是 RTX 4070' },
      { role: 'user', content: '請查詢照片中產品的資訊與市價', images: ['aGVsbG8='] }
    ]
  });
  assert.equal(queries[0].keyword, 'GIGABYTE RTX 5060');
  assert.equal(queries[0].forceRefresh, true);
  assert.equal(answer.provider, 'tools');
  assert.doesNotMatch(answer.answer, /型號辨識尚未確認|i5 14400/);
});

test('unreadable new photo cannot fall back to a previous product without a quick-action intent', async () => {
  const { api, queries } = service('Category: GPU\nModel: unknown\nConfidence: low');
  const answer = await ask(api, {
    messages: [
      { role: 'user', content: '查詢 RTX 5060 市價' },
      { role: 'user', content: '請查詢照片中產品的資訊與市價', images: ['aGVsbG8='] }
    ]
  });
  assert.equal(queries.length, 0);
  assert.match(answer.answer, /型號不夠清楚/);
  assert.doesNotMatch(answer.answer, /查詢 RTX 5060/);
});


test('confirmation in market mode queries the previous identified product rather than the word yes', async () => {
  const { api, queries } = service();
  await ask(api, { intent: 'market', messages: [
    { role: 'user', content: '請查詢照片中產品的資訊與市價' },
    { role: 'assistant', content: '照片辨識到 RTX 5060，請確認' },
    { role: 'user', content: '是' }
  ] });
  assert.equal(queries[0].keyword, 'RTX 5060');
});

test('generic image recognition request in market mode uses the new photo model', async () => {
  const { api, queries } = service();
  await ask(api, { intent: 'market', messages: [
    { role: 'user', content: '請辨識這張硬體圖片', images: ['aGVsbG8='] }
  ] });
  assert.equal(queries[0].keyword, 'ASUS RTX 4070 Ti');
});
