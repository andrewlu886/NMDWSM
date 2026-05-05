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

// 總爬蟲控制器
async function performScraping(platform, keyword) {
    const tasks = [];
    
    // 根據參數決定要觸發哪個爬蟲，支援 all
    if (platform === 'coolpc' || platform === 'all') tasks.push(scrapeCoolpc(keyword));
    if (platform === 'sinya' || platform === 'all') tasks.push(scrapeSinya(keyword));

    const results = await Promise.all(tasks);
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

        if (!keyword) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: "請輸入關鍵字" }));
        }

        // 執行真實爬蟲！
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