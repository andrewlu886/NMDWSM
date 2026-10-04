# 讓 Render 網站共用你的電腦上的 AI

連線流程：用戶瀏覽器 → Render 網站 → HTTPS 通道 → 本機密鑰轉接服務 → Ollama。
用戶與協作者只需要網站網址，不需要安裝 Ollama、下載模型或取得密鑰。

## Windows 快速啟動

本機已準備好通道工具時，在專案目錄執行：

```powershell
.\scripts\start-shared-ai.ps1
```

這會在背景啟動轉接服務與臨時通道，並產生 `.env.render-ai`。將該檔案的設定匯入 Render Environment；檔案含密鑰，不要貼到公開聊天或提交 GitHub。不要將它匯入前端。
停止：

```powershell
.\scripts\stop-shared-ai.ps1
```

通道工具放在忽略追蹤的 `tools/cloudflared.exe`；未提供該檔案的電腦請依下方步驟安裝 cloudflared。

## 1. 電腦端準備

在專案目錄執行：

```powershell
ollama pull llama3.1:8b
ollama pull gemma3:4b
npm run ai:setup
npm run ai:gateway
```

如果找不到 ollama 指令，可使用安裝位置：
`C:\Users\你的帳號\AppData\Local\Programs\Ollama\ollama.exe`。
Windows 的 Ollama 應保持執行；沒有啟動時才另外執行 `ollama serve`。
`ai:setup` 會建立隨機密鑰到 `.env.ai-gateway`，重複執行不會覆蓋原有密鑰。
此檔案已由 `.gitignore` 的 `.env.*` 規則排除。不要把密鑰放在前端或 GitHub。
轉接服務只監聽 `127.0.0.1:11435`，不需要將 Ollama 改成對外監聽，也不需要開放路由器連入連接埠。
它允許已驗證的 `GET /api/tags`、`POST /api/chat` 與 `POST /api/ptt/search`。AI 只允許上述兩個模型，預設最多同時 2 個請求。PTT 只查詢 HardwareSale 公開搜尋與文章，不接受自訂 URL；獨立限制最多 2 個查詢，同一關鍵字快取 60 秒。

## 2. 建立通道

安裝 [cloudflared](https://developers.cloudflare.com/tunnel/downloads/)。
在另一個 PowerShell 視窗執行（前一個轉接服務需保持運行）：

```powershell
cloudflared tunnel --url http://127.0.0.1:11435
```

複製輸出的 `https://...trycloudflare.com` 網址。這個網址指向受密鑰保護的轉接服務，而非直接公開 Ollama。
不要加上需要瀏覽器登入的 `--allowed-mail`，Render 的後端無法完成互動式登入。
[Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) 適合測試；重啟後網址會改變，也沒有上線時間保證。
正式供用戶使用時，建立有固定網域的 [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) 並將服務指向同一個本機位址。
也可加上 Cloudflare Access 的 Service Auth 政策，再設定下方兩個 CF Access 變數。

## 3. Render 設定

在 Render Dashboard → nmdwsm → Environment 填入：

| 名稱 | 值 |
| --- | --- |
| OLLAMA_BASE_URL | 通道的 HTTPS 網址，不加 /api/chat |
| OLLAMA_API_KEY | 本機 .env.ai-gateway 裡 AI_GATEWAY_TOKEN 的值 |
| OLLAMA_MODEL | llama3.1:8b |
| OLLAMA_VISION_MODEL | gemma3:4b |
| OLLAMA_TIMEOUT_MS | 90000 |
| OLLAMA_STATUS_TIMEOUT_MS | 5000 |

儲存並重新部署；只修改本機 .env 不會更新 Render。現有 Render 服務仍需手動填入這些變數；render.yaml 提供新 Blueprint 的設定欄位。
Render 的 PTT 查詢預設共用 `OLLAMA_BASE_URL` 與 `OLLAMA_API_KEY`，經由本機取得資料，避免 Render 直接讀取 PTT 遭拒絕。無須新增環境變數；仍需部署新版程式及重啟本機 gateway。要使用獨立的轉接服務，可設定 `PTT_GATEWAY_URL`（HTTPS 基底網址）與 `PTT_GATEWAY_API_KEY`。一般本機執行網站時仍直接查詢 PTT。gateway 失聯時會回報來源無法使用，不會顯示過期快取或假商品。
如果採用 Cloudflare Access Service Auth，再於 Render 設定 `OLLAMA_CF_ACCESS_CLIENT_ID` 和 `OLLAMA_CF_ACCESS_CLIENT_SECRET`；兩者需一起提供。
[Service token 官方文件](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)。
所有密鑰只由網站後端送出，瀏覽器和狀態 API 不會取得它們。

## 4. 確認連線

先把程式修改推送至 GitHub 並讓 Render 部署新版本，再開啟：
`https://nmdwsm-6d0g.onrender.com/api/chat/status`。
預期 `available`、`modelInstalled`、`visionModelInstalled` 為 true，`serviceMode` 為 shared。
網站會顯示「共用 AI 已連線」。請再測試文字對話與上傳硬體圖片。

若 available 為 false：確認電腦沒有睡眠、Ollama 與轉接服務及通道都在運行、通道網址沒有變更、兩端密鑰一致。
若模型未安裝：在提供模型的電腦執行 ollama pull，而非要求使用者下載。
關閉電腦或通道時，AI 會離線；正式長期服務需要保持主機與通道持續運行。
