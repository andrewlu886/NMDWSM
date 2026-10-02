# 一次買夠

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
