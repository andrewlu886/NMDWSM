const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

// --- 輔助函數 ---
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// --- 建立伺服器與 API 路由 ---
const server = http.createServer((req, res) => {
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

    } else if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();

    // --- 靜態檔案服務 (網頁切換路由) ---
    } else {
        let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
        
        if (pathname === '/login') filePath = path.join(__dirname, 'login.html');
        else if (pathname === '/forum') filePath = path.join(__dirname, 'forum.html');

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
    ==========================================
    `);
});