# 一次估夠

電腦硬體推薦、市價查詢、二手估價與跑分教學平台。

## 功能

- 依預算與用途產生硬體推薦
- 查詢多個線上通路的即時價格
- 二手硬體估價與保固資訊
- CPU、GPU 與記憶體跑分教學

## 本機啟動

1. 安裝 Node.js 20。
2. 執行 `npm install`。
3. 執行 `npm start`。
4. 開啟 `http://localhost:3000`。

預設使用 `public/nmdwsm.db`。如需指定其他 SQLite 檔案，可設定 `DB_PATH` 環境變數。

## 本機 Llama 3.1 AI 助手

聊天助手透過 Ollama 在本機執行 Llama 3.1，並可呼叫「一次估夠」既有的二手估價、市價查詢、智慧推薦及瓦數計算功能。請先安裝並啟動 Ollama，再下載模型：

```powershell
ollama pull llama3.1:8b
ollama serve
```

若要在聊天視窗上傳硬體圖片辨識，還需另下載支援圖像的本機模型：

```powershell
ollama pull gemma3:4b
```

預設圖片模型為已安裝 Gemma 3 4B（約 3.3 GB）；Llama 3.1 文字模型本身不能接收圖片。圖片只送到本機 Ollama 作辨識，網站不會因此訓練或微調模型權重；辨識型號會先要求使用者確認，避免直接拿不確定的型號查價或估價。可在 `.env` 以 `OLLAMA_VISION_MODEL` 指定其他已安裝的 Ollama 視覺模型。模型規格可參考 [Ollama Gemma 3](https://ollama.com/library/gemma3)。

將 `.env.example` 中的設定加入既有 `.env`，需要時調整 `OLLAMA_BASE_URL`、`OLLAMA_MODEL`、`OLLAMA_VISION_MODEL` 或 `OLLAMA_TIMEOUT_MS`。重新啟動網站後，聊天視窗會顯示文字與圖片模型連線狀態。Ollama 未啟動時，網站仍可使用，聊天助手會退回功能導覽與頁面連結。

估價與瓦數需要足夠的型號及使用資料；模型會先追問缺漏資訊，計算結果以網站後端資料為準。

## 維護 CPU 參考價格

CPU 價格以資料庫為準。啟動時，程式清單只補入缺少的 CPU 報價，保留既有的價格、來源與日期。Intel 存在 `hardware_cpu_pricing_models`；AMD 存在 `hardware_reference_prices`。其他硬體的匯入方式不受此規則影響。

先停止本機網站並備份資料庫，再用 SQLite 工具開啟實際使用的資料庫。價格請填大於 0 的新臺幣整數。以下 SQL 的型號、金額、來源及日期都是示例，請依實際報價修改；儲存並重新啟動網站後，重新選取型號即可帶入新價格。

### Intel CPU

先查詢型號、價格和來源：

```sql
SELECT m.canonical_model AS model, p.reference_price_ntd,
       p.source_name, p.source_url, p.source_checked_at
FROM hardware_cpu_pricing_models AS p
JOIN hardware_models AS m ON m.id = p.hardware_model_id
ORDER BY m.canonical_model;
```

依完整型號更新價格，同時記錄來源及查價日期（沒有來源網址時可填空字串）：

```sql
BEGIN TRANSACTION;
UPDATE hardware_cpu_pricing_models
SET reference_price_ntd = 6500,
    source_name = '手動確認的報價',
    source_url = '',
    source_checked_at = '2026-09-18'
WHERE hardware_model_id = (
  SELECT id FROM hardware_models
  WHERE category = 'cpu' AND manufacturer = 'Intel'
    AND canonical_model = 'Core i5-12400'
);
SELECT changes() AS updated_rows; -- 此例應為 1
COMMIT;
```

### AMD CPU

查詢單買及搭購報價：

```sql
SELECT model, price_ntd, offer_type, source_file, imported_at, notes
FROM hardware_reference_prices
WHERE category = 'cpu' AND brand = 'AMD'
ORDER BY model, offer_type, imported_at DESC;
```

`standalone` 是估價採用的單買價，`motherboard_bundle` 是搭購價。用上面查到的完整型號、報價種類和原始來源精確指定要修改的那筆資料：

```sql
BEGIN TRANSACTION;
UPDATE hardware_reference_prices
SET price_ntd = 16000,
    source_file = '手動報價-20260918.csv',
    imported_at = '2026-09-18',
    notes = '單買價，已人工確認'
WHERE category = 'cpu' AND brand = 'AMD'
  AND model = 'Ryzen 7 9800X3D'
  AND offer_type = 'standalone'
  AND source_file = '2026-09-10_214500.png';
SELECT changes() AS updated_rows; -- 此例應為 1
COMMIT;
```

`imported_at` 記錄這筆報價的匯入／更新日期；如需另記查價日期，可寫入 `notes`。同型號若有多個來源的單買報價，網站優先使用 `imported_at` 較新的資料。修改來源後，下一次更新 SQL 的條件也要使用新的來源。要修改搭購價時，將條件改為 `motherboard_bundle`，它不會成為估價自動填入的單買價。

首次建立新資料庫仍會匯入初始價格。刪除初始清單中的 Intel 價格，或刪光某個 AMD 型號同一報價種類的資料，下次啟動會補回初始價格，因此刪除不代表停用型號。網站表單內的改價只影響當次估價，不會寫回資料庫。

確認修改後，關閉資料庫工具及網站程序，再將 `public/nmdwsm.db` 納入 commit、推送並重新部署。若設定了 `DB_PATH`，務必確認部署使用的是更新過的那份資料庫。Render 免費方案採用此「本機維護、隨部署發布」方式；線上執行期間修改的 SQLite 檔案不會自動回存 GitHub。
