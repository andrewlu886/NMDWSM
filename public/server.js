const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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
const USERS_FILE = path.join(__dirname, 'users.json');
const BLOCKED_STATIC_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);
const BLOCKED_STATIC_FILES = new Set(['users.json', 'products.json', 'posts.json']);
// JSON 檔僅保留作為備份或測試資料，正式資料來源統一使用 SQLite。
// --- 資料庫與使用者相關初始化 ---

// 1. 初始化使用者資料
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            console.log(`Loaded ${Object.keys(parsed).length} users from users.json`);
            return parsed;
        }
    } catch (error) {
        console.error('Error reading users.json:', error.message);
    }
    return { 'test@example.com': '12345678' };
}
let registeredUsers = loadUsers();

// 舊版 posts.json 不再作為正式論壇資料來源。

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
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
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

async function getCartUser(parsedUrl, body = {}) {
    return findRequestUser(body.userId || body.userEmail || parsedUrl.searchParams.get('userId') || parsedUrl.searchParams.get('userEmail'));
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

function formatProduct(product) {
    return {
        id: product.id,
        title: product.title,
        price: product.price,
        category: product.category,
        desc: product.description,
        image: product.image_url,
        seller: product.seller_name || product.seller_email || product.seller_id,
        sellerEmail: product.seller_email,
        sellerId: product.seller_id,
        condition: product.condition || 'used',
        status: product.status || 'active',
        location: product.location || '',
        usageTag: product.usage_tag || '',
        negotiable: Boolean(product.negotiable),
        views: product.views || 0,
        createdAt: product.created_at
    };
}

function formatTransaction(row) {
    return {
        id: row.id,
        productId: row.product_id,
        title: row.product_title,
        image: row.image_url,
        price: row.price,
        status: row.status,
        note: row.note || '',
        seller: row.seller_name,
        buyer: row.buyer_name,
        createdAt: row.created_at
    };
}

function formatTransactionComment(row) {
    return {
        id: row.id,
        transactionId: row.transaction_id,
        author: row.author_name || row.author_email,
        authorEmail: row.author_email,
        content: row.content,
        createdAt: row.created_at
    };
}

async function requireUserFromBodyOrQuery(parsedUrl, body = {}) {
    const user = await findRequestUser(body.userEmail || body.userId || parsedUrl.searchParams.get('userEmail') || parsedUrl.searchParams.get('userId'));
    return user;
}

// --- 智慧推薦功能實作 ---
// ==========================================
// 1. CPU 效能字典 (2026 最新版)
// ==========================================
const CPU_SCORE = {
    "TRPRO9995WX": 38000, "TRPRO9855WX": 35000, "TR9980X": 32000, "TR9970X": 30000,
    "W9-3475X": 28000, "W5-2455X": 25000,
    "RYZEN99950X3D": 29000, "RYZEN99950X": 27500, "RYZEN99900X3D": 26500, 
    "RYZEN79850X3D": 26000, "RYZEN79800X3D": 25500, "RYZEN99900X": 25000,
    "ULTRA9285K": 26000, "I9-14900KS": 25000, "I9-14900K": 24000, "I9-14900KF": 23500,
    "RYZEN97950X3D": 24500, "RYZEN97950X": 23000, "I9-13900K": 22000,
    "ULTRA7270KPLUS": 21000, "ULTRA7265K": 20000, "ULTRA7265KF": 19500,
    "RYZEN79700X": 19000, "RYZEN59600X": 18500, 
    "I7-14700K": 19500, "I7-14700KF": 19000, "I7-14700": 18000, "I7-14700F": 17500,
    // 補上常見筆電 CPU 分數 (H/HX 結尾)
    "I7-13620H": 14000, "I9-13900HX": 18000, "I7-13700H": 15000, 
    "RYZEN77800X3D": 18500, "RYZEN97900X": 18000, "RYZEN77700X": 17000,
    "I7-13700K": 17000, "I7-13700F": 16000,
    "ULTRA5250KPLUS": 15000, "ULTRA5250KFPLUS": 14500, 
    "ULTRA5245K": 14000, "ULTRA5245KF": 13500,
    "RYZEN59500F": 14000, "RYZEN57500F": 13000, "RYZEN57600X": 13500,
    "I5-14600K": 14500, "I5-14500": 12500, "I5-14400": 11500, "I5-14400F": 11000,
    "I5-13600K": 13000, "I5-13500": 11500, "I5-13400F": 10500, "I5-12600K": 11000,
    "RYZEN75800X3D": 13500, "RYZEN75700X": 11000, "RYZEN55600X": 10000,
    "ULTRA5235": 9500, "ULTRA5225": 8500, "ULTRA5225F": 8000,
    "RYZEN78700G": 9000, "RYZEN58600G": 8000, "RYZEN58500G": 7000, "RYZEN58400F": 6500,
    "I5-12400": 8500, "I5-12400F": 8000,
    "I3-14100": 7000, "I3-13100": 6000, "I3-12100": 5500,
    "RYZEN55600GT": 6500, "RYZEN55500X3D": 6000, "RYZEN55500GT": 5500,
    "RYZEN53400G": 4000,
    "I9處理器": 15000, "RYZEN9處理器": 15000,
    "I7處理器": 12000, "RYZEN7處理器": 12000,
    "I5處理器": 8500,  "RYZEN5處理器": 8500,
    "I3處理器": 5500,  "RYZEN3處理器": 5500,
    "UNKNOWN": 2000
};

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
// 3. GPU 效能字典
// ==========================================
const GPU_SCORE = {
    "RTX5090": 40000, "RTX5080": 32000, "RTX5070": 26000, "RTX5060": 16000,
    "RTX4090": 35000, "RTX4080": 28000, "RTX4070TI": 25000, "RTX4070": 20000, 
    "RTX4060TI": 15000, "RTX4060": 12000, "RTX3060": 10000, "RTX3050": 7000,
    "GTX1650": 5000, "UNKNOWN": 1000
};

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
                    name: text.substring(0, 60) + '...', // 名稱過長截斷為 60 字
                    price: price,
                    url: 'https://www.coolpc.com.tw/evaluate.php'
                });
            }
        });

        console.log(`[原價屋] 搜尋完成，找到 ${results.length} 筆`);
        
        // 回傳前 30 筆
        return results.slice(0, 30); 
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
        
        // 資料在 response.data.data 裡面
        const items = response.data.data || []; 

        items.forEach(item => {
            results.push({
                platform: '欣亞',
                // 根據回傳的 JSON 解析
                name: item.prod_name, 
                // 將數字價格轉成有逗號的字串
                price: item.price ? item.price.toLocaleString() : '請至官網確認',
                url: item.prod_id ? `https://www.sinya.com.tw/prod/${item.prod_id}` : `https://www.sinya.com.tw/search?keyword=${encodeURIComponent(keyword)}`
            });
        });

        console.log(`[欣亞] API 搜尋完成，找到 ${results.length} 筆`);
        return results.slice(0, 12); // 回傳前 12 筆

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

        // 取前 12 個 ID，並組成 "id1,id2,id3..." 的格式
        const itemIds = searchRows.slice(0, 12).map(row => row.Id || row.GoodsNo).filter(id => id).join(',');

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
        return results.slice(0, 12);

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
        return results.slice(0, 12);

    } catch (error) {
        console.error(`Momo 爬蟲失敗: ${error.message}`);
        return [];
    }
}

// 9. 美國 Newegg 爬蟲邏輯 (Puppeteer 版 - 3C 硬體權威)
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
        return results.slice(0, 10);

    } catch (error) {
        console.error(`❌ Newegg 爬蟲失敗: ${error.message}`);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

// 12. 台灣 Yahoo 購物中心爬蟲邏輯 (特徵錨點抓取法 - 升級版)
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

        // 👇 擴大雷達：同時等待 /gdsale/ (一般商品) 與 /activity/ (活動促銷品)
        await page.waitForSelector('a[href*="/gdsale/"], a[href*="/activity/"]', { timeout: 8000 }).catch(() => console.log('[Yahoo購物] 等待商品載入超時'));

        // 模擬人類往下滾動，多滾幾次確保圖片和價格動態載入完成
        for(let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await new Promise(r => setTimeout(r, 800));
        }

        const content = await page.content();
        const $ = cheerio.load(content);
        let results = [];

        // 👇 擴大雷達範圍
        // 👇 替換 scrapeYahoo 裡面的這段 each 迴圈
        $('a[href*="/gdsale/"], a[href*="/activity/"]').each((i, el) => {
            const link = $(el).attr('href');
            
            // 1. 智慧標題萃取：找出字數最長的 span 當作標題，並濾除垃圾文字
            let name = '';
            $(el).find('span, div').each((_, element) => {
                const text = $(element).text().trim();
                // 如果這段文字比目前存的長，而且不是系統按鈕文字，就當作標題
                if (text.length > name.length && !text.includes('比較找相似') && !text.includes('折價券')) {
                    name = text;
                }
            });

            // 再次強制清理可能殘留的開頭文字
            name = name.replace(/^比較找相似\s*/, '').trim();
            
            // 2. 精準價格萃取：尋找金錢符號，並避免抓到怪異的龐大數字
            const rawText = $(el).text(); 
            // 尋找 $ 後面跟著數字與逗號的組合
            const priceMatch = rawText.match(/\$\s*([0-9,]+)/);
            let price = priceMatch ? priceMatch[1].replace(/,/g, '') : null;

            // 確保標題存在，且價格大於 0 才推入陣列
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
// 總和爬蟲執行函式
async function performScraping(platform, keyword) {
        let tasks = [];
        if (platform === 'all' || platform === 'coolpc') tasks.push(scrapeCoolpc(keyword));
        if (platform === 'all' || platform === 'sinya')  tasks.push(scrapeSinya(keyword));
        if (platform === 'all' || platform === 'ruten')  tasks.push(scrapeRuten(keyword));
        if (platform === 'all' || platform === 'pchome') tasks.push(scrapePChome(keyword));
        if (platform === 'all' || platform === 'momo')   tasks.push(scrapeMomo(keyword));
        if (platform === 'all' || platform === 'shopee') tasks.push(scrapeShopee(keyword));
        if (platform === 'all' || platform === 'amazon') tasks.push(scrapeAmazon(keyword));
        if (platform === 'all' || platform === '1688')  tasks.push(scrape1688(keyword));
        if (platform === 'all' || platform === 'newegg') tasks.push(scrapeNewegg(keyword));
        if (platform === 'all' || platform === 'ebay')   tasks.push(scrapeEbay(keyword));
        if (platform === 'all' || platform === 'zol')    tasks.push(scrapeZOL(keyword));
        if (platform === 'all' || platform === 'yahoo') tasks.push(scrapeYahoo(keyword));
        if (platform === 'all' || platform === 'etmall') tasks.push(scrapeETMall(keyword));
        
        // 等待所有爬蟲任務完成
        const resultsArray = await Promise.all(tasks);
        // 將二維陣列扁平化為一維陣列
        let allResults = resultsArray.flat(); 
        return allResults; 
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
                    //scrapeShopee(searchKeyword),
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

                    // 1. 萃取所有硬體特徵
                    let cpu = extractCPU(item.name);
                    let gpu = extractGPU(item.name);
                    let ram = extractRAM(item.name); // 🟢 新增：萃取記憶體
                    let os = extractOS(item.name);   // 🟢 新增：萃取 OS
                    
                    // 防呆：整機或筆電必須要有 CPU 或 GPU
                    if (productType !== 'component' && cpu === "UNKNOWN" && gpu === "UNKNOWN") {
                        continue; 
                    }

                    let cpuScore = CPU_SCORE[cpu] || CPU_SCORE["UNKNOWN"];
                    let gpuScore = GPU_SCORE[gpu] || GPU_SCORE["UNKNOWN"];

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
                // 計算完畢，現在可以安全地回傳給前端了！
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

    // --- 專題版商品/收藏/模擬交易 API ---
    } else if (pathname === '/api/products' && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const body = await parseJsonBody(req);
            const { seller, title, category, price, desc, image, condition, location, usageTag, negotiable, status } = body;
            const user = await db.User.findByEmail(seller);
            const parsedPrice = parseInt(price, 10);

            if (!user) return sendJson(res, 404, { success: false, message: '找不到賣家帳號' });
            if (!title || !category || Number.isNaN(parsedPrice)) {
                return sendJson(res, 400, { success: false, message: '商品名稱、分類與價格不能為空' });
            }

            const result = await db.Product.create({
                seller_id: user.id,
                title,
                description: desc || '',
                category,
                price: parsedPrice,
                condition,
                image_url: image || null,
                location,
                usage_tag: usageTag,
                negotiable,
                status
            });

            sendJson(res, 200, { success: true, message: '商品上架成功', product_id: result.id });
        } catch (error) {
            console.error('新增商品錯誤:', error);
            sendJson(res, 500, { success: false, message: '伺服器錯誤' });
        }

    } else if (pathname === '/api/products' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const sellerEmail = parsedUrl.searchParams.get('seller');
            const statusFilter = parsedUrl.searchParams.get('status');
            let products = [];

            if (sellerEmail) {
                const user = await db.User.findByEmail(sellerEmail);
                if (user) products = await db.Product.findBySeller(user.id);
            } else {
                products = await db.Product.getActive();
            }

            if (statusFilter && statusFilter !== 'all') {
                products = products.filter(product => product.status === statusFilter);
            }

            sendJson(res, 200, products.map(formatProduct));
        } catch (error) {
            console.error('讀取商品錯誤:', error);
            sendJson(res, 500, { success: false, message: '伺服器錯誤' });
        }

    } else if (pathname.match(/^\/api\/products\/\d+$/) && req.method === 'GET') {
        setCorsHeaders(res);
        const productId = parseInt(pathname.split('/')[3]);
        try {
            const product = await db.Product.findById(productId);
            if (!product) return sendJson(res, 404, { success: false, message: '找不到商品' });

            await db.Product.incrementViews(productId);
            product.views = (product.views || 0) + 1;
            sendJson(res, 200, formatProduct(product));
        } catch (error) {
            console.error('讀取單一商品錯誤:', error);
            sendJson(res, 500, { success: false, message: '伺服器錯誤' });
        }

    } else if (/^\/api\/products\/\d+\/status$/.test(pathname) && req.method === 'POST') {
        setCorsHeaders(res);
        const productId = parseInt(pathname.split('/')[3]);
        try {
            const body = await parseJsonBody(req);
            const user = await findRequestUser(body.seller || body.userEmail);
            const allowed = ['active', 'sold', 'inactive'];
            if (!user || !allowed.includes(body.status)) {
                return sendJson(res, 400, { success: false, message: '狀態或賣家資料不正確' });
            }

            const result = await db.Product.updateStatus(productId, user.id, body.status);
            if (!result.changes) return sendJson(res, 403, { success: false, message: '只能管理自己的商品' });
            sendJson(res, 200, { success: true, message: '商品狀態已更新' });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '商品狀態更新失敗' });
        }

    } else if (pathname.startsWith('/api/products/') && req.method === 'PUT') {
        setCorsHeaders(res);
        const productId = parseInt(pathname.split('/')[3]);
        try {
            const body = await parseJsonBody(req);
            const { seller, title, category, price, desc, image, condition, location, usageTag, negotiable, status } = body;
            const user = await db.User.findByEmail(seller);
            const product = await db.Product.findById(productId);
            const parsedPrice = parseInt(price, 10);

            if (!user) return sendJson(res, 400, { success: false, message: '缺少賣家帳號' });
            if (!product || product.seller_id !== user.id) return sendJson(res, 403, { success: false, message: '只能修改自己的商品' });
            if (!title || !category || Number.isNaN(parsedPrice)) return sendJson(res, 400, { success: false, message: '商品資料不完整' });

            await db.Product.update(productId, {
                title,
                category,
                price: parsedPrice,
                description: desc || '',
                image_url: image || null,
                condition,
                location,
                usage_tag: usageTag,
                negotiable,
                status
            });

            sendJson(res, 200, { success: true, message: '商品已更新' });
        } catch (error) {
            console.error('更新商品錯誤:', error);
            sendJson(res, 500, { success: false, message: '伺服器錯誤' });
        }

    } else if (pathname.startsWith('/api/products/') && req.method === 'DELETE') {
        setCorsHeaders(res);
        const productId = parseInt(pathname.split('/')[3]);
        try {
            const userEmail = parsedUrl.searchParams.get('seller') || parsedUrl.searchParams.get('userEmail');
            const user = await findRequestUser(userEmail);
            if (!user) return sendJson(res, 400, { success: false, message: '缺少賣家帳號' });

            const result = await db.Product.updateStatus(productId, user.id, 'inactive');
            if (!result.changes) return sendJson(res, 403, { success: false, message: '只能下架自己的商品' });
            sendJson(res, 200, { success: true, message: '商品已下架' });
        } catch (error) {
            console.error('下架商品錯誤:', error);
            sendJson(res, 500, { success: false, message: '下架商品失敗' });
        }

    // --- 商品 API (新增 / 讀取) ---
    } else if (pathname === '/api/products' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { seller, title, category, price, desc, image } = JSON.parse(body);
                console.log(`🛒 準備新增商品: ${title}, 賣家: ${seller}`);
                
                // 透過 email 找出對應使用者的 ID (seller_id)
                const user = await db.User.findByEmail(seller);
                if (!user) {
                    console.log('❌ 新增商品失敗: 找不到賣家帳號 (可能是該信箱未在 SQLite 註冊，請先登出再重新註冊/登入)');
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: '找不到賣家帳號' }));
                }
                
                // 寫入 SQLite 資料庫
                const result = await db.Product.create({
                    seller_id: user.id,
                    title: title,
                    description: desc || '',
                    category: category || '未分類',
                    price: parseInt(price, 10),
                    condition: 'unknown',
                    image_url: image || null
                });
                console.log(`✅ 商品已成功寫入 SQLite 資料庫！(商品 ID: ${result.id})`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: '上架成功' }));
            } catch (error) {
                console.error('❌ 新增商品錯誤:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '伺服器錯誤' }));
            }
        });

    } else if (pathname === '/api/products' && req.method === 'GET') {
        setCorsHeaders(res);
        const sellerEmail = parsedUrl.searchParams.get('seller');
        try {
            let products = [];
            if (sellerEmail) {
                const user = await db.User.findByEmail(sellerEmail);
                if (user) products = await db.Product.findBySeller(user.id);
            } else {
                products = await db.Product.getActive();
            }
            
            // 為了相容前端原本預期的 JSON 屬性名稱，我們將資料庫欄位映射回原格式
            const formattedProducts = products.map(p => ({
                id: p.id,
                title: p.title,
                price: p.price,
                category: p.category,
                desc: p.description,
                image: p.image_url,
                seller: p.seller_name || sellerEmail
            }));
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(formattedProducts));
        } catch (error) {
            console.error('❌ 讀取商品錯誤:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: '伺服器錯誤' }));
        }

    // --- 商品 API (單一商品) ---
    } else if (pathname.match(/^\/api\/products\/\d+$/) && req.method === 'GET') {
        setCorsHeaders(res);
        const productId = parseInt(pathname.split('/')[3]);
        try {
            const product = await db.Product.findById(productId);
            if (product) {
                const formattedProduct = {
                    id: product.id,
                    title: product.title,
                    price: product.price,
                    category: product.category,
                    desc: product.description,
                    image: product.image_url,
                    seller: product.seller_name || product.seller_id
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(formattedProduct));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '找不到商品' }));
            }
        } catch (error) {
            console.error('❌ 讀取單一商品錯誤:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: '伺服器錯誤' }));
        }

    // --- 商品 API (刪除) ---
    } else if (pathname.startsWith('/api/products/') && req.method === 'DELETE') {
        setCorsHeaders(res);
        const productId = parseInt(pathname.split('/')[3]);
        try {
            await db.runUpdate('DELETE FROM products WHERE id = ?', [productId]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: '商品已刪除' }));
        } catch (error) {
            console.error('❌ 刪除商品錯誤:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: '刪除商品失敗' }));
        }

    // --- 商品 API (修改) ---
    } else if (pathname.startsWith('/api/products/') && req.method === 'PUT') {
        setCorsHeaders(res);
        const productId = parseInt(pathname.split('/')[3]);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { title, category, price, desc, image } = JSON.parse(body);
                
                await db.runUpdate(
                    'UPDATE products SET title = ?, category = ?, price = ?, description = ?, image_url = ? WHERE id = ?',
                    [title, category, parseInt(price, 10), desc || '', image || null, productId]
                );
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: '商品已更新' }));
            } catch (error) {
                console.error('❌ 更新商品錯誤:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '伺服器錯誤' }));
            }
        });
        
    } else if (pathname === '/api/favorites' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const user = await requireUserFromBodyOrQuery(parsedUrl);
            if (!user) return sendJson(res, 400, { success: false, message: '缺少使用者' });
            const favorites = await db.Favorite.getByUser(user.id);
            sendJson(res, 200, { success: true, data: favorites.map(formatProduct) });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '讀取收藏失敗' });
        }

    } else if (pathname === '/api/favorites' && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const body = await parseJsonBody(req);
            const user = await requireUserFromBodyOrQuery(parsedUrl, body);
            if (!user || !body.productId) return sendJson(res, 400, { success: false, message: '缺少必要參數' });
            await db.Favorite.add(user.id, body.productId);
            sendJson(res, 200, { success: true, message: '已加入收藏' });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '加入收藏失敗' });
        }

    } else if (pathname.startsWith('/api/favorites/') && req.method === 'DELETE') {
        setCorsHeaders(res);
        try {
            const productId = parseInt(pathname.split('/')[3]);
            const user = await requireUserFromBodyOrQuery(parsedUrl);
            if (!user || !productId) return sendJson(res, 400, { success: false, message: '缺少必要參數' });
            await db.Favorite.remove(user.id, productId);
            sendJson(res, 200, { success: true, message: '已取消收藏' });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '取消收藏失敗' });
        }

    } else if (pathname === '/api/transactions' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const user = await requireUserFromBodyOrQuery(parsedUrl);
            const role = parsedUrl.searchParams.get('role') || 'buyer';
            if (!user) return sendJson(res, 400, { success: false, message: '缺少使用者' });
            const rows = role === 'seller' ? await db.Transaction.getBySeller(user.id) : await db.Transaction.getByBuyer(user.id);
            sendJson(res, 200, { success: true, data: rows.map(formatTransaction) });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '讀取交易失敗' });
        }

    } else if (pathname === '/api/transactions' && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const body = await parseJsonBody(req);
            const buyer = await requireUserFromBodyOrQuery(parsedUrl, body);
            const product = await db.Product.findById(body.productId);
            if (!buyer || !product) return sendJson(res, 400, { success: false, message: '找不到買家或商品' });
            if (product.status !== 'active') return sendJson(res, 400, { success: false, message: '商品目前不能購買' });
            if (product.seller_id === buyer.id) return sendJson(res, 400, { success: false, message: '不能購買自己的商品' });

            const result = await db.Transaction.create({
                product_id: product.id,
                buyer_id: buyer.id,
                seller_id: product.seller_id,
                price: product.price,
                status: 'pending',
                note: body.note || '買家提出購買需求'
            });
            sendJson(res, 200, { success: true, message: '已送出購買需求', transaction_id: result.id });
        } catch (error) {
            console.error('建立交易錯誤:', error);
            sendJson(res, 500, { success: false, message: '建立交易失敗' });
        }

    } else if (pathname.startsWith('/api/transactions/') && req.method === 'PUT') {
        setCorsHeaders(res);
        try {
            const transactionId = parseInt(pathname.split('/')[3]);
            const body = await parseJsonBody(req);
            const user = await requireUserFromBodyOrQuery(parsedUrl, body);
            const allowed = ['pending', 'contacting', 'completed', 'cancelled'];
            if (!user || !allowed.includes(body.status)) return sendJson(res, 400, { success: false, message: '交易狀態不正確' });
            const result = await db.Transaction.updateStatus(transactionId, user.id, body.status);
            if (!result.changes) return sendJson(res, 403, { success: false, message: '無法更新這筆交易' });
            sendJson(res, 200, { success: true, message: '交易狀態已更新' });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '更新交易失敗' });
        }

    } else if (/^\/api\/transactions\/\d+\/comments$/.test(pathname) && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const transactionId = parseInt(pathname.split('/')[3]);
            const user = await requireUserFromBodyOrQuery(parsedUrl);
            if (!user) return sendJson(res, 400, { success: false, message: '請先登入' });

            const comments = await db.TransactionComment.getByTransaction(transactionId, user.id);
            if (!comments) return sendJson(res, 403, { success: false, message: '無法查看這筆交易留言' });
            sendJson(res, 200, { success: true, data: comments.map(formatTransactionComment) });
        } catch (error) {
            console.error('讀取交易留言失敗:', error);
            sendJson(res, 500, { success: false, message: '讀取留言失敗' });
        }

    } else if (/^\/api\/transactions\/\d+\/comments$/.test(pathname) && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const transactionId = parseInt(pathname.split('/')[3]);
            const body = await parseJsonBody(req);
            const user = await requireUserFromBodyOrQuery(parsedUrl, body);
            const content = String(body.content || '').trim();
            if (!user) return sendJson(res, 400, { success: false, message: '請先登入' });
            if (!content) return sendJson(res, 400, { success: false, message: '請輸入留言內容' });

            const result = await db.TransactionComment.create(transactionId, user.id, content);
            if (!result) return sendJson(res, 403, { success: false, message: '無法在這筆交易留言' });
            sendJson(res, 200, { success: true, message: '留言已送出', id: result.id });
        } catch (error) {
            console.error('新增交易留言失敗:', error);
            sendJson(res, 500, { success: false, message: '新增留言失敗' });
        }

    } else if (pathname === '/api/account/stats' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const user = await requireUserFromBodyOrQuery(parsedUrl);
            if (!user) return sendJson(res, 400, { success: false, message: '缺少使用者' });
            sendJson(res, 200, { success: true, data: await db.Stats.getByUser(user.id) });
        } catch (error) {
            sendJson(res, 500, { success: false, message: '讀取統計失敗' });
        }

    // --- 購物車 API ---
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
            console.error('更新使用者名稱失敗:', error);
            sendJson(res, 500, { success: false, message: '更新使用者名稱失敗' });
        }

    } else if (pathname === '/api/cart' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const user = await getCartUser(parsedUrl);
            if (!user) {
                return sendJson(res, 400, { success: false, message: "缺少或找不到使用者" });
            }

            const items = await db.Cart.getByUser(user.id);
            sendJson(res, 200, { success: true, data: items });
        } catch (error) {
            console.error('❌ 讀取購物車錯誤:', error);
            sendJson(res, 500, { success: false, message: "讀取購物車失敗" });
        }

    } else if (pathname === '/api/cart' && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const body = await parseJsonBody(req);
            const user = await getCartUser(parsedUrl, body);
            const { productId } = body;
            if (!user || !productId) {
                return sendJson(res, 400, { success: false, message: "缺少必要參數" });
            }

            await db.Cart.add(user.id, productId);
            sendJson(res, 200, { success: true, message: "已加入購物車" });
        } catch (error) {
            console.error('❌ 加入購物車錯誤:', error);
            sendJson(res, 500, { success: false, message: "加入購物車失敗" });
        }

    } else if (pathname === '/api/cart/clear' && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const body = await parseJsonBody(req);
            const user = await getCartUser(parsedUrl, body);
            if (!user) {
                return sendJson(res, 400, { success: false, message: "缺少或找不到使用者" });
            }

            await db.Cart.clear(user.id);
            sendJson(res, 200, { success: true, message: "購物車已清空" });
        } catch (error) {
            console.error('❌ 清空購物車錯誤:', error);
            sendJson(res, 500, { success: false, message: "清空購物車失敗" });
        }

    } else if (pathname.startsWith('/api/cart/') && req.method === 'PUT') {
        setCorsHeaders(res);
        const cartItemId = parseInt(pathname.split('/')[3]);
        try {
            const body = await parseJsonBody(req);
            const user = await getCartUser(parsedUrl, body);
            const quantity = parseInt(body.quantity, 10);
            if (!user || Number.isNaN(quantity)) {
                return sendJson(res, 400, { success: false, message: "缺少必要參數" });
            }

            await db.Cart.updateQuantity(cartItemId, user.id, quantity);
            sendJson(res, 200, { success: true, message: "購物車數量已更新" });
        } catch (error) {
            console.error('❌ 更新購物車數量錯誤:', error);
            sendJson(res, 500, { success: false, message: "更新購物車失敗" });
        }

    } else if (pathname.startsWith('/api/cart/') && req.method === 'DELETE') {
        setCorsHeaders(res);
        const cartItemId = parseInt(pathname.split('/')[3]);
        try {
            const user = await getCartUser(parsedUrl);
            if (!user) {
                return sendJson(res, 400, { success: false, message: "缺少或找不到使用者" });
            }

            await db.Cart.remove(cartItemId, user.id);
            sendJson(res, 200, { success: true, message: "已從購物車中移除" });
        } catch (error) {
            console.error('❌ 移除購物車商品錯誤:', error);
            sendJson(res, 500, { success: false, message: "移除商品失敗" });
        }

    }// 1. 爬蟲 API 路由
    else if (pathname === '/api/scrape' && req.method === 'GET') {
        setCorsHeaders(res);
        const getParam = (key) => parsedUrl.query ? parsedUrl.query[key] : parsedUrl.searchParams?.get(key);
        const keyword = getParam('keyword');
        const platform = getParam('platform') || 'all';
        const excludeStr = getParam('exclude') || ''; 
        const includeStr = getParam('include') || ''; 
        const categoriesStr = getParam('categories') || ''; 
        if (!keyword) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: "請輸入搜尋關鍵字" }));
        }
        console.log(`[系統] 收到搜尋請求: ${keyword}`);
        
        let allResults = [];
        if (platform === 'all' || platform === 'coolpc') {
            const coolpcData = await scrapeCoolpc(keyword);
            allResults = allResults.concat(coolpcData);
        }
        if (platform === 'all' || platform === 'sinya') {
            const sinyaData = await scrapeSinya(keyword);
            allResults = allResults.concat(sinyaData);
        }
        if (platform === 'all' || platform === 'ruten') {
            const rutenData = await scrapeRuten(keyword);
            allResults = allResults.concat(rutenData);
        }
        if (platform === 'all' || platform === 'pchome') {
            const pchomeData = await scrapePChome(keyword);
            allResults = allResults.concat(pchomeData);
        }
        if (platform === 'all' || platform === 'momo') {
            const momoData = await scrapeMomo(keyword);
            allResults = allResults.concat(momoData);
        }
        if (platform === 'all' || platform === 'newegg') {
            const neweggData = await scrapeNewegg(keyword);
            allResults = allResults.concat(neweggData);
        }/*
        if (platform === 'all' || platform === 'amazon') {
            const amazonData = await scrapeAmazon(keyword);
            allResults = allResults.concat(amazonData);
        }
        if (platform === 'all' || platform === 'ebay') {
            const ebayData = await scrapeEbay(keyword);
            allResults = allResults.concat(ebayData);
        }
        if (platform === 'all' || platform === 'zol') {
            const zolData = await scrapeZOL(keyword);
            allResults = allResults.concat(zolData);
        }*/
        if (platform === 'all' || platform === 'yahoo') {
            const yahooData = await scrapeYahoo(keyword);
            allResults = allResults.concat(yahooData);
        }
        // ==========================================
        // 核心邏輯：三向關鍵字過濾器 + 智慧防呆機制
        // ==========================================
    
       // const includeStr = parsedUrl.query.include || '';
        //const categoriesStr = parsedUrl.query.categories || '';

        const includeWords = includeStr.split(/[\s,]+/).filter(w => w);
        let excludeWords = excludeStr.split(/[\s,]+/).filter(w => w); 
        const categoryWords = categoriesStr.split(',').filter(w => w);

        // 智慧防呆：偵測到如 4060, 3060, 1060, 6600 等型號，自動排除周邊垃圾
        if (/\d[06]\d0/.test(keyword)) {
            const autoExcludes = ['風扇','Kg','碗','無線','GHz','不鏽鋼','鞋','題','衣','包','墊','筆','袋', '壺', '轉接線', '散熱', '水冷', '支架', '貼紙', '貼膜', '延長線', '空機殼'];
            autoExcludes.forEach(ex => {
                if (!excludeWords.includes(ex)) {
                    excludeWords.push(ex);
                }
            });
            console.log(`[系統防呆] 偵測到顯卡型號特徵，已自動加入排除詞: ${autoExcludes.join(', ')}`);
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
        // ==========================================
        if (excludeStr) {
            const excludeWords = excludeStr.split(/[, ]+/).filter(w => w);
            allResults = allResults.filter(item => {
                const nameLower = item.name.toLowerCase();
                return !excludeWords.some(ex => nameLower.includes(ex.toLowerCase()));
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
        else if (pathname === '/seller') filePath = path.join(__dirname, 'seller.html');
        else if (pathname === '/marketplace') filePath = path.join(__dirname, 'marketplace.html');
        else if (pathname === '/cart') filePath = path.join(__dirname, 'cart.html');
        else if (pathname === '/checkout') filePath = path.join(__dirname, 'checkout.html');
        else if (pathname === '/product') filePath = path.join(__dirname, 'product.html');
        else if (pathname === '/transactions') filePath = path.join(__dirname, 'transactions.html');

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
            '.js': 'text/javascript'
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
server.listen(PORT, () => {
    console.log(`
    ==========================================
    🌟 伺服器已啟動！
    ▶️ 測試首頁: http://localhost:${PORT}
    ▶️ 登入頁面: http://localhost:${PORT}/login
    ▶️ 論壇頁面: http://localhost:${PORT}/forum
    ▶️ 賣家頁面: http://localhost:${PORT}/seller  
    ▶️ 測試 API: http://localhost:${PORT}/api
    ==========================================
    `);
});