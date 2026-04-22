const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const PORT = 3000;
const USERS_FILE = path.join(__dirname, 'users.json');

// 從文件加載用戶數據
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

// 初始加載用戶數據
let registeredUsers = loadUsers();

// 保存用戶數據到文件
function saveUsers() {
    try {
        const jsonData = JSON.stringify(registeredUsers, null, 2);
        fs.writeFileSync(USERS_FILE, jsonData, 'utf8');
        console.log('✅ 已保存到 users.json：', Object.keys(registeredUsers).join(', '));
        return true;
    } catch (error) {
        console.error('❌ 保存失敗:', error.message);
        return false;
    }
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// 簡單的靜態文件服務器
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

    // API路由
    if (pathname === '/api/login' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { email, password } = JSON.parse(body);
                console.log(`\n📝 登入請求: ${email}`);
                
                // 直接從檔案讀取最新的用戶數據
                let users = {};
                try {
                    if (fs.existsSync(USERS_FILE)) {
                        const fileData = fs.readFileSync(USERS_FILE, 'utf8');
                        users = JSON.parse(fileData);
                        console.log(`📂 已讀取 users.json，共 ${Object.keys(users).length} 個帳號`);
                    }
                } catch (readError) {
                    console.error('❌ 讀取 users.json 失敗:', readError.message);
                }

                // 驗證帳號密碼
                if (users[email] === password) {
                    console.log(`✅ 登入成功: ${email}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: "登入成功！", user: email }));
                } else {
                    console.log(`❌ 登入失敗: ${email} (帳號存在: ${!!users[email]})`);
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "帳號或密碼錯誤" }));
                }
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "請求格式錯誤" }));
            }
        });
    } else if (pathname === '/api/register' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { name, email, password, confirmPassword } = JSON.parse(body);
                console.log(`\n📝 註冊請求: ${email}`);

                // 驗證密碼確認
                if (password !== confirmPassword) {
                    console.log(`❌ 密碼不符`);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "密碼確認不符" }));
                    return;
                }

                // 驗證密碼長度
                if (password.length < 8) {
                    console.log(`❌ 密碼過短`);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "密碼至少需要 8 個字元" }));
                    return;
                }

                // 從檔案讀取已註冊帳號
                let users = {};
                try {
                    if (fs.existsSync(USERS_FILE)) {
                        const fileData = fs.readFileSync(USERS_FILE, 'utf8');
                        users = JSON.parse(fileData);
                        console.log(`📂 已讀取 users.json，共 ${Object.keys(users).length} 個帳號`);
                    }
                } catch (readError) {
                    console.error('⚠️ 讀取 users.json 失敗，使用空對象:', readError.message);
                    users = {};
                }

                // 檢查帳號是否已存在
                if (users[email]) {
                    console.log(`❌ 帳號已存在: ${email}`);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "此帳號已被註冊" }));
                    return;
                }

                // 新增帳號到內存
                users[email] = password;
                registeredUsers = users;

                // 直接寫入檔案
                try {
                    const jsonData = JSON.stringify(users, null, 2);
                    fs.writeFileSync(USERS_FILE, jsonData, 'utf8');
                    
                    // 驗證是否成功寫入
                    const verify = fs.readFileSync(USERS_FILE, 'utf8');
                    const verifyData = JSON.parse(verify);
                    
                    if (verifyData[email] === password) {
                        console.log(`✅ 帳號 ${email} 已成功註冊並寫入 users.json`);
                        console.log(`📊 目前已有帳號: ${Object.keys(verifyData).join(', ')}`);
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: "註冊成功！請登入您的帳號。" }));
                    } else {
                        console.error(`❌ 寫入失敗，檔案驗證不通過`);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: "帳號保存失敗，請稍後重試。" }));
                    }
                } catch (writeError) {
                    console.error(`❌ 寫入 users.json 失敗:`, writeError.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "帳號保存失敗，請稍後重試。" }));
                }
            } catch (error) {
                console.error('❌ 請求格式錯誤:', error.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "請求格式錯誤" }));
            }
        });
    } else if (pathname === '/api/recommend' && req.method === 'POST') {
        setCorsHeaders(res);
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { budget, usage } = JSON.parse(body);

                let cpuRatio, gpuRatio;
                if (usage === 'gaming') {
                    cpuRatio = 0.2;
                    gpuRatio = 0.5;
                } else if (usage === 'office') {
                    cpuRatio = 0.4;
                    gpuRatio = 0.2;
                } else {
                    cpuRatio = 0.2;
                    gpuRatio = 0.4;
                }

                const cpuBudget = budget * cpuRatio;
                const gpuBudget = budget * gpuRatio;

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    cpu: `預算約 ${cpuBudget} 的處理器`,
                    gpu: `預算約 ${gpuBudget} 的顯示卡`,
                    usage: usage,
                    status: "success"
                }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "請求格式錯誤" }));
            }
        });
    } else if (pathname === '/favicon.ico') {
        // 處理favicon請求，避免404錯誤
        res.writeHead(204);
        res.end();
    } else if (pathname === '/api/debug/users' && req.method === 'GET') {
        // 調試端點：查看已註冊的帳號（僅用於開發）
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            registeredUsers: Object.keys(registeredUsers),
            count: Object.keys(registeredUsers).length
        }));
    } else {
        // 靜態文件服務
        let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
        if (pathname === '/login') {
            filePath = path.join(__dirname, 'login.html');
        }

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

// 啟動伺服器
server.listen(PORT, () => {
    console.log(`
    ==========================================
    🚀 伺服器已啟動！
    🔗 測試網址: http://localhost:${PORT}
    🔗 登入頁面: http://localhost:${PORT}/login
    ==========================================
    `);
});