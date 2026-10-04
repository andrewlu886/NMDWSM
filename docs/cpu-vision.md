# CPU 圖片辨識模型

CPU 訓練資料每個型號一個資料夾，遞迴讀取其中 JPG、PNG、WebP；不把盒裝與散片視為不同分類。
目前使用 `C:\Users\leo20\Desktop\cpu訓練`。原始圖片僅讀取，訓練不會修改或刪除。

## 建立環境與訓練

使用 Python 3.12 建立專案內獨立環境。這不會更動 Ollama 或網站的 Node 套件。

```powershell
python -m venv .cache/cpu-vision-venv
.cache/cpu-vision-venv/Scripts/python.exe -m pip install -r scripts/cpu_vision/requirements.txt
npm run model:cpu:train -- --data "C:\Users\leo20\Desktop\cpu訓練"
```

已建立的環境可直接跑第三行。可用 `CPU_VISION_PYTHON` 指定其他安裝了需求套件的 Python 執行檔。
要完全重現本次套件版本，可使用 `scripts/cpu_vision/requirements-lock.txt` 安裝。
Linux 使用 `.cache/cpu-vision-venv/bin/python`；需求檔中的 CPU 套件來源為 PyTorch 官方下載站。
首次需要下載 [MobileNetV3 權重](https://docs.pytorch.org/vision/0.21/models/generated/torchvision.models.mobilenet_v3_large.html) 與 [EasyOCR 權重](https://github.com/JaidedAI/EasyOCR)。運行辨識時不會下載。

模型訓練包含：圖片有效性檢查、像素與感知相似度分組、跨型號近似群排除、依圖片群分開訓練／校準／測試、訓練完整型號、系列及品牌分類層。
校準只使用 validation；測試資料不回填至正式模型，不以原圖與裁切圖分別作訓練及測試。
近似分組不能證明照片來源完全獨立。少於三組獨立圖片的型號不列入模型。

純外觀無法可靠區分每個尾碼，所以分類模型只供候選／系列核對，EasyOCR 另讀完整型號。
數字與尾碼不模糊比對；只有照片同時可讀 Intel／Core 時，允許 OCR 把家族前綴 i 誤讀成 1、l、0、[ 的格式正規化，仍須完全相同的 SKU 數字及尾碼。
完整型號純影像分類在這份資料上效果有限，因此實際型號必須有文字依據，品牌模型及候選結果用於核對；不能靠影像分數自行補出 SKU。
核對策略只在校準集至少採用 20 張、採用結果正確率達 90% 時啟用。這不保證其他照片也達 90%；最終效果與涵蓋率列於報告。
分類 softmax 只作排序，不把它顯示成 AI 正確率。模糊或衝突的辨識型號仍需使用者確認。
這是 CPU 資料模型，不是通用硬體／非 CPU 偵測器。

## 本機網站與 Render

本機網站在 Gemma 判斷為 CPU、且不是發票時，才使用 CPU 模型核對。GPU／主機板／RAM 保持既有流程。
Gemma 的原始觀察、CPU 分類候選及 OCR 文字分別保留，再交由本機 Llama 比較。Llama 只回傳有限的來源選擇，不可自行產生 SKU、改數字或補尾碼；分類候選的排名分數不是型號證據。
CPU worker 會接收 Gemma 的原始觀察。若 Gemma 提出已收錄型號而原始 OCR 未核對通過，worker 會依圖片實際偵測到的文字區域裁切、校正傾斜並放大，追加一次 OCR；原始文字與補查文字一起核對。Gemma 的型號只作補查線索，不能替代像素文字、強制分類結果或降低門檻。worker 回傳是否補查及仍需重讀的疑點，Gemma 重新看原圖時也會收到這些資訊。若 Gemma 補查才讀出新型號，且 CPU 尚未核對通過，會把新觀察再送入 CPU worker，最後由 Llama 審閱更新證據。這是推論時的雙向合作，沒有共同重訓權重。
Llama 可提出完整標籤、尾碼或來源衝突的補查問題。Gemma 會收到同一張原始圖片與雙方觀察，重新讀取可見文字，再由 Llama 審閱回答。每張照片最多一次 Gemma 補查、兩次 Llama 審閱，不進入無限問答；已一致的結果不必補查。重新讀到不同型號會保留前後候選；同一個 Gemma 重複回答不視為獨立驗證，也不自動提高信心。
OCR 讀不清時保留 Gemma 的候選型號，請使用者確認，不會直接抹成無法辨識。兩方完整型號不同時，保留雙方並請核對數字與尾碼；皆沒有完整型號才要求補拍。Llama 失敗時仍保留雙方觀察，不影響其他 AI 請求。
`Model` 保留供既有程式解析：核對通過可帶入型號；單方未確認或衝突時為 unknown，候選放在 `Candidate`。`Review` 記錄 corroborated/candidate/conflict/unreadable，`Llama review` 記錄實際來源比較結果。
新版網站的二手估價流程在完整型號唯一、Gemma 讀取清楚且前後無衝突時，自動帶入型號並繼續詢問保固等估價條件；模糊或衝突時請使用者確認。一般聊天的照片回覆仍提供型號確認。既有 Render 的聊天 Llama 會收到整份來源觀察；更新網站前的前端行為依已部署版本為準。
模型或 Python 環境未安裝、舊版 gateway 不支援、逾時或其他失敗時，保留原本 Gemma 視覺流程。

CPU 模型透過常駐 stdio Python worker 運行；閒置兩分鐘後釋放，下一次會重新載入。只接收圖片內容，不接受上傳者提供的檔案路徑。
依需求啟動 worker，最多同時排隊兩張，30 秒逾時。

Render 不需安裝這些 Python 套件。新版本機 gateway 在 Gemma 的 CPU 照片回覆後取得模型觀察並呼叫本機 Llama 審閱，因此原有 Render 網站也能取得共同判讀的回覆，無須先推送網站或改環境變數。
新版網站可透過既有 `OLLAMA_BASE_URL` 和驗證密鑰呼叫 `POST /api/cpu/recognize`；gateway 已核對的回覆會跳過重複辨識。
需要重啟本機 gateway 載入功能。重啟 gateway 不必重啟 Cloudflare tunnel，網址可保持。
本機 localhost 網站也需重啟 Node 伺服器以載入程式修改。

權重 `models/cpu-vision/model.pt`、OCR 模型目錄 `models/cpu-vision/ocr/` 和所有原圖不提交 Git；它們必須保存在執行 AI 的電腦。
可追蹤的 `models/cpu-vision/metadata.json`、`report.json`、`report.md` 記錄版本、支援型號、限制和實際測試結果。
訓練暫存於 `.cache/cpu-vision`；重訓前若更改 OCR 規則以外的影像前處理，需換快取版本，避免沿用不同輸入特徵。
先前報告的 99.1% 是原有 OCR 核對通過子集的測試精確率，不能套用到本次保留的 Gemma 候選、補查 OCR 或 Llama 審閱結果。本次修改沒有重訓模型，也沒有以測試照片降低 OCR 門檻。

## 驗證

```powershell
node --test test/cpu-vision.test.js test/ollama-remote.test.js test/market-chat.test.js test/market-agent.test.js
.cache/cpu-vision-venv/Scripts/python.exe scripts/cpu_vision/test_recognition.py
```

`scripts/cpu_vision/evaluate_uploads.py` 會另外以固定種子抽 50 張 test 圖片，模擬網頁 1024px／JPEG 品質 78 的壓縮後辨識。
Pillow 編碼與瀏覽器 canvas 並非完全相同，這是額外抽樣檢查，不是新獨立測試集，也不回調核對門檻。

2026-10-05 共同判讀實測：使用使用者提供的 `i5 14400.jpg`，僅在本機傳送圖片，完成 Gemma 初讀 → CPU 模型/OCR → Llama 提問 model_label → Gemma 原圖補查 → Llama 最終審閱。Gemma 前後皆讀到 i5-14400，CPU OCR 未讀清；最終保留 i5-14400 候選並請使用者確認，沒有取用外觀排名第一的 i5-13400。本機網站 `/api/chat` 也回覆此候選與確認要求。相關 35 個 Node 測試及 6 個 Python 測試通過；沒有上傳這張照片至 Render、修改權重或推送 Git。

同日雙向補查更新實測：同一張照片的 CPU worker 回傳 `receivedGemma: true`、`hypothesis: i5-14400`、`focusedOcr: true`，確認實際使用 Gemma 線索並追加像素文字補查；疑點一併送入 Gemma 的原圖重讀要求。最终仍保留 i5-14400，沒有宣稱 OCR 已確認或精確率提高。本次 42 個相關 Node 測試、8 個 Python 測試通過，涵蓋錯誤 Gemma 線索不能強制模型接受、無可讀文字不接受、新觀察回饋 worker 後交給最終審閱。
