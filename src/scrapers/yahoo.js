const cheerio = require('cheerio');
const puppeteer = require('./browser');
const { loadProductPage } = require('./browser-page');

async function scrape(keyword) {
  console.log(`[Yahoo購物] 啟動隱形瀏覽器搜尋: ${keyword}`);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const searchUrl = `https://tw.buy.yahoo.com/search/product?p=${encodeURIComponent(keyword)}`;
    await loadProductPage(page, searchUrl, 'a[href*="/gdsale/"], a[href*="/activity/"]', 'Yahoo購物');

    for (let index = 0; index < 3; index += 1) {
      await page.evaluate(() => globalThis.scrollBy(0, 800));
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const content = await page.content();
    const $ = cheerio.load(content);
    const results = [];
    $('a[href*="/gdsale/"], a[href*="/activity/"]').each((_index, element) => {
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
      const html = $(element).html() || '';
      const priceMatch = html.replace(/<[^>]+>/g, ' ').match(/\$\s*([0-9,]+)/);
      const price = priceMatch ? priceMatch[1].replace(/,/g, '') : null;
      if (name && price && parseInt(price, 10) > 0 && name.length > 5) {
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

    console.log(`[Yahoo購物] 搜尋完成，找到 ${uniqueResults.length} 筆`);
    return uniqueResults.slice(0, 10);
  } catch (error) {
    console.error(`❌ Yahoo購物 爬蟲失敗: ${error.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrape };
