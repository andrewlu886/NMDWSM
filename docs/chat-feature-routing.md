# 自然語言功能與圖片上下文

`public/hardware-context.js` 同時供前後端解析功能、保留完整型號及定位來源。
四項功能為 `market`、`valuation`、`recommendation`、`power`。
常見指令使用固定規則，自由說法由 Llama 回傳受限的功能提示，經相同驗證後才執行。
模型輸出的型號及可信狀態不會直接寫入硬體上下文。

聊天介面保存當前功能、功能佇列、產品來源及待確認狀態。明確的新需求取代舊佇列；
重複需求接續缺少的條件。查市價與估價同時出現時依句中順序執行。
圖片在功能執行前辨識，未核對的型號須先確認，確認後接續原功能。
文字明確提供的產品也保存為使用者輸入，不標示為圖片已核對。
推薦沿用既有商品搜尋及評分，`requiredHardware` 限制結果必須有相符規格；
規格不明或不同尾碼的商品不當成符合條件的配置。

## `/api/chat` 可選欄位

- `routeFeatures: true`：回傳 `featureAction`，包含 `features` 順序、`targetText` 與從原文取得的 `products`。
- `resolveFeatureOnly: true`：僅判讀功能；沒有明確需求則回傳 `featureAction: null`，不執行查價或計算。
- `recognitionOnly: true`：僅辨識上傳圖片，保留原有辨識欄位，查價與後續條件交給聊天共同入口。
- `executeFeature: true`、`intent: 'market'`：執行已選定產品的既有市價查詢。失敗回傳 `retryable`，介面保留進度。
- `featureRequest`：可選的結構化需求，仍經共同規則驗證。

保留 `model` 舊欄位，另以 `textModel`、`visionModel` 與 `recognitionDiagnostics`
區分文字模型、讀圖模型及實際辨識階段。舊 `chatAction: { type: 'valuation' }` 仍可使用。

## 圖片一致性及診斷

一般圖片固定使用同一提示、溫度及 seed，再以相同順序取得 CPU OCR 證據。
CPU 關鍵字及所選功能不改變讀圖提示；本機及 gateway 共用相同證據合併規則。
Gemma 候選只能引導原圖文字定位，不能當作獨立 OCR 證據。

模型狀態查詢限時 5 秒；讀圖限時 45 秒（若 `OLLAMA_TIMEOUT_MS` 更短則沿用）；
CPU 文字核對從讀圖完成後獨立計時 18 秒，不再共用整個圖片請求的 45 秒上限。
共用服務的讀圖回應包含 OCR，因此網站另保留 18 秒核對及 5 秒傳輸餘裕；
gateway 內部仍分階段計時。用戶端中斷會取消正在處理的階段，所有計時器在結束時清理。
核對逾時回傳 `degradedReason: 'cpu_timeout'`，顯示可重新送出圖片重試的說明；
保留候選且不寫入已核對圖片快取，不調降核對門檻。

`logs/image-recognition.jsonl` 保存請求編號、解碼圖片雜湊、尺寸、模型 digest、
CPU 版本指紋、提示版本、快取狀態、模型載入與各階段耗時、逾時、候選與結果。
不額外保存圖片、OCR 全文或聊天內容。單檔超過 2 MB 時保留一份輪替備份。
已核對 CPU 圖片快取維持 5 分鐘；模型／提示／核對版本變更使快取失效，模型標籤最多每分鐘更新一次。

執行 `npm run test:chat-context` 驗證分流與確認契約。
以 `npm run model:image:consistency -- "圖片完整路徑"` 測試真實模型：
同一檔案使用圖片功能的預設提示、自然語言辨識、市價及估價四種問法，並重建測試網站以略過圖片快取。
測試使用記憶體資料庫，結束時關閉自己啟動的網站與 CPU worker，卸載測試額外載入的模型。
結果在 `.cache/image-consistency/report.json`；測試一致不代表該圖片一定可讀或型號必定正確。

舊聊天紀錄缺少原圖雜湊與模型階段紀錄，因此無法證實歷史 i7-12700／12700K 差異的原因。
使用本機替代圖片重現時，報告明確標示它不是已證實的歷史上傳位元組。
