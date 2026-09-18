// 原價屋報價截圖（2026-09-18）；僅收錄可辨識的單買價，不代表即時售價或庫存。
// 每組資料的 key 對應原始截圖檔名時間；優惠折扣、贈品和限搭機價不匯入。
const gpuRows = {
  '222814': [
    ['ASUS', 'DUAL-RTX5060-O8G', 15990],
    ['ASUS', 'DUAL-RTX5060-O8G-A', 16290],
    ['ASUS', 'DUAL-RTX5060-O8G-WHITE', 16590],
    ['ASUS', 'ATS-RTX5060-O8G', 16590],
    ['GIGABYTE', 'RTX5060 WINDFORCE OC 8G', 15990],
    ['GIGABYTE', 'RTX5060 WINDFORCE MAX OC 8G', 15990],
    ['GIGABYTE', 'RTX5060 WINDFORCE MAX OC V2 8G', 15990],
    ['GIGABYTE', 'RTX5060 OC Low Profile 8G', 15990],
    ['GIGABYTE', 'RTX5060 EAGLE OC 8G', 16490],
    ['GIGABYTE', 'RTX5060 EAGLE MAX OC 8G', 16490],
    ['GIGABYTE', 'RTX5060 EAGLE OC ICE 8G', 16990],
    ['GIGABYTE', 'RTX5060 GAMING OC V2 8G', 17490],
    ['GIGABYTE', 'RTX5060 AERO OC 8G', 17990],
    ['GIGABYTE', 'AORUS RTX5060 ELITE 8G', 18490],
    ['MSI', 'RTX5060 8G VENTUS 2X OC', 15990],
    ['MSI', 'RTX5060 8G VENTUS 2X OC V1', 15990],
    ['MSI', 'RTX5060 8G VENTUS 2X OC WHITE', 16590],
    ['MSI', 'RTX5060 8G CYCLONE OC', 15990],
    ['MSI', 'RTX5060 8G VENTUS 3X OC', 16990],
    ['MSI', 'RTX5060 8G GAMING TRIO OC', 17990]
  ],
  '222826': [
    ['ASUS', 'PRIME-RTX5060TI-O8G', 20990],
    ['ASUS', 'T1-RTX5060TI-O8G-GAMING', 21990],
    ['GIGABYTE', 'RTX5060Ti WINDFORCE 8G', 18590],
    ['GIGABYTE', 'RTX5060Ti WINDFORCE OC 8G', 18990],
    ['GIGABYTE', 'RTX5060Ti WINDFORCE MAX OC 8G', 18990],
    ['GIGABYTE', 'RTX5060Ti EAGLE 8G', 19490],
    ['GIGABYTE', 'RTX5060Ti EAGLE MAX OC 8G', 19490],
    ['GIGABYTE', 'RTX5060Ti EAGLE OC ICE 8G', 19990],
    ['GIGABYTE', 'RTX5060Ti GAMING OC 8G', 20990],
    ['GIGABYTE', 'RTX5060Ti AERO OC 8G', 21590],
    ['MSI', 'RTX5060Ti 8G CYCLONE OC', 18990],
    ['MSI', 'RTX5060Ti 8G VENTUS 2X PLUS', 18990],
    ['MSI', 'RTX5060Ti 8G SHADOW 2X OC PLUS', 18990],
    ['MSI', 'RTX5060Ti 8G VENTUS 2X OC PLUS', 19590],
    ['MSI', 'RTX5060Ti 8G VENTUS 2X OC WHITE PLUS', 19990],
    ['MSI', 'RTX5060Ti 8G VENTUS 3X OC', 19990],
    ['MSI', 'RTX5060Ti 8G GAMING TRIO OC', 20990],
    ['MSI', 'RTX5060Ti 8G GAMING TRIO OC WHITE', 21590],
    ['ZOTAC', 'RTX5060Ti 8GB White OC', 19490]
  ],
  '222843': [
    ['ASUS', 'PRIME-RTX5070-12G', 30990],
    ['ASUS', 'PRIME-RTX5070-O12G', 31990],
    ['ASUS', 'T1-RTX5070-O12G-GAMING', 32990],
    ['GIGABYTE', 'RTX5070 WINDFORCE OC SFF 12G', 29990],
    ['GIGABYTE', 'RTX5070 EAGLE OC SFF 12G', 30990],
    ['GIGABYTE', 'RTX5070 EAGLE OC ICE SFF 12G', 31490],
    ['GIGABYTE', 'RTX5070 GAMING OC 12G', 32490],
    ['GIGABYTE', 'RTX5070 AERO OC 12G', 32990],
    ['GIGABYTE', 'AORUS RTX5070 MASTER 12G', 33990],
    ['GIGABYTE', 'AORUS RTX5070 INFINITY 12G', 33990],
    ['MSI', 'RTX5070 12G SHADOW 2X OC', 29990]
  ],
  '222858': [
    ['MSI', 'RTX5070 12G VENTUS 2X OC WHITE', 30990],
    ['MSI', 'RTX5070 12G INSPIRE 3X OC', 30990],
    ['MSI', 'RTX5070 12G VENTUS 3X OC', 31590],
    ['MSI', 'RTX5070 12G GAMING TRIO OC', 32990],
    ['ZOTAC', 'RTX5070 Twin Edge', 28990],
    ['ZOTAC', 'RTX5070 Twin Edge OC', 29990],
    ['ZOTAC', 'RTX5070 SOLID', 30990],
    ['ZOTAC', 'RTX5070 SOLID OC', 31490],
    ['ZOTAC', 'RTX5070 AMP White Edition', 31990],
    ['INNO3D', 'RTX5070 TWIN X2', 28888],
    ['INNO3D', 'RTX5070 TWIN X2 OC WHITE', 29888],
    ['INNO3D', 'RTX5070 iChill X3', 30888]
  ],
  '222919': [
    ['GIGABYTE', 'RTX5080 WINDFORCE OC SFF 16G', 53990],
    ['GIGABYTE', 'RTX5080 GAMING OC 16G', 54990],
    ['GIGABYTE', 'RTX5080 AERO OC SFF 16G', 55990],
    ['GIGABYTE', 'AORUS RTX5080 MASTER 16G', 57990],
    ['GIGABYTE', 'AORUS RTX5080 INFINITY 16G', 61990],
    ['MSI', 'RTX5080 16G VENTUS 3X OC', 53990],
    ['MSI', 'RTX5080 16G GAMING TRIO OC', 55990],
    ['ZOTAC', 'RTX5080 SOLID CORE OC', 53990],
    ['ZOTAC', 'RTX5080 SOLID OC White Edition', 54990],
    ['ZOTAC', 'RTX5080 SOLID CORE OC 20th Anniversary Edition', 55990],
    ['INNO3D', 'RTX5080 X3', 52888],
    ['INNO3D', 'RTX5080 X3 OC', 53888],
    ['INNO3D', 'RTX5080 X3 OC WHITE', 53888]
  ],
  // RTX 5090 截圖僅有「限搭機」價格，依使用者要求整筆略過。
  '222953': [
    ['GIGABYTE', 'RX9060XT GAMING OC 8GB', 11490, 'RX 9060 XT', 8],
    ['ASRock', 'RX9060XT Challenger 8GB OC', 11990, 'RX 9060 XT', 8],
    ['Acer', 'Nitro RX9060XT OC 8GB', 10990, 'RX 9060 XT', 8],
    ['PowerColor', 'RX9060XT 8G-L/OC Hellhound', 11490, 'RX 9060 XT', 8],
    ['GIGABYTE', 'RX9060XT GAMING OC 16G', 16890, 'RX 9060 XT', 16],
    ['GIGABYTE', 'RX9060XT GAMING OC ICE 16G', 17390, 'RX 9060 XT', 16],
    ['ASRock', 'RX9060XT Challenger 16GB OC', 16790, 'RX 9060 XT', 16],
    ['Acer', 'Nitro RX9060XT OC 16GB', 17390, 'RX 9060 XT', 16],
    ['SAPPHIRE', 'PULSE RX9060XT GAMING OC 16GB', 15800, 'RX 9060 XT', 16],
    ['SAPPHIRE', 'PURE RX9060XT GAMING OC 16GB', 16490, 'RX 9060 XT', 16],
    ['SAPPHIRE', 'NITRO+ RX9060XT GAMING OC 16GB', 16990, 'RX 9060 XT', 16],
    ['PowerColor', 'RX9060XT 16G-A Reaper', 14590, 'RX 9060 XT', 16],
    ['PowerColor', 'RX9060XT 16G-L/OC Hellhound', 15990, 'RX 9060 XT', 16]
  ]
};

// 主機板列：品牌、產品型號、單買價、平台、晶片組。
const motherboardRows = {
  '223014': [
    ['ASUS', 'H610M-F D4 R2.0-CSM', 2790, 'Intel LGA1700', 'H610'],
    ['ASUS', 'PRIME H610M-K D4-CSM', 2990, 'Intel LGA1700', 'H610'],
    ['ASUS', 'PRIME H610I-PLUS D4-CSM', 3590, 'Intel LGA1700', 'H610'],
    ['GIGABYTE', 'H610M K DDR4', 2790, 'Intel LGA1700', 'H610'],
    ['GIGABYTE', 'H610M H V2 DDR4', 2990, 'Intel LGA1700', 'H610'],
    ['GIGABYTE', 'H610M S2H V2 DDR4', 2790, 'Intel LGA1700', 'H610'],
    ['MSI', 'PRO H610M-S DDR4', 1990, 'Intel LGA1700', 'H610'],
    ['MSI', 'PRO H610M-E DDR4', 2290, 'Intel LGA1700', 'H610'],
    ['ASRock', 'H610M-H2/M.2', 1990, 'Intel LGA1700', 'H610'],
    ['ASRock', 'H610M COMBO II', 2290, 'Intel LGA1700', 'H610'],
    ['ASUS', 'B760M-AYW WIFI D4', 3990, 'Intel LGA1700', 'B760'],
    ['ASUS', 'PRIME B760M-F D4-CSM', 3090, 'Intel LGA1700', 'B760'],
    ['ASUS', 'PRIME B760M-K D4-CSM', 3190, 'Intel LGA1700', 'B760'],
    ['ASUS', 'PRIME B760M-A D4-CSM', 3790, 'Intel LGA1700', 'B760'],
    ['ASUS', 'PRIME B760M-A WIFI D4-CSM', 4490, 'Intel LGA1700', 'B760']
  ],
  '223027': [
    ['MSI', 'B760M GAMING PLUS WIFI', 4090, 'Intel LGA1700', 'B760'],
    ['MSI', 'B760 GAMING PLUS WIFI', 4290, 'Intel LGA1700', 'B760'],
    ['ASRock', 'B760M-HDV/M.2', 2390, 'Intel LGA1700', 'B760'],
    ['ASRock', 'B760M PG LIGHTNING', 3890, 'Intel LGA1700', 'B760'],
    ['ASRock', 'B760M Steel Legend WiFi', 4190, 'Intel LGA1700', 'B760'],
    ['ASUS', 'PRIME Z790-P D4-CSM', 6490, 'Intel LGA1700', 'Z790'],
    ['ASUS', 'PRIME Z790-P WIFI-CSM', 6490, 'Intel LGA1700', 'Z790'],
    ['MSI', 'PRO Z790-P WIFI', 5590, 'Intel LGA1700', 'Z790'],
    ['ASUS', 'PRIME H810M-K-CSM', 3090, 'Intel LGA1851', 'H810'],
    ['ASUS', 'PRIME H810M-E-CSM', 3190, 'Intel LGA1851', 'H810'],
    ['GIGABYTE', 'H810M K GEN5', 2990, 'Intel LGA1851', 'H810'],
    ['GIGABYTE', 'H810M H', 3190, 'Intel LGA1851', 'H810'],
    ['GIGABYTE', 'H810M H GEN5', 3190, 'Intel LGA1851', 'H810'],
    ['MSI', 'PRO H810M-E', 2890, 'Intel LGA1851', 'H810'],
    ['MSI', 'PRO H810M-B', 3290, 'Intel LGA1851', 'H810'],
    ['MSI', 'PRO H810M-B WIFI', 3590, 'Intel LGA1851', 'H810']
  ],
  '223039': [
    ['ASRock', 'A520M-ITX/ac', 3390, 'AMD AM4', 'A520'],
    ['ASRock', 'A520M-HVS', 1650, 'AMD AM4', 'A520'],
    ['ASUS', 'PRIME B550M-K ARGB-CSM', 2690, 'AMD AM4', 'B550'],
    ['ASUS', 'PRIME B550M-K/CSM', 2790, 'AMD AM4', 'B550'],
    ['ASUS', 'PRIME B550M-K WIFI', 2890, 'AMD AM4', 'B550'],
    ['ASUS', 'TUF GAMING B550M-PLUS', 3390, 'AMD AM4', 'B550'],
    ['ASUS', 'TUF GAMING B550M-PLUS WIFI II', 3790, 'AMD AM4', 'B550'],
    ['GIGABYTE', 'B550M H ARGB', 2490, 'AMD AM4', 'B550'],
    ['GIGABYTE', 'B550M K', 2690, 'AMD AM4', 'B550'],
    ['GIGABYTE', 'B550M AORUS ELITE', 3290, 'AMD AM4', 'B550'],
    ['GIGABYTE', 'B550M GAMING X WIFI6', 3690, 'AMD AM4', 'B550'],
    ['MSI', 'B550M-A PRO', 2390, 'AMD AM4', 'B550'],
    ['MSI', 'PRO B550M-B', 2690, 'AMD AM4', 'B550'],
    ['MSI', 'PRO B550M-P', 2790, 'AMD AM4', 'B550'],
    ['MSI', 'PRO B550M-P WIFI6E', 3090, 'AMD AM4', 'B550'],
    ['MSI', 'B550M PRO-VDH WIFI', 3390, 'AMD AM4', 'B550'],
    ['MSI', 'B550M GAMING PLUS WIFI6E', 3990, 'AMD AM4', 'B550']
  ]
};

// 記憶體列：品牌、容量／套裝／速度／時序／料號、整條或整組單買價。
const ramRows = {
  '223051': [
    ['ADATA', '8GB DDR5-5600 CL46 AD5U56008G-S', 4199],
    ['ADATA', '16GB DDR5-4000 CL32 AD5U400016G-S', 5999],
    ['ADATA', '16GB DDR5-4800 CL40 AD5U480016G-S', 6999],
    ['ADATA', '16GB DDR5-5600 CL46 AD5U560016G-S', 7999],
    ['ADATA', 'Lancer Black 16GB DDR5-5600 CL36 AX5U5600C3616G-CLABK', 8199],
    ['ADATA', 'LancerBlade Black 16GB DDR5-5600 CL46 AX5U5600C4616G-SLABBK', 8199],
    ['ADATA', 'LancerBlade Black 16GB DDR5-6000 CL48 AX5U6000C4816G-SLABBK', 8399],
    ['ADATA', '32GB DDR5-5600 CL46 AD5U560032G-S', 14999],
    ['Kingston', '16GB DDR5-5600 CL46', 7999],
    ['Kingston', '32GB DDR5-5600 CL46', 15500],
    ['Kingston', 'FURY Beast 8GB DDR5-5600 CL36', 4990],
    ['Kingston', 'FURY Beast 16GB DDR5-5600 CL36', 8300],
    ['Kingston', 'FURY Beast Black 16GB DDR5-6000 CL30', 9300],
    ['KLEVV', '16GB DDR5-5600 CL46', 6250]
  ],
  '223058': [
    ['ADATA', 'LancerBlade Black 32GB (2x16GB) DDR5-5600 CL46 AX5U5600C4616G-DTLABBK', 16399],
    ['ADATA', 'LancerBlade White 32GB (2x16GB) DDR5-5600 CL46 AX5U5600C4616G-DTLABWH', 16399],
    ['ADATA', 'LancerBlade Black 32GB (2x16GB) DDR5-6000 CL48 AX5U6000C4816G-DTLABBK', 17299],
    ['ADATA', 'LancerBlade White 32GB (2x16GB) DDR5-6000 CL48 AX5U6000C4816G-DTLABWH', 17299],
    ['ADATA', 'LancerBlade Black 32GB (2x16GB) DDR5-6000 CL36 AX5U6000C3616G-DTLABBK', 17799],
    ['ADATA', 'LancerBlade White 32GB (2x16GB) DDR5-6000 CL36 AX5U6000C3616G-DTLABWH', 17799],
    ['ADATA', 'LancerBlade Black 32GB (2x16GB) DDR5-6000 CL30 AX5U6000C3016G-DTLABBK', 18799],
    ['ADATA', 'LancerBlade White 32GB (2x16GB) DDR5-6000 CL30 AX5U6000C3016G-DTLABWH', 18799],
    ['ADATA', 'LancerBlade White 32GB (2x16GB) DDR5-6000 CL28 AX5U6000C2816G-DTLABWH', 15799],
    ['ADATA', 'LancerBlade RGB Black 32GB (2x16GB) DDR5-6000 CL36 AX5U6000C3616G-DTLABRBK', 18099],
    ['ADATA', 'LancerBlade RGB White 32GB (2x16GB) DDR5-6000 CL36 AX5U6000C3616G-DTLABRWH', 18099],
    ['ADATA', 'LancerBlade RGB Black 32GB (2x16GB) DDR5-6000 CL30 AX5U6000C3016G-DTLABRBK', 19099],
    ['ADATA', 'LancerBlade RGB White 32GB (2x16GB) DDR5-6000 CL30 AX5U6000C3016G-DTLABRWH', 19099],
    ['ADATA', 'Lancer White 32GB (2x16GB) DDR5-6000 CL30 AX5U6000C3016G-DCLAWH', 19099]
  ],
  '223107': [
    ['Crucial', 'PRO White 64GB (2x32GB) DDR5-6000 CL40', 29199],
    ['Crucial', 'PRO Black 32GB (2x16GB) DDR5-6400 CL38', 14999],
    ['Crucial', 'PRO White 32GB (2x16GB) DDR5-6400 CL38', 14999],
    ['Crucial', 'PRO White 64GB (2x32GB) DDR5-6400 CL40', 29999],
    ['Crucial', 'PRO Black 96GB (2x48GB) DDR5-5600 CL46', 28500],
    ['Corsair', 'VENGEANCE RGB Grey 32GB (2x16GB) DDR5-6000 CL36 CMH32GX5M2E6000Z36', 15990],
    ['Corsair', 'VENGEANCE Grey 32GB (2x16GB) DDR5-6000 CL30 CMK32GX5M2B6000Z30', 17590],
    ['Corsair', 'VENGEANCE RGB Grey 32GB (2x16GB) DDR5-6000 CL30 CMH32GX5M2B6000Z30K', 17990],
    ['Corsair', 'VENGEANCE Grey 32GB (2x16GB) DDR5-6400 CL36 CMK32GX5M2B6400Z36', 15490],
    ['Corsair', 'VENGEANCE RGB Grey 32GB (2x16GB) DDR5-6400 CL36 CMH32GX5M2B6400Z36', 16990],
    ['Corsair', 'VENGEANCE Grey 32GB (2x16GB) DDR5-6400 CL32 CMK32GX5M2B6400Z32', 16990],
    ['Corsair', 'VENGEANCE RGB Grey 32GB (2x16GB) DDR5-6400 CL32 CMH32GX5M2B6400Z32', 17290],
    ['Corsair', 'VENGEANCE Black 64GB (2x32GB) DDR5-6400 CL42 CMK64GX5M2B6400C42', 32900],
    ['Corsair', 'VENGEANCE Black 128GB (2x64GB) DDR5-6000 CL40 CMK128GX5M2D6000C40', 83500],
    ['Corsair', 'DOMINATOR TITANIUM RGB Grey 32GB (2x16GB) DDR5-6000 CL30 CMP32GX5M2B6000Z30', 19190],
    ['G.SKILL', 'Flare X5 Black 32GB (2x16GB) DDR5-6000 CL28 F5-6000J2836G16GX2-FX5', 19500],
    ['G.SKILL', 'Flare X5 White 32GB (2x16GB) DDR5-6000 CL28 F5-6000J2836G16GX2-FX5W', 19500],
    ['G.SKILL', 'Flare X5 Black 64GB (2x32GB) DDR5-6000 CL30 F5-6000J3040G32GX2-FX5', 35900]
  ],
  '223116': [
    ['Corsair', 'DOMINATOR TITANIUM RGB Black 32GB (2x16GB) DDR5-7200 CL34 CMP32GX5M2X7200C34', 21990],
    ['G.SKILL', 'Flare X5 White 64GB (2x32GB) DDR5-6000 CL30 F5-6000J3040G32GX2-FX5W', 35900],
    ['G.SKILL', 'Flare X5 Black 64GB (2x32GB) DDR5-6000 CL28 F5-6000J2836G32GX2-FX5', 38900],
    ['G.SKILL', 'Flare X5 Black 96GB (2x48GB) DDR5-6000 CL30 F5-6000J3036F48GX2-FX5', 59980],
    ['G.SKILL', 'Flare X5 White 96GB (2x48GB) DDR5-6000 CL30 F5-6000J3036F48GX2-FX5W', 59980],
    ['G.SKILL', 'Flare X5 Black 128GB (2x64GB) DDR5-6000 CL34 F5-6000J3444F64GX2-FX5', 94500],
    ['G.SKILL', 'Ripjaws S5 Black 32GB (2x16GB) DDR5-6000 CL36 F5-6000J3636F16GX2-RS5K', 15500],
    ['G.SKILL', 'Ripjaws S5 Black 64GB (2x32GB) DDR5-6000 CL36 F5-6000J3636F32GX2-RS5K', 29000],
    ['G.SKILL', 'Ripjaws M5 RGB Black 32GB (2x16GB) DDR5-6000 CL36 F5-6000J3636F16GX2-RM5RK', 16000],
    ['G.SKILL', 'Trident Z5 RGB Black 64GB (2x32GB) DDR5-6000 CL36 F5-6000J3636F32GX2-RM5NRK', 34000],
    ['G.SKILL', 'Trident Z5 RGB White 64GB (2x32GB) DDR5-6000 CL36 F5-6000J3636F32GX2-RM5NRW', 34000],
    ['G.SKILL', 'Trident Z5 RGB Black 32GB (2x16GB) DDR5-6400 CL32 F5-6400J3239G16GX2-TZ5RK', 21500],
    ['G.SKILL', 'Trident Z5 RGB White 32GB (2x16GB) DDR5-6400 CL32 F5-6400J3239G16GX2-TZ5RW', 21500],
    ['G.SKILL', 'Trident Z5 RGB Black 32GB (2x16GB) DDR5-7200 CL34 F5-7200J3445G16GX2-TZ5RK', 14900],
    ['G.SKILL', 'Trident Z5 RGB White 64GB (2x32GB) DDR5-6000 CL30 F5-6000J3040G32GX2-TZ5RW', 29000],
    ['G.SKILL', 'Trident Z5 RGB Black 32GB (2x16GB) DDR5-6000 CL30 F5-6000J3038F16GX2-TZ5NR', 19400],
    ['G.SKILL', 'Trident Z5 RGB Black 64GB (2x32GB) DDR5-6000 CL30 F5-6000J3040G32GX2-TZ5NR', 37900]
  ],
  '235716': [
    ['Kingston', 'FURY Beast RGB Black 32GB DDR5-6400 CL32', 14800]
  ],
  '235735': [
    ['Kingston', 'FURY Beast Black 64GB DDR5-6400 CL32 (獸獵者)', 28800],
    ['Kingston', 'FURY Renegade RGB Black 32GB DDR5-7200 KF572C38RSAK2-32', 16800]
  ]
};

const brandNames = {
  ASUS: '華碩', GIGABYTE: '技嘉', MSI: '微星', ASRock: '華擎',
  ZOTAC: '索泰', INNO3D: '映眾', PowerColor: '撼訊', SAPPHIRE: '藍寶石',
  ADATA: '威剛', Kingston: '金士頓', Crucial: '美光', Corsair: '海盜船',
  'G.SKILL': '芝奇', Acer: '宏碁', KLEVV: '科賦'
};

const normalize = (value) => String(value || '').normalize('NFKC').toUpperCase()
  .replace(/[^\p{L}\p{N}]/gu, '');

const sourceFiles = {
  '235716': '2026-09-18_235716.png',
  '235735': '2026-09-18_235735.png'
};

async function seedScreenshotReferencePrices(runUpdate, runQueryOne) {
  await runUpdate(`CREATE TABLE IF NOT EXISTS hardware_motherboard_product_chipsets (
    hardware_model_id INTEGER PRIMARY KEY REFERENCES hardware_models(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, chipset TEXT NOT NULL
  )`);
  await runUpdate(`CREATE TABLE IF NOT EXISTS hardware_gpu_variant_specs (
    hardware_model_id INTEGER PRIMARY KEY REFERENCES hardware_models(id) ON DELETE CASCADE,
    base_model TEXT NOT NULL, vram_gb INTEGER NOT NULL CHECK(vram_gb > 0)
  )`);

  for (const [category, groups] of [
    ['gpu', gpuRows], ['motherboard', motherboardRows], ['ram', ramRows]
  ]) {
    for (const [time, rows] of Object.entries(groups)) {
      const source = sourceFiles[time] || `螢幕擷取畫面 2026-09-18 ${time}.png`;
      for (const [brand, model, price, extra, vramGb] of rows) {
        if (!brand || !model || !Number.isInteger(price) || price <= 0 ||
            `${brand} ${model}`.length > 100) {
          throw new Error(`無效的截圖報價：${source} ${brand} ${model}`);
        }
        const fullName = `${brand} ${model}`;
        await runUpdate(
          `INSERT OR IGNORE INTO hardware_models
           (category, manufacturer, canonical_model, normalized_model, series)
           VALUES (?, ?, ?, ?, ?)`,
          [category, brand, fullName, normalize(fullName), category === 'motherboard' ? vramGb : category.toUpperCase()]
        );
        const found = await runQueryOne(
          'SELECT id FROM hardware_models WHERE category = ? AND normalized_model = ?',
          [category, normalize(fullName)]
        );
        for (const alias of [model, `${brandNames[brand] || brand} ${model}`]) {
          await runUpdate(
            `INSERT OR IGNORE INTO hardware_model_aliases
             (hardware_model_id, alias, normalized_alias) VALUES (?, ?, ?)`,
            [found.id, alias, normalize(alias)]
          );
        }
        await runUpdate(
          `INSERT INTO hardware_reference_prices
           (category, brand, model, price_ntd, offer_type, notes, source_file, imported_at)
           SELECT ?, ?, ?, ?, 'standalone', ?, ?, '2026-09-18'
           WHERE NOT EXISTS (
             SELECT 1 FROM hardware_reference_prices
             WHERE category = ? AND brand = ? AND model = ? AND offer_type = 'standalone'
           )`,
          [category, brand, model, price, '截圖單買參考價；非即時售價或庫存', source,
            category, brand, model]
        );
        if (category === 'motherboard') {
          await runUpdate(
            `INSERT OR IGNORE INTO hardware_motherboard_product_chipsets
             (hardware_model_id, platform, chipset) VALUES (?, ?, ?)`,
            [found.id, extra, vramGb]
          );
        } else if (category === 'gpu' && extra) {
          await runUpdate(
            `INSERT OR IGNORE INTO hardware_gpu_variant_specs
             (hardware_model_id, base_model, vram_gb) VALUES (?, ?, ?)`,
            [found.id, extra, vramGb]
          );
        }
      }
    }
  }
}

module.exports = { gpuRows, motherboardRows, ramRows, seedScreenshotReferencePrices };
