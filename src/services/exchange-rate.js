const axios = require('axios');
const database = require('../../public/db');

const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_URL = 'https://rate.bot.com.tw/xrt/flcsv/0/day';
const FALLBACK_URL = 'https://api.frankfurter.dev/v2/providers/cbc/rate/usd/twd';

function getTaipeiDate(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(timestamp);
}

function parseUsdSpotSellRate(csv) {
  const usdRow = String(csv || '').split(/\r?\n/).find((line) => /USD/i.test(line));
  if (!usdRow) throw new Error('臺灣銀行匯率資料中找不到美元欄位。');

  const columns = usdRow.split(',').map((value) => value.trim().replace(/^"|"$/g, ''));
  // 臺銀 CSV 欄序：幣別、現金買入／賣出、即期買入／賣出。
  const rate = Number(columns[4]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('臺灣銀行美元即期賣出匯率格式無效。');
  return rate;
}

function parseFallbackUsdNtdRate(data) {
  const rate = Number(data?.rate);
  if (String(data?.base || '').toUpperCase() !== 'USD' || String(data?.quote || '').toUpperCase() !== 'TWD'
    || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('備援匯率資料格式無效。');
  }
  return { rate, quoteDate: data.date };
}

function createExchangeRateProvider({
  fetchCsv = async () => (await axios.get(SOURCE_URL, { timeout: 10000, responseType: 'text' })).data,
  fetchFallback = async () => (await axios.get(FALLBACK_URL, { timeout: 10000 })).data,
  loadCached = () => database.getExchangeRate('USD/TWD'),
  saveCached = (rate) => database.saveExchangeRate(rate, 'USD/TWD'),
  now = Date.now
} = {}) {
  let cached = null;
  let loadPromise = null;
  let pendingRequest = null;

  async function loadCache() {
    if (!loadPromise) {
      loadPromise = Promise.resolve().then(loadCached).then((value) => {
        if (Number.isFinite(value?.rate) && Number.isFinite(value?.fetchedAt)) cached = value;
      });
    }
    await loadPromise;
  }

  return async function getUsdNtdRate() {
    await loadCache();
    const today = getTaipeiDate(now());
    if (cached && cached.cacheDate === today) return cached;
    if (pendingRequest) return pendingRequest;

    pendingRequest = (async () => {
      let latest;
      try {
        const rate = parseUsdSpotSellRate(await fetchCsv());
        const fetchedAt = now();
        latest = {
          rate,
          source: '臺灣銀行牌告匯率（美元即期賣出）',
          sourceUrl: SOURCE_URL,
          fetchedAt,
          quoteDate: getTaipeiDate(fetchedAt),
          cacheDate: getTaipeiDate(fetchedAt)
        };
      } catch (bankError) {
        try {
          const fallback = parseFallbackUsdNtdRate(await fetchFallback());
          const fetchedAt = now();
          latest = {
            ...fallback,
            source: '臺灣央行美元兌台幣收盤匯率（備援）',
            sourceUrl: FALLBACK_URL,
            fetchedAt,
            cacheDate: getTaipeiDate(fetchedAt)
          };
        } catch (fallbackError) {
          if (cached) return { ...cached, stale: true };
          throw new Error(`臺銀匯率抓取失敗（${bankError.message}），備援匯率也無法取得（${fallbackError.message}）。`);
        }
      }

      try {
        await saveCached(latest);
        cached = latest;
      } catch (error) {
        console.warn(`[匯率] 匯率已取得，但寫入資料庫失敗：${error.message}`);
        cached = latest;
      }
      return cached;
    })().catch((error) => {
      if (cached) return { ...cached, stale: true };
      throw error;
    }).finally(() => {
      pendingRequest = null;
    });
    return pendingRequest;
  };
}

const getUsdNtdRate = createExchangeRateProvider();

module.exports = {
  DAY_MS,
  SOURCE_URL,
  FALLBACK_URL,
  getTaipeiDate,
  parseUsdSpotSellRate,
  parseFallbackUsdNtdRate,
  createExchangeRateProvider,
  getUsdNtdRate
};
