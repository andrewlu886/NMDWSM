# 市價查詢訓練資料提案與採用紀錄

日期：2026-10-04。狀態：使用者已同意調整；此提案已採用至 `train_keyword3.csv`，完成模型訓練並接入市價查詢程式。線上 Render 部署需另行進行。

完整草稿：[train_keyword3.proposed.csv](train_keyword3.proposed.csv)。沿用原檔的 FastText「標籤＋商品名稱」文字格式，並非逗號分隔表格。

## 商品範圍

一般搜尋：保留與關鍵字相關的電腦零件、整機、筆電、組合套餐與直接電腦周邊。相關性仍須另外比對查詢字詞及型號，不能只靠分類。限制商品類型，不設定結果筆數上限。

任何模式都排除：吸塵器、家電、防蚊液、蚊香、手機、遊戲主機、麻將用品、電腦椅、電競椅、電腦桌、電競桌、書桌、辦公桌椅及這些桌椅的專用配件。電競桌機是電腦，仍保留。獨立電腦主機托架、顯卡支架、螢幕支架是直接電腦配件，可於一般相關搜尋出現。

草稿保留網路設備、印表機、UPS、工控電腦等電腦相關類型；延續原檔排除電視、投影設備、平板及掌機。支援狀態不明的遊戲控制器暫列文末待確認清單，不武斷當成非電腦商品。

## 搜尋行為提案

|查詢|一般搜尋|精確搜尋|
|---|---|---|
|RTX 4060|相關顯卡、整機、筆電、套餐、配件；可包含 Ti 變體|僅完整型號 RTX 4060 的顯卡單品，不含 Ti、整機、筆電、套餐與配件|
|i5 14400|相關 CPU、整機、套餐、配件；可包含 F 變體|僅完整型號 i5-14400 的 CPU 單品，不含 14400F、整機與套餐；盒裝附原廠散熱器仍保留|
|主機|電腦整機，不把加購標籤當整機|電腦整機|
|電腦桌／電腦椅|排除|排除|

精確搜尋的「單品」不表示只顯示一筆。可顯示不同廠牌、賣家的同型號單品。

勾選精確搜尋後，依查詢類型加入排除詞並保留手動輸入。例如顯卡：電競主機、筆記型電腦、組裝套餐、顯卡支架、顯卡散熱器、顯卡水冷頭。避免用「風扇」等泛詞誤刪三風扇顯卡。取消勾選只移除系統自動加入的詞。後端仍須獨立檢查商品類別、完整型號與上下文，不能只依賴排除框。

## 草稿統計

- 原檔：4419 筆。
- 正規化名稱後：4346 個商品文字，原有 73 組跨標籤衝突。
- 草稿：4410 筆、20 類；同名重複與跨標籤衝突均為 0。
- 原有資料經去重、修正標籤後採用 4312 筆。
- 新增 98 筆示例，包含使用者提供的截圖商品名稱及人工撰寫的對照訓練句；人工句不代表已查證的商品刊登。
- 34 筆分類待確認，列於文末，未加入草稿訓練資料。
- 每筆原始資料均歸入草稿、重複合併或待確認清單。

|標籤|意思|筆數|草稿首行|
|---|---|---:|---:|
|part_cpu|CPU 單品|122|1|
|part_gpu|顯卡單品|222|123|
|part_motherboard|主機板|344|345|
|part_ram|記憶體|181|689|
|part_ssd|SSD|203|870|
|part_hdd|HDD|139|1073|
|part_case|機殼|652|1212|
|part_psu|電源供應器|57|1864|
|part_cooling|散熱零件|8|1921|
|part_monitor|電腦螢幕|616|1929|
|part_network|電腦網路設備|166|2545|
|whole_desktop|電腦整機（含工控機）|170|2711|
|whole_laptop|筆記型電腦|279|2881|
|bundle|跨種類零件套餐|5|3160|
|accessory_mouse|滑鼠|163|3165|
|accessory_keyboard|鍵盤|158|3328|
|accessory_controller|明示支援 PC 的遊戲控制器|10|3486|
|accessory_printer|電腦列印周邊|6|3496|
|accessory|電腦配件|612|3502|
|not_pc|排除商品（含桌椅及桌椅配件）|297|4114|

## 訓練與驗證

商品分類與查詢意圖分開：商品標籤不隨一般／精確模式改變，模式決定接受哪些標籤。完整型號與 Ti、SUPER、F 等尾碼另做比對。中文與英數型號採相同預處理規則訓練及推論。

已按商品／型號分組切分訓練、驗證、測試資料，人工新增範例不充當獨立市場測試證據。訓練指令為 `npm run model:train`，離線評估指令為 `npm run model:evaluate`。分類評估見 `models/market-classifier-report.json`；搜尋評估見 `models/market-search-validation-report.json` 和 `models/market-search-test-report.json`。報告只反映已標註的離線商品標題，不能保證即時平台結果的準確率。

目前使用 Node.js 可載入的壓縮模型檔 `models/market-classifier.json.gz`，不依賴 Windows 專用的 FastText 執行檔。模型檔需連同程式碼一起部署到 Render 才會在線上生效。

## 原資料調整紀錄

下表包含改標及重複合併，原檔行號可供逐筆核對。

|原檔行號|原標籤|草稿標籤|原因|商品名稱|
|---|---|---|---|---|
|707, 4107|whole_laptop, out_of_scope|whole_laptop|合併重複商品並保留明確的電腦商品分類|Lenovo IdeaPad 3 i3-1315U 82X700LATW 8G / 512G / 15.6吋 / 藍|
|708, 4108|whole_laptop, out_of_scope|whole_laptop|合併重複商品並保留明確的電腦商品分類|Lenovo IdeaPad 3 Core 5-320 83RS001PTW 16G / 512G / 16吋 / 灰|
|709, 4109|whole_laptop, out_of_scope|whole_laptop|合併重複商品並保留明確的電腦商品分類|Lenovo IdeaPad 3 Ultra 5-322 83US0050TW 16G / 512G / 16吋 / 灰|
|710, 4110|whole_laptop, out_of_scope|whole_laptop|合併重複商品並保留明確的電腦商品分類|Lenovo IdeaPad Pro 5 Ultra X7-358H 83SH000NTW 32G / 1T / 14吋 / 灰|
|1676, 4111|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 4TB【NAS碟】512M HDWG740AZSTC 7200轉 / 3年保|
|1677, 4112|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 6TB【NAS碟】512M HDWG760AZSTA 7200轉 / 3年保|
|1678, 4113|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 8TB【NAS碟】512M HDWG780AZSTA 7200轉 / 3年保|
|1679, 4114|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 10TB【NAS碟】512M HDWG71AAZSTA 7200轉 / 3年保|
|1680, 4115|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 12TB【NAS碟】512M HDWG51CAZSTA 7200轉 / 3年保|
|1681, 4116|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 14TB【NAS碟】512M HDWG51EAZSTA 7200轉 / 3年保|
|1682, 4117|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 16TB【NAS碟】512M HDWG51GAZSTA 7200轉 / 3年保|
|1683, 4118|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 18TB【NAS碟】512M HDWG51JAZSTA 7200轉 / 3年保|
|1684, 4119|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 20TB【NAS碟】512M HDWG62AAZSTA 7200轉 / 3年保|
|1685, 4120|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Toshiba 22TB【NAS碟】512M HDWG62CAZSTA 7200轉 / 3年保|
|1686, 4121|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 2TB【那嘶狼】256M ST2000VN003 5400轉 / 3年保 / 3年 Rescue|
|1687, 4122|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 4TB【那嘶狼】256M ST4000VN006 5400轉 / 3年保 / 3年 Rescue|
|1688, 4123|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 6TB【那嘶狼】256M ST6000VN006 5400轉 / 3年保 / 3年 Rescue|
|1689, 4124|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 8TB【那嘶狼】256M ST8000VN002 5400轉 / 3年保 / 3年 Rescue|
|1690, 4125|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 10TB【那嘶狼】256M ST10000VN000 7200轉 / 3年保 / 3年 Rescue|
|1691, 4126|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 12TB【那嘶狼】256M ST12000VN0008 7200轉 / 3年保3年 Rescue|
|1692, 4127|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 4TB【那嘶狼 PRO】256M ST4000NT001 7200轉 / 5年保 / 3年 Rescue|
|1693, 4128|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 8TB【那嘶狼 PRO】256M ST8000NT001 7200轉 / 5年保 / 3年 Rescue|
|1694, 4129|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 12TB【那嘶狼 PRO】256M ST12000NT001 7200轉 / 5年保 / 3年 Rescue|
|1695, 4130|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 16TB【那嘶狼 PRO】256M ST16000NT001 7200轉 / 5年 / 3年 Rescue|
|1696, 4131|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 20TB【那嘶狼 PRO】256M ST20000NT001 7200轉 / 5年 / 3年 Rescue|
|1697, 4132|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 24TB【那嘶狼 PRO】512M ST24000NT002 7200轉 / 5年 / 3年 Rescue|
|1698, 4133|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 28TB【那嘶狼 PRO】512M ST28000NT000 7200轉 / 5年 / 3年 Rescue|
|1699, 4134|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 30TB【那嘶狼 PRO】512M ST30000NT011 7200轉 / 5年 / 3年 Rescue|
|1700, 4135|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|Seagate 32TB【那嘶狼 PRO】512M ST32000NT000 7200轉 / 5年 / 3年 Rescue|
|1701, 4136|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|WD 2TB【紅標Plus】64M WD20EFPX 5400轉 / 3年保|
|1702, 4137|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|WD 4TB【紅標Plus】128M WD40EFZZ 5400轉 / 3年保|
|1703, 4138|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|WD 8TB【紅標Plus】256M WD80EFPX 5640轉 / 3年保|
|1704, 4139|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|WD 12TB【紅標PRO】512M WD122KFBX 7200轉 / 5年保|
|1705, 4140|part_hdd, out_of_scope|part_hdd|合併重複商品並保留明確的電腦商品分類|WD 16TB【紅標PRO】512M WD161KFGX 7200轉 / 5年保|
|2907, 4141|part_monitor, out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ J55-770 55型 Mini LED量子點遊戲Google TV 〈微距控光&光動態演算技術〉|
|2908, 4142|part_monitor, out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ J65-770 65型 Mini LED量子點遊戲Google TV 〈微距控光&光動態演算技術〉|
|2909, 4143|part_monitor, out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ J75-770 75型 Mini LED量子點遊戲Google TV 〈微距控光&光動態演算技術〉|
|2910, 4144|part_monitor, out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ S65-960 65型 Mini LED量子點遊戲Google TV 〈重低音+天空聲道〉|
|2911, 4145|part_monitor, out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ S85-960 85型 Mini LED量子點遊戲Google TV 〈重低音+天空聲道〉|
|2912, 4146|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|MSI PRO MP165 E6 〈15.6吋/1H2C/IPS/含喇叭〉|
|2913, 4147|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|MSI PRO MP161E6T 〈15.6吋/1H2C/IPS/含喇叭〉10點觸控|
|2914, 4148|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|Acer PM141W 〈14吋/1H2C/IPS / 含喇叭/HDR10〉|
|2915, 4149|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|Acer PM161W 〈16吋/1H2C/IPS / 含喇叭/HDR10〉|
|2916, 4150|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|Acer PM161Q J 〈15.6吋/1H2C/IPS/含喇叭/金色〉|
|2917, 4151|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|Acer PG161Q P 〈15.6吋/1H2C/IPS/165Hz/含喇叭/藍色〉|
|2918, 4152|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|Acer PG161W P1 〈16吋/1H2C/IPS/144Hz/含喇叭/HDR10〉|
|2919, 4153|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|Acer PD243Y E 〈23.8吋/1H2C/IPS/100Hz/含喇叭〉可攜式雙螢幕|
|2920, 4154|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|AOC 16T20 〈15.6吋/1H2C/IPS/含喇叭〉|
|2921, 4155|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|AOPEN 16PM1Q J 〈15.6吋/1H2C/IPS/含喇叭〉|
|2922, 4156|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|AOPEN 16PM1QT 〈15.6吋/1H2C/IPS / 含喇叭/HDR10〉10點觸控|
|2923, 4157|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|AOPEN 16PD3Q 〈15.6吋/1H2C/IPS/含喇叭〉可攜式雙螢幕|
|2924, 4158|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|AOPEN 24UT2Y G 〈23.8吋/1H1P/IPS / 含喇叭〉10點觸控|
|2925, 4159|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|MNN HSP156P4(LT) 〈15.6吋/1H2C/IPS/含喇叭〉|
|2926, 4160|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|LG gram+view 16MR70 〈16吋/2C/IPS〉抗反光面板|
|2927, 4161|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|ViewSonic VA1655-3 〈15.6吋/1H2C/IPS/含喇叭〉|
|2928, 4162|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|ViewSonic VA1650 〈15.6吋/1H2C/IPS/含喇叭〉|
|2929, 4163|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|ViewSonic VG1655 〈15.6吋/1H1C/IPS/含喇叭/無亮點/五年保〉|
|2930, 4164|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|ViewSonic VX1654 〈15.6吋/1H2C/IPS/144Hz/含喇叭〉|
|2931, 4165|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB14AC 〈14吋/1C/IPS〉|
|2932, 4166|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB169CK 〈15.6吋/1H2C/IPS〉360度支架|
|2933, 4167|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB16AHVE 〈15.6吋/1H2C/IPS〉|
|2934, 4168|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB16AHV 〈15.6吋/1H2C/IPS〉可折疊支架|
|2935, 4169|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB16AHG 〈15.6吋/1H2C/IPS/144Hz〉可折疊支架|
|2936, 4170|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB16AMTR 〈15.6吋/1H1C/IPS/含喇叭〉10點觸控.可折疊支架|
|2937, 4171|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB16FC 〈16吋/1H2C/IPS〉可折疊支架|
|2938, 4172|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB16NCG 〈16吋/1H2C/IPS/155Hz/〉可折疊支架|
|2939, 4173|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB16QHG 〈16吋/1H2C/IPS/120Hz/HDR400〉L形支架|
|2940, 4174|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB14FCD 〈14吋/1H2C/IPS/360度摺疊設計〉可攜式雙螢幕|
|2941, 4175|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen MB17AHG 〈17.3吋/1H2C/IPS/144Hz〉L形支架|
|2942, 4176|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ZenScreen OLED MQ16FC 〈16吋/1H2C/OLED〉三腳支架|
|2943, 4177|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ROG Strix XG129C 〈12.3吋/2C/IPS/75Hz/24:9長寬比/10 點觸控〉可調式支架|
|2944, 4178|part_monitor, out_of_scope|part_monitor|合併重複商品並保留明確的電腦商品分類|華碩 ROG Strix XG17AHP 〈17.3吋/1H2C/IPS/240Hz/含喇叭〉可折疊ROG三腳架|
|3401|accessory|not_pc|排除桌椅、家具與其配件；電競桌機不視為電競桌|Raymii OA1 鋁合金電腦桌手臂支撐架 / 六段可調整 / 專業人體工學設計|
|3862|not_pc|whole_desktop|工業與迷你電腦仍屬電腦整機|研華工控機IPC-610L原裝4U主機上架式視覺工控電腦|
|3870|not_pc|accessory|電腦配件與供電周邊|螢幕掛燈|
|3873|not_pc|accessory|電腦配件與供電周邊|電腦主機支架|
|3876|not_pc|accessory|電腦配件與供電周邊|電腦顯示器護眼掛燈|
|4066, 4417|not_pc, out_of_scope|accessory|電腦配件與供電周邊|APC 艾比希 BV800-TW 在線互動式不斷電系統|
|4084|out_of_scope|whole_desktop|工業與迷你電腦仍屬電腦整機|研華 IPC-610L 工業電腦 工控機|
|4085|out_of_scope|whole_desktop|工業與迷你電腦仍屬電腦整機|迷妳電腦酷睿11代 I5/I7OPS電腦 適用教學會議壹體機插拔式主機|
|4086|out_of_scope|whole_desktop|工業與迷你電腦仍屬電腦整機|研拓現貨J1900工控機兩COM雙網NANO工控小主機嵌入式工業主機電腦|
|4087|out_of_scope|whole_desktop|工業與迷你電腦仍屬電腦整機|臺式電腦學校教育考試培訓電腦|
|4088|out_of_scope|whole_desktop|工業與迷你電腦仍屬電腦整機|美視訊微型工控機國產兆芯飛騰J1900 I3I5I7安卓鋁合金工業主機|
|4089|out_of_scope|whole_desktop|工業與迷你電腦仍屬電腦整機|跨境新款口袋迷妳主機WIN11電腦棒|
|4090|out_of_scope|whole_desktop|工業與迷你電腦仍屬電腦整機|聯達12代全鋁迷妳小主機酷|
|4091|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|ASUS Pad T3201M5A 雲朵白 / 12.2吋 / 聯發科 MT8792Z 八核 / 8G / 256G / WIFI|
|4092|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|Lenovo TAB TB311FU 北極藍 / 10.1吋 / 聯發科 G85 八核 / 4G / 128G / WIFI|
|4093|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|TCL NXTPAPER 11 Plus 鈦金灰 / 11.5吋 / 聯發科 G100 八核 / 12G / 256G / WIFI|
|4094|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|TCL NXTPAPER 14 星鑽灰 / 14.3吋 / 聯發科 MT8781 八核 / 8+8G / 256G / WIFI|
|4095|out_of_scope|accessory|電腦配件與供電周邊|ASUS ROG LPR01 電源延長線 1.5M 相容ROG ALLY / 部分 ROG筆電|
|4096|out_of_scope|accessory|電腦配件與供電周邊|ASUS ROG LCR50 240W USB-C to C 充電線 / 編織線 / 1.5米|
|4097|out_of_scope|accessory|電腦配件與供電周邊|ASUS ROG AC140-01 140W GaN四孔充電器 1A3C + C to C 充電線|
|4098|out_of_scope|accessory|電腦配件與供電周邊|ASUS ROG Bulwark Dock DG300 USB(10G*3A1C) / RJ-45 / HDMI2.1 七合一基座|
|4099|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|ASUS ROG XBOX ALLY TRAVEL CASE 二合一收納保護包 / 防潑水|
|4100|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|ASUS ROG XBOX ALLY 白 Ryzen Z2 A / 16G / 512G / Radeon / Wi-Fi 6E|
|4101|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|ASUS ROG XBOX ALLY X 黑 Ryzen AI Z2 Extreme / 24G / 1T / Radeon / Wi-Fi 6E|
|4102|out_of_scope|whole_laptop|筆記型電腦|Lenovo IdeaPad 3 i3-1315U 82X700LATW Lenovo IdeaPad 3 i3-1315U/8G/512G/15.6吋/藍|
|4103|out_of_scope|whole_laptop|筆記型電腦|Lenovo IdeaPad 3 Core 5-320 83RS001PTW Lenovo IdeaPad 3 Core 5-320/16G/512G/16吋/灰|
|4104|out_of_scope|whole_laptop|筆記型電腦|Lenovo IdeaPad 3 Ultra 5-322 83US0050TW Lenovo IdeaPad 3 Ultra 5-322/16G/512G/16吋/灰|
|4105|out_of_scope|whole_laptop|筆記型電腦|Lenovo IdeaPad Pro 5 Ultra X7-358H 83SH000NTW Lenovo IdeaPad Pro 5 Ultra X7-358H/32G/1T/14吋/灰|
|4106|out_of_scope|part_motherboard|主機板|精粵X99主機板|
|4179|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|ACER PL3510ATV 雷射LED/1080P/5000 ANSI Im/家庭劇院投影機|
|4180|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|ACER H6815BD 4K/4000 ANSI lm/家庭劇院投影機|
|4181|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ GV50 雷射/1080P/500 ANSI 智慧微型投影機|
|4182|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ MX560C XGA/4000流明/會議投影機|
|4183|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ MH560 1080P/3800流明/商用投影機|
|4184|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ TK710 4K/3200 ANSI 雷射遊戲投影機|
|4185|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ TK705I 4K/3000 ANSI 智慧調光投影機|
|4186|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|BenQ TK705STI 4K/3000 ANSI 短焦智慧調光投影機|
|4187|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|Raymii LMC-6-A 落地式 可升降投影機支架 最大承重6KG|
|4188|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|Raymii LMC-6-B 落地式 可升降投影機支架 最大承重6KG|
|4189|out_of_scope|part_case|NAS用途機殼仍屬機殼|銀欣 CS382 顯卡長36.9/U高16.8/8*硬碟熱插拔(2.5/3.5吋)/帶鎖門板/M-ATX|
|4190|out_of_scope|part_case|NAS用途機殼仍屬機殼|銀欣 CS383 顯卡長34/U高15.8(18.6)/8*硬碟熱插拔(2.5/3.5吋)/帶鎖門板/EEB|
|4191|out_of_scope|part_case|NAS用途機殼仍屬機殼|喬思伯 N3 顯卡長25/CPU高13/3.5*8 硬碟位/NAS推薦/上下分艙/ITX【SFX】|
|4192|out_of_scope|part_case|NAS用途機殼仍屬機殼|喬思伯 N4 黑 顯卡長23(Low Profile)/U高7/硬碟位3.5*6+2.5*2/NAS推薦/M-ATX【SFX】|
|4193|out_of_scope|part_case|NAS用途機殼仍屬機殼|喬思伯 N4 白 顯卡長23(Low Profile)/U高7/硬碟位3.5*6+2.5*2/NAS推薦/M-ATX【SFX】|
|4194|out_of_scope|part_case|NAS用途機殼仍屬機殼|喬思伯 N5 顯卡長35/CPU高16/3.5*12 硬碟位/NAS推薦/上下分艙/E-ATX|
|4195|out_of_scope|part_case|NAS用途機殼仍屬機殼|喬思伯 N6 黑 顯卡長(27.5~32)/CPU高6.5/3.5*9 硬碟位/NAS推薦/上下分艙/M-ATX|
|4199|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|華碩 ROG Tessen 手遊控制器/僅支援Android 手機/可折疊/光環Rgb/Type-C 充電|
|4200|out_of_scope|accessory_controller|名稱明示支援電腦的控制器|華碩 Raikiri II Pro PC 無線三模搖桿(黑)/有線/無線/藍牙/熱插拔TMR搖桿/8K輪詢率|
|4202|out_of_scope|accessory_controller|名稱明示支援電腦的控制器|Razer Wolverine V2 Chroma 有線搖桿(白)/機械觸感動作鍵和方向鍵/適用PC|
|4203|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|Razer Prio 手遊遊戲手把/極致便攜/可摺疊設計/全尺寸控制器按鍵配置/電容式拇指搖桿|
|4217|out_of_scope|accessory_controller|名稱明示支援電腦的控制器|羅技 G29 Driving Force方向盤/支援PC.PS4|
|4218|out_of_scope|accessory_controller|名稱明示支援電腦的控制器|羅技 G923 模擬賽車方向盤/Trueforce功能/支援PC.PS4/扭力2.2Nm|
|4220|out_of_scope|accessory_controller|名稱明示支援電腦的控制器|羅技 G RS50 賽車模擬方向盤/8Nm扭力/支援Trueforce/支援PC.PS|
|4221|out_of_scope|accessory_controller|名稱明示支援電腦的控制器|羅技 G PRO 模擬賽車方向盤/11nm扭力/支援Trueforce/僅限PC使用/|
|4225|out_of_scope|accessory_controller|名稱明示支援電腦的控制器|MOZA R3 套裝(方向盤+基座+雙踏板)PC版/3.9Nm扭力/鋁合金機身/車規級環保PU|
|4239|out_of_scope|not_pc|排除桌椅、家具與其配件；電競桌機不視為電競桌|Raymii GameArm LRACE-1-RF-SEAT 賽車遊戲模擬器駕駛艙座椅|
|4240|out_of_scope|not_pc|排除桌椅、家具與其配件；電競桌機不視為電競桌|Raymii GameArm LRACE-6 賽車遊戲模擬器駕駛艙|
|4241|out_of_scope|not_pc|排除桌椅、家具與其配件；電競桌機不視為電競桌|Raymii GameArm LRACE-5 鋁合金RGB賽車遊戲模擬器駕駛艙|
|4242|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SF1005D 【5埠】10/100Mbps /桌上型交換器/塑膠殼/即插即用|
|4243|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SF1008D 【8埠】10/100Mbps /桌上型交換器/塑膠殼/即插即用|
|4244|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS105 【5埠】10/100Mbps /交換器/塑膠殼/桌上型|
|4245|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS108 【8埠】10/100Mbps /交換器/塑膠殼/桌上型|
|4246|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK S808 【8埠】10/100Mbps 交換器/桌上型/壁掛兩用/即插即用|
|4247|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK LS1005G 【5埠】1Gb/桌上型交換器/塑膠殼/可壁掛兩用|
|4248|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK LS1008G 【8埠】1Gb/桌上型交換器/塑膠殼/可壁掛兩用|
|4249|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK LS105G 【5埠】1Gb/桌上型交換器/鐵殼/可壁掛兩用|
|4250|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK LS108G 【8埠】1Gb/桌上型交換器/鐵殼/可壁掛兩用|
|4251|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG105 【5埠】1Gb/桌上型交換器/鐵殼/可壁掛兩用|
|4252|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG108 【8埠】1Gb/桌上型交換器/鐵殼/可壁掛兩用|
|4253|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG1005P 【5埠】1Gb(含4埠 PoE+)65W總供電/PoE埠最高30W供電|
|4254|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG116 【16埠】1Gb交換器/鐵殼/桌上型/壁掛兩用|
|4255|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG1016D 【16埠】1Gb 交換器/鐵殼/桌上型/壁掛兩用|
|4256|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG1024D 【24埠】1Gb 交換器/鐵殼/桌上型/可機架裝載|
|4257|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK ER605 【5埠】VPN 有線路由器/1Gb/鐵殼/Omada雲端管理|
|4258|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG2210P 【10埠】8*1Gb PoE+(總功率61W)/2*1Gb SFP/鐵殼|
|4259|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS108G 【8埠】1Gb 交換器/塑膠殼/桌上型|
|4260|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS105GS 【5埠】1Gb 交換器/金屬殼/桌上型|
|4261|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS108GS 【8埠】1Gb 交換器/金屬殼/桌上型|
|4262|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS108GP 【8埠】1Gb(含7埠 PoE)交換器/金屬殼/桌上型|
|4263|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS116GS 【16埠】1Gb 交換器/鐵殼/桌上型|
|4264|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS124GS 【24埠】1Gb 交換器/鐵殼/桌上型|
|4265|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MS110GMP 【10埠】1Gb 含8埠 PoE總供電 111W+埠 交換器/金屬殼|
|4266|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 GX-U1051 【5埠】1Gb交換器/VIP Port 頻寬優先/霧黑鐵殼/桌上型/三年換新|
|4267|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 GX-U1081 【8埠】1Gb交換器/VIP Port 頻寬優先/霧黑鐵殼/桌上型/三年換新|
|4268|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ExpertWiFi EBP15 【5埠】1Gb PoE+/4埠 PoE+每埠最高30W/總功率60W|
|4269|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ExpertWiFi EBG15 【5埠】1Gb VPN 有線路由器/Layer 7 防火牆/支援VPN|
|4270|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ExpertWiFi EBG19P 【9埠】1Gb PoE+/8埠 PoE+每埠最高30W/總功率123W|
|4271|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK S808G 【8埠】1Gb 交換器/桌上型/即插即用|
|4272|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS-105B v5 【5埠】1Gb交換器/鐵殼/桌上型/三年保固|
|4273|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS-108B v5 【8埠】1Gb交換器/鐵殼/桌上型/三年保固|
|4274|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS1200-5 【5埠】1Gb交換器/網頁式管理型/鐵殼/桌上、壁掛兩用|
|4275|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS1200-8 【8埠】1Gb交換器/網頁式管理型/鐵殼/桌上、壁掛兩用|
|4276|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS1200-10 【10埠】1Gb交換器/網頁式管理型/鐵殼/桌上、壁掛兩用|
|4277|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS1005HP 【5埠】1Gb PoE+/4埠 PoE+每埠最高30W/總功率60W|
|4278|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS1008HP 【8埠】1Gb PoE+/8埠 PoE+每埠最高30W/總功率60W|
|4279|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS1100-16 【16埠】1Gb 交換器/鐵殼/可壁掛、機架裝載/三年保固|
|4280|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS1100-16S 【16埠】1Gb 交換器/鐵殼/可壁掛、機架裝載/三年保固|
|4281|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 GS1100-24ES 【24埠】1Gb 交換器/鐵殼/可壁掛、機架裝載/三年保固|
|4282|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG105-M2 【5埠】2.5Gb 桌上型交換器 / 鐵殼 / 可壁掛兩用|
|4283|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SG108-M2 【8埠】2.5Gb 桌上型交換器 / 鐵殼 / 可壁掛兩用|
|4284|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SX105 【5埠】10Gb 桌上型交換器 / 鐵殼 / 可壁掛兩用|
|4285|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-SX1008 【8埠】10Gb 桌上型交換器 / 鐵殼 / 可壁掛兩用|
|4286|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 QG-U1050 【5埠】2.5Gb 桌上型交換器/支援四種智慧功能模式|
|4287|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 QG-U1080 【8埠】2.5Gb 桌上型交換器 /10G SFP+*2 光纖埠/四種智慧功能模式|
|4288|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 XMG-105 【6埠】Multi-Gig 2.5Gb*5/10Gb*1 SFP+光纖埠/無網管|
|4289|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 XMG-108 【9埠】Multi-Gig 2.5Gb*8/10Gb*1 SFP+光纖埠/無網管|
|4290|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 XGS1010-12 【12埠】1Gb*8/2.5Gb*2/10Gb*2 SFP+光纖埠/無網管|
|4291|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 XGS1250-12 【12埠】1Gb*8/10Gb*3(RJ45)/10Gb*1 SFP+光纖埠|
|4292|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華芸 ASW205T 【5埠】2.5Gb埠 桌上型交換器 / 鐵殼 / 可壁掛兩用|
|4293|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華芸 ASW209X 【9埠】2.5Gb*8埠/10Gb*1 SFP+光纖埠/可壁掛兩用/無網管交換器|
|4294|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 USG FLEX 50H 防火牆路由器 【5埠】1Gb*5|
|4295|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 USG FLEX 50HP 防火牆路由器 【5埠】1Gb*5 含*1 支援POE|
|4296|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK M7450 AC1200/4G LTE 行動WIFI分享，內含3000mAh電池方便攜帶|
|4297|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-MR100-Outdoor 300M/4G LTE 行動WIFI分享/IP65防水/戶外型|
|4298|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-MR6400 300M/雙天線/SIM卡/4G LTE無線路由器|
|4299|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-MR6500v 300M/雙天線/SIM卡/支援VoIP電話/4G LTE無線路由器|
|4300|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer MR400 AC1200/雙天線/SIM卡/3*100M/4G LTE無線路由器|
|4301|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer MX700 AX1500/SIM卡/1Gb/4G LTE無線路由器|
|4302|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer MR600 AC1200/雙天線/SIM卡/1Gb/4G LTE無線路由器|
|4303|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco X20-4G AX1800/AX Mesh/1Gb/4G LTE 無線路由器|
|4304|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco X50-4G AX3000/AX Mesh/1Gb/4G LTE 無線路由器|
|4305|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer NX200 AX1800/1Gb/5G＆4G LTE 無線路由器|
|4306|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 4G-BE58 BE3600/Wi-Fi 7/雙頻/3*1Gb/1*2.5Gb/SIM卡/ 三年換新|
|4307|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MB110-4G 300M/雙天線/2*100M/4G LTE 無線路由器|
|4308|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MB115-4G 300M/四天線/3*100M/4G LTE 無線路由器|
|4309|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MT110 150M/行動WiFi/4G LTE/內含2200mAh電池方便攜帶|
|4310|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK TL-WR840N 300M/雙天線/4*100M/小套房、小坪數適用|
|4311|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MW325R 300M/四天線/4*100M/小套房、學生宿舍適用|
|4312|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-N12+ B1 300M/雙天線/4*100M/三年換新|
|4313|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer C24 AC750/四天線/4*100M/路由器、基地台、訊號延伸三合一|
|4314|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer C54 AC1200/四天線/4*100M/路由器、基地台、訊號延伸三合一|
|4315|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer C64 AC1200/雙頻/四天線/4埠1Gb/MU-MIMO/三年保固|
|4316|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 AC10 AC1200/雙頻/四天線/100M*2|
|4317|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 AC12G AC1300/雙頻/四天線/1Gb*3|
|4318|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-AC52 AC750/雙頻/四天線/4*100M/支援MOD/三年換新|
|4319|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-AC1200 V2 AC1200/雙頻/四天線/4*100M/三年換新|
|4320|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer AX12 AX1500/Wi-Fi 6/4*天線/3*1Gb/App簡單設定/入門首選|
|4321|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer AX23 AX1800/Wi-Fi 6/4*天線/4*1Gb/支援OneMesh|
|4322|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer AX53 AX3000/Wi-Fi 6/4*高功率天線/4*1Gb/支援OneMesh|
|4323|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK EAP610 AX1800/Wi-Fi 6/吸頂式/1Gb*1/支援PoE/Omada 雲端管理|
|4324|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MR60X AX1500/Wi-Fi 6/4*天線/3*1Gb/中文APP|
|4325|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MR80X AX3000/Wi-Fi 6/4*天線/3*1Gb/中文APP|
|4326|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-AX1800S AX1800/Wi-Fi 6/4*高功率天線/4*1Gb|
|4327|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-AX1800HP AX1800/Wi-Fi 6/4*高功率大天線/4*1Gb/三年換新|
|4328|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-AX3000S 1.3GHz雙核心/AX3000/雙頻/4*天線/4*1Gb/三年換新|
|4329|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 NWA50AX AX1800/1Gb PoE/手機APP 雲端管理|
|4330|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 NWA50AX PRO AX3000/2.5Gb PoE/手機APP 雲端管理|
|4331|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 NWA90AX AX1800/1Gb PoE/手機APP 雲端管理/企業級資安防護|
|4332|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 NWA90AX PRO AX3000/2.5Gb PoE/手機APP 雲端管理/企業級資安防護|
|4333|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 USG Lite 60AX AX6000/2*2.5Gb/4*1Gb/支援防火牆/內建基礎資安防禦|
|4334|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MSI RadiX AXE6600 AXE6600/1*2.5Gb/4*1Gb/三年保固 到府收送|
|4335|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer AXE75 AXE5400/Wi-Fi 6E/三頻/6*天線/5*1Gb|
|4336|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK WR3002X AX3000/Wi-Fi 6/雙頻/1*2.5Gb/1*1Gb/便攜式路由器|
|4337|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK WR3602BE BE3600/Wi-Fi 7/雙頻/2*天線/1*2.5Gb/1*1Gb/便攜式路由器|
|4338|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer BE220 BE3600/Wi-Fi 7/雙頻/4*天線/4*1Gb|
|4339|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer BE230 BE3600/Wi-Fi 7/雙頻/4*天線/3*1Gb/2.5Gb|
|4340|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer BE400 BE6500/Wi-Fi 7/雙頻/6*天線/3*1Gb/2.5Gb|
|4341|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer BE600 BE9700/Wi-Fi 7/三頻/320MHz頻道/1*10Gb+4*2.5Gb|
|4342|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer BE805 BE19000/Wi-Fi 7/三頻/320MHz頻道/2*10Gb/4*1Gb|
|4343|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer GE550 BE9300/Wi-Fi 7/三頻/2*5Gb/3*2.5Gb/遊戲加速技術|
|4344|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Archer GE800 BE19000/Wi-Fi 7/三頻/8*隱藏天線/2*10Gb/遊戲加速技術|
|4345|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MR27BE BE3600/雙頻/Wi-Fi 7/4*天線/2*2.5Gb|
|4346|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 MR47BE BE9300/三頻/Wi-Fi 7/6*天線/4*2.5Gb|
|4347|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 TUF Gaming BE3600 Wi-Fi 7/雙頻/4*天線/4*1Gb/1*2.5Gb|
|4348|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 TUF Gaming BE9400 Wi-Fi 7/三頻/6*天線/USB3.0*1/4*2.5Gb|
|4349|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-BE58 GO BE3600/Wi-Fi 7/雙頻 1*2.5Gb/1*1Gb/三年換新|
|4350|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-BE3600S BE3600/Wi-Fi 7雙頻/1*2.5Gb/3*1Gb/三年換新|
|4351|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-BE3600HP BE3600/Wi-Fi 7/雙頻/1*2.5Gb/4*1Gb/三年換新|
|4352|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-BE58U BE3600/Wi-Fi 7/雙頻/1*2.5Gb/4*1Gb/三年換新|
|4353|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 PRT-BE5000 BE5000/Wi-Fi 7/5*隱藏天線/雙頻/2*2.5Gb/3*1Gb/三年換新|
|4354|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-BE82U BE6500/Wi-Fi 7/雙頻/4*2.5Gb/三年換新|
|4355|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-BE86U BE6800/Wi-Fi 7/雙頻/3*2.5Gb/10Gb/三年換新|
|4356|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-BE88U BE7200/Wi-Fi 7/雙頻/4*2.5Gb/4*1Gb/1*10Gb RJ45&SFP+|
|4357|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 RT-BE92U BE9700/Wi-Fi 7/三頻/4*2.5Gb/10Gb/三年換新|
|4358|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ROG STRIX GS-BE18000 Wi-Fi 7/三頻/8*隱藏天線/7*2.5Gb|
|4359|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ROG Rapture GT-BE25000 Wi-Fi 7/四頻/8*天線/4*2.5Gb/雙10Gb|
|4360|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ROG Rapture GT-BE25000 Edition 20 Wi-Fi 7/四頻/8*天線/4*2.5Gb/雙10Gb|
|4361|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ROG Rapture GT-BE19000AI Wi-Fi 7/三頻/8*天線/4*2.5Gb/雙10Gb|
|4362|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 NWA50BE BE5100/2.5Gb PoE/手機APP 雲端管理|
|4363|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 NWA50BE PRO BE6500/2.5Gb PoE/手機APP 雲端管理|
|4364|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 NWA90BE BE5100/2.5Gb PoE/企業級安全防護|
|4365|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|ZyXEL合勤 NWA90BE PRO BE6500 2.5Gb PoE/企業級安全防護|
|4366|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco M4 兩入組 AC1200/Mesh/隱藏雙天線/1Gb*2|
|4367|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco M4 三入組 AC1200/Mesh/隱藏雙天線/1Gb*2|
|4368|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco X10 兩入組 AX1500/AX Mesh/隱藏雙天線/1Gb*2|
|4369|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco X10 三入組 AX1500/AX Mesh/隱藏雙天線/1Gb*2|
|4370|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco X20 兩入組 AX1800/AX Mesh/隱藏雙天線/1Gb*2|
|4371|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco X20 三入組 AX1800/AX Mesh/隱藏雙天線/1Gb*2|
|4372|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco X50 兩入組 AX3000/AX Mesh/隱藏雙天線/1Gb*3|
|4373|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco X50 三入組 AX3000/AX Mesh/隱藏雙天線/1Gb*3|
|4374|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE22 兩入組 BE3600/雙頻/Mesh WiFi 7/隱藏四天線/1Gb*2|
|4375|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE22 三入組 BE3600/雙頻/Mesh WiFi 7隱藏四天線/1Gb*2|
|4376|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE25 兩入組 BE5000/雙頻/Mesh WiFi 7/隱藏四天線/2.5Gb*2|
|4377|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE25 三入組 BE5000/雙頻/Mesh WiFi 7/隱藏四天線/2.5Gb*2|
|4378|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE65 單入組 BE11000/三頻/Mesh WiFi 7/隱藏四天線/2.5Gb*4|
|4379|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE65 兩入組 BE11000/三頻/Mesh WiFi 7/隱藏四天線/2.5Gb*4|
|4380|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE65 三入組 BE11000/三頻/Mesh WiFi 7/隱藏四天線/2.5Gb*4|
|4381|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE65-POE 三入組 BE11000/三頻/Mesh WiFi 7/隱藏四天線/5Gb*2|
|4382|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE85 兩入組 BE22000/三頻/Mesh WiFi 7/2.5Gb*2/10Gb*2|
|4383|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TP-LINK Deco BE85 三入組 BE22000/三頻/Mesh WiFi 7/2.5Gb*2/10Gb*2|
|4384|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 Halo H80X 兩入組 AX3000/Mesh/隱藏雙天線/3*1Gb|
|4385|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|MERCUSYS水星 Halo H80X 三入組 AX3000/Mesh/隱藏雙天線/3*1Gb|
|4386|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI XD4 Plus 單入組 AX1800/AX Mesh/隱藏雙天線/可壁掛|
|4387|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI XD4 Plus 兩入組 AX1800/AX Mesh/隱藏雙天線/可壁掛|
|4388|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI BD5 單入組 BE5000/Wi-Fi 7/雙頻/MESH/隱藏四天線/2.5Gb/支援壁掛|
|4389|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI BD5 兩入組 BE5000/Wi-Fi 7/雙頻/MESH/隱藏四天線/2.5Gb|
|4390|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI BD5 三入組 BE5000/Wi-Fi 7/雙頻/MESH/隱藏四天線/2.5Gb|
|4391|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI BT8 單入組 BE14000/Wi-Fi 7/三頻/MESH/隱藏八天線/2.5Gb|
|4392|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI BT8 兩入組 BE14000/Wi-Fi 7/三頻/MESH/隱藏八天線/2.5Gb|
|4393|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI BT10 單入組 BE18000/Wi-Fi 7/三頻/MESH/隱藏八天線/10Gb*2|
|4394|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|華碩 ZENWIFI BT10 兩入組 BE18000/Wi-Fi 7/三頻/MESH/隱藏八天線/10Gb*2|
|4395|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK X30 AX3000/Wi-Fi 6/雙頻/MESH/隱藏四天線/1Gb*4|
|4396|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK X30SE AX3000/Wi-Fi 6/雙頻/MESH/隱藏四天線/1Gb*1|
|4397|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK BE3600 一入組 BE3600/Wi-Fi 7/雙頻/MESH/隱藏四天線/1Gb|
|4398|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK BE3600 二入組 BE3600/Wi-Fi 7/雙頻/MESH/隱藏四天線/1Gb|
|4399|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK BE3600 三入組 BE3600/Wi-Fi 7/雙頻/MESH/隱藏四天線/1Gb|
|4400|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK BE5100 一入組 BE5100/Wi-Fi 7/雙頻/MESH/隱藏四天線/2*1Gb/WAN*2.5Gb|
|4401|out_of_scope|part_network|原檔網路交換器、路由器與基地台區段|TOTOLINK BE5100 二入組 BE5100/Wi-Fi 7/雙頻/MESH/隱藏四天線/2*1Gb/WAN*2.5Gb|
|4404|out_of_scope|part_hdd|NAS用途硬碟仍屬硬碟|Toshiba 企業 4T(MG08ADA400N)5年QNAP保固|
|4405|out_of_scope|part_hdd|NAS用途硬碟仍屬硬碟|Toshiba 企業 8T(MG08ADA800E)5年QNAP保固|
|4406|out_of_scope|part_network|網路交換器|QNAP QSW-1108-8T 【8埠】2.5GbE 無網管型交換器/鐵殼/桌上型|
|4407|out_of_scope|accessory|電腦配件與供電周邊|QNAP TR-002 【2Bay】USB 3.2 Gen 1 RAID 磁碟陣列外接盒|
|4408|out_of_scope|accessory|電腦配件與供電周邊|QNAP TR-004 【4Bay】USB 3.2 Gen 1 RAID 磁碟陣列外接盒|
|4409|out_of_scope|accessory_printer|電腦列印周邊|EPSON LQ-310 80行 / 雙介面 / 點陣式印表機|
|4410|out_of_scope|accessory_printer|電腦列印周邊|EPSON LQ-690CII 106行 / 雙介面 / 內建中文字型 / 點陣式印表機|
|4411|out_of_scope|accessory_printer|電腦列印周邊|EPSON L121 超值入門輕巧款 單功能(列印)連續供墨|
|4412|out_of_scope|accessory_printer|電腦列印周邊|EPSON L3550 高速三合一 Wi-Fi(列印 / 影印 / 掃描)連續供墨複合機|
|4413|out_of_scope|accessory_printer|電腦列印周邊|EPSON L5590 高速雙網傳真(WiFi＆有線網路/列印/影印/掃描/傳真)連續供墨印表機|
|4414|out_of_scope|accessory_printer|電腦列印周邊|EPSON L6290 雙網四合一 Wi-Fi(列印/影印/掃描/傳真)雙面列印 / 連續供墨複合機|
|4415|out_of_scope|accessory|電腦配件與供電周邊|伽利略 PEP01A 【PCI-E X1】Parallel 1埠|
|4416|out_of_scope|accessory|電腦配件與供電周邊|伽利略 PETR02A 【PCI-E 1X】RS-232 2埠|
|4418|out_of_scope|part_motherboard|主機板|華南金牌x99|
|4419|out_of_scope|not_pc|電視、投影設備、平板、掌機或手機專用商品|雷爵RockTek G2 4K影音串流遊戲主機|

|4402|out_of_scope|part_network|Wi-Fi Mesh 網路設備|TOTOLINK BE5100 三入組 BE5100/Wi-Fi 7/雙頻/MESH/隱藏四天線/2*1Gb/WAN*2.5Gb|
|4403|out_of_scope|part_network|Wi-Fi Mesh 網路設備|MSI Roamii BE Pro 二入組 BE11000/Wi-Fi 7/三頻/MESH/隱藏六天線/4*2.5Gb|

## 待確認資料（不加入草稿訓練）

以下保留原標題及行號。需要確認支援 PC 或商品類型後再納入，不將不確定性訓練成商品類別。

|原檔行號|原標籤|商品名稱|
|---|---|---|
|4196|out_of_scope|微軟 Xbox 無線控制器/搖桿/磨砂黑/無線-藍牙/防滑握把/(無接收器)|
|4197|out_of_scope|微軟 Xbox 無線控制器/搖桿/黑/無線-藍牙/防滑握把/(無接收器)|
|4198|out_of_scope|微軟 Xbox 無線控制器(狙擊紅)/搖桿/無線-藍牙/防滑握把/(無接收器)|
|4201|out_of_scope|華碩 ROG Raikiri II Xbox 無線控制器/三模(有線/2.4g/藍牙)/防飄移TMR搖桿/微動開關按鈕|
|4204|out_of_scope|Razer Wolverine V3 TE 8k 有線搖桿(黑)/機械式動作鍵/多功能按鍵/TMR類比拇指搖桿|
|4205|out_of_scope|Razer Wolverine V3 Pro 8k 無線搖桿(黑)/機械式動作鍵/多功能按鍵/TMR類比拇指搖桿|
|4206|out_of_scope|Razer Raiju V3 Pro 無線搖桿(黑)/對稱拇指搖桿/多功能按鍵/8向懸浮方向鍵|
|4207|out_of_scope|Turtle Beach Rematch Core 有線搖桿 黑綠/專利音訊控制/人體工學/雙震動馬達|
|4208|out_of_scope|Turtle Beach Rematch Core 有線搖桿 迷彩黑綠/專利音訊控制/人體工學/雙震動馬達|
|4209|out_of_scope|Turtle Beach Rematch Core 有線搖桿 迷彩黑橘 專利音訊控制/人體工學/雙震動馬達|
|4210|out_of_scope|Turtle Beach Rematch Advanced 有線搖桿 黑暗宇宙/專利音訊控制/可自訂遊戲操作|
|4211|out_of_scope|Turtle Beach Afterglow Ignite 有線搖桿 時光機/專利音訊控制/雙段霍爾效應板機/Rgb|
|4212|out_of_scope|Turtle Beach Afterglow Wave 有線搖桿 黑色/專利音訊控制/霍爾效應三段可調式扳機/Rgb|
|4213|out_of_scope|MSI Force Gc300 W 無線搖捍控制器遊戲手把(黑)/有線-無線-藍牙/動態觸覺回饋|
|4214|out_of_scope|羅技 F310 遊戲搖桿/有線/浮動式D-Pad舒適防滑握把|
|4215|out_of_scope|羅技 F710 遊戲搖桿/無線/2.4GHz/雙震動馬達回饋|
|4216|out_of_scope|Varmilo FK2 全按鍵遊戲控制器(黑)/Cherry電感軸/快速觸發模式/網頁驅動軟體/可調式觸發|
|4219|out_of_scope|羅技 G RS50 (預購11/2到貨) 麥拉倫聯名賽車模擬方向盤(含踏板)/8Nm扭力/支援Trueforce|
|4222|out_of_scope|Thrustmaster T98-P-FERRARI 296GTB 法拉利聯名方向盤組/7:10 比例復刻版|
|4223|out_of_scope|Thrustmaster T248R 賽車套裝(方向盤+基座+雙踏板)/3.1Nm扭力|
|4224|out_of_scope|Thrustmaster T598 賽車套裝(方向盤+基座+雙踏板)/5Nm扭力|
|4226|out_of_scope|MOZA R5 卡車套裝(TSW卡車盤+R5基座+SRP-LITE 雙踏板+卡車夾)|
|4227|out_of_scope|MOZA mBooster 主動踏板/軟體智能調節/雙200KG壓力感測器/真實動態模擬|
|4228|out_of_scope|MOZA R9 V3 基座/9Nm扭力/智慧溫控系統/鋁合金機身/APP雲端控制|
|4229|out_of_scope|MOZA R12 V2 基座/12Nm扭力/智慧溫控系統/NexGen Force 4.0力回饋系統|
|4230|out_of_scope|MOZA R25 Ultra 基座/25Nm扭力/高精度扭力感測器/600MHz高性能CPU|
|4231|out_of_scope|MOZA TSW 卡車方向盤/400mm標準直徑/超纖皮手工縫線/鋁合金骨架|
|4232|out_of_scope|MOZA Revuelto 藍寶堅尼模擬賽車方向盤/超纖皮手工縫線/3K斜紋碳纖維撥片|
|4233|out_of_scope|MOZA Mission R 保時捷模擬賽車方向盤/5.4吋柔性OLED顯示屏/300R超高曲度儀表|
|4234|out_of_scope|Raymii GameArm LGAME-1 飛行遊戲搖桿支架 飛行模擬器支架|
|4235|out_of_scope|Raymii GameArm LGAME-2 賽車遊戲支架 夾桌式方向盤/排檔桿/踏板固定座|
|4236|out_of_scope|Raymii GameArm LGAME-3 賽車遊戲支架/方向盤/落地式折疊可調式賽車架|
|4237|out_of_scope|Raymii GameArm LSA-37 遊戲賽車方向盤/排檔桿/油門支架|
|4238|out_of_scope|Raymii GameArm LSA-36-V2 遊戲賽車方向盤/排檔桿/油門支架|

原檔 SHA-256：`c2fd40341f83d4d5f63bfa7b52554c4f01c48151d7b2a130b47217b97b8babd6`。
