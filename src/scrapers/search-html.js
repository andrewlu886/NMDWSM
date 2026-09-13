const axios = require('axios');
const cheerio = require('cheerio');

async function fetchSearchHtml(url, selector, platform) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    const content = typeof response.data === 'string' ? response.data : '';
    const $ = cheerio.load(content);
    if ($(selector).length) {
      console.log(`[${platform}] 公開 HTML 已取得商品資料`);
      return content;
    }
    console.warn(`[${platform}] 公開 HTML 無商品；HTTP ${response.status}；標題: ${$('title').text().slice(0, 160)}`);
  } catch (error) {
    console.warn(`[${platform}] 公開 HTML 取得失敗；HTTP ${error.response?.status || '未收到回應'}；${error.message}`);
  }
  return null;
}

module.exports = { fetchSearchHtml };
