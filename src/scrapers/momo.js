const axios = require('axios');

async function scrape(keyword) {
  try {
    console.log(`[Momo] 正在透過 API 搜尋: ${keyword}`);
    const apiUrl = 'https://apisearch.momoshop.com.tw/momoSearchCloud/moec/textSearch';
    const payload = {
      host: 'momoshop',
      flag: 1,
      data: {
        searchValue: keyword,
        curPage: '1',
        priceS: '0',
        priceE: '9999999',
        searchType: '1'
      }
    };
    const response = await axios.post(apiUrl, payload, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/json',
        'Origin': 'https://www.momoshop.com.tw',
        'Referer': `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${encodeURIComponent(keyword)}`
      },
      timeout: 10000
    });

    const results = [];
    const goodsList = response.data?.rtnSearchData?.goodsInfoList || [];
    if (goodsList.length === 0 && response.data?.rtnSearchData) {
      console.log('[Momo 偵錯] rtnSearchData 回傳的欄位', Object.keys(response.data.rtnSearchData));
    }

    goodsList.forEach((item) => {
      const rawPrice = String(item.goodsPrice || item.price || '');
      const cleanPrice = rawPrice.replace(/[^0-9]/g, '');
      results.push({
        platform: 'Momo',
        name: item.goodsName || item.name || 'Momo 商品',
        price: cleanPrice ? parseInt(cleanPrice, 10).toLocaleString() : '請至官網確認',
        url: item.goodsCode
          ? `https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=${item.goodsCode}`
          : `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${encodeURIComponent(keyword)}`
      });
    });

    console.log(`[Momo] 搜尋完成，找到 ${results.length} 筆`);
    return results.slice(0, 99);
  } catch (error) {
    const status = error.response?.status;
    const responseData = error.response?.data;
    const responsePreview = responseData
      ? JSON.stringify(responseData).slice(0, 500)
      : '';
    console.error(
      `[Momo] 爬蟲失敗${status ? ` (HTTP ${status})` : ''}: ${error.message}`
      + (responsePreview ? ` | 回應: ${responsePreview}` : '')
    );
    return [];
  }
}

module.exports = { scrape };
