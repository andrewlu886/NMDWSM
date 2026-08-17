const axios = require('axios');

async function scrape(keyword) {
  try {
    console.log(`[PChome] 正在透過 API 搜尋: ${keyword}`);
    const apiUrl = `https://ecshweb.pchome.com.tw/search/v3.3/all/results?q=${encodeURIComponent(keyword)}&page=1&sort=rnk/dc`;
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://24h.pchome.com.tw/',
        'Origin': 'https://24h.pchome.com.tw'
      },
      timeout: 5000
    });

    const results = [];
    const products = response.data.prods || [];
    products.forEach((item) => {
      const itemName = item.name || item.Name;
      const itemPrice = item.price || item.Price;
      const itemId = item.Id || item.id;
      results.push({
        platform: 'PChome',
        name: itemName || 'PChome 商品',
        price: itemPrice ? itemPrice.toLocaleString() : '請至官網確認',
        url: itemId
          ? `https://24h.pchome.com.tw/prod/${itemId}`
          : `https://ecshweb.pchome.com.tw/search/v3.3/?q=${encodeURIComponent(keyword)}`
      });
    });

    console.log(`[PChome] 搜尋完成，找到 ${results.length} 筆`);
    return results.slice(0, 99);
  } catch (error) {
    console.error(`PChome 爬蟲失敗: ${error.message}`);
    return [];
  }
}

module.exports = { scrape };
