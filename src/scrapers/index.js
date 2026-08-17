const coolpc = require('./coolpc');
const sinya = require('./sinya');
const ruten = require('./ruten');
const pchome = require('./pchome');
const momo = require('./momo');
const newegg = require('./newegg');
const yahoo = require('./yahoo');

const PLATFORM_IDS = Object.freeze([
  'coolpc',
  'sinya',
  'ruten',
  'pchome',
  'momo',
  'newegg',
  'yahoo'
]);

const RECOMMENDATION_PLATFORM_IDS = Object.freeze([
  'coolpc',
  'sinya',
  'pchome',
  'momo',
  'yahoo',
  'ruten'
]);

const scraperRegistry = Object.freeze({
  coolpc: coolpc.scrape,
  sinya: sinya.scrape,
  ruten: ruten.scrape,
  pchome: pchome.scrape,
  momo: momo.scrape,
  newegg: newegg.scrape,
  yahoo: yahoo.scrape
});

function resolvePlatformIds(platformIds, registry) {
  const requested = Array.isArray(platformIds)
    ? platformIds
    : String(platformIds || 'all').split(',');
  const useAll = requested.includes('all');
  const availableIds = PLATFORM_IDS.filter((id) => typeof registry[id] === 'function');
  return availableIds.filter((id) => useAll || requested.includes(id));
}

async function scrapePlatforms(keyword, platformIds = PLATFORM_IDS, registry = scraperRegistry) {
  const selectedIds = resolvePlatformIds(platformIds, registry);
  const results = await Promise.all(selectedIds.map(async (id) => {
    try {
      const products = await registry[id](keyword);
      return Array.isArray(products) ? products : [];
    } catch (error) {
      console.error(`[${id}] 未預期的爬蟲錯誤: ${error.message}`);
      return [];
    }
  }));
  return results.flat();
}

module.exports = {
  PLATFORM_IDS,
  RECOMMENDATION_PLATFORM_IDS,
  scraperRegistry,
  resolvePlatformIds,
  scrapePlatforms
};
