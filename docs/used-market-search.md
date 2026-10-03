# 整合市價查詢

查詢頁只有一組來源勾選框與一個搜尋按鈕。`GET /api/scrape` 統一使用 `searchProductsWithMeta`，不再依全新／二手模式分流。

來源：欣亞、露天、PChome、Momo、Newegg、Yahoo 購物中心、PTT HardwareSale、旋轉拍賣、Yahoo 拍賣。勾選框統一為藍色。

露天保留 `src/scrapers/ruten.js` 原本兩階段 API 爬蟲，僅查詢一次；不同價格上下限、價格區間及已售出標記會被排除。原全新通路與露天仍使用每日快取，快取讀出後再次套用價格區間篩選。PTT、旋轉拍賣與 Yahoo 拍賣使用 `src/services/used-search.js` 的即時公開刊登驗證，排除全新、已售出、沒有固定价格與無法驗證的刊登。

所有結果套用共同關鍵字、排除字、類別、精確搜尋及價格排序，再按原刊登網址去重。部分來源失敗不影響其餘来源返回，二手來源狀態在 `meta.sourceStatus` 回報。前端統一顯示結果，二手來源保留原刊登連結且不存進商品快照。

Facebook 勾選項、搜尋模組、解析程式與相關樣式均已移除。智慧推薦仍使用原購物通路爬蟲與推薦排序，不會自動加入 PTT 等二手來源。

部署需包含 `public/server.js`、`public/scrape.html`、`public/market-page.css`、`src/services/search.js`、`src/services/used-search.js`、`src/scrapers/ruten.js`，並移除已退役的兩個 FB 服務檔案。本機修改不會自動推送或部署。
