const axios = require('axios');

async function scrape(keyword) {
  try {
    console.log(`[欣亞] 正在透過 API 搜尋: ${keyword}`);
    const apiUrl = `https://gateway.sinya.com.tw/api/diy/search?keyword=${encodeURIComponent(keyword)}`;
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.sinya.com.tw/'
      },
      timeout: 5000
    });

    const results = [];
    const items = response.data.data || [];
    items.forEach((item) => {
      if (item && item.prod_name && item.prod_name.toLowerCase().includes(keyword.toLowerCase())) {
        results.push({
          platform: '欣亞',
          name: item.prod_name,
          price: item.price ? item.price.toLocaleString() : '請至官網確認',
          url: item.prod_id
            ? `https://www.sinya.com.tw/prod/${item.prod_id}`
            : `https://www.sinya.com.tw/search?keyword=${encodeURIComponent(keyword)}`
        });
      }
    });

    console.log(`[欣亞] API 搜尋完成，過濾後找到 ${results.length} 筆`);
    return results.slice(0, 99);
  } catch (error) {
    console.error(`欣亞 API 爬蟲失敗: ${error.message}`);
    return [{ platform: '欣亞', name: '錯誤: 取得失敗 (API 異常)', price: 'N/A', url: 'https://www.sinya.com.tw/' }];
  }
}

module.exports = { scrape };
