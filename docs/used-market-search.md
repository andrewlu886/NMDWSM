# 整合市價查詢

查詢頁只有一組來源勾選框與一個搜尋按鈕。`GET /api/scrape` 統一使用 `searchProductsWithMeta`，不再依全新／二手模式分流。

來源：欣亞、露天、PChome、Momo、Newegg、Yahoo 購物中心、PTT HardwareSale、旋轉拍賣、Yahoo 拍賣。勾選框統一為藍色。

露天保留 `src/scrapers/ruten.js` 原本兩階段 API 爬蟲，僅查詢一次；不同價格上下限、價格區間及已售出標記會被排除。原全新通路與露天仍使用每日快取，快取讀出後再次套用價格區間篩選。PTT、旋轉拍賣與 Yahoo 拍賣使用 `src/services/used-search.js` 的即時公開刊登驗證，排除全新、已售出、沒有固定价格與無法驗證的刊登。

所有結果套用共同關鍵字、排除字、類別、精確搜尋及價格排序，再按原刊登網址去重。部分來源失敗不影響其餘来源返回，二手來源狀態在 `meta.sourceStatus` 回報。前端統一顯示結果，二手來源保留原刊登連結且不存進商品快照。

Facebook 勾選項、搜尋模組、解析程式與相關樣式均已移除。智慧推薦的「商品狀況」預設全新，全新沿用原購物通路爬蟲與每日快取。選擇二手時，以「二手主機／二手筆電」等關鍵字重新呼叫原爬蟲（不沿用昨日的刊登），並整合 PTT、旋轉拍賣與 Yahoo 拍賣的公開二手刊登。兩者沿用相同的預算、用途、CPU／GPU 評分與跨平台推薦排序。二手必須有明確的二手標記或商品狀況資料；售出、無庫存、無固定價格、全新與狀况不明的資料不會列入二手推薦。

部署需包含 `public/server.js`、`public/scrape.html`、`public/market-page.css`、`src/services/search.js`、`src/services/used-search.js`、`src/scrapers/ruten.js`，並移除已退役的兩個 FB 服務檔案。本機修改不會自動推送或部署。

智慧推薦 API：`POST /api/recommend` 的 `condition` 可為 `new` 或 `used`，未傳入時預設 `new`；其他值回傳 400。頁面將選擇值送到 API，推薦卡片與 AI 解讀也保留同一商品狀況。

二手來源保留原貼文／商品頁已取得的規格內文，用相同 CPU／GPU／RAM 解析與評分處理標題未寫規格的整機刊登；PTT 不會把推文或板規範本當成商品規格。零件機、故障與無法開機商品不作為可用整機推薦。
