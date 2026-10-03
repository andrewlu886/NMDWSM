/* global document, window */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { classifyProductCondition } = require('../src/services/product-condition');
const { parsePttArticle, searchUsedProducts } = require('../src/services/used-search');
const { rankRecommendations, getRecommendationsWithMeta } = require('../src/services/recommendation');
const { RECOMMENDATION_PLATFORM_IDS } = require('../src/scrapers');
const publicDir = path.resolve(__dirname, '../public');
const baseOptions = { budget: 20000, productType: 'desktop', usage: 'gaming' };
const newDesktop = { platform: 'PChome', name: '桌機 i5-12400 / RTX3060 / 16GB', price: '15,000', url: 'https://24h.pchome.com.tw/prod/NEW-PC' };
const usedDesktop = { platform: '露天', name: '二手桌機 i5-12400 / RTX3060 / 16GB', price: '7,000', url: 'https://www.ruten.com.tw/item/show?123456789' };
const usedPtt = { platform: 'PTT 硬體版', name: '桌機 i5-11400 / GTX1660 / 16GB', price: 4500, condition: 'used', url: 'https://www.ptt.cc/bbs/HardwareSale/M.1800000000.A.123.html' };

test('condition classification distinguishes verified used data, second-hand descriptions and conflicting labels', () => {
  assert.equal(classifyProductCondition(newDesktop), 'unknown');
  assert.equal(classifyProductCondition(usedPtt), 'used');
  assert.equal(classifyProductCondition({ name: '幾乎全新桌機' }), 'used');
  assert.equal(classifyProductCondition({ name: '自用八成新筆電' }), 'used');
  assert.equal(classifyProductCondition({ name: '全新未拆封桌機' }), 'new');
  assert.equal(classifyProductCondition({ name: '二手／全新都有' }), 'conflict');
});

test('default new recommendations reuse original keyword, platforms and cache without calling used sources', async () => {
  let usedCalled = false;
  const result = await getRecommendationsWithMeta(baseOptions, {
    getMarketData: async (keyword, platforms, cacheOptions) => {
      assert.equal(keyword, '主機');
      assert.deepEqual(platforms, RECOMMENDATION_PLATFORM_IDS);
      assert.deepEqual(cacheOptions, {});
      return { products: [newDesktop, usedDesktop, usedPtt], meta: { cached: true, updatedAt: 1800000000000 } };
    },
    searchUsedProducts: async () => { usedCalled = true; throw new Error('must not run'); }
  });
  assert.equal(result.condition, 'new');
  assert.deepEqual(result.recommendations.map(item => item.url), [newDesktop.url]);
  assert.equal(result.marketMeta.cached, true);
  assert.equal(usedCalled, false);
});

test('used recommendations refresh the old crawlers, merge public used listings and keep the same ranking', async () => {
  const carousell = { ...usedPtt, platform: '旋轉拍賣', name: '電腦主機 i7-12700 / RTX4060 / 16GB', price: 10000, url: 'https://tw.carousell.com/p/used-gaming-pc-123456789/' };
  const result = await getRecommendationsWithMeta({ ...baseOptions, condition: 'used' }, {
    getMarketData: async (keyword, platforms, cacheOptions) => {
      assert.equal(keyword, '二手主機');
      assert.deepEqual(platforms, RECOMMENDATION_PLATFORM_IDS);
      assert.deepEqual(cacheOptions, { forceRefresh: true });
      return { products: [usedDesktop, newDesktop], meta: { updatedAt: 1800000000000 } };
    },
    searchUsedProducts: async options => {
      assert.deepEqual(options, { keyword: '主機', platforms: 'ptt,carousell,yahoo-auction' });
      return { data: [usedPtt, carousell, usedDesktop], meta: { sourceStatus: { ptt: { status: 'ok' } } } };
    }
  });
  assert.equal(result.condition, 'used');
  assert.deepEqual(result.recommendations.map(item => item.url), [carousell.url, usedDesktop.url, usedPtt.url]);
  assert.equal(result.suggestedPrice, 7000);
  assert.equal(result.marketMeta.liveListings, true);
  assert.equal(result.marketMeta.partial, false);
});

test('used laptop requests retain the old laptop keyword and reject desktop listings', async () => {
  const laptop = { ...usedDesktop, name: '二手筆電 i5-12400 / RTX3060 / 16GB', url: 'https://www.ruten.com.tw/item/show?987654321' };
  const result = await getRecommendationsWithMeta({ ...baseOptions, productType: 'laptop', condition: 'used' }, {
    getMarketData: async keyword => {
      assert.equal(keyword, '二手筆電');
      return { products: [usedDesktop, laptop], meta: {} };
    },
    searchUsedProducts: async options => {
      assert.equal(options.keyword, '筆電');
      return { data: [], meta: {} };
    }
  });
  assert.deepEqual(result.recommendations.map(item => item.url), [laptop.url]);
});

test('used ranking excludes new, unknown, unavailable, sold, price ranges, multi-price and non-computer listings', () => {
  const invalid = [
    newDesktop,
    { ...usedDesktop, name: '全新未拆封桌機 i5-12400 RTX3060' },
    { ...usedDesktop, available: false },
    { ...usedDesktop, name: `${usedDesktop.name} 已售出` },
    { ...usedDesktop, price: 'NT$ 1,500~10,000' },
    { ...usedDesktop, price: '7000、8000' },
    { ...usedDesktop, price: 'NT$ 7000、8000' },
    { ...usedDesktop, price: 'NT$ 7000 / NT$ 8000' },
    { ...usedDesktop, price: '面議' },
    { ...usedDesktop, name: '二手顯示卡 RTX3060' }
  ];
  // A high budget also catches ranges that would become a concatenated number.
  const result = rankRecommendations({ ...baseOptions, budget: 20000000, condition: 'used' }, [...invalid, usedDesktop]);
  assert.deepEqual(result.recommendations.map(item => item.title), [usedDesktop.name]);
  assert.equal(result.suggestedPrice, 7000);
  const office = rankRecommendations({ budget: 3000, productType: 'desktop', usage: 'office', condition: 'used' }, [
    { ...usedDesktop, name: '二手迷你電腦 i5-6500 8GB', price: 2000 }
  ]);
  assert.equal(office.recommendations[0].price, 2000);
});

test('used recommendations preserve successful sources and report unavailable or partial sources', async () => {
  const result = await getRecommendationsWithMeta({ ...baseOptions, condition: 'used' }, {
    getMarketData: async () => { throw new Error('retail timeout'); },
    searchUsedProducts: async () => ({ data: [usedPtt], meta: { sourceStatus: { carousell: { status: 'unavailable' } } } })
  });
  assert.equal(result.recommendations[0].url, usedPtt.url);
  assert.equal(result.marketMeta.partial, true);
  const partial = await getRecommendationsWithMeta({ ...baseOptions, condition: 'used' }, {
    getMarketData: async () => ({ products: [usedDesktop], meta: {} }),
    searchUsedProducts: async () => ({ data: [], meta: { sourceStatus: { ptt: { status: 'partial' } } } })
  });
  assert.equal(partial.marketMeta.partial, true);
  await assert.rejects(getRecommendationsWithMeta({ ...baseOptions, condition: 'used' }, {
    getMarketData: async () => { throw new Error('retail timeout'); },
    searchUsedProducts: async () => { throw new Error('used timeout'); }
  }), /二手商品來源暫時無法讀取/);
});

test('verified second-hand specs in article content reach the original hardware scoring without reading comments', async () => {
  const article = parsePttArticle(`<div id="main-content">
◎硬體型號：桌機 i5-12400 RTX3060 16GB
◎欲售價格：7000
◎品樣狀況：正常使用，升級換下
<div class="push">RTX5090 跑分很高</div>
</div>`, '[賣/臺北/面交] 電競主機', usedPtt.url);
  assert.match(article.specificationText, /i5-12400 RTX3060/);
  assert.doesNotMatch(article.specificationText, /RTX5090/);
  const listings = await searchUsedProducts({ keyword: '主機', platforms: 'ptt' }, { searchers: { ptt: async () => [article] } });
  const result = rankRecommendations({ ...baseOptions, condition: 'used' }, listings.data);
  assert.equal(result.recommendations[0].cpu, 'I5-12400');
  assert.equal(result.recommendations[0].gpu, 'RTX3060');
  assert.equal(result.recommendations[0].price, 7000);
  const broken = rankRecommendations({ ...baseOptions, condition: 'used' }, [{ ...usedDesktop, name: '二手故障桌機 i5-12400 RTX3060' }]);
  assert.equal(broken.recommendations.length, 0);
});

test('used recommendations discard stale retail fallback so sold old listings cannot reappear', async () => {
  const result = await getRecommendationsWithMeta({ ...baseOptions, condition: 'used' }, {
    getMarketData: async () => ({ products: [usedDesktop], meta: { stale: true, cached: true } }),
    searchUsedProducts: async () => ({ data: [usedPtt], meta: {} })
  });
  assert.deepEqual(result.recommendations.map(item => item.url), [usedPtt.url]);
  assert.equal(result.marketMeta.partial, true);
});

test('invalid product condition is rejected before any crawl', async () => {
  await assert.rejects(getRecommendationsWithMeta({ ...baseOptions, condition: 'invalid' }, {
    getMarketData: () => { throw new Error('must not crawl'); }
  }), /商品狀況/);
});

test('recommendation page places the condition selector after product type and carries it through results and AI prompts', async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000 });
  try {
    const page = await browser.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      let contentType = 'text/plain', body = '';
      if (url.pathname === '/api/recommend') {
        const options = JSON.parse(request.postData());
        requests.push(options);
        const item = options.condition === 'used' ? usedDesktop : newDesktop;
        contentType = 'application/json';
        body = JSON.stringify({ recommendations: [{ title: item.name, price: 7000, url: item.url, platform: item.platform, cpu: 'i5-12400', gpu: 'RTX3060', ram: '16GB' }], marketMeta: { updatedAt: 1800000000000, liveListings: options.condition === 'used' } });
      } else if (url.pathname === '/recommend') {
        contentType = 'text/html';
        body = fs.readFileSync(path.join(publicDir, 'recommend.html'), 'utf8');
      } else if (url.hostname === 'localhost' && /^\/(?:recommend\.js|style\.css|site-theme\.css)$/.test(url.pathname)) {
        contentType = url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css';
        body = fs.readFileSync(path.join(publicDir, url.pathname.slice(1)), 'utf8');
      }
      request.respond({ status: 200, contentType, body }).catch(() => {});
    });
    await page.goto('http://localhost:3999/recommend');
    assert.deepEqual(await page.$$eval('#recommend-form .recommend-field label', labels => labels.map(label => label.textContent)), ['商品種類', '商品狀況', '預算範圍（NTD）', '主要用途']);
    assert.equal(await page.$eval('#condition', select => select.value), 'new');
    assert.deepEqual(await page.$$eval('#condition option', options => options.map(option => option.textContent)), ['全新', '二手']);
    await page.type('#budget', '20000');
    await page.click('#recommend-submit');
    await page.waitForSelector('.recommend-result-item');
    assert.deepEqual(requests[0], { ...baseOptions, condition: 'new' });
    assert.match(await page.$eval('.recommend-tags', node => node.textContent), /商品狀況：全新/);
    await page.select('#condition', 'used');
    await page.click('#recommend-submit');
    await page.waitForFunction(() => document.querySelector('.recommend-tag')?.textContent === '商品狀況：二手');
    assert.deepEqual(requests[1], { ...baseOptions, condition: 'used' });
    assert.match(await page.$eval('.recommend-data-freshness', node => node.textContent), /二手刊登即時查詢/);
    await page.evaluate(() => window.addEventListener('nmdwsm:agent-prompt', event => { window.lastRecommendationPrompt = event.detail.prompt; }));
    await page.click('.recommend-agent-button');
    assert.match(await page.evaluate(() => window.lastRecommendationPrompt), /查詢二手套裝主機/);
    assert.equal(await page.$('.recommend-calculator-link'), null);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});