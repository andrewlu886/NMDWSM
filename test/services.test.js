const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECOMMENDATION_PLATFORM_IDS,
  resolvePlatformIds,
  scrapePlatforms
} = require('../src/scrapers');
const {
  normalizeSearchKeyword,
  expandExcludeWords,
  filterSearchResults,
  searchProducts
} = require('../src/services/search');
const { matchesSearchKeyword } = require('../src/utils/search-keyword');
const {
  getSearchKeyword,
  rankRecommendations,
  getRecommendations
} = require('../src/services/recommendation');

function product(name, price, platform = '測試平台') {
  return { name, price, platform, url: 'https://example.com/item' };
}

test('平台 registry 忽略未知平台並維持固定順序', () => {
  const registry = { coolpc: async () => [], sinya: async () => [] };
  assert.deepEqual(resolvePlatformIds(['sinya', 'missing', 'coolpc'], registry), ['coolpc', 'sinya']);
});

test('scrapePlatforms 並行執行、依平台順序合併且隔離失敗', async () => {
  const registry = {
    coolpc: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return [product('原價屋商品', '2000', '原價屋')];
    },
    sinya: async () => [product('欣亞商品', '1000', '欣亞')],
    ruten: async () => { throw new Error('測試錯誤'); }
  };
  const results = await scrapePlatforms('顯示卡', ['ruten', 'sinya', 'coolpc'], registry);
  assert.deepEqual(results.map((item) => item.platform), ['原價屋', '欣亞']);
});

test('搜尋服務傳遞平台選項並執行包含、排除與價格排序', async () => {
  let receivedPlatforms;
  const results = await searchProducts({
    keyword: '記憶體',
    platforms: 'sinya,coolpc',
    include: 'DDR5',
    exclude: '筆電',
    categories: '32GB,64GB'
  }, {
    scrapePlatforms: async (_keyword, platforms) => {
      receivedPlatforms = platforms;
      return [
        product('桌機 DDR5 64GB', '6,000'),
        product('Laptop DDR5 32GB', '3,000'),
        product('桌機 DDR4 32GB', '2,000'),
        product('桌機 DDR5 32GB', '4,000')
      ];
    }
  });
  assert.equal(receivedPlatforms, 'sinya,coolpc');
  assert.deepEqual(results.map((item) => item.price), ['4,000', '6,000']);
});

test('市價查詢會統一全形字元並移除所有空白', () => {
  assert.equal(normalizeSearchKeyword('RTX4060'), 'RTX4060');
  assert.equal(normalizeSearchKeyword(' RTX  4060\t\n'), 'RTX4060');
  assert.equal(normalizeSearchKeyword('ＲＴＸ　４０６０'), 'RTX4060');
  assert.equal(normalizeSearchKeyword('Intel Core i5-12400F'), 'IntelCorei5-12400F');
});

test('有空格與無空格的搜尋會送出相同關鍵字並產生相同結果', async () => {
  const receivedKeywords = [];
  const dependencies = {
    scrapePlatforms: async (keyword) => {
      receivedKeywords.push(keyword);
      return [
        product('RTX 4060 顯示卡', '9,000'),
        product('RTX4060 顯卡風扇', '1,500')
      ];
    }
  };
  const baseOptions = { platforms: 'all', include: '', exclude: '', categories: '' };
  const compactResults = await searchProducts({ ...baseOptions, keyword: 'RTX4060' }, dependencies);
  const spacedResults = await searchProducts({ ...baseOptions, keyword: 'RTX 4060' }, dependencies);

  assert.deepEqual(receivedKeywords, ['RTX4060', 'RTX4060']);
  assert.deepEqual(spacedResults, compactResults);
});

test('商品名稱與關鍵字的本地比對會忽略空白', () => {
  assert.equal(matchesSearchKeyword('ASUS GeForce RTX 4060 Ti 8GB', 'RTX4060Ti'), true);
  assert.equal(matchesSearchKeyword('Intel Core i5-12400F 處理器', 'Intel Core i5-12400F'), true);
  assert.equal(matchesSearchKeyword('RTX 4070 顯示卡', 'RTX4060'), false);
});

test('同義詞擴充與顯卡搜尋防呆會排除周邊及低價商品', () => {
  const expanded = expandExcludeWords(['w11', '筆電']);
  assert.ok(expanded.includes('windows 11'));
  assert.ok(expanded.includes('laptop'));

  const results = filterSearchResults([
    product('RTX 4060 顯示卡', '9,000'),
    product('RTX 4060 顯卡風扇', '1,500'),
    product('RTX 4060 轉接線', '500')
  ], { keyword: 'RTX4060', include: '', exclude: '', categories: '' });
  assert.deepEqual(results.map((item) => item.name), ['RTX 4060 顯示卡']);
});

test('主機與筆電依用途選擇關鍵字，零件依類別選擇', () => {
  assert.equal(getSearchKeyword('desktop', 'gaming'), '主機');
  assert.equal(getSearchKeyword('desktop', 'office'), '套裝機');
  assert.equal(getSearchKeyword('laptop', 'gaming'), '筆電');
  assert.equal(getSearchKeyword('component', 'gaming', 'cpu'), '處理器');
  assert.equal(getSearchKeyword('component', 'office', 'gpu'), '顯示卡');
});

test('推薦排名維持分數優先、同分價格優先及 Top 3 schema', () => {
  const result = rankRecommendations({ budget: 50000, usage: 'gaming', productType: 'desktop' }, [
    product('i7-13700K RTX 4070 Ti 32GB Windows 11 Pro', '45,000', 'A'),
    product('i5-12400F RTX 4060 16GB Windows 11', '30,000', 'B'),
    product('i5-12400F RTX 4060 16GB Windows 11', '28,000', 'C'),
    product('i9-13900K RTX 4080 32GB Windows 11', '60,000', 'D'),
    product('i9-13900K 32GB Windows 11', '40,000', 'E')
  ]);

  assert.equal(result.recommendations.length, 3);
  assert.equal(result.recommendations[0].platform, 'A');
  assert.equal(result.recommendations[1].price, 28000);
  assert.deepEqual(Object.keys(result.recommendations[0]), [
    'title', 'price', 'cpu', 'gpu', 'ram', 'os', 'matchScore', 'platform', 'url'
  ]);
  assert.equal(result.suggestedPrice, 30000);
});

test('辦公推薦允許只有 CPU，零件推薦只保留所選類別', () => {
  const office = rankRecommendations({ budget: 30000, usage: 'office', productType: 'desktop' }, [
    product('i7-13700 16GB Windows 11 套裝機', '25,000')
  ]);
  assert.equal(office.recommendations.length, 1);
  assert.equal(office.recommendations[0].gpu, 'UNKNOWN');

  const products = [
    product('Intel Core i7-13700K 處理器', '12,000'),
    product('RTX 4070 SUPER 顯示卡', '28,000')
  ];
  const cpuComponents = rankRecommendations({
    budget: 30000,
    productType: 'component',
    componentType: 'cpu'
  }, products);
  const gpuComponents = rankRecommendations({
    budget: 30000,
    productType: 'component',
    componentType: 'gpu'
  }, products);

  assert.equal(cpuComponents.recommendations.length, 1);
  assert.equal(cpuComponents.recommendations[0].cpu, 'I7-13700K');
  assert.equal(cpuComponents.recommendations[0].gpu, 'UNKNOWN');
  assert.equal(gpuComponents.recommendations.length, 1);
  assert.equal(gpuComponents.recommendations[0].cpu, 'UNKNOWN');
  assert.equal(gpuComponents.recommendations[0].gpu, 'RTX4070SUPER');
});

test('零件推薦將所選類別的關鍵字傳給爬蟲', async () => {
  let receivedKeyword;
  await getRecommendations({
    budget: 30000,
    productType: 'component',
    componentType: 'cpu'
  }, {
    scrapePlatforms: async (keyword) => {
      receivedKeyword = keyword;
      return [];
    }
  });
  assert.equal(receivedKeyword, '處理器');
});

test('getRecommendations 使用固定六平台並回傳空結果 schema', async () => {
  let receivedPlatforms;
  const result = await getRecommendations({ budget: 1000, usage: 'gaming', productType: 'desktop' }, {
    scrapePlatforms: async (_keyword, platforms) => {
      receivedPlatforms = platforms;
      return [];
    }
  });
  assert.deepEqual(receivedPlatforms, RECOMMENDATION_PLATFORM_IDS);
  assert.deepEqual(result, { suggestedPrice: 0, recommendations: [] });
});
