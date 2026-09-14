const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECOMMENDATION_PLATFORM_IDS,
  resolvePlatformIds,
  scrapePlatforms
} = require('../src/scrapers');
const {
  scrape: scrapeCoolpc,
  buildCoolpcSearchUrl,
  cleanCoolpcProductSearchText,
  extractCoreProductIdentifier,
  normalizeCoolpcProductUrl,
  extractCoolpcProductUrl,
  extractCoolpcSearchProducts,
  findCoolpcDirectProductUrl
} = require('../src/scrapers/coolpc');
const cheerio = require('cheerio');
const axios = require('axios');
const {
  normalizeSearchKeyword,
  expandExcludeWords,
  filterSearchResults,
  extractGpuFamily,
  matchesGpuFamily,
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

test('原價屋搜尋網址會依關鍵字正確編碼', () => {
  assert.equal(buildCoolpcSearchUrl('3060'), 'https://coolpc.com.tw/tw/?s=3060');
  assert.equal(buildCoolpcSearchUrl('RTX 3060 顯示卡'), 'https://coolpc.com.tw/tw/?s=RTX%203060%20%E9%A1%AF%E7%A4%BA%E5%8D%A1');
});

test('原價屋商品網址只接受原價屋網域的有效連結', () => {
  assert.equal(
    normalizeCoolpcProductUrl('/tw/portfolio-items/rtx-3060'),
    'https://coolpc.com.tw/tw/portfolio-items/rtx-3060'
  );
  assert.equal(
    normalizeCoolpcProductUrl('https://www.coolpc.com.tw/tw/portfolio-items/rtx-3060'),
    'https://www.coolpc.com.tw/tw/portfolio-items/rtx-3060'
  );
  assert.equal(normalizeCoolpcProductUrl('https://coolpc.com.tw/tw/product/rtx-3060'), null);
  assert.equal(normalizeCoolpcProductUrl('https://example.com/item'), null);
  assert.equal(normalizeCoolpcProductUrl('javascript:alert(1)'), null);
  assert.equal(normalizeCoolpcProductUrl('https://coolpc.com.tw/evaluate.php'), null);
});

test('原價屋會依優先順序提取商品核心型號', () => {
  assert.equal(extractCoreProductIdentifier('華碩 TUF Ryzen AI 9 465/RTX5060/32G FA401GM'), 'FA401GM');
  assert.equal(extractCoreProductIdentifier('Acer Nitro ANV15-52-52CL RTX5060'), 'ANV15-52-52CL');
  assert.equal(extractCoreProductIdentifier('華碩 DUAL-RTX5060-O8G-A 顯示卡'), 'DUAL-RTX5060-O8G-A');
  assert.equal(extractCoreProductIdentifier('Intel Core i5-14450HX'), 'I514450HX');
  assert.equal(extractCoreProductIdentifier('GeForce RTX 5060 Ti'), 'RTX5060TI');
});

test('原價屋搜尋頁只解析並去重正式商品連結', () => {
  const products = extractCoolpcSearchProducts(`
    <article id="post-1"><h2><a href="/tw/portfolio-items/asus-fa401gm/">ASUS FA401GM RTX5060 筆電</a></h2></article>
    <a href="/tw/portfolio-items/asus-fa401gm/">重複連結</a>
    <a href="https://example.com/item">外部連結</a>
  `);
  assert.equal(products.length, 1);
  assert.equal(products[0].url, 'https://coolpc.com.tw/tw/portfolio-items/asus-fa401gm/');
  assert.match(products[0].text, /FA401GM/);
});

test('原價屋只在核心型號唯一一致時使用商品直連', () => {
  const searchProducts = [
    { url: 'https://coolpc.com.tw/tw/portfolio-items/rtx5060/', text: 'ASUS RTX5060 8G 顯示卡' },
    { url: 'https://coolpc.com.tw/tw/portfolio-items/rtx5060ti/', text: 'ASUS RTX5060 Ti 8G 顯示卡' }
  ];
  assert.equal(
    findCoolpcDirectProductUrl('ASUS RTX5060 8G 顯示卡', searchProducts),
    'https://coolpc.com.tw/tw/portfolio-items/rtx5060/'
  );
  assert.equal(
    findCoolpcDirectProductUrl('ASUS RTX5060 Ti 8G 顯示卡', searchProducts),
    'https://coolpc.com.tw/tw/portfolio-items/rtx5060ti/'
  );
  assert.equal(
    findCoolpcDirectProductUrl('ASUS FA401GM RTX5060', [
      { url: 'https://coolpc.com.tw/tw/portfolio-items/a/', text: 'ASUS FA401GM RTX5060' },
      { url: 'https://coolpc.com.tw/tw/portfolio-items/b/', text: 'ASUS FA401GM RTX5060 展示頁' }
    ]),
    null
  );
});

test('原價屋商品搜尋文字會移除價格與促銷資訊', () => {
  assert.equal(
    cleanCoolpcProductSearchText('酷！PC 【黑豹】 華碩 TUF Ryzen AI 9 465/RTX5060/32G/1T/14吋 銀 FA401GM 省$3000, $65900 ◆ ★'),
    '華碩 TUF Ryzen AI 9 465/RTX5060/32G/1T/14吋 銀 FA401GM'
  );
  assert.equal(cleanCoolpcProductSearchText('$15990 ◆ ★'), '');
});

test('原價屋選項有商品網址時會優先使用直達頁', () => {
  const $ = cheerio.load('<select><option data-url="/tw/portfolio-items/rtx-3060">RTX 3060 $15990</option></select>');
  assert.equal(
    extractCoolpcProductUrl($, $('option')[0]),
    'https://coolpc.com.tw/tw/portfolio-items/rtx-3060'
  );
});

test('原價屋爬蟲會將商品網址帶入結果', async () => {
  const originalGet = axios.get;
  axios.get = async (url) => ({
    data: url.includes('evaluate.php')
      ? Buffer.from('<option data-href="/tw/portfolio-items/rtx-3060">RTX 3060 $15990</option>')
      : ''
  });
  try {
    const [result] = await scrapeCoolpc('RTX 3060');
    assert.equal(result.url, 'https://coolpc.com.tw/tw/portfolio-items/rtx-3060');
    assert.equal(result.price, '15990');
  } finally {
    axios.get = originalGet;
  }
});

test('原價屋爬蟲沒有商品直連時會用清理後商品名稱搜尋', async () => {
  const originalGet = axios.get;
  axios.get = async (url) => ({
    data: url.includes('evaluate.php')
      ? Buffer.from('<option>ASUS TUF RTX 3060 12G $15990 ◆ ★</option>')
      : ''
  });
  try {
    const [result] = await scrapeCoolpc('RTX 3060');
    assert.equal(result.url, 'https://coolpc.com.tw/tw/?s=RTX3060');
  } finally {
    axios.get = originalGet;
  }
});

test('原價屋爬蟲會用搜尋頁唯一型號配對商品直連', async () => {
  const originalGet = axios.get;
  axios.get = async (url) => ({
    data: url.includes('evaluate.php')
      ? Buffer.from('<option>ASUS TUF FX607JV RTX 5060 $45990</option>')
      : '<article><h2><a href="/tw/portfolio-items/asus-fx607jv/">ASUS TUF FX607JV RTX5060 Laptop</a></h2></article>'
  });
  try {
    const [result] = await scrapeCoolpc('RTX 5060');
    assert.equal(result.url, 'https://coolpc.com.tw/tw/portfolio-items/asus-fx607jv/');
  } finally {
    axios.get = originalGet;
  }
});

test('原價屋爬蟲會保留完整商品名稱，不截斷或附加省略號', async () => {
  const originalGet = axios.get;
  const longName = `ASUS TUF RTX 3060 ${'LongSpec '.repeat(20)}`.trim();
  axios.get = async () => ({
    data: Buffer.from(`<option>${longName} $15990</option>`)
  });
  try {
    const [result] = await scrapeCoolpc('RTX 3060');
    assert.equal(result.name, longName);
    assert.equal(result.name.endsWith('...'), false);
    assert.ok(result.name.length > 125);
  } finally {
    axios.get = originalGet;
  }
});

test('原價屋爬蟲失敗時仍導向對應的動態搜尋頁', async () => {
  const originalGet = axios.get;
  axios.get = async () => { throw new Error('測試錯誤'); };
  try {
    const [result] = await scrapeCoolpc('RTX 3060');
    assert.equal(result.url, 'https://coolpc.com.tw/tw/?s=RTX%203060');
  } finally {
    axios.get = originalGet;
  }
});

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

test('顯示卡搜尋以基礎型號匹配同系列並排除誤匹配', () => {
  assert.equal(extractGpuFamily('4060'), '4060');
  assert.equal(extractGpuFamily('RTX 4060'), '4060');
  assert.equal(extractGpuFamily('RTX4060'), '4060');
  assert.equal(extractGpuFamily('Intel Core i5-12400F'), null);

  assert.equal(matchesGpuFamily('ASUS GeForce RTX 4060 8GB Graphics Card', '4060'), true);
  assert.equal(matchesGpuFamily('ASUS GeForce RTX 4060 Ti 8GB Graphics Card', '4060'), true);
  assert.equal(matchesGpuFamily('ASUS GeForce RTX 4060 Super Graphics Card', '4060'), true);
  assert.equal(matchesGpuFamily('GIGABYTE GeForce RTX 5060 Graphics Card', '4060'), false);
  assert.equal(matchesGpuFamily('便椅 HT4060-BL', '4060'), false);

  const results = filterSearchResults([
    product('RTX 4060 顯示卡', '9,000'),
    product('RTX 4060 Ti 顯示卡', '12,000'),
    product('RTX 4060 Super 顯示卡', '13,000'),
    product('RTX 5060 顯示卡', '10,000'),
    product('便椅 HT4060-BL', '7,000')
  ], { keyword: '4060', include: '', exclude: '', categories: '' });
  assert.deepEqual(results.map((item) => item.name), [
    'RTX 4060 顯示卡',
    'RTX 4060 Ti 顯示卡',
    'RTX 4060 Super 顯示卡'
  ]);
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
