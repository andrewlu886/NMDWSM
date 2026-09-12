const { scrapePlatforms } = require('../scrapers');
const { normalizeSearchKeyword } = require('../utils/search-keyword');

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

function filterSearchResults(products, options) {
  const includeWords = splitWords(options.include);
  let excludeWords = expandExcludeWords(splitWords(options.exclude));
  const categoryWords = splitWords(options.categories, ',');
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
    const includeMatch = includeWords.length === 0
      || includeWords.every((word) => name.includes(word.toLowerCase()));
    const excludeMatch = excludeWords.length === 0
      || !excludeWords.some((word) => name.includes(word.toLowerCase()));
    const categoryMatch = categoryWords.length === 0
      || categoryWords.some((word) => name.includes(word.toLowerCase()));
    if (!includeMatch || !excludeMatch || !categoryMatch) return false;
    return minimumPrice === 0 || parsePrice(item.price) >= minimumPrice;
  });

  return filtered.sort((left, right) => parsePrice(left.price) - parsePrice(right.price));
}

async function searchProducts(options, dependencies = {}) {
  const scrape = dependencies.scrapePlatforms || scrapePlatforms;
  const normalizedOptions = {
    ...options,
    keyword: normalizeSearchKeyword(options.keyword)
  };
  const products = await scrape(normalizedOptions.keyword, normalizedOptions.platforms || 'all');
  return filterSearchResults(products, normalizedOptions);
}

module.exports = {
  SYNONYM_GROUPS,
  normalizeSearchKeyword,
  expandExcludeWords,
  parsePrice,
  filterSearchResults,
  searchProducts
};
