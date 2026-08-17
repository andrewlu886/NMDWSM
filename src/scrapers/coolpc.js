const axios = require('axios');
const cheerio = require('cheerio');

async function scrape(keyword) {
  try {
    console.log(`[原價屋] 正在搜尋: ${keyword}`);
    const response = await axios.get('https://www.coolpc.com.tw/evaluate.php', {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 5000
    });

    const html = new TextDecoder('big5').decode(response.data);
    const $ = cheerio.load(html);
    const results = [];

    $('option').each((_index, element) => {
      const text = $(element).text();
      if (text.toLowerCase().includes(keyword.toLowerCase())) {
        const priceMatch = text.match(/\$(\d+)/);
        results.push({
          platform: '原價屋',
          name: `${text.substring(0, 125)}...`,
          price: priceMatch ? priceMatch[1] : '請至官網確認',
          url: 'https://www.coolpc.com.tw/evaluate.php'
        });
      }
    });

    console.log(`[原價屋] 搜尋完成，找到 ${results.length} 筆`);
    return results.slice(0, 99);
  } catch (error) {
    console.error(`原價屋爬蟲失敗: ${error.message}`);
    return [{ platform: '原價屋', name: '錯誤: 取得失敗', price: 'N/A', url: 'https://www.coolpc.com.tw/evaluate.php' }];
  }
}

module.exports = { scrape };
