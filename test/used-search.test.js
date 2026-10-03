const test = require('node:test');
const assert = require('node:assert/strict');
const {
  eligible, parsePttArticle, parseYahoo, searchUsedProducts
} = require('../src/services/used-search');

const pttUrl = 'https://www.ptt.cc/bbs/HardwareSale/M.1.A.001.html';
function article(price, condition = '正常使用兩年') {
  return `<div id="main-content"><div class="article-metaline">作者</div>◎硬體型號：RTX 4060
    ◎欲售價格：${price}
    ◎品樣狀況：${condition}
    <div class="push">推文</div></div>`;
}

test('PTT article parser rejects sold, new and ambiguous prices', () => {
  const title = '[賣/臺北/面交] RTX 4060';
  const sold = parsePttArticle(article('7,200 (已售出)'), title, pttUrl);
  assert.equal(sold, null);
  const range = parsePttArticle(article('7,000 / 8,000'), title, pttUrl);
  assert.equal(range, null);
  const used = parsePttArticle(article('7,200'), title, pttUrl);
  assert.equal(used.price, 7200);
  assert.equal(eligible(used, 'RTX 4060'), true);
  assert.equal(eligible(parsePttArticle(article('7,200', '全新未拆封'), title, pttUrl), 'RTX 4060'), false);
});

test('used search excludes sold, brand-new, variable, multi-model and purchase posts', async () => {
  const make = (name, price = 7000) => ({ verified: true, source: 'carousell', platform: '旋轉拍賣', name, price, url: `https://tw.carousell.com/p/${encodeURIComponent(name)}`, evidence: name });
  const candidates = [
    make('二手 RTX 4060 顯示卡'),
    make('二手 RTX 4060 已售出'),
    make('全新 RTX 4060'),
    make('二手 RTX 4060 議價'),
    make('二手 RTX 4060 4070 4080 多款'),
    make('回收二手 RTX 4060', 300)
  ];
  const result = await searchUsedProducts({ keyword: 'RTX 4060', platforms: 'carousell,ptt' }, {
    searchers: { carousell: async () => candidates, ptt: async () => { throw new Error('HTTP 403'); } }
  });
  assert.deepEqual(result.data.map(item => item.name), ['二手 RTX 4060 顯示卡']);
  assert.equal(result.meta.sourceStatus.ptt.status, 'unavailable');
  assert.equal(result.meta.sourceStatus.carousell.count, 1);
});

test('Yahoo auction parser keeps fixed-price used cards and rejects bidding', () => {
  const html = `<a href="https://tw.bid.yahoo.com/item/10001"><img alt="二手 RTX 4060 顯示卡"><span class="sc-1kltuah-2">$7,200</span></a>
    <a href="https://tw.bid.yahoo.com/item/10002"><img alt="二手 RTX 4060 顯示卡 競標"><span class="sc-1kltuah-2">$1,000</span>出價 2 次</a>`;
  const items = parseYahoo(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].price, 7200);
  assert.equal(eligible(items[0], 'RTX 4060'), true);
});

test('precise used search requires the keyword phrase rather than scattered words', async () => {
  const item = { verified: true, source: 'carousell', platform: '旋轉拍賣', name: '二手 Intel Core i5 CPU', evidence: '二手', price: 2000, url: 'https://tw.carousell.com/p/1' };
  const searchers = { carousell: async () => [item] };
  const loose = await searchUsedProducts({ keyword: 'Intel i5', platforms: 'carousell' }, { searchers });
  const precise = await searchUsedProducts({ keyword: 'Intel i5', platforms: 'carousell', precise: true }, { searchers });
  assert.equal(loose.data.length, 1);
  assert.equal(precise.data.length, 0);
});

test('PTT template warnings and penalties do not become sold markers or prices', () => {
  const html = `<div id="main-content">
◎硬體型號： RTX4060 (禁止販售未拆封之物品，贈品除外)
◎欲售價格： (沒有明確價格或賣出後清空價格=水桶2m，售價高於原價=水桶1y+退文)
7500
◎品樣狀況： (購買日期、保固有無、使用狀況、配件完整性)
2025/04購買，升級換下，正常使用
◎實物照片：https://example.com/photo
</div>`;
  const result = parsePttArticle(html, '[賣/高雄/皆可] RTX4060', pttUrl);
  assert.equal(result.price, 7500);
  assert.equal(eligible(result, '4060'), true);
  assert.equal(parsePttArticle(html.replace('7500', '7500 (已售出)'), '[賣/高雄/皆可] RTX4060', pttUrl), null);
  assert.equal(parsePttArticle(html.replace('7500', '7500沒了'), '[賣/高雄/皆可] RTX4060', pttUrl), null);
  assert.equal(parsePttArticle(html.replace('7500', '7500\n8000'), '[賣/高雄/皆可] RTX4060', pttUrl), null);
});