// 1. 載入 dotenv 並支援 .env / key.env 兩種環境檔
const dotenv = require('dotenv');
const http = require('http');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const envCandidates = [
    path.join(rootDir, '.env'),
    path.join(rootDir, 'key.env')
];

for (const envFile of envCandidates) {
    if (fs.existsSync(envFile)) {
        dotenv.config({ path: envFile });
    }
}

// SQLite 資料庫
const db = require('./db.js');
const { searchProducts } = require('../src/services/search');
const { getRecommendations } = require('../src/services/recommendation');

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
        try {
            const options = await parseJsonBody(req);
            const result = await getRecommendations(options);
            sendJson(res, 200, result);
        } catch (error) {
            console.error('❌ API 推薦處理發生錯誤:', error);
            if (!res.headersSent) {
                sendJson(res, 500, { success: false, message: '伺服器內部錯誤' });
            }
        }

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

    // 取得使用者統計資料（貼文數等）
    } else if (pathname === '/api/account/stats' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const user = await requireUserFromBodyOrQuery(parsedUrl);
            if (!user) return sendJson(res, 404, { success: false, message: '找不到使用者' });
            const stats = await db.Stats.getByUser(user.id);
            sendJson(res, 200, { success: true, data: stats });
        } catch (error) {
            console.error('❌ 取得使用者統計失敗:', error);
            sendJson(res, 500, { success: false, message: '取得統計失敗' });
        }

    } else if ((pathname === '/api/chat' || pathname === '/api/chat/') && req.method === 'POST') {
        setCorsHeaders(res);
        // log incoming request for debugging client 403 issues
        try {
            console.log('→ Incoming /api/chat request', { url: req.url, method: req.method, headers: req.headers });
            const aiService = require('./AiService');
            await aiService.handle(req, res, parsedUrl);
        } catch (error) {
            console.error('❌ /api/chat delegate error:', error);
            sendJson(res, 500, { success: false, message: 'AI 聊天服務發生錯誤' });
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
        const keyword = parsedUrl.searchParams.get('keyword');
        if (!keyword) {
            return sendJson(res, 400, { success: false, message: '請輸入搜尋關鍵字' });
        }

        try {
            console.log(`[系統] 收到搜尋請求: ${keyword}`);
            const data = await searchProducts({
                keyword,
                platforms: parsedUrl.searchParams.get('platform') || 'all',
                exclude: parsedUrl.searchParams.get('exclude') || '',
                include: parsedUrl.searchParams.get('include') || '',
                categories: parsedUrl.searchParams.get('categories') || ''
            });
            sendJson(res, 200, { success: true, data });
            return;
        } catch (error) {
            console.error('❌ API 市價查詢發生錯誤:', error);
            return sendJson(res, 500, { success: false, message: '伺服器內部錯誤' });
        }
    }else if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();

    // --- 靜態檔案路由 (網頁前端路由) ---
    } else {
        let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
        if (pathname === '/login') filePath = path.join(__dirname, 'login.html');
        else if (pathname === '/forum') filePath = path.join(__dirname, 'forum.html');
        else if (pathname === '/scrape') filePath = path.join(__dirname, 'scrape.html');
        else if (pathname === '/recommend') filePath = path.join(__dirname, 'recommend.html');
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
//安裝 npm install dotenv
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
