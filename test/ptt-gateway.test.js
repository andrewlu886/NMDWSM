const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createAiGateway } = require('../scripts/ai-gateway');
const { searchUsedProducts } = require('../src/services/used-search');
const axios = require('axios');
const token = 'a'.repeat(64);
async function withGateway(pttSearch, run) {
  const server = createAiGateway({ token, pttSearch, fetchImpl: async () => ({ ok: true, json: async () => ({ models: [] }) }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const query = (body, authenticated = true) => fetch(base + '/api/ptt/search', { method: 'POST', headers: authenticated ? { authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) });
  try { await run(query, base); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('PTT gateway authenticates, rejects arbitrary URLs and caches successful searches', async () => {
  const calls = [];
  await withGateway(async keyword => { calls.push(keyword); return { items: [], scanned: 3 }; }, async query => {
    assert.equal((await query({ keyword: 'rtx4080' }, false)).status, 401);
    for (const body of [{ keyword: '' }, { keyword: 'a'.repeat(81) }, { keyword: '4080', url: 'http://localhost' }]) assert.equal((await query(body)).status, 400);
    for (let i = 0; i < 2; i++) {
      const response = await query({ keyword: ' rtx4080 ' });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { items: [], scanned: 3 });
    }
  });
  assert.deepEqual(calls, ['rtx4080']);
});
test('PTT failures do not leak details or consume AI capacity', async () => {
  let release; let calls = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  await withGateway(async () => { calls++; await waiting; throw new Error('private detail'); }, async (query, base) => {
    const first = query({ keyword: '4080' });
    const second = query({ keyword: '4060' });
    for (let i = 0; i < 100 && calls < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await query({ keyword: '4090' })).status, 503);
    assert.equal((await fetch(base + '/api/tags', { headers: { authorization: 'Bearer ' + token } })).status, 200);
    release();
    assert.equal((await second).status, 502);
    const failed = await first;
    assert.equal(failed.status, 502); assert.equal((await failed.text()).includes('private detail'), false);
    assert.equal((await query({ keyword: '4080' })).status, 502);
  });
  assert.equal(calls, 3);
});
test('Render routes PTT through the existing authenticated AI tunnel', async () => {
  const previous = { ...process.env }; const original = axios.post; const calls = [];
  try {
    delete process.env.PTT_GATEWAY_URL; delete process.env.PTT_GATEWAY_API_KEY;
    process.env.RENDER = 'true'; process.env.OLLAMA_BASE_URL = 'https://gateway.example.test'; process.env.OLLAMA_API_KEY = token;
    axios.post = async (...args) => { calls.push(args); return { data: { items: [], scanned: 5 } }; };
    const result = await searchUsedProducts({ keyword: 'rtx4080', platforms: 'ptt' });
    assert.equal(result.meta.sourceStatus.ptt.status, 'empty');
    assert.equal(calls[0][0], 'https://gateway.example.test/api/ptt/search');
    assert.deepEqual(calls[0][1], { keyword: 'rtx4080' });
    assert.equal(calls[0][2].headers.Authorization, 'Bearer ' + token);
    assert.equal(calls[0][2].maxRedirects, 0);
    process.env.PTT_GATEWAY_URL = 'http://unsafe.example.test';
    const rejected = await searchUsedProducts({ keyword: 'rtx4080', platforms: 'ptt' });
    assert.equal(rejected.meta.sourceStatus.ptt.status, 'unavailable'); assert.equal(calls.length, 1);
  } finally { axios.post = original; for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
});
