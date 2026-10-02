const cheerio = require('cheerio');
const axios = require('axios');
const puppeteer = require('./browser');
const { loadProductPage } = require('./browser-page');
const { fetchSearchHtml } = require('./search-html');

const UNAVAILABLE_PAGE_PATTERN = /查無此商品|找不到(?:該|此)?商品|商品不存在|頁面不存在|商品已下架|此商品已下架|商品已失效|目前無法販售|暫無庫存|商品已停售/i;

function isUnavailableYahooProductPage(status, html, finalUrl = '') {
  if (status === 404 || status === 410) return true;
  if (status < 200 || status >= 400 || typeof html !== 'string') return false;
  if (finalUrl) {
    try {
      const url = new URL(finalUrl);
      if (url.hostname !== 'tw.buy.yahoo.com' || !url.pathname.startsWith('/gdsale/')) return true;
    } catch {
      return true;
    }
  }
  const pageText = cheerio.load(html).text().replace(/\s+/g, ' ');
  return UNAVAILABLE_PAGE_PATTERN.test(`${pageText} ${html}`);
}

async function filterUnavailableYahooProducts(products, request = axios.get) {
  const results = new Array(products.length);
  let nextIndex = 0;
  const workerCount = Math.min(4, products.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < products.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = products[index];
      if (!/^https:\/\/tw\.buy\.yahoo\.com\/gdsale\//i.test(item.url || '')) {
        results[index] = item;
        continue;
      }

      try {
        const response = await request(item.url, {
          timeout: 7000,
          maxContentLength: 2_000_000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml'
          },
          validateStatus: () => true
        });
        const finalUrl = response.request?.res?.responseUrl || response.request?.responseURL || '';
        if (!isUnavailableYahooProductPage(response.status, response.data, finalUrl)) results[index] = item;
      } catch {
        // Keep results when the product page cannot be checked due to a transient network error.
        results[index] = item;
      }
    }
  }));

  return results.filter(Boolean);
}

function extractYahooPrice($, element) {
  const product = $(element);
  const promotionPattern = /折價券|優惠券|折抵|刷卡金|回饋金|現金回饋|折扣碼|coupon|cashback/i;
  const installmentPattern = /分期|每期|月付|每月/i;
  const pricePattern = /(?:NT\s*\$|TWD\s*\$?|US\s*\$|\$)\s*([\d,]+)|([\d,]+)\s*(?:元|NTD)/gi;
  const leafTexts = product.find('*')
    .filter((_index, node) => $(node).children().length === 0)
    .toArray()
    .map((node) => $(node).text().replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const textCandidates = leafTexts.length ? leafTexts : [product.text().replace(/\s+/g, ' ').trim()];

  for (const text of textCandidates) {
    let match;
    while ((match = pricePattern.exec(text)) !== null) {
      const context = text.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20);
      const before = text.slice(Math.max(0, match.index - 12), match.index);
      if (promotionPattern.test(context)
        || (installmentPattern.test(before) && /\$/.test(match[0]))
        || /折\s*$/.test(before)) continue;
      return (match[1] || match[2]).replace(/,/g, '');
    }
  }

  return null;
}

function isPlausibleYahooPrice(name, price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return false;
  const text = String(name || '');
  const isComputer = /桌機|桌上型|迷你電腦|迷你桌機|筆電|筆記型|laptop|notebook|電腦主機|電競主機/i.test(text);
  if (!isComputer) return true;
  if (value < 1500) return false;
  if (/迷你電腦|迷你桌機/i.test(text) && value > 100000) return false;
  return true;
}

async function scrape(keyword) {
  console.log(`[Yahoo購物] 搜尋: ${keyword}`);
  let browser;
  try {
    const searchUrl = `https://tw.buy.yahoo.com/search/product?p=${encodeURIComponent(keyword)}`;
    let content = await fetchSearchHtml(searchUrl, 'a[href*="/gdsale/"]', 'yahoo');
    if (!content) {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await loadProductPage(page, searchUrl, 'a[href*="/gdsale/"], a[href*="/activity/"]', 'Yahoo購物');

      for (let index = 0; index < 3; index += 1) {
        await page.evaluate(() => globalThis.scrollBy(0, 800));
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      content = await page.content();
    }
    const $ = cheerio.load(content);
    const results = [];
    $('a[href*="/gdsale/"]').each((_index, element) => {
      const link = $(element).attr('href');
      let name = $(element).find('img').attr('alt');
      if (!name) {
        $(element).find('span, div').each((_childIndex, child) => {
          if ($(child).children().length === 0) {
            const text = $(child).text().trim();
            if (text.length > (name?.length || 0) && !text.includes('比較找相似') && !text.includes('折價券')) {
              name = text;
            }
          }
        });
      }

      name = (name || '').replace(/^比較找相似\s*/, '').trim();
      const price = extractYahooPrice($, element);
      const listingText = `${name} ${$(element).text()}`;
      if (/售完|已售完|缺貨|無庫存|下架|暫停販售|補貨中/i.test(listingText)) return;
      if (name && price && isPlausibleYahooPrice(name, price) && name.length > 5) {
        results.push({
          platform: 'Yahoo購物',
          name,
          price,
          url: link.startsWith('http') ? link : `https://tw.buy.yahoo.com${link}`,
          sales: 0
        });
      }
    });

    const uniqueResults = [];
    const urls = new Set();
    results.forEach((item) => {
      if (!urls.has(item.url)) {
        urls.add(item.url);
        uniqueResults.push(item);
      }
    });

    const checkedResults = await filterUnavailableYahooProducts(uniqueResults.slice(0, 10));
    console.log(`[Yahoo購物] 搜尋完成，找到 ${checkedResults.length} 筆（已排除失效商品頁）`);
    return checkedResults;
  } catch (error) {
    console.error(`❌ Yahoo購物 爬蟲失敗: ${error.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  scrape,
  extractYahooPrice,
  isPlausibleYahooPrice,
  isUnavailableYahooProductPage,
  filterUnavailableYahooProducts
};
