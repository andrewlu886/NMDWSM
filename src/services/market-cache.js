const fs = require('node:fs');
const path = require('node:path');
const { scrapePlatforms, PLATFORM_IDS } = require('../scrapers');
const { normalizeSearchKeyword } = require('../utils/search-keyword');

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 6;
const DEFAULT_CACHE_PATH = path.join(__dirname, '../../.cache/market-search-cache.json');

function createMarketCache({
  scrape = scrapePlatforms,
  ttlMs = DAY_MS,
  cachePath = DEFAULT_CACHE_PATH,
  now = Date.now
} = {}) {
  const entries = new Map();
  const inFlight = new Map();

  if (cachePath) {
    try {
      const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      Object.entries(saved).forEach(([key, value]) => {
        if (Array.isArray(value?.products) && Number.isFinite(value.updatedAt)) entries.set(key, value);
      });
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[市價快取] 無法讀取快取檔：${error.message}`);
    }
  }

  function persist() {
    if (!cachePath) return;
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      const temporaryPath = `${cachePath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(Object.fromEntries(entries)), 'utf8');
      fs.renameSync(temporaryPath, cachePath);
    } catch (error) {
      console.warn(`[市價快取] 無法儲存快取：${error.message}`);
    }
  }

  async function get(keyword, platforms = 'all', options = {}) {
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    const requestedPlatforms = Array.isArray(platforms) ? platforms : String(platforms || 'all').split(',');
    const platformIds = PLATFORM_IDS.filter((id) => requestedPlatforms.includes('all') || requestedPlatforms.includes(id));
    const key = JSON.stringify([CACHE_SCHEMA_VERSION, normalizedKeyword.toLowerCase(), platformIds]);
    const cachedEntry = entries.get(key);
    const timestamp = now();

    if (!options.forceRefresh && cachedEntry && timestamp - cachedEntry.updatedAt < ttlMs) {
      return {
        products: cachedEntry.products,
        meta: { cached: true, updatedAt: cachedEntry.updatedAt, nextUpdateAt: cachedEntry.updatedAt + ttlMs }
      };
    }

    if (inFlight.has(key)) return inFlight.get(key);

    const request = (async () => {
      try {
        const products = await Promise.resolve().then(() => scrape(normalizedKeyword, platformIds));
        const entry = { products: Array.isArray(products) ? products : [], updatedAt: now() };
        entries.set(key, entry);
        if (entries.size > 500) {
          const oldestKey = [...entries.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0][0];
          entries.delete(oldestKey);
        }
        persist();
        return {
          products: entry.products,
          meta: { cached: false, updatedAt: entry.updatedAt, nextUpdateAt: entry.updatedAt + ttlMs }
        };
      } catch (error) {
        if (cachedEntry) {
          return {
            products: cachedEntry.products,
            meta: {
              cached: true,
              stale: true,
              updatedAt: cachedEntry.updatedAt,
              nextUpdateAt: cachedEntry.updatedAt + ttlMs
            }
          };
        }
        throw error;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, request);
    return request;
  }

  return { get, entries };
}

const marketCache = createMarketCache();

async function getDailyMarketData(keyword, platforms = 'all', options = {}) {
  return marketCache.get(keyword, platforms, options);
}

module.exports = { DAY_MS, createMarketCache, getDailyMarketData };
