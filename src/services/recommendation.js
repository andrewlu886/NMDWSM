const { RECOMMENDATION_PLATFORM_IDS } = require('../scrapers');
const { getDailyMarketData } = require('./market-cache');
const { searchUsedProducts, fixedPrice } = require('./used-search');
const { matchesProductCondition } = require('./product-condition');
const { isComputerListing, isUnrelatedProduct } = require('./computer-product');
const {
  extractCPU,
  extractGPU,
  extractRAM,
  extractOS,
  getDynamicCPUScore,
  getDynamicGPUScore,
  getRamBonusScore,
  getOsBonusScore
} = require('./hardware');

function getSearchKeyword(productType, usage, componentType) {
  if (productType === 'component') return componentType === 'cpu' ? '處理器' : '顯示卡';
  if (productType === 'laptop') return usage === 'gaming' ? '筆電' : '筆記型電腦';
  return usage === 'gaming' ? '主機' : '套裝機';
}

function hasProductDetailUrl(item) {
  try {
    const url = new URL(item.url);
    if (url.protocol !== 'https:') return false;
    const path = url.pathname.toLowerCase();
    switch (item.platform) {
      case 'Yahoo購物': return url.hostname === 'tw.buy.yahoo.com' && path.startsWith('/gdsale/');
      case '原價屋': return url.hostname.endsWith('coolpc.com.tw') && path.startsWith('/tw/portfolio-items/');
      case '欣亞': return url.hostname === 'www.sinya.com.tw' && /^\/prod\/[\w-]+/.test(path);
      case 'PChome': return url.hostname === '24h.pchome.com.tw' && /^\/prod\/[\w-]+/.test(path);
      case 'Momo': return url.hostname === 'www.momoshop.com.tw'
        && path.includes('/goodsdetail.jsp') && Boolean(url.searchParams.get('i_code'));
      case '露天': return url.hostname === 'www.ruten.com.tw'
        && path === '/item/show' && Boolean(url.search);
      default: return path !== '/' && !/search|find|activity/i.test(path);
    }
  } catch {
    return false;
  }
}

function getProductIdentity(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^(?:\[[^\]]+\]|【[^】]+】)\s*/g, '')
    .replace(/(?:灰色|白色|黑色|銀色|銀白|深灰|淺灰|藍色|紅色|金色|粉色|紫色|綠色|gray|grey|white|black|silver|blue|red|gold|pink|purple|green)/gi, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function selectDiverseRecommendations(products, limit = 3) {
  const selected = [];
  const selectedIdentities = new Set();
  const selectedPlatforms = new Set();

  for (const item of products) {
    const identity = `${item.platform}:${getProductIdentity(item.title)}`;
    if (!identity || selectedIdentities.has(identity) || selectedPlatforms.has(item.platform)) continue;
    selected.push(item);
    selectedIdentities.add(identity);
    selectedPlatforms.add(item.platform);
    if (selected.length === limit) return selected;
  }

  for (const item of products) {
    const identity = `${item.platform}:${getProductIdentity(item.title)}`;
    if (!identity || selectedIdentities.has(identity)) continue;
    selected.push(item);
    selectedIdentities.add(identity);
    if (selected.length === limit) break;
  }
  return selected;
}

function rankRecommendations(options, products) {
  const validProducts = [];
  const minimumPrice = options.condition === 'used' ? 1000 : 5000;

  products.forEach((item) => {
    if (!item || !item.price) return;
    if (isUnrelatedProduct(item.name)) return;
    if (!hasProductDetailUrl(item) || item.available === false) return;
    if (!matchesProductCondition(item, options.condition || 'new')) return;
    if (options.condition === 'used' && /零件機|故障|不知好壞|無法開機|不能開機|報廢|僅供拆件/.test(item.name)) return;
    if (/已售出|售出|已成交|售完|已售完|缺貨|無庫存|下架|暫停販售|補貨中|\bsold\b/i.test(String(item.name).replace(/尚未售出|未售出/g, ''))) return;
    const cleanPrice = fixedPrice(item.price);
    if (!cleanPrice || cleanPrice > options.budget || cleanPrice < minimumPrice) return;
    if (options.usage === 'gaming' && item.name.includes('文書')) return;

    const specifications = options.condition === 'used' ? `${item.name} ${item.specificationText || ''}` : item.name;
    const cpu = extractCPU(specifications);
    const gpu = extractGPU(specifications);
    const ram = extractRAM(specifications);
    const os = extractOS(specifications);
    if (options.productType !== 'component' && !isComputerListing(item.name, options.productType, cpu, gpu)) return;
    if (options.productType === 'component' && options.componentType === 'cpu' && cpu === 'UNKNOWN') return;
    if (options.productType === 'component' && options.componentType === 'gpu' && gpu === 'UNKNOWN') return;
    if (options.productType !== 'component' && cpu === 'UNKNOWN' && gpu === 'UNKNOWN' && options.usage !== 'office') return;
    if (options.usage === 'gaming' && gpu === 'UNKNOWN') return;

    const cpuScore = getDynamicCPUScore(cpu);
    const gpuScore = getDynamicGPUScore(gpu);
    const baseScore = options.usage === 'gaming'
      ? (gpuScore * 0.75) + (cpuScore * 0.25)
      : (cpuScore * 0.75) + (gpuScore * 0.25);
    const bonusScore = getRamBonusScore(ram) + getOsBonusScore(os);

    validProducts.push({
      title: item.name,
      price: cleanPrice,
      cpu,
      gpu,
      ram,
      os,
      matchScore: baseScore + bonusScore,
      platform: item.platform || '未知平台',
      url: item.url || '#'
    });
  });

  validProducts.sort((left, right) => {
    if (right.matchScore === left.matchScore) return left.price - right.price;
    return right.matchScore - left.matchScore;
  });
  const recommendations = selectDiverseRecommendations(validProducts);
  if (validProducts.length === 0) return { suggestedPrice: 0, recommendations: [] };

  const prices = validProducts.map((product) => product.price).sort((left, right) => left - right);
  if (prices.length > 4) {
    prices.pop();
    prices.shift();
  }
  const middle = Math.floor(prices.length / 2);
  const medianPrice = prices.length % 2 === 0
    ? (prices[middle - 1] + prices[middle]) / 2
    : prices[middle];

  return {
    suggestedPrice: Math.round(medianPrice),
    recommendations
  };
}

async function getRecommendationsWithMeta(options, dependencies = {}) {
  const condition = options.condition === undefined ? 'new' : options.condition;
  if (!['new', 'used'].includes(condition)) throw new Error('商品狀況僅支援全新或二手');
  const normalized = { ...options, condition };
  const keyword = getSearchKeyword(options.productType, options.usage, options.componentType);
  const retailKeyword = condition === 'used' ? `二手${keyword}` : keyword;
  const loadRetail = () => dependencies.getMarketData
    ? dependencies.getMarketData(retailKeyword, RECOMMENDATION_PLATFORM_IDS, condition === 'used' ? { forceRefresh: true } : {})
    : dependencies.scrapePlatforms
      ? Promise.resolve(dependencies.scrapePlatforms(retailKeyword, RECOMMENDATION_PLATFORM_IDS)).then(products => ({ products, meta: null }))
      : getDailyMarketData(retailKeyword, RECOMMENDATION_PLATFORM_IDS, condition === 'used' ? { forceRefresh: true } : {});
  if (condition === 'new') {
    const marketData = await loadRetail();
    return { ...rankRecommendations(normalized, marketData.products), condition, marketMeta: marketData.meta };
  }
  // Reuse the existing crawlers and scoring; second-hand sources verify their original listings.
  const [retail, used] = await Promise.allSettled([
    Promise.resolve().then(loadRetail),
    Promise.resolve().then(() => (dependencies.searchUsedProducts || searchUsedProducts)({
      keyword: options.productType === 'desktop' ? '主機' : keyword,
      platforms: 'ptt,carousell,yahoo-auction'
    }))
  ]);
  if (retail.status === 'rejected' && used.status === 'rejected') throw new Error('二手商品來源暫時無法讀取');
  const marketData = retail.status === 'fulfilled' ? retail.value : { products: [], meta: null };
  const listings = used.status === 'fulfilled' ? used.value : { data: [], meta: { sourceStatus: {} } };
  const seen = new Set();
  const retailProducts = marketData.meta?.stale ? [] : marketData.products;
  const products = [...retailProducts, ...listings.data].filter(item => {
    if (!item || seen.has(item.url)) return false;
    seen.add(item.url); return true;
  });
  return { ...rankRecommendations(normalized, products), condition,
    marketMeta: { ...marketData.meta, updatedAt: Date.now(), liveListings: true,
      sourceStatus: listings.meta?.sourceStatus || {},
      partial: retail.status === 'rejected' || used.status === 'rejected' || Boolean(marketData.meta?.stale)
        || Object.values(listings.meta?.sourceStatus || {}).some(source => ['partial', 'unavailable'].includes(source.status)),
      retailUpdatedAt: marketData.meta?.updatedAt || null }
  };
}
async function getRecommendations(options, dependencies = {}) {
  if (!['desktop', 'laptop', 'component'].includes(options.productType)) {
    throw new Error('商品種類僅支援套裝主機、筆記型電腦或零件');
  }
  const result = await getRecommendationsWithMeta(options, dependencies);
  const { marketMeta, condition, ...recommendations } = result;
  return recommendations;
}

module.exports = {
  getSearchKeyword,
  rankRecommendations,
  getRecommendations,
  getRecommendationsWithMeta
};
