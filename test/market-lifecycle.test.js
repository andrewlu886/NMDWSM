const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMarketLifecycle } = require('../src/services/market-lifecycle');
const { parseAvailability, checkProduct } = require('../src/services/product-availability');
const { searchProductsWithMeta } = require('../src/services/search');
const item = { name: 'MSI RTX 4060 VENTUS 8GB', platform: 'PChome', price: '9000', url: 'https://24h.pchome.com.tw/prod/TEST' };
const html = (availability, extra = {}) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: item.name, offers: { '@type': 'Offer', price: 8900, priceCurrency: 'TWD', availability: `https://schema.org/${availability}`, ...extra } })}</script>`;

test('only explicit stock and an unambiguous matching offer are admitted', () => {
  assert.equal(parseAvailability(html('InStock'), item).availability, 'available');
  assert.equal(parseAvailability(html('OutOfStock'), item).availability, 'unavailable');
  assert.equal(parseAvailability(html('SoldOut'), item).availability, 'unavailable');
  assert.equal(parseAvailability(html('PreOrder'), item).availability, 'unknown');
  assert.equal(parseAvailability(html('InStock', { '@type': 'AggregateOffer' }), item).availability, 'unknown');
  assert.equal(parseAvailability(html('InStock') + html('OutOfStock'), item).availability, 'unknown');
  assert.equal(parseAvailability('<title>Checking your browser</title>' + html('InStock'), item).availability, 'unknown');
  assert.equal(parseAvailability(html('InStock').replace(item.name, 'different product'), item).availability, 'unknown');
});

test('HTTP removal, temporary failures and unsafe redirects remain distinct', async () => {
  assert.equal((await checkProduct(item, { request: async () => ({ status: 404 }) })).availability, 'unavailable');
  assert.equal((await checkProduct(item, { request: async () => ({ status: 429 }) })).reason, 'rate_limited');
  assert.equal((await checkProduct(item, { request: async () => { throw Error('offline'); } })).availability, 'unknown');
  let calls = 0;
  assert.equal((await checkProduct(item, { request: async () => { calls++; return { status: 302, headers: { location: 'http://127.0.0.1/' } }; } })).availability, 'unknown');
  assert.equal(calls, 1);
});

test('expired status hides sold products, marks unknown ones, and the same URL can recover', async () => {
  let time = 100000, stock = 'available', calls = 0;
  const lifecycle = createMarketLifecycle({ file: null, now: () => time, check: async () => { calls++; return { availability: stock, reason: stock }; } });
  assert.equal((await lifecycle.filter([item])).products.length, 1);
  stock = 'unavailable';
  assert.equal((await lifecycle.filter([item])).products.length, 1);
  assert.equal(calls, 1);
  time += 60001;
  assert.equal((await lifecycle.filter([item])).products.length, 0);
  assert.equal(lifecycle.state.products[item.url].availability, 'unavailable');
  time += 60001; stock = 'unknown';
  const unknown = await lifecycle.filter([item]);
  assert.equal(unknown.products[0].availability, 'unknown');
  assert.deepEqual(unknown.hidden, []);
  assert.deepEqual(unknown.failures, {});
  time += 60001; stock = 'available';
  assert.equal((await lifecycle.filter([item])).products.length, 1);
});

test('persisted pending records and query candidates survive restart without permanent exclusions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-state-'));
  try {
    const file = path.join(dir, 'state.json'); let time = 100000;
    const a = createMarketLifecycle({ file, now: () => time, check: async () => ({ availability: 'unknown', reason: 'offline' }) });
    const options = { keyword: 'RTX 4060', platforms: 'pchome' };
    a.trackQuery(options, [item]); await a.filter([item]);
    time += 60001;
    const b = createMarketLifecycle({ file, now: () => time, check: async () => ({ availability: 'available' }) });
    assert.equal(b.retained(options).length, 1);
    assert.equal((await b.filter(b.retained(options))).products.length, 1);
    time += 8 * 86400000; b.save(); assert.equal(Object.keys(b.state.products).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scheduled jobs do not overlap and limit rediscovery to fifty active query groups', async () => {
  const lifecycle = createMarketLifecycle({ file: null, now: () => 1_000_000_000 });
  for (let i = 0; i < 60; i++) lifecycle.trackQuery({ keyword: `RTX ${i}`, platforms: 'pchome' });
  let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  const work = lifecycle.runDue(async options => { assert.equal(options.forceRefresh, true); assert.equal(options.maintenance, true); calls++; if (calls === 1) await gate; });
  assert.equal(await lifecycle.runDue(async () => {}), false);
  release(); await work; assert.equal(calls, 50);
  await lifecycle.runDue(async () => calls++); assert.equal(calls, 50);
});

test('search removes stale rows, marks unconfirmed listings, and recovers retained rows', async () => {
  let time = 100000, status = 'unavailable';
  const lifecycle = createMarketLifecycle({ file: null, now: () => time, check: async () => ({ availability: status }) });
  let products = [item];
  const deps = { lifecycle, getMarketData: async () => ({ products, meta: {} }) };
  const options = { keyword: 'RTX 4060', platforms: 'pchome' };
  assert.equal((await searchProductsWithMeta(options, deps)).data.length, 0);
  time += 60001; status = 'unknown';
  const marked = await searchProductsWithMeta(options, deps);
  assert.equal(marked.data[0].availability, 'unknown');
  assert.equal(marked.meta.sourceStatus.PChome, undefined);
  time += 60001; products = [];
  assert.equal((await searchProductsWithMeta(options, deps)).data.length, 0);
  time += 60001; status = 'available';
  assert.equal((await searchProductsWithMeta(options, deps)).data.length, 1);
});

test('new listings join a query and an absent used listing loses its verified state', async () => {
  let time = 100000;
  const lifecycle = createMarketLifecycle({ file: null, now: () => time, check: async () => ({ availability: 'available' }) });
  const used = { ...item, url: 'https://www.ptt.cc/bbs/HardwareSale/M.1.A.001.html', condition: 'used', source: 'ptt', verifiedAt: time };
  const options = { keyword: 'RTX 4060', platforms: 'ptt' };
  lifecycle.trackQuery(options, [used]); await lifecycle.filter([used]);
  lifecycle.observeUsed(options, [], { ptt: { status: 'empty' } });
  assert.equal(lifecycle.state.products[used.url].availability, 'unknown');
  time += 60001;
  used.verifiedAt = time;
  assert.equal((await lifecycle.filter([used, { ...item, url: item.url + '2' }])).products.length, 2);
});

test('gateway cache hits do not extend the original sixty-second evidence lifetime', async () => {
  let time = 150000;
  const lifecycle = createMarketLifecycle({ file: null, now: () => time });
  const used = { ...item, condition: 'used', source: 'ptt', verifiedAt: 100001 };
  assert.equal((await lifecycle.filter([used])).products.length, 1);
  assert.equal(lifecycle.state.products[item.url].availabilityCheckedAt, 100001);
  time = 160002;
  assert.equal((await lifecycle.filter([used])).products.length, 0);
});

test('verification budgets mark unchecked rows and retries recover; rate limiting backs off', async () => {
  let time = 100000, fail = true, calls = 0;
  const lifecycle = createMarketLifecycle({ file: null, now: () => time, check: async () => { calls++; return fail ? { availability: 'unknown', reason: 'rate_limited' } : { availability: 'available' }; } });
  await lifecycle.filter([item]);
  await lifecycle.filter([{ ...item, url: item.url + '2' }]);
  assert.equal(calls, 1);
  time += 300001; fail = false;
  assert.equal((await lifecycle.filter([item])).products.length, 1);
  const slow = createMarketLifecycle({ file: null, budgetMs: 5, check: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')), { once: true })) });
  const result = await slow.filter(Array.from({ length: 8 }, (_, i) => ({ ...item, url: item.url + i })));
  assert.equal(result.products.length, 8);
  assert.ok(result.products.every(row => row.availability === 'unknown'));
  assert.equal(result.hidden.length, 0);
});
