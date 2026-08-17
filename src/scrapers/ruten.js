const axios = require('axios');

async function scrape(keyword) {
  try {
    console.log(`[露天] 第一階段：正在搜尋 "${keyword}" 取得商品 ID...`);
    const searchUrl = `https://rtapi.ruten.com.tw/api/search/v3/index.php/core/prod?q=${encodeURIComponent(keyword)}&type=direct&sort=rnk/dc`;
    const searchResponse = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 5000
    });

    const searchRows = searchResponse.data.Rows || [];
    if (searchRows.length === 0) {
      console.log(`[露天] 找不到 "${keyword}" 的相關商品`);
      return [];
    }

    const itemIds = searchRows
      .slice(0, 99)
      .map((row) => row.Id || row.GoodsNo)
      .filter(Boolean)
      .join(',');
    if (!itemIds) return [];

    console.log('[露天] 第二階段：已取得 IDs，準備獲取詳細價格與名稱...');
    const detailUrl = `https://rtapi.ruten.com.tw/api/prod/v3/index.php/prod?id=${itemIds}`;
    const detailResponse = await axios.get(detailUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 5000
    });

    const results = [];
    const items = detailResponse.data || [];
    items.forEach((item) => {
      const itemPrice = item.PriceRange && item.PriceRange.length > 0
        ? item.PriceRange[0]
        : item.Price || item.DirectPrice;
      results.push({
        platform: '露天',
        name: item.ProdName || '露天商品',
        price: itemPrice ? itemPrice.toLocaleString() : '請至賣場確認',
        url: item.ProdId
          ? `https://www.ruten.com.tw/item/show?${item.ProdId}`
          : `https://www.ruten.com.tw/find/?q=${encodeURIComponent(keyword)}`
      });
    });

    console.log(`[露天] 搜尋完成，共解析了 ${results.length} 筆詳細資料`);
    return results;
  } catch (error) {
    console.error(`露天爬蟲失敗: ${error.message}`);
    return [{ platform: '露天', name: '錯誤: 取得失敗 (API 異常)', price: 'N/A', url: 'https://www.ruten.com.tw/' }];
  }
}

module.exports = { scrape };
