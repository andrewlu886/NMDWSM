const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  searchProducts,
  convertUsdProducts
} = require('../src/services/search');
const { matchesSearchKeyword } = require('../src/utils/search-keyword');
const {
  getSearchKeyword,
  rankRecommendations,
  getRecommendations
} = require('../src/services/recommendation');
const { DAY_MS, createMarketCache } = require('../src/services/market-cache');
const {
  parseUsdSpotSellRate,
  parseFallbackUsdNtdRate,
  createExchangeRateProvider
} = require('../src/services/exchange-rate');
const { convertUsdPrice } = require('../src/scrapers/newegg');
const {
  extractYahooPrice,
  isUnavailableYahooProductPage,
  isPlausibleYahooPrice,
  filterUnavailableYahooProducts
} = require('../src/scrapers/yahoo');

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

test('Yahoo 商品價錢擷取會略過刷卡金與折價券金額', () => {
  const $ = cheerio.load(`
    <a href="/gdsale/acer-mini-pc.html">
      <span class="coupon" data-price="200">9/30 前登錄送 $200 元刷卡金</span>
      <span>Acer Aspire Revo Box RB102 迷你桌機</span>
      <span>NT$ 20,990</span>
    </a>
  `);
  assert.equal(extractYahooPrice($, $('a')[0]), '20990');
  const installment = cheerio.load('<a>每期 $500，商品價格 NT$ 20,990</a>');
  assert.equal(extractYahooPrice(installment, installment('a')[0]), '20990');
  assert.equal(isPlausibleYahooPrice('Acer RB102 迷你桌機', '200'), false);
  assert.equal(isPlausibleYahooPrice('Acer RB102 迷你桌機', '159905'), false);
  assert.equal(isPlausibleYahooPrice('Acer RB102 迷你桌機', '20990'), true);
});

test('Yahoo 商品頁明確查無商品或回應 404/410 時會判定失效', () => {
  assert.equal(isUnavailableYahooProductPage(200, '<main>查無此商品</main>'), true);
  assert.equal(isUnavailableYahooProductPage(200, '<main>商品已停售</main>'), true);
  assert.equal(isUnavailableYahooProductPage(200, '<main>商品</main>', 'https://tw.buy.yahoo.com/search/product?p=RB102'), true);
  assert.equal(isUnavailableYahooProductPage(404, '<main>Not Found</main>'), true);
  assert.equal(isUnavailableYahooProductPage(410, '<main>Gone</main>'), true);
  assert.equal(isUnavailableYahooProductPage(200, '<main>商品售價 NT$ 20,990</main>'), false);
  assert.equal(isUnavailableYahooProductPage(503, '<main>暫時無法服務</main>'), false);
});

test('Yahoo 爬蟲排除失效商品頁但保留暫時無法驗證的商品', async () => {
  const products = [
    { name: '正常商品', url: 'https://tw.buy.yahoo.com/gdsale/valid.html' },
    { name: '已下架商品', url: 'https://tw.buy.yahoo.com/gdsale/missing.html' },
    { name: '其他平台商品', url: 'https://example.com/item' }
  ];
  const filtered = await filterUnavailableYahooProducts(products, async (url) => {
    if (url.endsWith('valid.html')) return { status: 200, data: '<main>正常商品頁</main>' };
    return { status: 200, data: '<main>查無此商品</main>' };
  });
  assert.deepEqual(filtered.map((item) => item.name), ['正常商品', '其他平台商品']);

  const retainedOnNetworkError = await filterUnavailableYahooProducts(products.slice(0, 1), async () => {
    throw new Error('network timeout');
  });
  assert.deepEqual(retainedOnNetworkError, products.slice(0, 1));
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
        { ...product('桌機 DDR5 64GB', '6,000'), url: 'https://example.com/item/64' },
        product('Laptop DDR5 32GB', '3,000'),
        product('桌機 DDR4 32GB', '2,000'),
        { ...product('桌機 DDR5 32GB', '4,000'), url: 'https://example.com/item/32' }
      ];
    }
  });
  assert.deepEqual(receivedPlatforms, ['sinya']);
  assert.deepEqual(results.map((item) => item.price), ['4,000', '6,000']);
});

test('市價查詢不再使用原價屋爬蟲，包括直接指定原價屋或全平台搜尋', async () => {
  const calls = [];
  const dependencies = {
    searchUsedProducts: async () => ({ data: [], meta: { sourceStatus: {} } }),
    scrapePlatforms: async (_keyword, platforms) => {
      calls.push(platforms);
      return [];
    }
  };

  await searchProducts({ keyword: 'RTX 4060', platforms: 'coolpc' }, dependencies);
  await searchProducts({ keyword: 'RTX 4060', platforms: 'all' }, dependencies);

  assert.deepEqual(calls[0], []);
  assert.ok(calls[1].length > 0);
  assert.ok(!calls[1].includes('coolpc'));
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
    searchUsedProducts: async () => ({ data: [], meta: { sourceStatus: {} } }),
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

test('精確顯卡搜尋排除周邊，普通搜尋保留其他配件但排除顯卡風扇', () => {
  const expanded = expandExcludeWords(['w11', '筆電']);
  assert.ok(expanded.includes('windows 11'));
  assert.ok(expanded.includes('laptop'));

  const products = [
    product('RTX 4060 顯示卡', '9,000'),
    product('RTX 4060 顯卡風扇', '1,500'),
    product('RTX 4060 轉接線', '500')
  ];
  const results = filterSearchResults(products, { keyword: 'RTX4060', precise: true });
  assert.deepEqual(results.map((item) => item.name), ['RTX 4060 顯示卡']);
  assert.deepEqual(filterSearchResults(products, { keyword: 'RTX4060' }).map(item => item.price), ['500', '9,000']);
});

test('市價查詢會排除 Yahoo 迷你桌機舊快取中的明顯錯價', () => {
  const results = filterSearchResults([
    product('Acer RB102 迷你桌機 R5-7430U', '209,905', 'Yahoo購物'),
    product('Acer RB102 迷你桌機 CU5-225H', '269,109', 'Yahoo購物'),
    product('Acer RB102 迷你桌機 R7-7730U', '269,905', 'Yahoo購物'),
    product('Acer RB102 迷你桌機 R5-7430U', '20,990', 'Yahoo購物')
  ], { keyword: 'RB102', include: '', exclude: '', categories: '' });

  assert.deepEqual(results.map((item) => item.price), ['20,990']);
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
    product('文書桌上型電腦 i7-13700 16GB Windows 11 套裝機', '25,000')
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

test('文書推薦要求商品明確為電腦，避免把用途文字相同的工具或周邊列入', () => {
  const desktop = rankRecommendations({ budget: 30000, usage: 'office', productType: 'desktop' }, [
    product('文書桌上型電腦 8GB SSD 套裝機', '18,000'),
    product('【家事達】HIKOKI 充電式無刷電鑽，適合文書工作', '9,900'),
    product('【家事達】HIKOKI 日立 CS1810DD 手持式無刷 4 吋鏈鋸 套裝機（含電池+充電器）', '9,900'),
    product('【家事達】德國 STIHL-ASA 20 充電式電剪 套裝機', '10,900'),
    product('電腦滑鼠鍵盤組', '1,000')
  ]);
  const laptop = rankRecommendations({ budget: 30000, usage: 'office', productType: 'laptop' }, [
    product('商用筆記型電腦 16GB Windows 11', '25,000'),
    product('【家事達】HIKOKI 充電式無刷電鑽，適合文書工作', '9,900')
  ]);

  assert.deepEqual(desktop.recommendations.map((item) => item.title), ['文書桌上型電腦 8GB SSD 套裝機']);
  assert.equal(desktop.recommendations[0].gpu, 'UNKNOWN');
  assert.deepEqual(laptop.recommendations.map((item) => item.title), ['商用筆記型電腦 16GB Windows 11']);
});

test('推薦優先跨平台並去除同平台同型號不同顏色、活動頁及售完商品', () => {
  const result = rankRecommendations({ budget: 30000, usage: 'office', productType: 'desktop' }, [
    {
      ...product('Acer Aspire TC-885 桌上型電腦 灰色', '15,000', 'Yahoo購物'),
      url: 'https://tw.buy.yahoo.com/gdsale/acer-1'
    },
    {
      ...product('Acer Aspire TC-885 桌上型電腦 白色', '15,000', 'Yahoo購物'),
      url: 'https://tw.buy.yahoo.com/gdsale/acer-2'
    },
    {
      ...product('Lenovo ThinkCentre 桌機', '20,000', 'PChome'),
      url: 'https://24h.pchome.com.tw/prod/DRAA1A-A900EXAMPLE'
    },
    {
      ...product('HP ProDesk 桌機', '18,000', 'Momo'),
      url: 'https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=123'
    },
    {
      ...product('售完 ASUS 桌機', '19,000', '露天'),
      url: 'https://www.ruten.com.tw/item/show?123456'
    },
    {
      ...product('Dell 桌機', '17,000', 'Yahoo購物'),
      url: 'https://tw.buy.yahoo.com/activity/123'
    }
  ]);

  assert.equal(result.recommendations.length, 3);
  assert.deepEqual(new Set(result.recommendations.map((item) => item.platform)), new Set(['Yahoo購物', 'PChome', 'Momo']));
  assert.equal(result.recommendations.filter((item) => item.title.startsWith('Acer Aspire TC-885')).length, 1);
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

test('市價快取在 24 小時內重用資料，過期後更新並保存至磁碟', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdwsm-market-cache-'));
  const cachePath = path.join(directory, 'cache.json');
  let timestamp = 1_800_000_000_000;
  let scrapeCount = 0;
  const scrape = async () => [{ name: `商品 ${++scrapeCount}`, price: '1000' }];

  try {
    const cache = createMarketCache({ cachePath, now: () => timestamp, scrape });
    const first = await cache.get('RTX 4060', ['coolpc']);
    assert.equal(first.meta.cached, false);
    assert.equal(first.products[0].name, '商品 1');

    const sameDay = await cache.get('RTX4060', ['coolpc']);
    assert.equal(sameDay.meta.cached, true);
    assert.equal(sameDay.products[0].name, '商品 1');
    assert.equal(scrapeCount, 1);

    const restored = createMarketCache({ cachePath, now: () => timestamp, scrape });
    assert.equal((await restored.get('RTX4060', ['coolpc'])).products[0].name, '商品 1');
    assert.equal(scrapeCount, 1);

    timestamp += DAY_MS + 1;
    const refreshed = await restored.get('RTX4060', ['coolpc']);
    assert.equal(refreshed.meta.cached, false);
    assert.equal(refreshed.products[0].name, '商品 2');
    assert.equal(scrapeCount, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('市價快取版本更新後不會沿用舊版錯誤價格', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdwsm-market-cache-version-'));
  const cachePath = path.join(directory, 'cache.json');
  const oldKey = JSON.stringify(['桌機', ['yahoo']]);
  fs.writeFileSync(cachePath, JSON.stringify({
    [oldKey]: {
      updatedAt: Date.now(),
      products: [{ platform: 'Yahoo購物', name: '迷你桌機', price: '200' }]
    }
  }));
  let scrapeCount = 0;

  try {
    const cache = createMarketCache({
      cachePath,
      scrape: async () => {
        scrapeCount += 1;
        return [{ platform: 'Yahoo購物', name: '迷你桌機', price: '20990' }];
      }
    });
    const result = await cache.get('桌機', ['yahoo']);
    assert.equal(result.meta.cached, false);
    assert.equal(result.products[0].price, '20990');
    assert.equal(scrapeCount, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('同一組合的並行市價查詢只會觸發一次爬取', async () => {
  let scrapeCount = 0;
  const cache = createMarketCache({
    cachePath: null,
    scrape: async () => {
      scrapeCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [];
    }
  });
  await Promise.all([
    cache.get('RTX 5070', ['momo', 'coolpc']),
    cache.get('RTX 5070', ['coolpc', 'momo'])
  ]);
  assert.equal(scrapeCount, 1);
});

test('Newegg 美元金額依臺銀即期賣出匯率轉為新台幣並保留原價', () => {
  const csv = [
    '"幣別","現金匯率","現金匯率","即期匯率","即期匯率"',
    '"美金 (USD)","31.45","32.12","31.80","31.90"'
  ].join('\n');
  const rate = parseUsdSpotSellRate(csv);
  const converted = convertUsdPrice('1,534', '29', {
    rate,
    fetchedAt: 1_800_000_000_000,
    source: '臺灣銀行牌告匯率（美元即期賣出）',
    sourceUrl: 'https://rate.bot.com.tw/xrt/flcsv/0/day'
  });

  assert.equal(rate, 31.9);
  assert.equal(converted.priceNtd, 48944);
  assert.equal(converted.price, '48944');
  assert.equal(converted.originalPrice, 'USD $1,534.29');
});

test('臺銀美元匯率每日快取，來源暫時失敗時沿用最近成功匯率', async () => {
  let timestamp = 1_800_000_000_000;
  let fetchCount = 0;
  let available = true;
  let storedRate = null;
  const provider = createExchangeRateProvider({
    loadCached: async () => storedRate,
    saveCached: async (rate) => { storedRate = rate; },
    now: () => timestamp,
    fetchCsv: async () => {
      fetchCount += 1;
      if (!available) throw new Error('offline');
      return '"幣別","現金買入","現金賣出","即期買入","即期賣出"\n"美金 (USD)",31.45,32.12,31.80,31.90';
    },
    fetchFallback: async () => { throw new Error('backup offline'); }
  });

  assert.equal((await provider()).rate, 31.9);
  assert.equal((await provider()).rate, 31.9);
  assert.equal(fetchCount, 1);

  timestamp += DAY_MS + 1;
  available = false;
  const stale = await provider();
  assert.equal(stale.rate, 31.9);
  assert.equal(stale.stale, true);
  assert.equal(fetchCount, 2);
});

test('臺銀匯率抓取失敗時使用台灣央行收盤匯率備援來源', async () => {
  const data = { date: '2026-09-30', base: 'USD', quote: 'TWD', rate: 31.82 };
  assert.deepEqual(parseFallbackUsdNtdRate(data), { rate: 31.82, quoteDate: '2026-09-30' });

  const provider = createExchangeRateProvider({
    loadCached: async () => null,
    saveCached: async () => {},
    fetchCsv: async () => { throw new Error('Bank blocked'); },
    fetchFallback: async () => data
  });
  const result = await provider();
  assert.equal(result.rate, 31.82);
  assert.equal(result.quoteDate, '2026-09-30');
  assert.match(result.source, /備援/);
});

test('已快取的美元商品會在新台灣日期重新套用當日匯率', async () => {
  const products = [{
    name: 'RTX GPU',
    currency: 'USD',
    originalPrice: 'USD $100.00',
    price: '3190',
    priceNtd: 3190,
    exchangeRate: 31.9
  }];
  const refreshed = await convertUsdProducts(products, async () => ({
    rate: 32.1,
    fetchedAt: 1_800_000_000_000,
    source: '臺灣銀行牌告匯率（美元即期賣出）',
    sourceUrl: 'https://rate.bot.com.tw/xrt/flcsv/0/day'
  }));

  assert.equal(refreshed[0].priceNtd, 3210);
  assert.equal(refreshed[0].originalPrice, 'USD $100.00');
});

test('舊版 Newegg 快取仍能辨識並同時提供美元原價與新台幣換算價', async () => {
  const [product] = await convertUsdProducts([{
    platform: 'Newegg (US)',
    price: 'USD $1,555.74'
  }], async () => ({ rate: 31.9, fetchedAt: 1_800_000_000_000 }));

  assert.equal(product.originalPrice, 'USD $1,555.74');
  assert.equal(product.priceNtd, 49628);
  assert.equal(product.currency, 'USD');
});
