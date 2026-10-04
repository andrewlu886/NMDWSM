const test = require('node:test');
const assert = require('node:assert/strict');
const { isComputerProduct } = require('../src/services/computer-product');
const { filterSearchResults, searchProductsWithMeta } = require('../src/services/search');
const { rankRecommendations } = require('../src/services/recommendation');
const { searchUsedProducts } = require('../src/services/used-search');

function product(name, price = 500) {
  return { name, price, platform: '測試平台', url: `https://example.com/item/${encodeURIComponent(name)}` };
}

test('computer filter preserves whole computers, components and peripherals without a recommendation price floor', () => {
  const names = ['Acer RB102 迷你桌機', 'MacBook Air M4', 'Intel Core i5-12400F',
    'ASUS RTX5060-O8G', '二手 GTX 970', 'DDR5 32GB', 'Samsung NVMe SSD 1TB',
    'B650 主機板', '650W 電源供應器', 'CPU 散熱風扇', '電腦機殼', 'USB 鍵盤', '無線滑鼠', '27 吋螢幕'];
  assert.deepEqual(filterSearchResults(names.map(name => product(name)), { keyword: '電腦' }).map(item => item.name), names);
});

test('unrelated titles are rejected despite computer words, model numbers or descriptions', () => {
  const names = ['無線電鑽主機', '食物處理器', '電腦桌 RTX 4060', '電競椅 i5-12400F',
    '空氣清淨機', 'Nintendo Switch 遊戲主機', '便椅 HT4060-BL', '品牌運動鞋', 'ASUS 品牌商品'];
  for (const name of names) {
    assert.equal(isComputerProduct({ name, specificationText: 'CPU RTX 4060 電腦' }), false, name);
  }
  assert.equal(isComputerProduct(null), false);
  assert.equal(isComputerProduct({ name: 'ＲＴＸ　５０６０ 顯示卡' }), true);
});

test('cached retail and used market results both pass through the common computer filter', async () => {
  const desktop = product('文書主機 i5-12400F', 10000);
  const used = { ...product('二手 650W 電源供應器'), source: 'carousell', condition: 'used' };
  const result = await searchProductsWithMeta({ keyword: '電腦', platforms: 'sinya,carousell' }, {
    getMarketData: async () => ({ products: [desktop, product('電鑽主機', 2000)], meta: { cached: true, updatedAt: 123 } }),
    searchUsedProducts: async () => ({ data: [used, { ...product('二手遊戲主機'), source: 'carousell' }],
      meta: { sourceStatus: { carousell: { status: 'ok', count: 2, filtered: 0 } } } })
  });
  assert.deepEqual(result.data.map(item => item.name), [used.name, desktop.name]);
  assert.equal(result.meta.cached, true);
  assert.equal(result.meta.sourceStatus.carousell.count, 1);
  assert.equal(result.meta.sourceStatus.carousell.filtered, 1);
});

test('screenshot listings are excluded from desktop searches while PC controllers remain searchable as peripherals', () => {
  const names = ['Dyson V6無線吸塵器主機無電池 (兩台合售)',
    '【雷達】momo獨規品 超智慧薄型液體電蚊香-無臭無味/無香精(10補充贈1主機)',
    '【主機筆電加購價】【PowerA】PC專用無線遊戲手把- 戰龍',
    '【finamill】電動香料研磨器(一主機可換多個調味料罐 節省收納空間)'];
  const desktop = product('文書主機 i5-12400F', 10000);
  assert.deepEqual(filterSearchResults([...names.map(name => product(name)), desktop], { keyword: '主機' }), [desktop]);
  assert.deepEqual(filterSearchResults(names.map(name => product(name)), { keyword: '筆電' }), []);
  assert.equal(isComputerProduct(product(names[2])), true);
  assert.deepEqual(filterSearchResults(names.map(name => product(name)), { keyword: '手把' }).map(item => item.name), [names[2]]);
  const office = { budget: 30000, usage: 'office' };
  for (const productType of ['desktop', 'laptop']) {
    assert.deepEqual(rankRecommendations({ ...office, productType }, [product(names[2], 6000)]).recommendations, []);
  }
});

test('used source eligibility rejects unrelated products before counting its results', async () => {
  const candidates = ['二手電腦桌', '二手電腦機殼'].map((name, index) => ({
    ...product(name), source: 'carousell', verified: true, evidence: '二手正常使用',
    url: `https://tw.carousell.com/p/${index}`
  }));
  const result = await searchUsedProducts({ keyword: '電腦', platforms: 'carousell' }, {
    searchers: { carousell: async () => candidates }
  });
  assert.deepEqual(result.data.map(item => item.name), ['二手電腦機殼']);
  assert.equal(result.meta.sourceStatus.carousell.filtered, 1);
});

test('recommendations share the same unrelated-product exclusion, including component requests', () => {
  const options = { budget: 30000, usage: 'office', productType: 'desktop' };
  assert.deepEqual(rankRecommendations(options, [product('電腦桌 i5-12400F RTX4060', 6000)]).recommendations, []);
  assert.deepEqual(rankRecommendations({ ...options, productType: 'component', componentType: 'cpu' },
    [product('食物處理器 i5-12400F', 6000)]).recommendations, []);
});
