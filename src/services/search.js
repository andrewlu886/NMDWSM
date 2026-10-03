const { normalizeSearchKeyword } = require('../utils/search-keyword');
const { PLATFORM_IDS } = require('../scrapers');
const { getDailyMarketData } = require('./market-cache');
const { getUsdNtdRate } = require('./exchange-rate');
const { searchUsedProducts, SOURCES: USED_SOURCES } = require('./used-search');

const SYNONYM_GROUPS = Object.freeze([
  ['w11', 'win11', 'windows11', 'windows 11'],
  ['w10', 'win10', 'windows10', 'windows 10'],
  ['筆電', '筆記型電腦', '筆記本', 'laptop', 'notebook'],
  ['主機', '桌機', '桌上型電腦', '套裝機', 'desktop', 'pc']
]);

const GPU_AUTO_EXCLUDES = Object.freeze([
  'Kg', '架', '折疊', '會議', '眼鏡', '碗', '無線', 'GHz', '不鏽鋼', '鞋', '題', '衣', '包',
  '墊', '筆', '袋', '壺', '轉接線', '散熱', '水冷', '支架', '貼紙', '貼膜', '延長線', '空機殼',
  ' 金牌', ' 銀牌', ' 銅牌', '顯卡風扇', 'Fan', 'Cooler', 'Liquid', 'Heatsink', 'Cable',
  'Adapter', 'Extension', 'Bracket', 'Case', 'Chassis', 'Enclosure', 'Sticker', 'Skin', 'Decal'
]);

function splitWords(value, pattern = /[\s,]+/) {
  return String(value || '').split(pattern).filter(Boolean);
}

function expandExcludeWords(words) {
  const expanded = [...words];
  const lowerWords = new Set(expanded.map((word) => word.toLowerCase()));
  SYNONYM_GROUPS.forEach((group) => {
    if (group.some((synonym) => lowerWords.has(synonym))) {
      group.forEach((synonym) => {
        if (!lowerWords.has(synonym)) {
          expanded.push(synonym);
          lowerWords.add(synonym);
        }
      });
    }
  });
  return expanded;
}

function parsePrice(price) {
  if (!price) return Infinity;
  const digits = String(price).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : Infinity;
}

function hasPlausibleYahooMiniPcPrice(item) {
  if (!/yahoo/i.test(item?.platform || '') || !/迷你(?:桌機|電腦)/i.test(item?.name || '')) return true;
  const price = parsePrice(item.price);
  return price >= 1500 && price <= 100000;
}

function extractGpuFamily(keyword) {
  const normalized = normalizeSearchKeyword(keyword).toUpperCase();
  const match = normalized.match(/(?<!\d)(?:RTX|RX)?([3-9]\d{3})(?:TI|SUPER)?(?!\d)/);
  return match ? match[1] : null;
}

function isGpuProductName(name) {
  return /RTX|GEFORCE|RADEON|GRAPHIC|VIDEO|GPU|顯示卡|顯卡/i.test(name);
}

function matchesGpuFamily(name, family) {
  const normalizedName = String(name || '').normalize('NFKC').toUpperCase();
  const familyPattern = new RegExp(`(?<!\\d)${family}(?:\\s*(?:TI|SUPER))?(?!\\d)`);
  return familyPattern.test(normalizedName) && isGpuProductName(normalizedName);
}

function filterSearchResults(products, options) {
  const includeWords = splitWords(options.include);
  let excludeWords = expandExcludeWords(splitWords(options.exclude));
  const categoryWords = splitWords(options.categories, ',');
  const gpuFamily = extractGpuFamily(options.keyword);
  let minimumPrice = 0;

  if (/\d[06]\d0/.test(options.keyword)) {
    minimumPrice = 1000;
    const existing = new Set(excludeWords);
    GPU_AUTO_EXCLUDES.forEach((word) => {
      if (!existing.has(word)) {
        excludeWords.push(word, word.toLowerCase());
        existing.add(word);
        existing.add(word.toLowerCase());
      }
    });
  }

  const filtered = products.filter((item) => {
    const name = String(item?.name || '').toLowerCase();
    if (!item || !hasPlausibleYahooMiniPcPrice(item)) return false;
    const amount = String(item.price ?? '').normalize('NFKC');
    if (/\d[\d,]*\s*(?:元)?\s*[-~～至/]\s*(?:NT\$?|\$)?\s*\d/.test(amount)
      || /面議|議價|起標|價格浮動/.test(amount) || !Number.isFinite(parsePrice(item.price))) return false;
    if (/已售出|售完|已成交|已下架/.test(name)) return false;
    if (options.precise && !name.replace(/[\s_-]+/g, '').includes(String(options.keyword).toLowerCase().replace(/[\s_-]+/g, ''))) return false;
    const includeMatch = includeWords.length === 0
      || includeWords.every((word) => name.includes(word.toLowerCase()));
    const excludeMatch = excludeWords.length === 0
      || !excludeWords.some((word) => name.includes(word.toLowerCase()));
    const categoryMatch = categoryWords.length === 0
      || categoryWords.some((word) => name.includes(word.toLowerCase()));
    const gpuFamilyMatch = gpuFamily ? matchesGpuFamily(item?.name || '', gpuFamily) : true;
    if (!includeMatch || !excludeMatch || !categoryMatch || !gpuFamilyMatch) return false;
    return minimumPrice === 0 || parsePrice(item.price) >= minimumPrice;
  });

  return filtered.sort((left, right) => parsePrice(left.price) - parsePrice(right.price));
}

async function convertUsdProducts(products, getRate = getUsdNtdRate) {
  const usdProducts = products.map((item) => {
    if (!item || (item.currency !== 'USD' && !/newegg/i.test(item.platform || ''))) return item;
    const sourcePrice = item.originalPrice || item.price;
    const match = String(sourcePrice || '').match(/(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
    const usd = match ? Number(match[1].replace(/,/g, '')) : NaN;
    if (!Number.isFinite(usd) || usd <= 0) return item;
    return {
      ...item,
      currency: 'USD',
      originalPrice: `USD $${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    };
  });
  if (!usdProducts.some((item) => item?.currency === 'USD' && item.originalPrice)) return products;

  let exchange;
  try {
    exchange = await getRate();
  } catch (error) {
    console.warn(`[市價查詢] 美元商品暫時無法換算：${error.message}`);
    return usdProducts;
  }

  return usdProducts.map((item) => {
    if (item?.currency !== 'USD' || !item.originalPrice) return item;
    const match = String(item.originalPrice).match(/USD\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i);
    const usd = match ? Number(match[1].replace(/,/g, '')) : NaN;
    if (!Number.isFinite(usd) || usd <= 0) return item;
    const priceNtd = Math.round(usd * exchange.rate);
    return {
      ...item,
      price: String(priceNtd),
      priceNtd,
      exchangeRate: exchange.rate,
      exchangeRateFetchedAt: exchange.fetchedAt,
      exchangeRateQuoteDate: exchange.quoteDate,
      exchangeRateStale: Boolean(exchange.stale),
      exchangeRateSource: exchange.source,
      exchangeRateSourceUrl: exchange.sourceUrl
    };
  });
}

async function searchProductsWithMeta(options, dependencies = {}) {
  const normalizedOptions = {
    ...options,
    keyword: normalizeSearchKeyword(options.keyword)
  };
  const requestedPlatforms = Array.isArray(normalizedOptions.platforms)
    ? normalizedOptions.platforms
    : String(normalizedOptions.platforms || 'all').split(',');
  const platforms = PLATFORM_IDS
    .filter(platform => platform !== 'coolpc')
    .filter(platform => requestedPlatforms.includes('all') || requestedPlatforms.includes(platform));
  normalizedOptions.platforms = platforms;
  const usedPlatforms = Object.keys(USED_SOURCES).filter(id => requestedPlatforms.includes('all') || requestedPlatforms.includes(id));
  const retail = async () => {
    if (!platforms.length && !dependencies.getMarketData && !dependencies.scrapePlatforms) return { products: [], meta: null };
    return dependencies.getMarketData
      ? dependencies.getMarketData(normalizedOptions.keyword, platforms, { forceRefresh: normalizedOptions.forceRefresh === true })
      : dependencies.scrapePlatforms
        ? { products: await dependencies.scrapePlatforms(normalizedOptions.keyword, platforms), meta: null }
        : getDailyMarketData(normalizedOptions.keyword, platforms, { forceRefresh: normalizedOptions.forceRefresh === true });
  };
  const used = async () => usedPlatforms.length
    ? (dependencies.searchUsedProducts || searchUsedProducts)({ ...normalizedOptions, platforms: usedPlatforms })
    : { data: [], meta: { sourceStatus: {} } };
  const [retailResult, usedResult] = await Promise.allSettled([retail(), used()]);
  if (retailResult.status === 'rejected' && !usedPlatforms.length) throw retailResult.reason;
  if (usedResult.status === 'rejected' && !platforms.length) throw usedResult.reason;
  const marketData = retailResult.status === 'fulfilled' ? retailResult.value : { products: [], meta: null };
  const usedData = usedResult.status === 'fulfilled' ? usedResult.value : { data: [], meta: { sourceStatus: {} } };
  const products = await convertUsdProducts(marketData.products, dependencies.getUsdNtdRate || getUsdNtdRate);
  const sourceStatus = { ...(usedData.meta?.sourceStatus || {}) };
  if (retailResult.status === 'rejected') sourceStatus.retail = { name: '購物通路', status: 'unavailable', count: 0, message: '購物通路暫時無法讀取' };
  if (usedResult.status === 'rejected') sourceStatus.used = { name: '二手刊登', status: 'unavailable', count: 0, message: '二手刊登暫時無法讀取' };
  const seen = new Set();
  const data = filterSearchResults([...products, ...usedData.data], normalizedOptions).filter(item => {
    const key = item.url || `${item.platform}:${item.name}:${item.price}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  for (const id of usedPlatforms) {
    if (!sourceStatus[id]) continue;
    const status = sourceStatus[id];
    const count = data.filter(item => item.source === id).length;
    sourceStatus[id] = { ...status, count,
      filtered: (status.filtered || 0) + Math.max(0, (status.count || 0) - count),
      status: status.status === 'ok' && !count ? 'empty' : status.status,
      message: status.status === 'ok' && !count ? '沒有符合共同搜尋條件的商品' : status.message };
  }
  return {
    data,
    meta: { ...marketData.meta, mode: 'unified', sourceStatus,
      updatedAt: Math.max(Number(marketData.meta?.updatedAt) || 0, Number(usedData.meta?.updatedAt) || 0) || Date.now(),
      retailUpdatedAt: marketData.meta?.updatedAt || null, liveListings: usedPlatforms.length > 0 }
  };
}

async function searchProducts(options, dependencies = {}) {
  return (await searchProductsWithMeta(options, dependencies)).data;
}

module.exports = {
  SYNONYM_GROUPS,
  normalizeSearchKeyword,
  expandExcludeWords,
  parsePrice,
  filterSearchResults,
  extractGpuFamily,
  matchesGpuFamily,
  convertUsdProducts,
  searchProducts,
  searchProductsWithMeta
};
