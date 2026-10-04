const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { readRows } = require('../train');
const { classifyProduct } = require('../src/services/product-classifier');
const { matchesComputerSearch } = require('../src/services/computer-product');
const { filterSearchResults, searchProductsWithMeta } = require('../src/services/search');
const policy = require('../public/market-search-policy');

function item(name, i = 0) { return { name, price: '10000', platform: '測試', url: `https://example.com/product/${i}` }; }

test('model asset loads and separates product titles with overlapping hardware words', () => {
  assert.equal(classifyProduct('微星 GeForce RTX4060 8GB 顯示卡').label, 'part_gpu');
  assert.equal(classifyProduct('Intel i5-14400 盒裝處理器').label, 'part_cpu');
  assert.notEqual(classifyProduct('機殼 支援顯卡長40公分 CPU高16公分').label, 'part_cpu');
});

test('precise GPU search returns single cards of the exact model without requiring the exclusions UI', () => {
  const names = ['華碩 RTX 4060 三風扇 8GB 顯示卡', 'MSI RTX4060 8GB 顯示卡',
    'RTX4060 Ti 8GB 顯示卡', 'RTX 4060 筆電 i7-13620H', 'i5-14400 RTX4060 電競桌機',
    'RTX4060 顯卡支架', 'RTX4060 顯卡風扇', 'RTX4060 轉接線', 'RTX4060 顯卡空盒',
    'RTX4060 顯示卡 加 650W 電源 組合包', 'RTX4060 / RTX4070 顯示卡 多款可選'];
  const products = names.map(item);
  assert.deepEqual(filterSearchResults(products, { keyword: 'ＲＴＸ ４０６０', precise: true }).map(row => row.name), names.slice(0, 2));
  for (const name of names.slice(0, -1).filter(value => !value.includes('顯卡風扇'))) {
    assert.equal(matchesComputerSearch(item(name), 'RTX4060'), true, name);
  }
  assert.equal(matchesComputerSearch(item('RTX4060 Ti 8GB 顯示卡'), 'RTX4060Ti', { precise: true }), true);
});

test('GPU model searches reject replacement fan listings but retain complete multi-fan cards', () => {
  const cards = ['華碩 RTX 4080 三風扇 16GB 顯示卡', 'MSI RTX4080 16GB 顯卡'];
  const fans = ['【量大優惠】全新聯想拯救者RTX4080顯示卡器風扇 看好拍',
    '【量大可優惠】全新聯想拯救者RTX4080顯卡器風扇 看好拍',
    'RTX4080 顯示卡散熱風扇', 'RTX4080 顯卡專用風扇'];
  const products = [...cards, ...fans].map(item);
  for (const precise of [false, true]) {
    assert.deepEqual(filterSearchResults(products, { keyword: 'RTX 4080', precise }).map(row => row.name), cards);
    assert.deepEqual(filterSearchResults(products, { keyword: '顯卡', precise }).map(row => row.name), cards);
  }
});

test('precise CPU search checks suffixes, excludes bundles and keeps boxed CPUs with coolers', () => {
  const names = ['Intel Core i5-14400 盒裝處理器 附原廠散熱器', '二手 i5 14400 CPU 單顆',
    'Intel i5-14400F 盒裝處理器', 'i5-14400 搭 B760 主機板 CPU主板組合',
    'i5-14400 16GB 1TB 文書電腦主機', 'i5-14400 適用 LGA1700 CPU 塔式散熱器',
    'i5-14400 處理器空盒', 'SSD 讀取14400MB/s'];
  assert.deepEqual(filterSearchResults(names.map(item), { keyword: 'i5 14400', precise: true }).map(row => row.name), names.slice(0, 2));
  assert.equal(matchesComputerSearch(item(names[2]), 'i5-14400F', { precise: true }), true);
  assert.equal(matchesComputerSearch(item(names[7]), 'i5 14400'), false);
  assert.equal(matchesComputerSearch(item('Ryzen 7 7800X3D 盒裝CPU'), 'R7-7800X3D', { precise: true }), true);
});

test('household goods, phones, consoles and furniture never become PC products through keywords', () => {
  const names = ['Dyson 吸塵器主機', '防蚊液贈主機', '自動麻將桌 電腦控制板', '三星 Galaxy 手機',
    '小米手機', 'Switch 2 主機', '電腦桌附USB充電 顯卡造型', '電競椅 RTX4060 聯名', '辦公椅 人體工學'];
  for (const name of names) for (const precise of [true, false]) {
    assert.equal(matchesComputerSearch(item(name), '電腦', { precise }), false, name);
  }
  assert.equal(matchesComputerSearch(item('ASUS TUF 電競桌機 RTX4060 i5-14400'), '主機'), true);
  assert.equal(matchesComputerSearch(item('文書桌上型電腦 i5-14400'), '主機'), true);
});

test('ordinary search preserves accessories, requires model relevance and honors user exclusions', () => {
  const products = ['RTX4060 支架', 'RTX4060 轉接線', 'RTX5060 顯示卡'].map(item);
  assert.deepEqual(filterSearchResults(products, { keyword: 'RTX 4060', exclude: '支架' }).map(r => r.name), ['RTX4060 轉接線']);
  assert.deepEqual(filterSearchResults(products, { keyword: 'RTX4060', exclude: '支架，轉接線' }), []);
  assert.equal(matchesComputerSearch(item('RTX3080 顯示卡 效能同等RTX4070'), 'RTX4070'), false);
  assert.equal(matchesComputerSearch(item('Bykski 顯示卡誰稜頭 RTX4070 豪華版'), 'RTX4070', { precise: true }), false);
  assert.equal(matchesComputerSearch(item('華碩 DUAL-RTX4060-O8G 顯示卡'), 'ASUS RTX4060', { precise: true }), true);
  assert.equal(matchesComputerSearch(item('微星 RTX4060 8G 顯示卡'), 'ASUS RTX4060', { precise: true }), false);
  assert.equal(matchesComputerSearch(item('ASUS RTX4070S-O12G 顯示卡'), 'RTX4070', { precise: true }), false);
});

test('cached retail and verified used listings obey the same precise classification', async () => {
  const result = await searchProductsWithMeta({ keyword: 'RTX 4060', precise: true, platforms: 'sinya,carousell' }, {
    getMarketData: async () => ({ products: [item('RTX4060 顯示卡', 1), item('RTX4060 電競主機', 2)], meta: { cached: true } }),
    searchUsedProducts: async () => ({ data: [{ ...item('二手 RTX4060 Ti 顯示卡', 3), source: 'carousell' },
      { ...item('二手 RTX4060 顯示卡', 4), source: 'carousell' }], meta: { sourceStatus: { carousell: { status: 'ok', count: 2 } } } })
  });
  assert.deepEqual(result.data.map(r => r.name), ['RTX4060 顯示卡', '二手 RTX4060 顯示卡']);
  assert.equal(result.meta.sourceStatus.carousell.count, 1);
});

test('auto exclusions are type-specific, preserve manual terms and have browser/server parity', () => {
  let state = policy.updateExcludes('二手 電競主機', [], 'RTX 4060', true);
  assert.ok(state.value.includes('顯卡支架'));
  assert.ok(!state.autoWords.includes('電競主機'));
  state = policy.updateExcludes(state.value, state.autoWords, 'i5 14400', true);
  assert.ok(!state.value.includes('顯卡支架'));
  assert.ok(state.value.includes('主機板套餐'));
  state = policy.updateExcludes(state.value, state.autoWords, 'i5 14400', false);
  assert.equal(state.value, '二手 電競主機');
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../public/market-search-policy'), 'utf8'), context);
  assert.equal(JSON.stringify(context.MarketSearchPolicy.intent('rtx 4060')), JSON.stringify(policy.intent('rtx 4060')));
});

test('training, validation and test product groups are disjoint and have no duplicated titles', () => {
  const { rows } = readRows();
  const groups = new Map();
  for (const row of rows) {
    if (groups.has(row.group)) assert.equal(groups.get(row.group), row.split);
    groups.set(row.group, row.split);
  }
  for (const split of ['train', 'validation', 'test']) assert.ok(rows.some(r => r.split === split));
});

test('marketplace development fixtures stay above accepted-result precision and recall targets', () => {
  const { evaluateMarketCases } = require('../scripts/evaluate-market-classifier');
  const result = evaluateMarketCases();
  assert.ok(result.general.precision >= 0.8 && result.general.recall >= 0.8);
  assert.ok(result.precise.precision >= 0.9 && result.precise.recall >= 0.9);
});
