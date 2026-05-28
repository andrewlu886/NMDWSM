const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
// 引入網路爬蟲相關套件
const axios = require('axios');
const cheerio = require('cheerio');
// SQLite 資料庫
const db = require('./db.js');

const PORT = 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const POSTS_FILE = path.join(__dirname, 'posts.json');
const PRODUCTS_FILE = path.join(__dirname, 'products.json');
// 初始化商品資料檔案
function initProducts() {
    if (!fs.existsSync(PRODUCTS_FILE)) {
        fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([]), 'utf8');
    }
}
initProducts();
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

// 2. 初始化論壇文章資料
function initPosts() {
    if (!fs.existsSync(POSTS_FILE)) {
        const initialPosts = [
            { id: 1, title: 'RTX 3060 available', author: 'Seller A', content: 'Selling a used RTX 3060 in good condition.', date: new Date().toISOString() },
            { id: 2, title: 'GPU-Z report help needed', author: 'Buyer B', content: 'Looking for help understanding a GPU-Z report and CPU compatibility.', date: new Date(Date.now() - 86400000).toISOString() }
        ];
        fs.writeFileSync(POSTS_FILE, JSON.stringify(initialPosts, null, 2), 'utf8');
        console.log('已建立預設 posts.json');
    }
}
initPosts();

// --- SQLite 資料庫初始化 ---
db.initDatabase().then(() => {
    console.log('✅ 資料庫已連接');
}).catch(err => {
    console.error('❌ 資料庫連接失敗:', err.message);
    process.exit(1);
});

function readJsonFile(filePath, fallbackValue) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallbackValue;
        }

        const raw = fs.readFileSync(filePath, 'utf8').trim();
        if (!raw) {
            return fallbackValue;
        }

        return JSON.parse(raw);
    } catch (error) {
        console.error(`Error reading ${path.basename(filePath)}:`, error.message);
        return fallbackValue;
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeAttachmentList(items) {
    if (Array.isArray(items)) {
        return items.filter(Boolean);
    }

    return items ? [items] : [];
}

function normalizeReply(reply) {
    return {
        ...reply,
        images: normalizeAttachmentList(reply.images || reply.image),
    };
}

function normalizePost(post) {
    return {
        ...post,
        images: normalizeAttachmentList(post.images || post.image),
        replies: Array.isArray(post.replies) ? post.replies.map(normalizeReply) : [],
    };
}

function loadPostsData() {
    return readJsonFile(POSTS_FILE, []).map(normalizePost);
}

function savePostsData(posts) {
    writeJsonFile(POSTS_FILE, posts);
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
// 4. 蝦皮購物爬蟲 (BUG)
async function scrapeShopee(keyword) {
    try {
        console.log(`[蝦皮] 正在透過 API 搜尋: ${keyword}`);
        
        // 蝦皮的搜尋 API
        const apiUrl = `https://shopee.tw/api/v4/search/search_items?keyword=${encodeURIComponent(keyword)}&limit=12&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
        
        const response = await axios.get(apiUrl, {
            headers: { 
                // 蝦皮經常阻擋爬蟲，需要設定 Header
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': `https://shopee.tw/search?keyword=${encodeURIComponent(keyword)}`,
                'Accept': 'application/json',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 5000
        });

        let results = [];
        const items = response.data.items || [];

        items.forEach(data => {
            // 蝦皮的詳細資料在 item_basic 裡面
            const item = data.item_basic;
            if (!item) return;

            // 處理蝦皮的價格放大 10 萬倍問題
            let itemPrice = null;
            if (item.price) {
                itemPrice = item.price / 100000;
            }

            results.push({
                platform: '蝦皮',
                name: item.name || '蝦皮商品',
                price: itemPrice ? itemPrice.toLocaleString() : '請至賣場確認',
                // 蝦皮商品網址: /product/{shopid}/{itemid}
                url: (item.shopid && item.itemid) ? `https://shopee.tw/product/${item.shopid}/${item.itemid}` : `https://shopee.tw/search?keyword=${encodeURIComponent(keyword)}`
            });
        });

        console.log(`[蝦皮] 搜尋完成，找到 ${results.length} 筆`);
        return results;

    } catch (error) {
        console.error(`蝦皮爬蟲失敗: ${error.message}`);
        return [{ platform: '蝦皮', name: '錯誤: 取得失敗 (可能被擋)', price: 'N/A', url: 'https://shopee.tw/' }];
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
// 總和爬蟲執行函式
async function performScraping(platform, keyword) {
        let tasks = [];
        if (platform === 'all' || platform === 'coolpc') tasks.push(scrapeCoolpc(keyword));
        if (platform === 'all' || platform === 'sinya')  tasks.push(scrapeSinya(keyword));
        if (platform === 'all' || platform === 'ruten')  tasks.push(scrapeRuten(keyword));
        if (platform === 'all' || platform === 'pchome') tasks.push(scrapePChome(keyword));
        if (platform === 'all' || platform === 'momo')   tasks.push(scrapeMomo(keyword));
        if (platform === 'all' || platform === 'shopee') tasks.push(scrapeShopee(keyword));
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
                const { name, email, password, confirmPassword } = JSON.parse(body);
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
                    username: name,
                    real_name: name,
                    phone: '',
                    city: ''
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: "註冊成功" }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: "伺服器錯誤" }));
            }
        });

    // 3. 需求推薦 API
    } else if (pathname === '/api/recommend' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { budget, usage } = JSON.parse(body);
                let cpuRatio = (usage === 'gaming') ? 0.2 : (usage === 'office' ? 0.4 : 0.2);
                let gpuRatio = (usage === 'gaming') ? 0.5 : (usage === 'office' ? 0.2 : 0.4);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    cpu: `建議約 ${budget * cpuRatio} 元的處理器`,
                    gpu: `建議約 ${budget * gpuRatio} 元的顯示卡`,
                    usage: usage,
                    status: "success"
                }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "請檢查傳送的資料格式" }));
            }
        });

    // 4. 取得論壇文章 API (使用 SQLite)
    } else if (pathname === '/api/posts' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const postsData = JSON.stringify(loadPostsData());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(postsData);
            
            // 註解掉 SQLite 讀取，避免重複發送回應引發 ERR_HTTP_HEADERS_SENT
            // db.Post.getAll().then(posts => {
            //     res.writeHead(200, { 'Content-Type': 'application/json' });
            //     res.end(JSON.stringify(posts || []));
            // }).catch(err => {
            //     res.writeHead(500, { 'Content-Type': 'application/json' });
            //     res.end(JSON.stringify({ success: false, message: "無法讀取文章列表" }));
            // });
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: "無法讀取文章列表" }));
        }

    // 5. 新增論壇文章 API (使用 SQLite)
    } else if (pathname === '/api/posts' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
            const { title, content, author, images, author_id, category } = JSON.parse(body);
                if (!title || !content) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: "標題和內容不能為空" }));
                }

                const posts = loadPostsData();
                const newPost = {
                    id: Date.now(),
                    title,
                    content,
                    author: author || '測試用戶',
                    date: new Date().toISOString(),
                    images: normalizeAttachmentList(images),
                    replies: []
                };
                
                posts.unshift(newPost);
                savePostsData(posts);
                const result = await db.Post.create({
                    author_id: author_id || 1,
                    title,
                    content,
                category: category || '一般討論'
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: "發文成功", post_id: result.id }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "發文發生錯誤" }));
            }
        });
        } else if (/^\/api\/posts\/\d+\/replies$/.test(pathname) && req.method === 'POST') {
            setCorsHeaders(res);
            const postId = parseInt(pathname.split('/')[3]);
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const { content, author, images } = JSON.parse(body);
                    if (!content) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "回覆內容不能為空" }));
                    }

                    const posts = loadPostsData();
                    const postIndex = posts.findIndex(post => post.id === postId);
                    if (postIndex === -1) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "找不到文章" }));
                    }

                    const newReply = {
                        id: Date.now(),
                        content,
                    author: author || '匿名使用者',
                        date: new Date().toISOString(),
                        images: normalizeAttachmentList(images)
                    };

                    posts[postIndex].replies = Array.isArray(posts[postIndex].replies) ? posts[postIndex].replies : [];
                    posts[postIndex].replies.push(newReply);
                    savePostsData(posts);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: '回覆成功', reply: newReply }));
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '回覆發生錯誤' }));
                }
            });

        // --- 論壇文章修改/刪除 API ---
} else if (pathname.startsWith('/api/posts/') && (req.method === 'PUT' || req.method === 'DELETE')) {
    setCorsHeaders(res);
    const postId = parseInt(pathname.split('/')[3]); // 取得 URL 中的 id
        let posts = loadPostsData();

    if (req.method === 'DELETE') {
            const postIndex = posts.findIndex(p => p.id === postId);
            if (postIndex === -1) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: '找不到文章' }));
            }

            posts = posts.filter(p => p.id !== postId);
            savePostsData(posts);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '文章已刪除' }));
    } else if (req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
                const { title, content, images } = JSON.parse(body);
            const postIndex = posts.findIndex(p => p.id === postId);
            if(postIndex > -1) {
                posts[postIndex].title = title;
                posts[postIndex].content = content;
                    if (images !== undefined) {
                        posts[postIndex].images = normalizeAttachmentList(images);
                    }
                    savePostsData(posts);
                res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: '文章已更新' }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '找不到文章' }));
            }
        });
    }

    // --- 商品 API (新增 / 讀取) ---
    } else if (pathname === '/api/products' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            const product = JSON.parse(body);
            product.id = Date.now(); // 產生唯一 ID
            let products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
            products.push(product);
            fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: '上架成功' }));
        });

    } else if (pathname === '/api/products' && req.method === 'GET') {
        setCorsHeaders(res);
        const sellerEmail = parsedUrl.searchParams.get('seller');
        let products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
        // 若有賣家參數則過濾
        if (sellerEmail) {
            products = products.filter(p => p.seller === sellerEmail);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(products));

    // --- 商品 API (刪除) ---
    } else if (pathname.startsWith('/api/products/') && req.method === 'DELETE') {
        setCorsHeaders(res);
        const productId = parseInt(pathname.split('/')[3]);
        let products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
        products = products.filter(p => p.id !== productId);
        fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        
    }// 1. 爬蟲 API 路由
    else if (pathname === '/api/scrape' && req.method === 'GET') {
        setCorsHeaders(res);
        const keyword = parsedUrl.searchParams.get('keyword');
        const platform = parsedUrl.searchParams.get('platform') || 'all';
        const excludeStr = parsedUrl.searchParams.get('exclude') || '';
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
        if (platform === 'all' || platform === 'shopee') {
            const shopeeData = await scrapeShopee(keyword);
            allResults = allResults.concat(shopeeData);
        }
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

        const ext = path.extname(filePath);
        const contentType = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript'
        }[ext] || 'text/plain';

        fs.readFile(filePath, (err, data) => {
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
