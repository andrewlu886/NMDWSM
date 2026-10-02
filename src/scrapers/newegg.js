const cheerio = require('cheerio');
const puppeteer = require('./browser');
const { loadProductPage } = require('./browser-page');
const { fetchSearchHtml } = require('./search-html');
const { getUsdNtdRate } = require('../services/exchange-rate');

function convertUsdPrice(priceWhole, priceFraction, exchange) {
  const whole = String(priceWhole || '').replace(/[^\d]/g, '');
  const fraction = String(priceFraction || '').replace(/[^\d]/g, '');
  const usd = Number(`${whole || '0'}.${fraction.padEnd(2, '0').slice(0, 2) || '00'}`);
  if (!Number.isFinite(usd) || usd <= 0) return null;

  const originalPrice = `USD $${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (!exchange) return { price: originalPrice, originalPrice, currency: 'USD' };

  const priceNtd = Math.round(usd * exchange.rate);
  return {
    price: String(priceNtd),
    priceNtd,
    originalPrice,
    currency: 'USD',
    exchangeRate: exchange.rate,
    exchangeRateFetchedAt: exchange.fetchedAt,
    exchangeRateQuoteDate: exchange.quoteDate,
    exchangeRateStale: Boolean(exchange.stale),
    exchangeRateSource: exchange.source,
    exchangeRateSourceUrl: exchange.sourceUrl
  };
}

async function scrape(keyword) {
  console.log(`[Newegg] 搜尋美國硬體: ${keyword}`);
  let browser;
  try {
    const searchUrl = `https://www.newegg.com/p/pl?d=${encodeURIComponent(keyword)}`;
    let content = await fetchSearchHtml(searchUrl, '.item-cell .item-title', 'newegg');
    if (!content) {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=en-US']
      });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await loadProductPage(page, searchUrl, '.item-cell .item-title', 'Newegg');

      content = await page.content();
    }
    const $ = cheerio.load(content);
    const results = [];
    $('.item-cell').each((_index, element) => {
      const name = $(element).find('.item-title').text().trim();
      const priceWhole = $(element).find('.price-current strong').text().trim();
      const priceFraction = $(element).find('.price-current sup').text().trim();
      const link = $(element).find('.item-title').attr('href');
      if (name && priceWhole) {
        results.push({
          platform: 'Newegg (US)',
          name,
          priceWhole,
          priceFraction,
          url: link,
          sales: 0
        });
      }
    });

    let exchange = null;
    if (results.length) {
      try {
        exchange = await getUsdNtdRate();
      } catch (error) {
        console.warn(`[Newegg] 暫時無法取得臺銀美元匯率：${error.message}`);
      }
    }
    const convertedResults = results.map((item) => {
      const { priceWhole: whole, priceFraction: fraction, ...product } = item;
      return { ...product, ...convertUsdPrice(whole, fraction, exchange) };
    });

    console.log(`[Newegg] 搜尋完成，找到 ${convertedResults.length} 筆`);
    return convertedResults.slice(0, 99);
  } catch (error) {
    console.error(`❌ Newegg 爬蟲失敗: ${error.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrape, convertUsdPrice };
