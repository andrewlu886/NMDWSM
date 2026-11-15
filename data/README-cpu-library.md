# 本機 CPU 圖片資料夾

`data/cpu-library/` 是此 Git 專案內供本機 AI 程式讀取的固定私人資料夾。

- `catalog.json`：1,402 張圖片、104 個資料夾型號及複核狀態。
- `index.json`：104 張已目視核對標準圖，依完整 SKU 精確查詢。
- `inventory.json`：來源相對路徑、雜湊、尺寸、切分及近似群。
- `<原圖雜湊前20碼>-thumbnail.jpg` / `-reference.jpg`：去 EXIF、不放大的衍生圖片。
- `evaluation-exclusions.json`：既有來源及參考圖群，避免誤算新來源獨立評估。

此資料夾已加入 `.gitignore`，因圖片來源授權未確認，不隨 Git 推送。原圖仍保留在桌面 `cpu訓練`，未搬動或覆寫。舊 `.cache/cpu-library` 可作舊版本備份；現行程式讀取此固定資料夾。

重新建置：

```powershell
.cache/cpu-vision-venv/Scripts/python.exe scripts/cpu_vision/build_library.py --source "C:\Users\leo20\Desktop\cpu訓練" --skip-contact-sheets
.cache/cpu-vision-venv/Scripts/python.exe scripts/cpu_vision/verify_library.py --source "C:\Users\leo20\Desktop\cpu訓練"
```

照片要由程式明確讀取或透過圖片介面提交，AI 不會因資料夾存在而自動學會圖片。現行流程利用 SKU 索引查詢及原圖文字核對；參考圖不替代上傳照片證據，也沒有重新訓練權重。
