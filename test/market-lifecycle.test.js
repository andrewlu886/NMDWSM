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
  const page = { ...item, platform: 'Yahoo購物', url: 'https://tw.buy.yahoo.com/gdsale/TEST-1.html' };
  assert.equal((await checkProduct(page, { request: async () => ({ status: 404 }) })).availability, 'unavailable');
  assert.equal((await checkProduct(page, { request: async () => ({ status: 429 }) })).reason, 'rate_limited');
  assert.equal((await checkProduct(page, { request: async () => { throw Error('offline'); } })).availability, 'unknown');
  let calls = 0;
  assert.equal((await checkProduct(page, { request: async () => { calls++; return { status: 302, headers: { location: 'http://127.0.0.1/' } }; } })).availability, 'unknown');
  assert.equal(calls, 1);
});

test('PChome uses the product button states for every variant', async () => {
  const pchome = { ...item, url: 'https://24h.pchome.com.tw/prod/DRAD1Q-A900I1OSV' };
  const row = (ButtonType, P = 8900, suffix = '000') => ({ Id: `DRAD1Q-A900I1OSV-${suffix}`, Qty: 1, Price: { P }, ButtonType, SaleStatus: ButtonType === 'ForSale' ? 1 : 0 });
  const check = data => checkProduct(pchome, { request: async () => ({ data }) });
  assert.deepEqual(await check([row('ForSale')]), { availability: 'available', reason: 'product_api', price: 8900, currency: 'TWD' });
  assert.equal((await check([row('ForSale'), row('ForSale', 9900, '001')])).availability, 'unknown');
  assert.equal((await check([{ ...row('ForSale'), Qty: 0 }])).availability, 'unavailable');
  for (const Qty of [undefined, null, '', 'invalid']) assert.equal((await check([{ ...row('ForSale'), Qty }])).availability, 'unknown');
  assert.equal((await check([{ ...row('ForSale'), Qty: 0 }, row('ForSale', 9900, '001')])).price, 9900);
  for (const state of ['OrderRefill', 'NotReady', 'SoldOut']) assert.equal((await check([row(state)])).availability, 'unavailable');
  assert.equal((await check([row('Coming')])).availability, 'unknown');
  assert.equal((await check([{ ...row('ForSale'), Id: 'OTHER-1-000' }])).availability, 'unknown');
});

test('Momo, Sinya and Ruten sold-out or removed listings are recognised', async () => {
  const momo = { ...item, platform: 'Momo', url: 'https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=1' };
  const meta = (stock, price = '8,900') => `<meta name="product:availability" content="${stock}"><meta name="product:price:amount" content="${price}">`;
  assert.deepEqual(parseAvailability(meta('in stock'), momo), { availability: 'available', reason: 'product_meta', price: 8900, currency: 'TWD' });
  assert.equal(parseAvailability(meta('out of stock'), momo).availability, 'unavailable');
  assert.equal(parseAvailability('<title>momo購物網 -- Mobile管理訊息</title><main>此商品目前已熱銷一空</main>', momo).availability, 'unavailable');
  assert.equal(parseAvailability('<title>momo購物網 -- Mobile管理訊息</title><main>很抱歉！網頁無法顯示。可能的原因是：商品目前無展售</main>', momo).availability, 'unavailable');
  assert.equal(parseAvailability('<title>商品</title>', momo).availability, 'unknown');
  const yahoo = { ...item, platform: 'Yahoo購物', url: 'https://tw.buy.yahoo.com/gdsale/TEST-1.html' };
  assert.equal(parseAvailability(html('InStock').replace(item.name, `${item.name} | RTX 5090 | Yahoo購物中心`), yahoo).availability, 'available');
  const sinya = { ...item, platform: '欣亞', url: 'https://www.sinya.com.tw/prod/212583' };
  assert.equal(parseAvailability('<button class="btn btnCart addToCart" data-pid="212583">加入購物車</button>', sinya).availability, 'available');
  assert.equal(parseAvailability('<button class="btn btnNoStock">貨到通知我</button><button class="addToCart" data-pid="1">加價購</button>', sinya).availability, 'unavailable');
  assert.equal(parseAvailability('<button class="addToCart" data-pid="1">加價購</button>', sinya).availability, 'unknown');
  assert.equal((await checkProduct(sinya, { request: async () => ({ status: 500, data: '很抱歉，此產品不存在或已經下架2。' }) })).reason, 'removed');
  assert.equal((await checkProduct(sinya, { request: async () => ({ status: 500, data: 'Database error' }) })).availability, 'unknown');
  const ruten = { ...item, platform: '露天', url: 'https://www.ruten.com.tw/item/show?22000000000001' };
  assert.equal((await checkProduct(ruten, { request: async () => ({ data: [] }) })).reason, 'removed');
  assert.equal((await checkProduct(ruten, { request: async () => ({ data: [null] }) })).reason, 'removed');
  assert.equal((await checkProduct(ruten, { request: async () => ({ data: { error: 1 } }) })).availability, 'unknown');
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

test('cleanup rotates beyond ten used queries and persists scheduling through search updates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-rotation-'));
  try {
    let time = 1_000_000_000;
    const file = path.join(dir, 'state.json');
    const lifecycle = createMarketLifecycle({ file, now: () => time });
    for (let i = 0; i < 12; i++) {
      const options = { keyword: `RTX ${i}`, platforms: 'ptt' };
      const used = { ...item, condition: 'used', source: 'ptt', verifiedAt: time, url: `https://www.ptt.cc/bbs/HardwareSale/M.${i}.A.001.html` };
      lifecycle.trackQuery(options, [used]);
      await lifecycle.filter([used]);
    }
    lifecycle.state.discoveryAt = time;
    const originalPopularity = Object.values(lifecycle.state.queries).map(q => [q.count, q.lastSeen]);
    const seen = [];
    const search = async options => { seen.push(options.keyword); lifecycle.trackQuery(options); };
    time += 31 * 60000;
    await lifecycle.runDue(search);
    const scheduled = Object.values(lifecycle.state.queries).filter(q => q.nextCheckAt > time);
    assert.equal(scheduled.length, 10);
    assert.equal(createMarketLifecycle({ file }).state.queries[JSON.stringify(['rtx 0', ['ptt']])].nextCheckAt, time + 30 * 60000);
    time += 31 * 60000;
    await lifecycle.runDue(search);
    assert.deepEqual(seen.slice(10, 12), ['RTX 10', 'RTX 11']);
    assert.equal(new Set(seen).size, 12);
    assert.deepEqual(Object.values(lifecycle.state.queries).map(q => [q.count, q.lastSeen]), originalPopularity);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PChome price conflicts are hidden while ordinary unconfirmed stock stays visible', async () => {
  const lifecycle = createMarketLifecycle({ file: null, check: async product => product.url.endsWith('CONFLICT')
    ? { availability: 'unknown', reason: 'variant_unconfirmed', priceAmbiguous: true }
    : { availability: 'unknown', reason: 'stock_unconfirmed' } });
  const result = await lifecycle.filter([item, { ...item, url: item.url + 'CONFLICT' }]);
  assert.deepEqual(result.products.map(row => row.url), [item.url]);
  assert.equal(result.products[0].availability, 'unknown');
  assert.deepEqual(result.hidden, [item.url + 'CONFLICT']);
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
