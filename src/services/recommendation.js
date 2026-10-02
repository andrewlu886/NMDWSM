const { RECOMMENDATION_PLATFORM_IDS } = require('../scrapers');
const { getDailyMarketData } = require('./market-cache');
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

function getSearchKeyword(productType, usage) {
  if (productType === 'laptop') return usage === 'gaming' ? '筆電' : '筆記型電腦';
  return usage === 'gaming' ? '主機' : '套裝機';
}

function isComputerListing(name, productType, cpu, gpu) {
  const text = String(name || '');
  if (/電鑽|鏈鋸|電鋸|電剪|電動工具|手持工具|起子|砂輪機|修剪機|吹葉機|割草機/i.test(text)) return false;
  if (productType === 'laptop') {
    return /筆電|筆記型|laptop|notebook|macbook|chromebook|電競本/i.test(text);
  }
  return /桌機|桌上型電腦|桌上型主機|桌電|桌上電腦|電腦主機|主機電腦|套裝電腦|電腦套裝|迷你電腦|mini\s*pc|desktop(?:\s*pc)?|個人電腦|all[- ]?in[- ]?one|一體成型電腦/i.test(text)
    || (cpu !== 'UNKNOWN' && gpu !== 'UNKNOWN');
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
  const minimumPrice = 5000;

  products.forEach((item) => {
    if (!item || !item.price) return;
    if (!hasProductDetailUrl(item)) return;
    if (/售完|已售完|缺貨|無庫存|下架|暫停販售|補貨中/i.test(item.name)) return;
    const cleanPrice = parseInt(String(item.price).replace(/[^\d]/g, ''), 10);
    if (Number.isNaN(cleanPrice) || cleanPrice === 0 || cleanPrice > options.budget || cleanPrice < minimumPrice) return;
    if (options.usage === 'gaming' && item.name.includes('文書')) return;

    const cpu = extractCPU(item.name);
    const gpu = extractGPU(item.name);
    const ram = extractRAM(item.name);
    const os = extractOS(item.name);
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
  const keyword = getSearchKeyword(options.productType, options.usage, options.componentType);
  const marketData = dependencies.getMarketData
    ? await dependencies.getMarketData(keyword, RECOMMENDATION_PLATFORM_IDS)
    : dependencies.scrapePlatforms
      ? { products: await dependencies.scrapePlatforms(keyword, RECOMMENDATION_PLATFORM_IDS), meta: null }
      : await getDailyMarketData(keyword, RECOMMENDATION_PLATFORM_IDS);
  return { ...rankRecommendations(options, marketData.products), marketMeta: marketData.meta };
}

async function getRecommendations(options, dependencies = {}) {
  if (!['desktop', 'laptop', 'component'].includes(options.productType)) {
    throw new Error('商品種類僅支援套裝主機、筆記型電腦或零件');
  }
  const result = await getRecommendationsWithMeta(options, dependencies);
  const { marketMeta, ...recommendations } = result;
  return recommendations;
}
}

module.exports = {
  getSearchKeyword,
  rankRecommendations,
  getRecommendations,
  getRecommendationsWithMeta
};
