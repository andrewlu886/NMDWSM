const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
// 靜態爬蟲核心套件
const axios = require('axios');
const cheerio = require('cheerio');

const PORT = 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const POSTS_FILE = path.join(__dirname, 'posts.json');

// --- 資料庫與使用者資料初始化 ---

// 1. 初始化使用者數據
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            console.log(`✅ 已加載 ${Object.keys(parsed).length} 個帳號`);
            return parsed;
        }
    } catch (error) {
        console.error('❌ 讀取 users.json 失敗:', error.message);
    }
    return { 'test@example.com': '12345678' };
}
let registeredUsers = loadUsers();

// 2. 初始化討論區文章數據
function initPosts() {
    if (!fs.existsSync(POSTS_FILE)) {
        const initialPosts = [
            { id: 1, title: '大家覺得現在買二手 RTX 3060 划算嗎？', author: '硬體新手', content: '目前預算大約 6000 左右，主要玩特戰英豪跟一些 3A 遊戲，想請問這個價位帶收 3060 還是捏一點上 4060 比較好？', date: new Date().toISOString() },
            { id: 2, title: '[閒聊] 關於平台的硬體驗證功能', author: '王小明', content: '覺得這個功能滿實用的，尤其是自動抓 GPU-Z 數據，可以防範不少礦卡。期待之後能加入 CPU 的壓力測試！', date: new Date(Date.now() - 86400000).toISOString() }
        ];
        fs.writeFileSync(POSTS_FILE, JSON.stringify(initialPosts, null, 2), 'utf8');
        console.log('✅ 已建立預設的 posts.json');
    }
}
initPosts();

// --- 爬蟲功能實作 ---

// 1. 原價屋爬蟲邏輯
async function scrapeCoolpc(keyword) {
    try {
        console.log(`[原價屋] 正在真實搜尋: ${keyword}`);
        const response = await axios.get('https://www.coolpc.com.tw/evaluate.php', {
            // axios 不要轉碼，直接把最原始的資料 (Buffer) 抓回來
            responseType: 'arraybuffer', 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 5000 
        });
        
        // 使用內建的 TextDecoder，將原始資料從 Big5 正確翻譯成 UTF-8
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
                    name: text.substring(0, 60) + '...', // 把字數限制放寬到 60 字
                    price: price,
                    url: 'https://www.coolpc.com.tw/evaluate.php'
                });
            }
        });

        console.log(`[原價屋] 搜尋完成，找到 ${results.length} 筆`);
        
        // 如果想把所有結果都吐出來，可以直接改成： return results;
        return results.slice(0, 30); 
    } catch (error) {
        console.error(`❌ 原價屋爬蟲失敗: ${error.message}`);
        return [{ platform: '原價屋', name: '⚠️ 抓取失敗 (伺服器無回應或被阻擋)', price: 'N/A', url: 'https://www.coolpc.com.tw/evaluate.php' }];
    }
}
// 2. 欣亞數位爬蟲邏輯
async function scrapeSinya(keyword) {
    try {
        console.log(`[欣亞] 正在透過隱藏 API 搜尋: ${keyword}`);
        
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
                // 精準對應 JSON 欄位
                name: item.prod_name, 
                // 將數字價格轉成有逗號的字串 (例如 39900 變成 "39,900")
                price: item.price ? item.price.toLocaleString() : '請至官網確認',
                url: item.prod_id ? `https://www.sinya.com.tw/prod/${item.prod_id}` : `https://www.sinya.com.tw/search?keyword=${encodeURIComponent(keyword)}`
            });
        });

        console.log(`[欣亞] API 搜尋完成，找到 ${results.length} 筆`);
        return results.slice(0, 12); // 回傳前 12 筆

    } catch (error) {
        console.error(`❌ 欣亞 API 爬蟲失敗: ${error.message}`);
        return [{ platform: '欣亞', name: '⚠️ 抓取失敗 (API 無回應)', price: 'N/A', url: 'https://www.sinya.com.tw/' }];
    }
}
// 3. 露天拍賣爬蟲邏輯 (兩階段 API 破解版)
async function scrapeRuten(keyword) {
    try {
        console.log(`[露天] 第一階段：正在搜尋關鍵字 "${keyword}" 取得商品 ID...`);
        
        // 【第一階段】先用關鍵字搜尋，取得商品 ID 清單
        const searchUrl = `https://rtapi.ruten.com.tw/api/search/v3/index.php/core/prod?q=${encodeURIComponent(keyword)}&type=direct&sort=rnk/dc`; 
        const searchRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000
        });

        // 露天通常把搜尋結果放在 Rows 裡面
        const searchRows = searchRes.data.Rows || [];
        if (searchRows.length === 0) {
            console.log(`[露天] 找不到 "${keyword}" 的相關商品。`);
            return [];
        }

        // 把前 12 個商品的 ID 抽出來，串成 "id1,id2,id3..." 的格式
        const itemIds = searchRows.slice(0, 12).map(row => row.Id || row.GoodsNo).filter(id => id).join(',');

        if (!itemIds) return [];

        console.log(`[露天] 第二階段：成功取得 IDs，準備獲取詳細價格與名稱...`);

        // 【第二階段】使用你抓到的「查價格 API」，把組合好的 ID 餵給它
        const detailUrl = `https://rtapi.ruten.com.tw/api/prod/v3/index.php/prod?id=${itemIds}`;
        const detailRes = await axios.get(detailUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000
        });

        let results = [];
        // 你剛才貼的 JSON 陣列會直接存在 detailRes.data 裡
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

        console.log(`[露天] 搜尋完成，完美抓取 ${results.length} 筆詳細資料！`);
        return results;

    } catch (error) {
        console.error(`❌ 露天爬蟲失敗: ${error.message}`);
        return [{ platform: '露天', name: '⚠️ 抓取失敗 (API 無回應)', price: 'N/A', url: 'https://www.ruten.com.tw/' }];
    }
}
// 4. 蝦皮購物爬蟲邏輯(BUG)
async function scrapeShopee(keyword) {
    try {
        console.log(`[蝦皮] 正在透過 API 搜尋: ${keyword}`);
        
        // 蝦皮的隱藏搜尋 API
        const apiUrl = `https://shopee.tw/api/v4/search/search_items?keyword=${encodeURIComponent(keyword)}&limit=12&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
        
        const response = await axios.get(apiUrl, {
            headers: { 
                // 蝦皮非常看重 User-Agent 和 Referer，甚至有時候需要塞一個假的 Cookie 騙過初步驗證
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
            // 蝦皮把詳細資訊包在 item_basic 裡面
            const item = data.item_basic;
            if (!item) return;

            // 破解蝦皮的 10 萬倍價格機制
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
        console.error(`❌ 蝦皮爬蟲失敗: ${error.message}`);
        return [{ platform: '蝦皮', name: '⚠️ 抓取失敗 (防爬蟲阻擋或無回應)', price: 'N/A', url: 'https://shopee.tw/' }];
    }
}

// 5. PChome 24h 爬蟲邏輯
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
            // 雙重保險：不管 PChome 給大寫還是小寫！
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
        console.error(`❌ PChome 爬蟲失敗: ${error.message}`);
        return [];
    }
}
// 6. Momo 購物網爬蟲邏輯
async function scrapeMomo(keyword) {
    try {
        console.log(`[Momo] 正在透過隱藏 API 搜尋: ${keyword}`);

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
            console.log(`[Momo 偵錯] rtnSearchData 內部的結構:`, Object.keys(response.data.rtnSearchData));
        }

        goodsList.forEach(item => {
            // 把 '$' 或 ',' 等非數字符號全部過濾掉
            const rawPrice = String(item.goodsPrice || item.price || '');
            const cleanPriceStr = rawPrice.replace(/[^0-9]/g, '');

            results.push({
                platform: 'Momo',
                // 雙重保險抓取名稱
                name: item.goodsName || item.name || 'Momo 商品',
                // 如果清洗後有數字，就轉換格式；否則顯示請至官網確認
                price: cleanPriceStr ? parseInt(cleanPriceStr, 10).toLocaleString() : '請至官網確認',
                url: item.goodsCode ? `https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=${item.goodsCode}` : `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${encodeURIComponent(keyword)}`
            });
        });
        console.log(`[Momo] 搜尋完成，找到 ${results.length} 筆`);
        return results.slice(0, 12);

    } catch (error) {
        console.error(`❌ Momo 爬蟲失敗: ${error.message}`);
        return [];
    }
}
// 總爬蟲控制器
async function performScraping(platform, keyword) {
        let tasks = [];
        if (platform === 'all' || platform === 'coolpc') tasks.push(scrapeCoolpc(keyword));
        if (platform === 'all' || platform === 'sinya')  tasks.push(scrapeSinya(keyword));
        if (platform === 'all' || platform === 'ruten')  tasks.push(scrapeRuten(keyword));
        if (platform === 'all' || platform === 'pchome') tasks.push(scrapePChome(keyword));
        if (platform === 'all' || platform === 'momo')   tasks.push(scrapeMomo(keyword));
        if (platform === 'all' || platform === 'shopee') tasks.push(scrapeShopee(keyword));
        // resultsArray 會是一個包含各個平台結果的「二維陣列」
        const resultsArray = await Promise.all(tasks);
        // 把二維陣列攤平，變成一個包含所有商品的一維大陣列
        let allResults = resultsArray.flat(); 
    return results.flat(); 
}

// --- 輔助函數 ---
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// --- 建立伺服器與 API 路由 ---
const server = http.createServer(async(req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // 支援 CORS 預檢請求
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
    }

    // 1. 登入 API
    if (pathname === '/api/login' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { email, password } = JSON.parse(body);
                let users = {};
                if (fs.existsSync(USERS_FILE)) {
                    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
                }

                if (users[email] === password) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: "登入成功！", user: email }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "帳號或密碼錯誤" }));
                }
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "請求格式錯誤" }));
            }
        });

    // 2. 註冊 API
    } else if (pathname === '/api/register' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { name, email, password, confirmPassword } = JSON.parse(body);
                if (password !== confirmPassword || password.length < 8) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "密碼不符或過短" }));
                }

                let users = {};
                if (fs.existsSync(USERS_FILE)) {
                    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
                }

                if (users[email]) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "此帳號已被註冊" }));
                }

                users[email] = password;
                registeredUsers = users;
                fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: "註冊成功！" }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "伺服器錯誤" }));
            }
        });

    // 3. 智慧推薦 API
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
                    cpu: `預算約 ${budget * cpuRatio} 的處理器`,
                    gpu: `預算約 ${budget * gpuRatio} 的顯示卡`,
                    usage: usage,
                    status: "success"
                }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "請求格式錯誤" }));
            }
        });

    // 4. 討論區取得文章 API (GET)
    } else if (pathname === '/api/posts' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const postsData = fs.readFileSync(POSTS_FILE, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(postsData);
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: "無法讀取文章列表" }));
        }

    // 5. 討論區發布文章 API (POST)
    } else if (pathname === '/api/posts' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { title, content, author } = JSON.parse(body);
                if (!title || !content) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: "標題與內容不能為空" }));
                }

                const posts = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
                const newPost = {
                    id: Date.now(),
                    title,
                    content,
                    author: author || '測試用戶',
                    date: new Date().toISOString()
                };
                
                posts.unshift(newPost);
                fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), 'utf8');
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: "發文成功！", post: newPost }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "發文處理失敗" }));
            }
        });
    }// 1. 爬蟲 API 路由
    else if (pathname === '/api/scrape' && req.method === 'GET') {
        setCorsHeaders(res);
        const keyword = parsedUrl.query.keyword;
        const platform = parsedUrl.query.platform || 'all';
        const excludeStr = parsedUrl.query.exclude || '';
        if (!keyword) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: "請輸入關鍵字" }));
        }
        console.log(`[系統] 準備開始爬取: ${keyword}`);
        
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

    // --- 靜態檔案服務 (網頁切換路由) ---
    } else {
        let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
        
        if (pathname === '/login') filePath = path.join(__dirname, 'login.html');
        else if (pathname === '/forum') filePath = path.join(__dirname, 'forum.html');
        else if (pathname === '/scrape') filePath = path.join(__dirname, 'scrape.html');

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
    🚀 伺服器已啟動！
    🔗 測試首頁: http://localhost:${PORT}
    🔗 登入頁面: http://localhost:${PORT}/login
    🔗 討論區頁面: http://localhost:${PORT}/forum
    🔗 測試端點: http://localhost:3000/api/scrape?keyword=RTX4060&platform=all
    ==========================================
    `);
});