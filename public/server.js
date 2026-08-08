const http = require('http');
const fs = require('fs');
const path = require('path');

// 引入網路爬蟲相關套件
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
// SQLite 資料庫
const db = require('./db.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname);
const BLOCKED_STATIC_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);
const BLOCKED_STATIC_FILES = new Set(['users.json', 'products.json', 'posts.json']);
const LEGACY_PAGE_ROUTES = new Set([
    '/marketplace', '/marketplace.html', '/seller', '/seller.html',
    '/products', '/products.html', '/product', '/product.html',
    '/cart', '/cart.html', '/checkout', '/checkout.html',
    '/transactions', '/transactions.html'
]);
const LEGACY_API_PREFIXES = ['/api/products', '/api/favorites', '/api/cart', '/api/transactions'];

function isLegacyApiPath(pathname) {
    return LEGACY_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}
// --- SQLite 資料庫初始化 ---
db.initDatabase().then(() => {
    console.log('✅ 資料庫已連接');
}).catch(err => {
    console.error('❌ 資料庫連接失敗:', err.message);
    process.exit(1);
});

function normalizeAttachmentList(items) {
    if (Array.isArray(items)) {
        return items.filter(Boolean);
    }

    return items ? [items] : [];
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function isBlockedStaticFile(filePath) {
    const fileName = path.basename(filePath).toLowerCase();
    const ext = path.extname(fileName);
    return BLOCKED_STATIC_EXTENSIONS.has(ext) || BLOCKED_STATIC_FILES.has(fileName);
}

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function encodeJsonList(items) {
    return JSON.stringify(normalizeAttachmentList(items));
}

function decodeJsonList(value) {
    if (!value) return [];
    try {
        return normalizeAttachmentList(JSON.parse(value));
    } catch (error) {
        return normalizeAttachmentList(value);
    }
}

async function findRequestUser(identifier) {
    if (!identifier) return null;
    if (/^\d+$/.test(String(identifier))) {
        return db.User.findById(Number(identifier));
    }
    return db.User.findByEmail(identifier);
}

function formatDbReply(reply) {
    return {
        id: reply.id,
        content: reply.content,
        author: reply.username || reply.author_email || '匿名使用者',
        authorEmail: reply.author_email,
        date: reply.created_at,
        images: decodeJsonList(reply.images)
    };
}

async function formatDbPost(post) {
    const replies = await db.Comment.getByPost(post.id);
    return {
        id: post.id,
        title: post.title,
        content: post.content,
        category: post.category,
        author: post.author_name || post.author_email || '匿名使用者',
        authorEmail: post.author_email,
        date: post.created_at,
        images: decodeJsonList(post.images),
        replies: replies.map(formatDbReply)
    };
}

async function requireUserFromBodyOrQuery(parsedUrl, body = {}) {
    const user = await findRequestUser(body.userEmail || body.userId || parsedUrl.searchParams.get('userEmail') || parsedUrl.searchParams.get('userId'));
    return user;
}

// --- 智慧推薦功能實作 ---
// ==========================================
// 1. GPU 動態算分引擎
// ==========================================
function getDynamicGPUScore(gpuStr) {
    if (!gpuStr || gpuStr === "UNKNOWN") return 1000;
    let text = gpuStr.toUpperCase().replace(/[\s-]/g, '');

    // 匹配 NVIDIA (例: RTX4070TI, GTX1650)
    // 拆解為: [1]品牌(RTX/GTX) [2]世代(40) [3]位階(70) [4]後綴(TI)
    const nvRegex = /(RTX|GTX)(\d{1,2})(\d{2})(TI|SUPER)?/;
    const nvMatch = text.match(nvRegex);

    if (nvMatch) {
        let gen = parseInt(nvMatch[2], 10);   // 10, 20, 30, 40, 50
        let tier = parseInt(nvMatch[3], 10);  // 50, 60, 70, 80, 90
        let suffix = nvMatch[4] || "";

        // GTX 16 系列特例，歸類為 1.5 代
        let genIndex = (gen === 16) ? 1.5 : (gen / 10);

        // A. 決定基準分數 (以 30 系列 / Gen 3 為基準)
        let baseScore = 5000;
        if (tier === 50) baseScore = 6000;
        else if (tier === 60) baseScore = 10000;
        else if (tier === 70) baseScore = 16000;
        else if (tier === 80) baseScore = 22000;
        else if (tier === 90) baseScore = 28000;

        // B. 世代指數加權 (每代效能成長抓 25%)
        // 算式: Base * (1.25 ^ (目前世代 - 3))
        let genMultiplier = Math.pow(1.25, genIndex - 3);

        // C. 後綴加權
        let suffixMultiplier = 1.0;
        if (suffix === "TI") suffixMultiplier = 1.15;      // Ti 強約 15%
        if (suffix === "SUPER") suffixMultiplier = 1.10;   // SUPER 強約 10%

        return Math.round(baseScore * genMultiplier * suffixMultiplier);
    }

    // 匹配 AMD (例: RX7800XT)
    const amdRegex = /(RX)(\d)(\d{2})(0)(XTX|XT|GRE)?/;
    const amdMatch = text.match(amdRegex);
    if (amdMatch) {
        let gen = parseInt(amdMatch[2], 10);  // 5, 6, 7
        let tier = parseInt(amdMatch[3], 10); // 60, 70, 80, 90
        let suffix = amdMatch[5] || "";

        let baseScore = 4500;
        if (tier === 60) baseScore = 9000;
        else if (tier === 70) baseScore = 14000;
        else if (tier === 80) baseScore = 20000;
        else if (tier === 90) baseScore = 26000;

        // AMD 每一代跳號是 1 (例如 RX 6000 -> RX 7000)
        let genMultiplier = Math.pow(1.20, gen - 6); // 以 RX 6000 為基準，代差成長 20%
        
        let suffixMultiplier = 1.0;
        if (suffix === "XTX") suffixMultiplier = 1.20;
        if (suffix === "XT") suffixMultiplier = 1.15;
        if (suffix === "GRE") suffixMultiplier = 1.10;

        return Math.round(baseScore * genMultiplier * suffixMultiplier);
    }

    return 1000; // 無法辨識的 GPU 基礎分
}

function extractGPU(text) {
    const gpuRegex = /(RTX|GTX|RX)\s*-?\s*\d{4}\s*(Ti|SUPER|XTX|XT|GRE)?/i;
    const match = text.match(gpuRegex);
    return match ? match[0].toUpperCase().replace(/[\s-]/g, '') : "UNKNOWN";
}
// ==========================================
// 2.擷取工具
// ==========================================
function extractCPU(text) {
    // 新增了 |(?:i[3579]|Ryzen\s*[3579])處理器 來捕捉模糊寫法
    const cpuRegex = /(i[3579]-\d{4,5}[A-Z]*|Ultra\s*[579]\s*\d{3}[A-Z]*|Ryzen\s*\d\s*\d{4}[A-Z\d]*|R[3579]-\d{4}[A-Z\d]*|TR\s*(PRO\s*)?\d{4}[A-Z]*|(?:i[3579]|Ryzen\s*[3579])處理器)/i;
    
    const match = text.match(cpuRegex);
    if (match) {
        return match[0].toUpperCase().replace(/\s+/g, '');
    }
    return "UNKNOWN";
}
// ==========================================
// 2. CPU 動態算分引擎
// ==========================================
function getDynamicCPUScore(cpuStr) {
    if (!cpuStr || cpuStr === "UNKNOWN") return 2000;
    let text = cpuStr.toUpperCase().replace(/\s+/g, '');

    // 匹配 Intel Core (例: I7-13700K, I5-12400F)
    const intelRegex = /I([3579])-(\d{2})(\d{3})([KFSX]*)/;
    const intelMatch = text.match(intelRegex);
    if (intelMatch) {
        let series = parseInt(intelMatch[1], 10); // 3, 5, 7, 9
        let gen = parseInt(intelMatch[2], 10);    // 12, 13, 14
        let suffix = intelMatch[4] || "";

        // A. 位階基準分 (以 12 代為基準 Gen 12)
        let baseScore = 4000;
        if (series === 3) baseScore = 6000;
        else if (series === 5) baseScore = 9000;
        else if (series === 7) baseScore = 14000;
        else if (series === 9) baseScore = 19000;

        // B. 世代加權 (Intel 每代擠牙膏約 12%~15%)
        let genMultiplier = Math.pow(1.15, gen - 12);

        // C. 後綴加權
        let suffixMultiplier = 1.0;
        if (suffix.includes("K")) suffixMultiplier = 1.10; // K 版時脈較高
        if (suffix.includes("T") || suffix.includes("U")) suffixMultiplier = 0.8; // 低壓版扣分

        return Math.round(baseScore * genMultiplier * suffixMultiplier);
    }

    // 匹配 AMD Ryzen (例: RYZEN7-7800X3D)
    const amdRegex = /(?:RYZEN|R)([3579])-?(\d)(\d{2})(0)([XG3DF]*)/;
    const amdMatch = text.match(amdRegex);
    if (amdMatch) {
        let series = parseInt(amdMatch[1], 10); // 3, 5, 7, 9
        let gen = parseInt(amdMatch[2], 10);    // 5, 7, 9 (千位數)
        let suffix = amdMatch[5] || "";

        let baseScore = 4000;
        if (series === 3) baseScore = 5500;
        else if (series === 5) baseScore = 8500;
        else if (series === 7) baseScore = 13500;
        else if (series === 9) baseScore = 18500;

        // AMD 世代跳號 (5000 -> 7000 是跳 2，所以要除以 2)
        let genMultiplier = Math.pow(1.15, (gen - 5) / 2);

        let suffixMultiplier = 1.0;
        if (suffix.includes("X3D")) suffixMultiplier = 1.25; // 遊戲神 U，給予 25% 加成
        if (suffix.includes("X")) suffixMultiplier = 1.08;
        if (suffix.includes("G")) suffixMultiplier = 0.95; // 帶內顯通常快取較小

        return Math.round(baseScore * genMultiplier * suffixMultiplier);
    }
    
    // 處理模糊型號 (如 "i5處理器")
    if (text.includes("I9") || text.includes("RYZEN9")) return 15000;
    if (text.includes("I7") || text.includes("RYZEN7")) return 12000;
    if (text.includes("I5") || text.includes("RYZEN5")) return 8500;
    if (text.includes("I3") || text.includes("RYZEN3")) return 5500;

    return 2000; // 無法辨識的 CPU 基礎分
}

function extractCPU(text) {
    const cpuRegex = /(i[3579]-\d{4,5}[KFSX]*|Ryzen\s*\d\s*\d{4}[A-Z\d]*|R[3579]-\d{4}[A-Z\d]*|(?:i[3579]|Ryzen\s*[3579])處理器)/i;
    const match = text.match(cpuRegex);
    return match ? match[0].toUpperCase().replace(/\s+/g, '') : "UNKNOWN";
}

// ==========================================
// 4. GPU 擷取工具
// ==========================================
function extractGPU(text) {
    const gpuRegex = /(RTX|GTX|RX)\s*-?\s*\d{4}\s*(Ti|SUPER|XT)?/i;
    const match = text.match(gpuRegex);
    return match ? match[0].toUpperCase().replace(/[\s-]/g, '') : "UNKNOWN";
}
// ==========================================
// 5. 記憶體 (RAM) 擷取與加分邏輯
// ==========================================
function extractRAM(text) {
    // 鎖定常見的記憶體容量 (8, 16, 32, 64, 128)，排除 SSD 常見容量以防誤判
    // 同時偵測是否有帶 DDR4/DDR5 或 記憶體 字眼
    const ramRegex = /\b(8|16|32|64|128)\s*(?:GB|G)\b/i;
    const match = text.match(ramRegex);
    if (match) {
        let size = parseInt(match[1], 10);
        return size + "GB"; // 統一格式為 16GB, 32GB
    }
    return "UNKNOWN";
}
function getRamBonusScore(ramString) {
    if (ramString === "128GB") return 6500;
    if (ramString === "64GB") return 4500;
    if (ramString === "32GB") return 3500;
    if (ramString === "16GB") return 1800;
    if (ramString === "8GB") return 900;
    if (ramString === "4GB") return 400;
    if (ramString === "2GB") return 100;
    return 0; // 找不到不加分
}
// ==========================================
// 6. 作業系統 (OS) 擷取與加分邏輯
// ==========================================
function extractOS(text) {
    const osRegex = /(Win\s*11|Windows\s*11|W11|Win\s*10|Windows\s*10|W10)([\w\u4e00-\u9fa5]*)/i;
    const match = text.match(osRegex);
    if (match) {
        // match[1] 是系統版本 (Win11), match[2] 是後綴 (專業版/Pro)
        let version = match[1].toUpperCase().replace(/\s+/g, '');
        let edition = match[2] || "";
        if (version === 'WINDOWS11' || version === 'W11') version = 'WIN11';
        if (version === 'WINDOWS10' || version === 'W10') version = 'WIN10';
        
        if (edition.includes("專業") || edition.toUpperCase().includes("PRO")) {
            return version + " Pro";
        }
        return version; // 預設為 Home 或未標明版本
    }
    return "UNKNOWN";
}

function getOsBonusScore(osString) {
    if (osString.includes("Pro")) return 2000; // 專業版最值錢，加 1000 分
    if (osString.includes("WIN11") || osString.includes("WIN10")) return 1500; // 一般版加 500 分
    return 0; // 空機或找不到不加分
}
// ==========================================
// 7. 儲存空間 (SSD/HDD) 萃取與加分邏輯 (含 HDD 給分版)
// ==========================================
function getStorageBonusScore(storageString) {
    if (storageString === "UNKNOWN") return 0; 
    
    // --- 傳統硬碟 (HDD) 給分區間 ---
    if (storageString.includes("HDD")) {
        if (storageString.includes("8TB")) return 3500; 
        if (storageString.includes("4TB")) return 2300; 
        if (storageString.includes("2TB")) return 1200;
        if (storageString.includes("1TB")) return 700;
        if (storageString.includes("500GB")) return 300;
        return 0;
    }
    
    // --- 固態硬碟 (SSD) 給分區間 ---
    if (storageString.includes("SSD")) {
        if (storageString.includes("8TB")) return 6000;
        if (storageString.includes("4TB")) return 4500;
        if (storageString.includes("2TB")) return 3500;
        if (storageString.includes("1TB")) return 1800;
        if (storageString.includes("512GB")) return 1000;
        if (storageString.includes("256GB")) return 500;
    }
    
    return 0; 
}
// --- 爬蟲功能實作 ---

// 1. 原價屋爬蟲
async function scrapeCoolpc(keyword) {
    try {
        console.log(`[原價屋] 正在搜尋: ${keyword}`);
        const response = await axios.get('https://www.coolpc.com.tw/evaluate.php', {
            // axios 不作轉碼，保留原始的 Buffer 格式
            responseType: 'arraybuffer', 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 5000 
        });
        
        // 使用內建 TextDecoder，將原始資料從 Big5 轉為 UTF-8
        const html = new TextDecoder('big5').decode(response.data);
        const $ = cheerio.load(html);
        let results = [];

        $('option').each((i, el) => {
            const text = $(el).text();
            if (text.toLowerCase().includes(keyword.toLowerCase())) {
                let priceMatch = text.match(/\$(\d+)/); 
                let price = priceMatch ? priceMatch[1] : "請至官網確認";
                
                results.push({
                    platform: '原價屋',
                    name: text.substring(0, 125) + '...', // 名稱過長截斷為 125 字
                    price: price,
                    url: 'https://www.coolpc.com.tw/evaluate.php'
                });
            }
        });

        console.log(`[原價屋] 搜尋完成，找到 ${results.length} 筆`);
        
        // 回傳前 99 筆
        return results.slice(0, 99); 
    } catch (error) {
        console.error(`原價屋爬蟲失敗: ${error.message}`);
        return [{ platform: '原價屋', name: '錯誤: 取得失敗', price: 'N/A', url: 'https://www.coolpc.com.tw/evaluate.php' }];
    }
}
// 2. 欣亞數位爬蟲
async function scrapeSinya(keyword) {
    try {
        console.log(`[欣亞] 正在透過 API 搜尋: ${keyword}`);
        
        const apiUrl = `https://gateway.sinya.com.tw/api/diy/search?keyword=${encodeURIComponent(keyword)}`;
        
        const response = await axios.get(apiUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.sinya.com.tw/' 
            },
            timeout: 5000
        });

        let results = [];
        const items = response.data.data || []; 
        items.forEach(item => {
            if (item && item.prod_name && item.prod_name.toLowerCase().includes(keyword.toLowerCase())) {
                results.push({
                    platform: '欣亞',
                    name: item.prod_name, 
                    price: item.price ? item.price.toLocaleString() : '請至官網確認',
                    url: item.prod_id ? `https://www.sinya.com.tw/prod/${item.prod_id}` : `https://www.sinya.com.tw/search?keyword=${encodeURIComponent(keyword)}`
                });
            }
        });

        console.log(`[欣亞] API 搜尋完成，過濾後找到 ${results.length} 筆`);
        return results.slice(0, 99); 
    } catch (error) {
        console.error(`欣亞 API 爬蟲失敗: ${error.message}`);
        return [{ platform: '欣亞', name: '錯誤: 取得失敗 (API 異常)', price: 'N/A', url: 'https://www.sinya.com.tw/' }];
    }
}
// 3. 露天拍賣爬蟲 (兩段式 API 抓取)
async function scrapeRuten(keyword) {
    try {
        console.log(`[露天] 第一階段：正在搜尋 "${keyword}" 取得商品 ID...`);
        
        // 執行第一階段搜尋
        const searchUrl = `https://rtapi.ruten.com.tw/api/search/v3/index.php/core/prod?q=${encodeURIComponent(keyword)}&type=direct&sort=rnk/dc`; 
        const searchRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000
        });

        // 露天通常將結果放在 Rows 裡面
        const searchRows = searchRes.data.Rows || [];
        if (searchRows.length === 0) {
            console.log(`[露天] 找不到 "${keyword}" 的相關商品`);
            return [];
        }

        // 取前 99 個 ID，並組成 "id1,id2,id3..." 的格式
        const itemIds = searchRows.slice(0, 99).map(row => row.Id || row.GoodsNo).filter(id => id).join(',');

        if (!itemIds) return [];

        console.log(`[露天] 第二階段：已取得 IDs，準備獲取詳細價格與名稱...`);

        // 執行第二階段詳細資料 API
        const detailUrl = `https://rtapi.ruten.com.tw/api/prod/v3/index.php/prod?id=${itemIds}`;
        const detailRes = await axios.get(detailUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000
        });

        let results = [];
        // 解析 JSON 回傳內容
        const items = detailRes.data || [];

        items.forEach(item => {
            let itemPrice = null;
            if (item.PriceRange && item.PriceRange.length > 0) {
                itemPrice = item.PriceRange[0];
            } else {
                itemPrice = item.Price || item.DirectPrice;
            }

            results.push({
                platform: '露天',
                name: item.ProdName || '露天商品', 
                price: itemPrice ? itemPrice.toLocaleString() : '請至賣場確認',
                url: item.ProdId ? `https://www.ruten.com.tw/item/show?${item.ProdId}` : `https://www.ruten.com.tw/find/?q=${encodeURIComponent(keyword)}`
            });
        });

        console.log(`[露天] 搜尋完成，共解析了 ${results.length} 筆詳細資料`);
        return results;

    } catch (error) {
        console.error(`露天爬蟲失敗: ${error.message}`);
        return [{ platform: '露天', name: '錯誤: 取得失敗 (API 異常)', price: 'N/A', url: 'https://www.ruten.com.tw/' }];
    }
}

// 5. PChome 24h 爬蟲
async function scrapePChome(keyword) {
    try {
        console.log(`[PChome] 正在透過 API 搜尋: ${keyword}`);
        const apiUrl = `https://ecshweb.pchome.com.tw/search/v3.3/all/results?q=${encodeURIComponent(keyword)}&page=1&sort=rnk/dc`;
        
        const response = await axios.get(apiUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://24h.pchome.com.tw/',
                'Origin': 'https://24h.pchome.com.tw'
            },
            timeout: 5000
        });

        let results = [];
        const prods = response.data.prods || [];

        prods.forEach(item => {
            // 欄位處理，PChome 有大小寫差異
            const itemName = item.name || item.Name;
            const itemPrice = item.price || item.Price;
            const itemId = item.Id || item.id;

            results.push({
                platform: 'PChome',
                name: itemName || 'PChome 商品',
                price: itemPrice ? itemPrice.toLocaleString() : '請至官網確認',
                url: itemId ? `https://24h.pchome.com.tw/prod/${itemId}` : `https://ecshweb.pchome.com.tw/search/v3.3/?q=${encodeURIComponent(keyword)}`
            });
        });

        console.log(`[PChome] 搜尋完成，找到 ${results.length} 筆`);
        return results.slice(0, 99);

    } catch (error) {
        console.error(`PChome 爬蟲失敗: ${error.message}`);
        return [];
    }
}
// 6. Momo 購物網爬蟲
async function scrapeMomo(keyword) {
    try {
        console.log(`[Momo] 正在透過 API 搜尋: ${keyword}`);

        const apiUrl = 'https://apisearch.momoshop.com.tw/momoSearchCloud/moec/textSearch';
        const payload = {
            host: "momoshop",
            flag: 1,
            data: {
                searchValue: keyword,
                curPage: "1",
                priceS: "0",
                priceE: "9999999",
                searchType: "1"
            }
        };

        const response = await axios.post(apiUrl, payload, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Content-Type': 'application/json',
                'Referer': 'https://www.momoshop.com.tw/'
            },
            timeout: 5000
        });

        let results = [];
        const goodsList = response.data?.rtnSearchData?.goodsInfoList || [];

        if (goodsList.length === 0 && response.data?.rtnSearchData) {
            console.log(`[Momo 偵錯] rtnSearchData 回傳的欄位`, Object.keys(response.data.rtnSearchData));
        }

        goodsList.forEach(item => {
            // 去除價格字串中的符號
            const rawPrice = String(item.goodsPrice || item.price || '');
            const cleanPriceStr = rawPrice.replace(/[^0-9]/g, '');

            results.push({
                platform: 'Momo',
                // 取得商品名稱
                name: item.goodsName || item.name || 'Momo 商品',
                // 如果解析後有數字，則轉換格式
                price: cleanPriceStr ? parseInt(cleanPriceStr, 10).toLocaleString() : '請至官網確認',
                url: item.goodsCode ? `https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=${item.goodsCode}` : `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${encodeURIComponent(keyword)}`
            });
        });
        console.log(`[Momo] 搜尋完成，找到 ${results.length} 筆`);
        return results.slice(0, 99);

    } catch (error) {
        console.error(`Momo 爬蟲失敗: ${error.message}`);
        return [];
    }
}

// 7. 美國 Newegg 爬蟲邏輯 
async function scrapeNewegg(keyword) {
    console.log(`[Newegg] 啟動隱形瀏覽器搜尋美國硬體: ${keyword}`);
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const searchUrl = `https://www.newegg.com/p/pl?d=${encodeURIComponent(keyword)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        const content = await page.content();
        const $ = cheerio.load(content);
        let results = [];

        $('.item-cell').each((i, el) => {
            const name = $(el).find('.item-title').text().trim();
            const priceWhole = $(el).find('.price-current strong').text().trim();
            const priceFraction = $(el).find('.price-current sup').text().trim();
            const link = $(el).find('.item-title').attr('href');

            if (name && priceWhole) {
                results.push({
                    platform: 'Newegg (US)',
                    name: name,
                    price: `USD $${priceWhole}${priceFraction}`,
                    url: link,
                    sales: 0
                });
            }
        });

        console.log(`[Newegg] 搜尋完成，找到 ${results.length} 筆`);
        return results.slice(0, 99);

    } catch (error) {
        console.error(`❌ Newegg 爬蟲失敗: ${error.message}`);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}
// 8. 台灣 Yahoo 購物中心爬蟲邏輯
async function scrapeYahoo(keyword) {
    console.log(`[Yahoo購物] 啟動隱形瀏覽器搜尋: ${keyword}`);
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const searchUrl = `https://tw.buy.yahoo.com/search/product?p=${encodeURIComponent(keyword)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // 等待商品載入
        await page.waitForSelector('a[href*="/gdsale/"], a[href*="/activity/"]', { timeout: 8000 }).catch(() => console.log('[Yahoo購物] 等待商品載入超時'));

        // 模擬人類往下滾動，多滾幾次確保圖片和價格動態載入完成
        for(let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await new Promise(r => setTimeout(r, 800));
        }

        const content = await page.content();
        const $ = cheerio.load(content);
        let results = [];

        $('a[href*="/gdsale/"], a[href*="/activity/"]').each((i, el) => {
            const link = $(el).attr('href');
            
            // 智慧標題萃取，優先抓取圖片的 alt 屬性（最乾淨的商品名稱）
            let name = $(el).find('img').attr('alt');
            
            // 備用方案：如果真的沒抓到 img，只找沒有子元素的純文字節點，避免抓到整個卡片
            if (!name) {
                $(el).find('span, div').each((_, element) => {
                    if ($(element).children().length === 0) {
                        const text = $(element).text().trim();
                        if (text.length > (name?.length || 0) && !text.includes('比較找相似') && !text.includes('折價券')) {
                            name = text;
                        }
                    }
                });
            }
            if (!name) name = '';
            name = name.replace(/^比較找相似\s*/, '').trim();

            // 精準價格萃取，將 HTML 標籤替換成「空白」，製造物理隔離
            const htmlContent = $(el).html() || '';
            const spacedText = htmlContent.replace(/<[^>]+>/g, ' '); 
            
            const priceMatch = spacedText.match(/\$\s*([0-9,]+)/);
            let price = priceMatch ? priceMatch[1].replace(/,/g, '') : null;

            if (name && price && parseInt(price) > 0 && name.length > 5) {
                results.push({
                    platform: 'Yahoo購物',
                    name: name,
                    price: price,
                    url: link.startsWith('http') ? link : `https://tw.buy.yahoo.com${link}`,
                    sales: 0 
                });
            }
        });

        // 去除重複項目
        const uniqueResults = [];
        const urls = new Set();
        for (const item of results) {
            if (!urls.has(item.url)) {
                urls.add(item.url);
                uniqueResults.push(item);
            }
        }

        console.log(`[Yahoo購物] 搜尋完成，找到 ${uniqueResults.length} 筆`);
        return uniqueResults.slice(0, 10);

    } catch (error) {
        console.error(`❌ Yahoo購物 爬蟲失敗: ${error.message}`);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}
// --- 輔助函式 ---
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// --- 建立伺服器與 API 路由 ---
const server = http.createServer(async(req, res) => {
    // 使用新的 URL API 來替換掉被棄用的 url.parse
    const baseURL = `http://${req.headers.host}`;
    const parsedUrl = new URL(req.url, baseURL);
    const pathname = parsedUrl.pathname;

    // 處理 CORS 預檢請求
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
    }

    // 1. 登入 API (使用 SQLite)
    if (pathname === '/api/login' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { email, password } = JSON.parse(body);
                const user = await db.User.findByEmail(email);
                
                if (user && user.password === password) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                    message: "登入成功", 
                        user: { id: user.id, email: user.email, username: user.username } 
                    }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "帳號或密碼錯誤" }));
                }
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "請檢查傳送的資料格式" }));
            }
        });

    // 2. 註冊 API (使用 SQLite)
    } else if (pathname === '/api/register' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const parsedBody = JSON.parse(body);
                console.log('📝 收到註冊請求資料:', parsedBody);
                
                // 兼容前端可能傳遞 name 或 username 的情況
                const { name, username, email, password, confirmPassword } = parsedBody;
                const finalName = name || username;
                
                if (password !== confirmPassword || password.length < 8) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: "密碼不一致" }));
                }

                const existingUser = await db.User.findByEmail(email);
                if (existingUser) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: "此信箱已被註冊" }));
                }

                await db.User.create({
                    email,
                    password,
                    username: finalName || '未命名使用者',
                    real_name: finalName || '',
                    phone: '',
                    city: ''
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: "註冊成功" }));
            } catch (error) {
                console.error('❌ 註冊 API 發生錯誤:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: "伺服器錯誤" }));
            }
        });

// 3. 需求推薦 API (升級版：即時爬蟲與智慧定價)
    } else if (pathname === '/api/recommend' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        
        // ⚠️ 這裡非常重要：必須加上 async，因為內部需要 await 爬蟲結果
        req.on('end', async () => { 
            try {
                // 1. 接收前端傳來的新參數 productType
                const { budget, usage, productType } = JSON.parse(body);
                
                // 2. 根據「商品種類」與「用途」精準設定搜尋關鍵字
                let searchKeyword = '';
                if (productType === 'laptop') {
                    searchKeyword = usage === 'gaming' ? '筆電' : '筆記型電腦';
                } else if (productType === 'component') {
                    searchKeyword = usage === 'gaming' ? '顯示卡' : '處理器';
                } else {
                    // desktop (主機)
                    searchKeyword = usage === 'gaming' ? '主機' : '套裝機'; 
                }

                const [coolpcResults, sinyaResults, pchomeResults, momoResults, yahooResults, rutenResults] = await Promise.all([
                    scrapeCoolpc(searchKeyword),
                    scrapeSinya(searchKeyword),
                    scrapePChome(searchKeyword),
                    scrapeMomo(searchKeyword),
                    scrapeYahoo(searchKeyword),
                    scrapeRuten(searchKeyword)
                    // scrapeAmazon(searchKeyword),
                    // scrapeNewegg(searchKeyword),
                    // scrapeEbay(searchKeyword),
                    // scrape1688(searchKeyword),
                    // scrapeZOL(searchKeyword)
                ]);
                // 2. 將所有通路的資料全部大融合
                let allProducts = [
                    ...coolpcResults, 
                    ...sinyaResults, 
                    ...(pchomeResults || []), 
                    ...(momoResults || []), 
                    ...(yahooResults || []), 
                    ...(rutenResults || [])
                ];
                
                let validProducts = [];

                // 3. 資料清洗與彈性防呆
                // (前方的 for 迴圈與防呆邏輯保持不變...)
                for (let item of allProducts) {
                    if (!item || !item.price) continue;
                    let cleanPrice = parseInt(item.price.toString().replace(/[^\d]/g, ''), 10);
                    
                    const minPrice = productType === 'component' ? 500 : 5000;
                    if (isNaN(cleanPrice) || cleanPrice === 0 || cleanPrice > budget || cleanPrice < minPrice) {
                        continue; 
                    }
                    if (usage === 'gaming' && item.name.includes('文書')) {
                        continue;
                    }
                    // 1. 萃取所有硬體特徵
                    let cpu = extractCPU(item.name);
                    let gpu = extractGPU(item.name);
                    let ram = extractRAM(item.name); 
                    let os = extractOS(item.name);  
                    
                    // 防呆：整機或筆電必須要有 CPU 或 GPU
                    if (productType !== 'component' && cpu === "UNKNOWN" && gpu === "UNKNOWN") {
                        continue; 
                    }
                    // 新增：當選擇 3A 遊戲專用的整機/筆電時，排除沒有抓到獨立顯卡 (GPU) 的商品
                    if (usage === 'gaming' && productType !== 'component' && gpu === "UNKNOWN") {
                        continue;
                    }
                    let cpuScore = getDynamicCPUScore(cpu);
                    let gpuScore = getDynamicGPUScore(gpu);
                    // 2. 計算核心分數 (Base Score)
                    let baseScore = 0;
                    if (productType === 'component') {
                        baseScore = Math.max(cpuScore, gpuScore); 
                    } else {
                        baseScore = usage === 'gaming' 
                            ? (gpuScore * 0.75) + (cpuScore * 0.25) 
                            : (cpuScore * 0.75) + (gpuScore * 0.25);
                    }

                    // 3. 計算額外加分 (Bonus Score)
                    let bonusScore = 0;
                    if (productType !== 'component') { // 只有買整機/筆電才算 RAM 和 OS 加分
                        bonusScore += getRamBonusScore(ram);
                        bonusScore += getOsBonusScore(os);
                    }

                    // 4. 總推薦分數
                    let finalMatchScore = baseScore + bonusScore;

                    // 5. 推入結果陣列 (連同 ram 和 os 一起送給前端)
                    validProducts.push({
                        title: item.name,
                        price: cleanPrice,
                        cpu: cpu,
                        gpu: gpu,
                        ram: ram,                
                        os: os,                  
                        matchScore: finalMatchScore,
                        platform: item.platform || "未知平台",
                        url: item.url || "#"  
                });
                }

                // 如果過濾完沒有東西了
                if (validProducts.length === 0) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ suggestedPrice: 0, recommendations: [] }));
                }

                // ==========================================
                // 先比分數 (高到低)，分數一樣時比價格 (低到高)
                // ==========================================
                validProducts.sort((a, b) => {
                    if (b.matchScore === a.matchScore) {
                        return a.price - b.price; // 分數平手時，越便宜的排越前面
                    }
                    return b.matchScore - a.matchScore; // 分數不同時，分數高的排前面
                });
                const top3Recommendations = validProducts.slice(0, 3);
                let prices = validProducts.map(p => p.price).sort((a, b) => a - b);
                let medianPrice = 0; // 👈 宣告變數，給予預設值 0

                if (prices.length > 4) {
                    prices.pop();   // 去除最高價
                    prices.shift(); // 去除最低價
                }

                if (prices.length > 0) {
                    let mid = Math.floor(prices.length / 2);
                    medianPrice = (prices.length % 2 === 0) 
                        ? (prices[mid - 1] + prices[mid]) / 2 
                        : prices[mid];
                }
                // ==========================================================
                // 計算完畢，回傳給前端
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    suggestedPrice: Math.round(medianPrice),
                    recommendations: top3Recommendations
                }));

            } catch (error) {
                console.error("❌ API 推薦處理發生錯誤:", error);
                // 防呆：確保標頭還沒送出才送 500 錯誤
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "伺服器內部錯誤" }));
                }
            }
        });
    // 4. 取得論壇文章 API (使用 SQLite)
    }else if (pathname === '/api/posts' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const posts = await db.Post.getAll();
            const formattedPosts = await Promise.all(posts.map(formatDbPost));
            sendJson(res, 200, formattedPosts);
        } catch (error) {
            sendJson(res, 500, { success: false, message: "無法讀取文章列表" });
        }

    // 5. 新增論壇文章 API (使用 SQLite)
    } else if (pathname === '/api/posts' && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const { title, content, author, images, author_id, category } = await parseJsonBody(req);
            if (!title || !content) {
                return sendJson(res, 400, { success: false, message: "標題和內容不能為空" });
            }

            const authorUser = author_id ? await db.User.findById(author_id) : await findRequestUser(author);
            const result = await db.Post.create({
                author_id: authorUser?.id || 1,
                title,
                content,
                category: category || '一般討論',
                images: encodeJsonList(images)
            });

            sendJson(res, 200, { success: true, message: "發文成功", post_id: result.id });
        } catch (error) {
            sendJson(res, 500, { success: false, message: "發文發生錯誤" });
        }
        } else if (/^\/api\/posts\/\d+\/replies$/.test(pathname) && req.method === 'POST') {
            setCorsHeaders(res);
            const postId = parseInt(pathname.split('/')[3]);
            try {
                const { content, author, images } = await parseJsonBody(req);
                if (!content) {
                    return sendJson(res, 400, { success: false, message: "回覆內容不能為空" });
                }

                const post = await db.Post.findById(postId);
                if (!post) {
                    return sendJson(res, 404, { success: false, message: "找不到文章" });
                }

                const authorUser = await findRequestUser(author);
                const result = await db.Comment.create({
                    post_id: postId,
                    author_id: authorUser?.id || 1,
                    content,
                    images: encodeJsonList(images)
                });

                const reply = await db.runQueryOne('SELECT c.*, u.username, u.email as author_email FROM comments c LEFT JOIN users u ON c.author_id = u.id WHERE c.id = ?', [result.id]);
                sendJson(res, 200, { success: true, message: '回覆成功', reply: formatDbReply(reply) });
            } catch (error) {
                sendJson(res, 500, { success: false, message: '回覆發生錯誤' });
            }

        // --- 論壇文章修改/刪除 API ---
} else if (pathname.startsWith('/api/posts/') && (req.method === 'PUT' || req.method === 'DELETE')) {
    setCorsHeaders(res);
    const postId = parseInt(pathname.split('/')[3]); // 取得 URL 中的 id

    if (req.method === 'DELETE') {
        const result = await db.Post.delete(postId);
        if (!result.changes) {
            return sendJson(res, 404, { success: false, message: '找不到文章' });
        }
        sendJson(res, 200, { success: true, message: '文章已刪除' });
    } else if (req.method === 'PUT') {
        try {
            const { title, content, images } = await parseJsonBody(req);
            const result = await db.Post.update(postId, {
                title,
                content,
                images: images !== undefined ? encodeJsonList(images) : null
            });
            if (!result.changes) {
                return sendJson(res, 404, { success: false, message: '找不到文章' });
            }
            sendJson(res, 200, { success: true, message: '文章已更新' });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '文章更新失敗' });
        }
    }
/*
    // --- 專題版商品/收藏/模擬交易 API ---
    } else if (pathname === '/api/account/stats' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const user = await requireUserFromBodyOrQuery(parsedUrl);
            if (!user) return sendJson(res, 400, { success: false, message: '缺少使用者' });
            sendJson(res, 200, { success: true, data: await db.Stats.getByUser(user.id) });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '讀取統計失敗' });
        }
*/
    } else if (pathname === '/api/account/name' && req.method === 'PUT') {
        setCorsHeaders(res);
        try {
            const body = await parseJsonBody(req);
            const user = await requireUserFromBodyOrQuery(parsedUrl, body);
            const username = String(body.username || '').trim();
            if (!user) return sendJson(res, 400, { success: false, message: '請先登入' });
            if (!username) return sendJson(res, 400, { success: false, message: '請輸入使用者名稱' });
            if (username.length > 30) return sendJson(res, 400, { success: false, message: '使用者名稱請勿超過 30 個字' });
            await db.User.updateUsername(user.id, username);
            sendJson(res, 200, { success: true, message: '使用者名稱已更新', username });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '更新使用者名稱失敗' });
        }

    } else if (isLegacyApiPath(pathname)) {
        setCorsHeaders(res);
        sendJson(res, 404, { success: false, message: '此功能已停止提供' });

    } else if (LEGACY_PAGE_ROUTES.has(pathname)) {
        res.writeHead(302, { Location: '/' });
        res.end();

    } else if (pathname.startsWith('/uploads/products/')) {
        sendJson(res, 404, { success: false, message: '檔案不存在' });

    }// 爬蟲 API 路由
    else if (pathname === '/api/scrape' && req.method === 'GET') {
        setCorsHeaders(res);
        const getParam = (key) => parsedUrl.query ? parsedUrl.query[key] : parsedUrl.searchParams?.get(key);
        
        const keyword = getParam('keyword');
        // 接收前端傳來的逗號字串 (例如 "coolpc,sinya")
        const platformParam = getParam('platform') || 'all'; 
        const excludeStr = getParam('exclude') || ''; 
        const includeStr = getParam('include') || ''; 
        const categoriesStr = getParam('categories') || ''
        if (!keyword) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: "請輸入搜尋關鍵字" }));
        }
        console.log(`[系統] 收到搜尋請求: ${keyword}`);

        const requestedPlatforms = platformParam.split(',');
        const isAll = requestedPlatforms.includes('all');

        let allResults = [];
        
        // 根據解開的陣列，精準觸發爬蟲
        if (isAll || requestedPlatforms.includes('coolpc')) {
            const coolpcData = await scrapeCoolpc(keyword);
            allResults = allResults.concat(coolpcData);
        }
        if (isAll || requestedPlatforms.includes('sinya')) {
            const sinyaData = await scrapeSinya(keyword);
            allResults = allResults.concat(sinyaData);
        }
        if (isAll || requestedPlatforms.includes('ruten')) {
            const rutenData = await scrapeRuten(keyword);
            allResults = allResults.concat(rutenData);
        }
        if (isAll || requestedPlatforms.includes('pchome')) {
            const pchomeData = await scrapePChome(keyword);
            allResults = allResults.concat(pchomeData);
        }
        if (isAll || requestedPlatforms.includes('momo')) {
            const momoData = await scrapeMomo(keyword);
            allResults = allResults.concat(momoData);
        }
        if (isAll || requestedPlatforms.includes('newegg')) {
            const neweggData = await scrapeNewegg(keyword);
            allResults = allResults.concat(neweggData);
        }
        if (isAll || requestedPlatforms.includes('yahoo')) {
            const yahooData = await scrapeYahoo(keyword);
            allResults = allResults.concat(yahooData);
        }
        // ==========================================
        // 核心邏輯：三向關鍵字過濾器 + 智慧防呆機制
        // ==========================================
    
        const includeWords = includeStr.split(/[\s,]+/).filter(w => w);
        let excludeWords = excludeStr.split(/[\s,]+/).filter(w => w); 
        const categoryWords = categoriesStr.split(',').filter(w => w);

        // 預設沒有最低價限制
        let minPriceThreshold = 0;

        // 排除詞「多向同義詞」自動擴充
        // 為了避免大小寫問題，我們先把現有的排除詞全部轉成小寫來檢查
        const currentExcludesLower = excludeWords.map(w => w.toLowerCase());
        
        // 建立同義詞字典：只要命中陣列裡的任何一個字，就把整個陣列的字都加入黑名單
        const synonymGroups = [
            ['w11', 'win11', 'windows11', 'windows 11'],
            ['w10', 'win10', 'windows10', 'windows 10']

            // 筆電同義詞 (包含常見的中文簡稱、全名與英文)
            ['筆電', '筆記型電腦', '筆記本', 'laptop', 'notebook'],
            
            // 主機/桌機同義詞 (包含常見的中文簡稱、全名與英文)
            ['主機', '桌機', '桌上型電腦', '套裝機', 'desktop', 'pc']
        ];

        synonymGroups.forEach(group => {
            // 檢查使用者輸入的排除詞中，是否包含這個群組的任何一個字
            const isMatch = group.some(synonym => currentExcludesLower.includes(synonym));
            if (isMatch) {
                let addedWords = [];
                group.forEach(synonym => {
                    // 如果原本的排除清單沒有這個同義詞，就把它補上去
                    if (!currentExcludesLower.includes(synonym) && !excludeWords.includes(synonym)) {
                        excludeWords.push(synonym);
                        addedWords.push(synonym);
                    }
                });
                // 有擴充新的詞才印出 log，避免洗版
                if (addedWords.length > 0) {
                    console.log(`[系統防呆] 偵測到同義詞，已自動擴充封殺: ${addedWords.join(', ')}`);
                }
            }
        });
        // 智慧防呆：偵測到如 4060, 3060, 1060, 6600 等型號，自動排除周邊垃圾與整機
        if (/\d[06]\d0/.test(keyword)) {
            minPriceThreshold = 1000;
            const autoExcludes = [
                'Kg','架','折疊','會議','眼鏡','Kg', '碗', '無線', 'GHz', '不鏽鋼', '鞋', '題', '衣', '包', '墊', '筆', '袋', '壺', '轉接線', '散熱', '水冷', '支架', '貼紙', '貼膜', '延長線', '空機殼',
                ' 金牌',' 銀牌',' 銅牌','顯卡風扇',
                'Fan', 'Cooler', 'Liquid', 'Heatsink',           // 排除散熱器
                'Cable', 'Adapter', 'Extension', 'Bracket',      // 排除線材與支架
                'Case', 'Chassis', 'Enclosure',                  // 排除空機殼
                'Sticker', 'Skin', 'Decal',                      // 排除貼紙
            ]
            autoExcludes.forEach(ex => {
                if (!excludeWords.includes(ex)) {
                    // 同時加入小寫版本，增加攔截率
                    excludeWords.push(ex);
                    excludeWords.push(ex.toLowerCase()); 
                }
            });
            console.log(`[系統防呆] 偵測到顯卡型號特徵，已自動加入排除詞`);
            //console.log(`[系統防呆] 偵測到顯卡型號特徵，已自動加入排除詞: ${autoExcludes.join(', ')}`);
        }

        if (includeWords.length > 0 || excludeWords.length > 0 || categoryWords.length > 0) {
            allResults = allResults.filter(item => {
                const nameLower = item.name.toLowerCase();

                const isIncludeMatch = includeWords.length === 0 || 
                    includeWords.every(inc => nameLower.includes(inc.toLowerCase()));

                const isExcludeMatch = excludeWords.length === 0 || 
                    !excludeWords.some(exc => nameLower.includes(exc.toLowerCase()));

                const isCategoryMatch = categoryWords.length === 0 || 
                    categoryWords.some(cat => nameLower.includes(cat.toLowerCase()));

                return isIncludeMatch && isExcludeMatch && isCategoryMatch;
            });
        }
        // 2. 執行全新的「價格守門員」過濾
        if (minPriceThreshold > 0) {
            allResults = allResults.filter(item => {
                // 將含有貨幣符號或逗號的字串 (例如 "1,406 元") 轉成純數字 1406
                const cleanPriceStr = String(item.price).replace(/[^0-9]/g, '');
                const numericPrice = cleanPriceStr ? parseInt(cleanPriceStr, 10) : 0;
                
                // 只保留價格大於或等於門檻的商品
                return numericPrice >= minPriceThreshold;
            });
        }
        // 價格排序 (由低到高)
        allResults.sort((a, b) => {
            const parsePrice = (priceStr) => {
                if (!priceStr) return Infinity; 
                const numStr = String(priceStr).replace(/[^0-9]/g, ''); 
                return numStr ? parseInt(numStr, 10) : Infinity; 
            };
            return parsePrice(a.price) - parsePrice(b.price);
        });
        // 回傳排序後的最終結果
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, data: allResults }));
        return;
    }else if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();

    // --- 靜態檔案路由 (網頁前端路由) ---
    } else {
        let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
        if (pathname === '/login') filePath = path.join(__dirname, 'login.html');
        else if (pathname === '/forum') filePath = path.join(__dirname, 'forum.html');
        else if (pathname === '/scrape') filePath = path.join(__dirname, 'scrape.html');
        else if (pathname === '/tools') filePath = path.join(__dirname, 'tools.html');
        const safeFilePath = path.resolve(filePath);
        if (!safeFilePath.startsWith(PUBLIC_DIR + path.sep) && safeFilePath !== PUBLIC_DIR) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const ext = path.extname(safeFilePath);
        if (isBlockedStaticFile(safeFilePath)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const contentType = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp'
        }[ext] || 'text/plain';

        fs.readFile(safeFilePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            }
        });
    }
});

// --- 啟動伺服器 ---
//GitHub\NMDWSM\public> node server.js
server.listen(PORT, () => {
    console.log(`
    ==========================================
    🌟 伺服器已啟動！
    ▶️ 測試首頁: http://localhost:${PORT}
    ▶️ 登入頁面: http://localhost:${PORT}/login
    ▶️ 論壇頁面: http://localhost:${PORT}/forum
    ▶️ 測試 API: http://localhost:${PORT}/api
    ▶️ 工具頁面: http://localhost:${PORT}/tools
    ==========================================
    `);
});
