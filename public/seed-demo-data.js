const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'nmdwsm.db');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function ensureColumn(table, column, definition) {
  const columns = await all(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

const demoUsers = [
  {
    email: 'demo.seller.gpu@example.com',
    password: 'demo1234',
    username: '硬派顯卡舖',
    realName: '陳柏宇',
    phone: '0900-100-001',
    city: '台北市',
    role: 'seller',
    reputation: 48
  },
  {
    email: 'demo.seller.parts@example.com',
    password: 'demo1234',
    username: '零件整理室',
    realName: '林佳蓉',
    phone: '0900-100-002',
    city: '新北市',
    role: 'seller',
    reputation: 46
  },
  {
    email: 'demo.seller.cooling@example.com',
    password: 'demo1234',
    username: '散熱工坊',
    realName: '黃彥廷',
    phone: '0900-100-003',
    city: '台中市',
    role: 'seller',
    reputation: 47
  },
  {
    email: 'demo.buyer.pc@example.com',
    password: 'demo1234',
    username: '裝機新手阿凱',
    realName: '吳承凱',
    phone: '0900-100-004',
    city: '桃園市',
    role: 'buyer',
    reputation: 42
  },
  {
    email: 'demo.buyer.creator@example.com',
    password: 'demo1234',
    username: '剪輯小築',
    realName: '張雅婷',
    phone: '0900-100-005',
    city: '高雄市',
    role: 'buyer',
    reputation: 44
  }
];

function demoImage(category, title) {
  const imageMap = {
    gpu: '/assets/products/gpu.png',
    cpu: '/assets/products/cpu.png',
    mb: '/assets/products/mb.png',
    ram: '/assets/products/ram.png',
    ssd: '/assets/products/ssd.png',
    hdd: '/assets/products/hdd.png',
    cooler: '/assets/products/cooler.png',
    case: '/assets/products/case.png',
    psu: '/assets/products/psu.png'
  };
  return imageMap[category] || '/assets/products/gpu.png';
}

const demoProducts = [
  {
    sellerEmail: 'demo.seller.gpu@example.com',
    title: 'ASUS Dual GeForce RTX 4060 8GB 顯示卡',
    description: '雙風扇版本，功能正常，適合 1080p 遊戲與直播入門。已清潔並可面交測試 HDMI / DisplayPort 輸出。',
    specs: 'NVIDIA GeForce RTX 4060、8GB GDDR6、PCIe 4.0、雙風扇散熱、建議 550W 以上電源。',
    category: 'gpu',
    price: 7800,
    condition: 'good',
    location: 'ASUS',
    usageTag: '遊戲',
    views: 38
  },
  {
    sellerEmail: 'demo.seller.gpu@example.com',
    title: 'MSI GeForce RTX 4060 Ti Gaming X 8G 顯示卡',
    description: '升級顯卡後出售，風扇安靜無異音，原盒與防靜電袋保留。',
    specs: 'NVIDIA GeForce RTX 4060 Ti、8GB GDDR6、Twin Frozr 散熱、HDMI x1、DisplayPort x3。',
    category: 'gpu',
    price: 9800,
    condition: 'excellent',
    location: 'MSI',
    usageTag: '遊戲',
    views: 56
  },
  {
    sellerEmail: 'demo.seller.gpu@example.com',
    title: 'GIGABYTE Radeon RX 6700 XT 12G 顯示卡',
    description: '12GB VRAM 適合 2K 遊戲，無挖礦使用紀錄，售出前可現場跑 3DMark。',
    specs: 'AMD Radeon RX 6700 XT、12GB GDDR6、三風扇、PCIe 4.0、HDMI / DisplayPort 輸出。',
    category: 'gpu',
    price: 8600,
    condition: 'good',
    location: 'GIGABYTE',
    usageTag: '遊戲',
    views: 44
  },
  {
    sellerEmail: 'demo.seller.gpu@example.com',
    title: 'ASUS TUF Gaming GeForce RTX 3070 O8G 顯示卡',
    description: '外觀有正常使用痕跡，溫度與風扇轉速正常，適合 1440p 遊戲。',
    specs: 'NVIDIA GeForce RTX 3070、8GB GDDR6、TUF 三風扇散熱、2.7 slot 厚度。',
    category: 'gpu',
    price: 11800,
    condition: 'used',
    location: 'ASUS',
    usageTag: '遊戲',
    views: 61
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'AMD Ryzen 5 5600 處理器',
    description: 'AM4 平台六核心處理器，升級 8 核後出售，針腳正常。',
    specs: '6 核心 12 執行緒、Zen 3、Base 3.5GHz、Boost 4.4GHz、65W TDP、AM4 腳位。',
    category: 'cpu',
    price: 2800,
    condition: 'good',
    location: 'AMD',
    usageTag: '遊戲',
    views: 29
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Intel Core i5-12400F 處理器',
    description: '無內顯版本，適合搭配獨立顯示卡，功能正常。',
    specs: '6 核心 12 執行緒、LGA1700、最高 4.4GHz、無內建顯示、支援 DDR4 / DDR5 平台。',
    category: 'cpu',
    price: 3200,
    condition: 'excellent',
    location: 'Intel',
    usageTag: '遊戲',
    views: 33
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'AMD Ryzen 7 5700X 處理器',
    description: '剪輯與多工升級用八核心處理器，盒裝含保護殼。',
    specs: '8 核心 16 執行緒、Zen 3、Base 3.4GHz、Boost 4.6GHz、65W TDP、AM4 腳位。',
    category: 'cpu',
    price: 4800,
    condition: 'good',
    location: 'AMD',
    usageTag: '剪輯',
    views: 41
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'GIGABYTE B550M AORUS ELITE 主機板',
    description: 'AM4 micro-ATX 主機板，含 I/O 擋板，M.2 與記憶體插槽測試正常。',
    specs: 'AMD B550、AM4、DDR4、M.2 PCIe 4.0、Realtek GbE LAN、micro-ATX。',
    category: 'mb',
    price: 2600,
    condition: 'good',
    location: 'GIGABYTE',
    usageTag: '遊戲',
    views: 24
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'ASUS PRIME B660M-K D4 主機板',
    description: 'Intel 12 / 13 代 DDR4 入門主機板，適合文書或中階遊戲主機。',
    specs: 'Intel B660、LGA1700、DDR4、M.2 插槽、micro-ATX、含 I/O 擋板。',
    category: 'mb',
    price: 2200,
    condition: 'used',
    location: 'ASUS',
    usageTag: '文書',
    views: 21
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Kingston FURY Beast DDR4 3200 16GBx2 記憶體',
    description: '32GB 雙通道套裝，XMP 可正常啟用，適合遊戲與多工。',
    specs: 'DDR4-3200、16GB x2、CL16、1.35V、黑色散熱片、支援 Intel XMP。',
    category: 'ram',
    price: 1800,
    condition: 'good',
    location: 'Kingston',
    usageTag: '遊戲',
    views: 35
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Corsair Vengeance LPX DDR4 3600 8GBx2 記憶體',
    description: '16GB 低矮散熱片記憶體，適合塔散空間較緊的機殼。',
    specs: 'DDR4-3600、8GB x2、CL18、1.35V、低高度散熱片、XMP 2.0。',
    category: 'ram',
    price: 1300,
    condition: 'excellent',
    location: 'Corsair',
    usageTag: '遊戲',
    views: 27
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Samsung 980 PRO 1TB NVMe SSD',
    description: 'PCIe 4.0 高速 SSD，健康度良好，適合系統碟或剪輯素材碟。',
    specs: 'M.2 2280、PCIe 4.0 x4、NVMe、1TB、官方最高讀取 7000MB/s 等級。',
    category: 'ssd',
    price: 2400,
    condition: 'good',
    location: 'Samsung',
    usageTag: '剪輯',
    views: 48
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Samsung 970 EVO Plus 1TB NVMe SSD',
    description: '穩定耐用的 PCIe 3.0 SSD，健康狀態良好，可提供檢測截圖。',
    specs: 'M.2 2280、PCIe 3.0 x4、NVMe、1TB、TLC NAND。',
    category: 'ssd',
    price: 1900,
    condition: 'good',
    location: 'Samsung',
    usageTag: '遊戲',
    views: 31
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'WD Blue SN570 500GB NVMe SSD',
    description: '入門升級用 M.2 SSD，讀寫正常，適合文書機或遊戲副碟。',
    specs: 'M.2 2280、PCIe 3.0 x4、NVMe、500GB、無 DRAM 設計。',
    category: 'ssd',
    price: 850,
    condition: 'used',
    location: 'WD',
    usageTag: '文書',
    views: 18
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Seagate BarraCuda 2TB 3.5 吋硬碟',
    description: '資料備份用硬碟，運轉正常，交易前可現場查看健康狀態。',
    specs: '3.5 吋、2TB、SATA 6Gb/s、7200RPM 等級、適合資料碟。',
    category: 'hdd',
    price: 900,
    condition: 'good',
    location: 'Seagate',
    usageTag: '備份',
    views: 16
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'WD Red Plus 4TB NAS 硬碟',
    description: 'NAS 升級後汰換，適合備份與家用檔案伺服器。',
    specs: '3.5 吋、4TB、SATA、CMR、NAS 用途、24x7 工作負載設計。',
    category: 'hdd',
    price: 2200,
    condition: 'used',
    location: 'WD',
    usageTag: '備份',
    views: 23
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'Noctua NH-U12S 塔式風冷散熱器',
    description: '風扇安靜，鰭片完整，附 AM4 扣具，適合中高階處理器。',
    specs: '120mm 單塔散熱器、NF-F12 PWM 風扇、6 年級耐用設計、支援多平台扣具。',
    category: 'cooler',
    coolingType: 'fan',
    price: 1500,
    condition: 'good',
    location: 'Noctua',
    usageTag: '靜音',
    views: 26
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'Cooler Master MasterLiquid ML240L ARGB V2 一體式水冷',
    description: '240mm 水冷排，水泵正常無異音，ARGB 燈效可亮。',
    specs: '240mm 一體式水冷、雙 120mm ARGB 風扇、低阻力冷排、支援 Intel / AMD 扣具。',
    category: 'cooler',
    coolingType: 'liquid',
    price: 2100,
    condition: 'used',
    location: 'Cooler Master',
    usageTag: '遊戲',
    views: 37
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'Fractal Design Meshify C 玻璃側透機殼',
    description: '中塔機殼，前面板網孔進氣，側透玻璃無破裂，適合 ATX 裝機。',
    specs: 'ATX 中塔、鋼化玻璃側板、網孔前面板、支援長顯卡與多顆風扇。',
    category: 'case',
    price: 1800,
    condition: 'good',
    location: 'Fractal Design',
    usageTag: '遊戲',
    views: 22
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'Seasonic Focus GX-750 80 Plus Gold 全模組電源',
    description: '升級瓦數後出售，線材齊全，運作穩定，適合中高階顯示卡平台。',
    specs: '750W、80 Plus Gold、全模組化、單路 +12V、120mm FDB 風扇。',
    category: 'psu',
    price: 2400,
    condition: 'excellent',
    location: 'Seasonic',
    usageTag: '遊戲',
    views: 40
  },
  {
    sellerEmail: 'demo.seller.gpu@example.com',
    title: 'ZOTAC Gaming GeForce RTX 3060 Twin Edge OC 12GB 顯示卡',
    description: '12GB VRAM 版本，適合 1080p 遊戲與影像剪輯入門，雙風扇散熱正常。',
    specs: 'NVIDIA GeForce RTX 3060、12GB GDDR6、雙風扇、HDMI / DisplayPort、建議 550W 電源。',
    category: 'gpu',
    price: 6200,
    condition: 'good',
    location: 'ZOTAC',
    usageTag: '遊戲',
    views: 34
  },
  {
    sellerEmail: 'demo.seller.gpu@example.com',
    title: 'SAPPHIRE Pulse Radeon RX 7600 8GB 顯示卡',
    description: 'RDNA 3 入門遊戲卡，功耗低，適合 1080p 高畫質遊戲。',
    specs: 'AMD Radeon RX 7600、8GB GDDR6、PCIe 4.0、雙風扇、HDMI / DisplayPort。',
    category: 'gpu',
    price: 6900,
    condition: 'excellent',
    location: 'SAPPHIRE',
    usageTag: '遊戲',
    views: 32
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Intel Core i7-12700K 處理器',
    description: '12 代高階處理器，適合遊戲、直播與剪輯多工，升級平台後出售。',
    specs: '12 核心 20 執行緒、LGA1700、最高 5.0GHz、支援 DDR4 / DDR5、125W Base Power。',
    category: 'cpu',
    price: 7200,
    condition: 'good',
    location: 'Intel',
    usageTag: '剪輯',
    views: 39
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'AMD Ryzen 5 7600 處理器',
    description: 'AM5 平台六核心處理器，遊戲效能佳，盒裝處理器本體功能正常。',
    specs: '6 核心 12 執行緒、Zen 4、AM5、最高 5.1GHz、65W TDP、支援 DDR5。',
    category: 'cpu',
    price: 5600,
    condition: 'excellent',
    location: 'AMD',
    usageTag: '遊戲',
    views: 36
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'MSI MAG B760M MORTAR WIFI DDR4 主機板',
    description: 'LGA1700 中階主機板，Wi-Fi 功能正常，含天線與 I/O 擋板。',
    specs: 'Intel B760、LGA1700、DDR4、Wi-Fi、2.5G LAN、M.2 插槽、micro-ATX。',
    category: 'mb',
    price: 3600,
    condition: 'good',
    location: 'MSI',
    usageTag: '遊戲',
    views: 28
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'ASRock B650M Pro RS 主機板',
    description: 'AM5 DDR5 平台主機板，適合 Ryzen 7000 系列裝機升級。',
    specs: 'AMD B650、AM5、DDR5、PCIe 4.0 M.2、2.5G LAN、micro-ATX。',
    category: 'mb',
    price: 3900,
    condition: 'excellent',
    location: 'ASRock',
    usageTag: '遊戲',
    views: 25
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'G.SKILL Ripjaws V DDR4 3200 16GBx2 記憶體',
    description: '32GB 雙通道記憶體，已測試 XMP 3200 可正常啟用。',
    specs: 'DDR4-3200、16GB x2、CL16、1.35V、黑色散熱片。',
    category: 'ram',
    price: 1750,
    condition: 'good',
    location: 'G.SKILL',
    usageTag: '遊戲',
    views: 30
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Crucial DDR5 5600 16GBx2 記憶體',
    description: 'DDR5 32GB 套裝，適合 AM5 或 Intel DDR5 平台升級。',
    specs: 'DDR5-5600、16GB x2、UDIMM、1.1V、原廠裸條設計。',
    category: 'ram',
    price: 2600,
    condition: 'excellent',
    location: 'Crucial',
    usageTag: '剪輯',
    views: 26
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Crucial P3 Plus 2TB NVMe SSD',
    description: '2TB 大容量 PCIe 4.0 SSD，適合遊戲庫與剪輯素材暫存。',
    specs: 'M.2 2280、PCIe 4.0 x4、NVMe、2TB、QLC NAND。',
    category: 'ssd',
    price: 2900,
    condition: 'good',
    location: 'Crucial',
    usageTag: '剪輯',
    views: 33
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Kingston NV2 1TB NVMe SSD',
    description: '入門 PCIe 4.0 M.2 SSD，讀寫正常，適合系統碟或遊戲碟。',
    specs: 'M.2 2280、PCIe 4.0 x4、NVMe、1TB、單面顆粒設計。',
    category: 'ssd',
    price: 1500,
    condition: 'used',
    location: 'Kingston',
    usageTag: '文書',
    views: 20
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Toshiba P300 3TB 3.5 吋硬碟',
    description: '桌機資料碟，容量 3TB，適合備份、照片與遊戲資料存放。',
    specs: '3.5 吋、3TB、SATA、7200RPM 等級、桌上型電腦用硬碟。',
    category: 'hdd',
    price: 1200,
    condition: 'good',
    location: 'Toshiba',
    usageTag: '備份',
    views: 17
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'DeepCool AK400 塔式風冷散熱器',
    description: '單塔風冷，外觀乾淨，附 Intel / AMD 常用扣具。',
    specs: '120mm PWM 風扇、4 支熱導管、單塔散熱器、支援多平台安裝。',
    category: 'cooler',
    coolingType: 'fan',
    price: 900,
    condition: 'good',
    location: 'DeepCool',
    usageTag: '靜音',
    views: 22
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'NZXT Kraken X63 280mm 一體式水冷',
    description: '280mm 水冷排，水泵與風扇正常，適合高階 CPU 壓溫。',
    specs: '280mm AIO 水冷、雙 140mm 風扇、可旋轉冷頭、支援 Intel / AMD 扣具。',
    category: 'cooler',
    coolingType: 'liquid',
    price: 3600,
    condition: 'used',
    location: 'NZXT',
    usageTag: '遊戲',
    views: 31
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'NZXT H510 Flow 玻璃側透機殼',
    description: '白色中塔機殼，前面板透氣版，側玻璃完整，適合簡潔裝機。',
    specs: 'ATX 中塔、鋼化玻璃側板、前面板網孔、支援 280mm 水冷排。',
    category: 'case',
    price: 1900,
    condition: 'good',
    location: 'NZXT',
    usageTag: '遊戲',
    views: 24
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'Lian Li LANCOOL 216 黑色機殼',
    description: '大風量中塔機殼，前置雙大風扇，適合高階顯卡平台。',
    specs: 'ATX 中塔、前置 160mm 風扇、網孔面板、支援長顯卡與大型水冷。',
    category: 'case',
    price: 2600,
    condition: 'excellent',
    location: 'LIAN LI',
    usageTag: '遊戲',
    views: 29
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'Corsair RM850x 80 Plus Gold 全模組電源',
    description: '850W 金牌全模組電源，升級 ATX 3.0 後出售，線材齊全。',
    specs: '850W、80 Plus Gold、全模組化、135mm 磁浮風扇、低噪音模式。',
    category: 'psu',
    price: 3300,
    condition: 'good',
    location: 'Corsair',
    usageTag: '遊戲',
    views: 35
  },
  {
    sellerEmail: 'demo.seller.cooling@example.com',
    title: 'be quiet! Pure Power 11 600W 金牌電源',
    description: '安靜型 600W 電源，適合中階顯卡與文書遊戲主機。',
    specs: '600W、80 Plus Gold、半模組化、靜音風扇、雙路 12V 設計。',
    category: 'psu',
    price: 1600,
    condition: 'used',
    location: 'be quiet!',
    usageTag: '文書',
    views: 19
  },
  {
    sellerEmail: 'demo.seller.gpu@example.com',
    title: 'Intel Arc A750 Limited Edition 8GB 顯示卡',
    description: 'Intel Arc 顯示卡，適合想嘗試 AV1 編碼與 1080p 遊戲的玩家。',
    specs: 'Intel Arc A750、8GB GDDR6、AV1 編碼、PCIe 4.0、雙風扇公版外觀。',
    category: 'gpu',
    price: 5200,
    condition: 'good',
    location: 'Intel',
    usageTag: '剪輯',
    views: 27
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'ASUS ROG Strix B550-F Gaming WiFi 主機板',
    description: 'AM4 ATX 主機板，含 Wi-Fi 與完整後 I/O，適合 Ryzen 5000 裝機。',
    specs: 'AMD B550、AM4、DDR4、Wi-Fi、2.5G LAN、PCIe 4.0 M.2、ATX。',
    category: 'mb',
    price: 4200,
    condition: 'good',
    location: 'ASUS',
    usageTag: '遊戲',
    views: 30
  },
  {
    sellerEmail: 'demo.seller.parts@example.com',
    title: 'Seagate IronWolf 6TB NAS 硬碟',
    description: 'NAS 用 6TB 硬碟，適合家庭備份與小型檔案伺服器。',
    specs: '3.5 吋、6TB、SATA、CMR、NAS 工作負載、AgileArray 韌體。',
    category: 'hdd',
    price: 3600,
    condition: 'good',
    location: 'Seagate',
    usageTag: '備份',
    views: 21
  }
];

async function upsertUser(user) {
  await run(
    `INSERT OR IGNORE INTO users
      (email, password, username, real_name, phone, city, role, reputation_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.email, user.password, user.username, user.realName, user.phone, user.city, user.role, user.reputation]
  );
  await run(
    `UPDATE users
     SET username = ?, real_name = ?, phone = ?, city = ?, role = ?, reputation_score = ?
     WHERE email = ?`,
    [user.username, user.realName, user.phone, user.city, user.role, user.reputation, user.email]
  );
}

async function upsertProduct(product, sellerId) {
  const existing = await get('SELECT id FROM products WHERE title = ?', [product.title]);
  const params = [
    sellerId,
    product.title,
    product.description,
    product.category,
    product.price,
    product.condition,
    product.specs,
    product.category === 'cooler' ? product.coolingType || '' : '',
    product.image || demoImage(product.category, product.title),
    product.location,
    product.usageTag,
    1,
    product.views,
    'active'
  ];

  if (existing) {
    await run(
      `UPDATE products
       SET seller_id = ?, title = ?, description = ?, category = ?, price = ?, condition = ?,
           specs = ?, cooling_type = ?, image_url = ?, location = ?, usage_tag = ?,
           negotiable = ?, views = ?, status = ?
       WHERE id = ?`,
      [...params, existing.id]
    );
    return;
  }

  await run(
    `INSERT INTO products
      (seller_id, title, description, category, price, condition, specs, cooling_type,
       image_url, location, usage_tag, negotiable, views, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

async function main() {
  await run('PRAGMA foreign_keys = ON');
  await ensureColumn('users', 'role', "role TEXT DEFAULT 'buyer'");
  await ensureColumn('products', 'specs', 'specs TEXT');
  await ensureColumn('products', 'cooling_type', 'cooling_type TEXT');
  await ensureColumn('products', 'image_url', 'image_url TEXT');
  await ensureColumn('products', 'location', 'location TEXT');
  await ensureColumn('products', 'usage_tag', 'usage_tag TEXT');
  await ensureColumn('products', 'negotiable', 'negotiable INTEGER DEFAULT 0');
  await ensureColumn('products', 'views', 'views INTEGER DEFAULT 0');

  await run("UPDATE products SET status = 'inactive' WHERE status = 'active'");

  for (const user of demoUsers) {
    await upsertUser(user);
  }

  for (const product of demoProducts) {
    const seller = await get('SELECT id FROM users WHERE email = ?', [product.sellerEmail]);
    if (!seller) throw new Error(`Missing seller: ${product.sellerEmail}`);
    await upsertProduct(product, seller.id);
  }

  const activeCount = await get("SELECT COUNT(*) AS count FROM products WHERE status = 'active'");
  console.log(`Demo data ready: ${demoUsers.length} users upserted, ${activeCount.count} active products.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
