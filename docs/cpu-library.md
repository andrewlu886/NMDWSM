# CPU 圖片庫與文字優先辨識（2026-10-15）

## 已實作

104 個型號、1,402 張原圖均收錄於私人圖庫。104 張經目視核對的完整 SKU 圖片供精確型號查詢；其餘圖片保留待複核、隔離或排除狀態供人工比對。完整收錄不代表每張原圖的資料夾標籤均已認證。每型號現階段選一張可讀參考圖；另一種盒裝／散片保留缺額，最多各一張的限制仍保留。

原圖留在 `C:\Users\leo20\Desktop\cpu訓練`，系統衍生圖片、完整清單與索引放在專案 `data/cpu-library`，Git 忽略此目錄。來源授權尚未確認，圖片只允許本機 loopback Host、socket 且沒有轉送標頭的請求讀取。公開網站可顯示辨識結果；私人圖片不會隨 Git 推送或公開部署。

開啟本機 `/cpu-library.html` 可依型號瀏覽全量圖片，點圖查看細節。聊天只顯示一般回答，不加狀態卡、證據面板或圖庫按鈕。`GET /api/cpu/library?model=i7-12700F&offset=0` 每頁最多 48 張，僅本機可用。`GET /api/cpu/references?model=i7-12700F` 僅回傳已核對標準圖，使用標準型號完全匹配，最多盒裝／散片各一張。未完成複核的圖片不會成為模型已驗證的依據。

## 辨識與確認

依使用者 2026-10-15 的更新要求，`text-first-v2` 直接肯定回答唯一且完整的文字核對結果。這取代先前「全部結果均需人工確認」的設定，沒有宣稱已完成外部獨立精確率驗證。

上傳原圖 → Gemma 判斷實際類別與可見文字 → CPU 分類／OCR 核對 → 後端決定狀態。指定 CPU 的估價流程或訊息會並行執行 Gemma 與 OCR。一般照片先判斷類別，GPU、主機板與發票不進 CPU 核對。

- `verified`：完整 SKU 與尾碼通過現有分類／品牌核對政策。符合嚴格 OCR（至少 0.85），或 Gemma 明確抄出完整標籤且同一實際文字區域的 OCR（至少 0.6、原圖字高至少 16px）讀到相同完整 SKU。必須沒有完整型號衝突。直接回答「這是……」，市價查詢、估價與瓦數流程可接續。Gemma 自報信心不參與判定。
- `candidate`：只有 Gemma 候選、文字不足、舊 worker 尚未套用清楚文字政策，或型號未受支援。要求確認完整型號。
- `conflict`：出現不同完整 SKU。要求輸入或選擇一個型號；僅回覆「是」不會任選其中之一。
- `unreadable`：沒有完整型號。請裁切標籤、補拍或輸入。

OCR 保留原始文字、信心、文字框及座標空間。局部補讀使用上傳照片實際偵測文字的位置，分別裁取最多兩個 SKU 區域，並映射回原圖保留細節；記錄原圖裁切座標、旋轉角度及縮放比例。盒上 logo 距離 SKU 較遠時，保留同張上傳照片實際讀到且沒有完整 SKU 的 Intel／Core 品牌文字作脈絡，以 contextReadingIndexes 回溯原始座標。盒子與散片同框時，採用能讀到完整 SKU 的較清楚區域；另一區域讀不到字不構成衝突，若讀到另一完整 SKU 則需確認。未知但完整的 OCR SKU 也會參與衝突判定。參考庫圖片不送入 OCR 證據，也不以資料夾標籤補數字或尾碼。人工確認記錄為 user；模型核對記錄為 model。

對 CPU 蝕刻標籤的局部補讀，採固定灰階及對比 2 倍前處理，並保留原始 OCR 與 `preprocessing` 紀錄。此處理只改善像素對比，不用候選型號補字；嚴格 OCR 與 Gemma＋區域 OCR 結合的驗證方法分開記錄於 `verificationMethod`。重複 OCR 不是新增獨立證據。`Intel(R) Core(TM)`、®、™ 只作商標格式正規化，不修改 SKU 數字或尾碼。

型號名錄另核對網站 CPU 清單與既有模型／圖片索引。若已通過分類核對且原圖 OCR 清楚讀到完整五位數 Intel SKU，另一個未列於名錄、同家族同尾碼且少一數字的低證據讀值，只保留於 `evidence.anomalies`，不構成另一個正式 SKU；不直接修補原讀值。若該短讀值本身也有高信心 OCR、兩個型號都有效、尾碼不同、未知型號仍完整，或缺少已核對的原圖文字，保留確認／分歧。

網頁上傳保留符合大小與像素限制的原始檔，可手動拖選或輸入百分比裁切標籤。上傳預覽提供拍近、避反光及低解析度提醒；觸控裝置提供拍照入口。提醒不會擋下可讀小圖，裁切不宣稱能還原模糊文字。衍生圖移除 EXIF、不放大、縮圖最長邊 480px，參考圖最長邊 4096px、最多 1.8MB 與 1,600 萬像素。

## 回應時間

正常流程移除 Llama → Gemma → Llama 的額外往返，後端使用同一份 OCR 政策決定結果。保留 `deepReview:true` 供診斷，最多一次 Gemma 重讀、兩次 Llama 審閱。正常使用不會自動進入此慢流程。

OCR 有 18 秒獨立等待上限，圖片請求整體最多等待 45 秒（可依既有設定縮短），逾時保留候選；gateway 即使核對失敗也標記已嘗試，網站不會重複等待同一次核對。模型清單快取 60 秒、OCR 結果快取 5 分鐘最多 20 筆、已 verified 照片結果快取 5 分鐘最多 10 筆；快取只按同一照片與流程，不增加獨立證據。OCR worker 與模型保溫 10 分鐘。結構化結果包含辨識時間，網站可顯示。

## 建立、驗證、啟動

```powershell
.cache/cpu-vision-venv/Scripts/python.exe scripts/cpu_vision/build_library.py --source "C:\Users\leo20\Desktop\cpu訓練" --skip-contact-sheets
.cache/cpu-vision-venv/Scripts/python.exe scripts/cpu_vision/verify_library.py --source "C:\Users\leo20\Desktop\cpu訓練"
node --test test/cpu-vision.test.js test/cpu-recognition-contract.test.js test/market-chat.test.js test/market-agent.test.js test/ollama-remote.test.js
node --test test/chat-feature-command.test.js test/cpu-image-ui.test.js
.cache/cpu-vision-venv/Scripts/python.exe scripts/cpu_vision/test_recognition.py
node scripts/evaluate-cpu-browser.js i7-12700F --deep-baseline
npm start
```

本機需 Ollama 已安裝 `gemma3:4b`、CPU Python 環境及既有權重。其他電腦需從自己的原始資料重建私人圖片包，不能只複製 Git 專案就取得照片。網站及本機 gateway 重啟才會載入程式更新；沒有重訓權重，也沒有公開部署。

## 驗收與評估限制

`models/cpu-library/reviews.json` 保存目視入選與隔離紀錄，`summary.json` 保存 104 型號及缺額。完整逐張清單位於私人 `inventory.json`，全圖索引為 `catalog.json`，標準參考索引為 `index.json`。`verification.json` 核對 1,402 張原圖雜湊、EXIF、尺寸與檔案限制。

2026-10-15 掃描全量場景，針對可疑擁擠照片檢視原尺寸，新增 9 張 `scene_sku_unreadable` 排除紀錄。圖庫隱藏全部 12 張已排除圖片，原圖與完整清單保留。`i5-13500_盒裝_003.jpg` 的盒上 i5-13500 可讀，依「任一側完整標籤可讀即採用」原則保留；場景可用的註記不會自動把其餘待複核圖片升格為標準型號證據。

已知錯標（i7-12700_散片_008 實際 K、i5-13400F_散片_005 實際無 F）、i3-13100/F 重複圖、19 組跨型號近似圖片及 R7-7700X 尾碼疑點均不進標準圖索引。近似構圖不等於錯標，因此保留隔離而不自動改標籤。另排除目視發現的 9850X3D 圖中 9800X3D、浮水印、遮字等問題。

已知來源的所有圖片均列入 `evaluation-exclusions.json` 的 knownSourceSha256；標準參考及其群另列 sha256/groups，既有候選不能作新的獨立成績。瀏覽器實測採用現有圖片，只驗證功能與時間。新來源至少 100 張自動採用、99% 正確率及尾碼／衝突零錯誤的發布成效門檻仍未取得足夠資料；不得把本機抽測稱為達標或對未來照片的保證。
