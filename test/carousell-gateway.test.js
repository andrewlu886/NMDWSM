const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const axios = require('axios');
const { createAiGateway } = require('../scripts/ai-gateway');
const { searchUsedProducts } = require('../src/services/used-search');
const token = 'b'.repeat(64);
async function withGateway(options, run) {
  const server = createAiGateway({ token, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const query = (source, data, authenticated = true) => fetch(`${base}/api/${source}/search`, { method: 'POST', headers: authenticated ? { authorization: 'Bearer ' + token } : {}, body: JSON.stringify(data) });
  try { await run(query); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('Carousell gateway authenticates and keeps each source cache separate', async () => {
  const calls = [];
  await withGateway({
    carousellSearch: async keyword => { calls.push(['carousell', keyword]); return { items: [], scanned: 12 }; },
    pttSearch: async keyword => { calls.push(['ptt', keyword]); return { items: [], scanned: 25 }; }
  }, async query => {
    assert.equal((await query('carousell', { keyword: 'rtx3060' }, false)).status, 401);
    assert.equal((await query('carousell', { keyword: 'rtx3060', url: 'https://example.test' })).status, 400);
    assert.equal((await query('constructor', { keyword: 'rtx3060' })).status, 404);
    for (let i = 0; i < 2; i++) {
      const response = await query('carousell', { keyword: 'rtx3060' });
      assert.equal(response.status, 200); assert.equal((await response.json()).scanned, 12);
    }
    assert.equal((await (await query('ptt', { keyword: 'rtx3060' })).json()).scanned, 25);
  });
  assert.deepEqual(calls, [['carousell', 'rtx3060'], ['ptt', 'rtx3060']]);
});
test('Concurrent identical Carousell searches share one browser query', async () => {
  let calls = 0; let release;
  const waiting = new Promise(resolve => { release = resolve; });
  await withGateway({ carousellSearch: async () => { calls++; await waiting; return { items: [] }; } }, async query => {
    const first = query('carousell', { keyword: '3060' });
    for (let i = 0; i < 100 && !calls; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const second = query('carousell', { keyword: '3060' });
    release();
    assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  });
  assert.equal(calls, 1);
});
test('Carousell upstream failures stay failures and are not cached as empty listings', async () => {
  let calls = 0;
  await withGateway({ carousellSearch: async () => { calls++; throw new Error('private details'); } }, async query => {
    for (let i = 0; i < 2; i++) {
      const response = await query('carousell', { keyword: '3060' });
      assert.equal(response.status, 502); assert.equal((await response.text()).includes('private details'), false);
    }
  });
  assert.equal(calls, 2);
});
test('Render transfers Carousell queries but still rejects unrelated and sold products', async () => {
  const previous = { ...process.env }; const original = axios.post; const calls = [];
  const make = (name, id) => ({ source: 'carousell', name, price: 6000, usedCondition: true, verified: true, url: `https://tw.carousell.com/p/${id}/` });
  try {
    delete process.env.CAROUSELL_GATEWAY_URL; delete process.env.CAROUSELL_GATEWAY_API_KEY;
    process.env.RENDER = 'true'; process.env.OLLAMA_BASE_URL = 'https://gateway.example.test'; process.env.OLLAMA_API_KEY = token;
    axios.post = async (...args) => { calls.push(args); return { data: { items: [make('RTX3060 顯示卡', 'card'), make('RTX3060 顯示卡已售出', 'sold'), make('RTX3060 吸塵器', 'vacuum')], scanned: 3 } }; };
    const result = await searchUsedProducts({ keyword: 'rtx3060', platforms: 'carousell' });
    assert.deepEqual(result.data.map(item => item.name), ['RTX3060 顯示卡']);
    assert.equal(result.meta.sourceStatus.carousell.status, 'ok');
    assert.equal(calls[0][0], 'https://gateway.example.test/api/carousell/search');
    assert.equal(calls[0][2].headers.Authorization, 'Bearer ' + token);
    assert.equal(calls[0][2].maxRedirects, 0);
    process.env.CAROUSELL_GATEWAY_URL = 'http://unsafe.example.test';
    assert.equal((await searchUsedProducts({ keyword: 'rtx3060', platforms: 'carousell' })).meta.sourceStatus.carousell.status, 'unavailable');
    assert.equal(calls.length, 1);
  } finally { axios.post = original; for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
});
