const { RECOMMENDATION_PLATFORM_IDS, scrapePlatforms } = require('../scrapers');
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

function rankRecommendations(options, products) {
  const validProducts = [];
  const minimumPrice = 5000;

  products.forEach((item) => {
    if (!item || !item.price) return;
    const cleanPrice = parseInt(String(item.price).replace(/[^\d]/g, ''), 10);
    if (Number.isNaN(cleanPrice) || cleanPrice === 0 || cleanPrice > options.budget || cleanPrice < minimumPrice) return;
    if (options.usage === 'gaming' && item.name.includes('文書')) return;

    const cpu = extractCPU(item.name);
    const gpu = extractGPU(item.name);
    const ram = extractRAM(item.name);
    const os = extractOS(item.name);
    if (cpu === 'UNKNOWN' && gpu === 'UNKNOWN') return;
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
    recommendations: validProducts.slice(0, 3)
  };
}

async function getRecommendations(options, dependencies = {}) {
  if (!['desktop', 'laptop'].includes(options.productType)) {
    throw new Error('商品種類僅支援套裝主機或筆記型電腦');
  }
  const scrape = dependencies.scrapePlatforms || scrapePlatforms;
  const keyword = getSearchKeyword(options.productType, options.usage);
  const products = await scrape(keyword, RECOMMENDATION_PLATFORM_IDS);
  return rankRecommendations(options, products);
}

module.exports = {
  getSearchKeyword,
  rankRecommendations,
  getRecommendations
};
