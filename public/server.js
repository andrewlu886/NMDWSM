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
const {
    TEST_WARNING, calculateValuation, calculateNvidiaGpuValuation,
    getNvidiaGpuPricingProfile, isNvidiaGpuModel
} = require('../src/services/valuation');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname);
const BLOCKED_STATIC_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);
const BLOCKED_STATIC_FILES = new Set(['users.json', 'products.json', 'posts.json']);
const LEGACY_PAGE_ROUTES = new Set([
    '/login', '/login.html', '/account', '/account.html',
    '/forum', '/forum.html',
    '/marketplace', '/marketplace.html', '/seller', '/seller.html',
    '/products', '/products.html', '/product', '/product.html',
    '/cart', '/cart.html', '/checkout', '/checkout.html',
    '/transactions', '/transactions.html'
]);
const LEGACY_API_PREFIXES = [
    '/api/login', '/api/register', '/api/account', '/api/posts',
    '/api/products', '/api/favorites', '/api/cart', '/api/transactions'
];

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
    // ========================================================
    // 理瓦數計算與驅動程式 API
    // ========================================================
    setCorsHeaders(res);

    if (req.method === 'GET') {
        const sqlite3 = require('sqlite3').verbose();
        const database = new sqlite3.Database(path.join(__dirname, 'nmdwsm.db'));

        // 1. GPU 瓦數資料 API
        if (pathname === '/api/gpu-data') {
            database.all('SELECT * FROM "GPU_Power_Supply_Data_2010_TO_2026"', [], (err, rows) => {
                if (err) sendJson(res, 500, { error: err.message });
                else sendJson(res, 200, rows);
                database.close();
            });
            return;
        }

        // 2. CPU 瓦數資料 API (配合您新增的 CPU 表格)
        if (pathname === '/api/cpu-data') {
            database.all('SELECT * FROM "CPU_Power_Supply_Data_2010_TO_2026"', [], (err, rows) => {
                if (err) sendJson(res, 500, { error: err.message });
                else sendJson(res, 200, rows);
                database.close();
            });
            return;
        }

        // 3. 驅動程式連結 API (注意表名的雙引號)
        if (pathname === '/api/driver-links') {
            database.all('SELECT * FROM "GPU_Driver_Links-ExactFormat"', [], (err, rows) => {
                if (err) sendJson(res, 500, { error: err.message });
                else sendJson(res, 200, rows);
                database.close();
            });
            return;
        }
        // 若找不到上述路徑，記得要關閉資料庫連線避免佔用
        database.close();
    }
    // 需求推薦 API
    if (pathname === '/api/recommend' && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const options = await parseJsonBody(req);
            if (options.productType === 'component' && !['cpu', 'gpu'].includes(options.componentType)) {
                return sendJson(res, 400, {
                    success: false,
                    message: '選擇電腦零件時，componentType 必須為 cpu 或 gpu'
                });
            }
            const result = await getRecommendations(options);
            sendJson(res, 200, result);
        } catch (error) {
            console.error('❌ API 推薦處理發生錯誤:', error);
            if (!res.headersSent) {
                sendJson(res, 500, { success: false, message: '伺服器內部錯誤' });
            }
        }

    } else if (pathname === '/api/valuation/models' && req.method === 'GET') {
        setCorsHeaders(res);
        try {
            const category = String(parsedUrl.searchParams.get('category') || '').trim().toLowerCase();
            const query = String(parsedUrl.searchParams.get('q') || '').trim();
            const brand = String(parsedUrl.searchParams.get('brand') || '').trim();
            if (!['cpu', 'gpu', 'motherboard'].includes(category)) {
                return sendJson(res, 200, { success: true, data: [] });
            }
            if (!query) return sendJson(res, 200, { success: true, data: [] });
            const data = await db.HardwareCatalog.searchModels({
                category,
                brand,
                query,
                limit: parsedUrl.searchParams.get('limit')
            });
            sendJson(res, 200, { success: true, data });
        } catch (error) {
            console.error('❌ 型號查詢失敗:', error);
            sendJson(res, 500, { success: false, message: '型號資料暫時無法查詢。' });
        }

    } else if (pathname === '/api/valuation' && req.method === 'POST') {
        setCorsHeaders(res);
        try {
            const payload = await parseJsonBody(req);
            const requiredFields = ['category', 'model', 'elapsedMonths'];
            const missingField = requiredFields.find(field => payload[field] === undefined || payload[field] === null || payload[field] === '');
            if (missingField) {
                return sendJson(res, 400, { success: false, message: '估價資料不完整，請檢查所有必填欄位。' });
            }
            const category = String(payload.category).trim().toLowerCase();
            const brand = String(payload.brand || '').trim();
            const allowedCategories = new Set(['cpu', 'gpu', 'motherboard', 'ram']);
            const originalPrice = Number(payload.originalPrice);
            const hasSubmittedPrice = Number.isFinite(originalPrice) && originalPrice > 0;
            const submittedWarrantyMonths = payload.totalWarrantyMonths === undefined || payload.totalWarrantyMonths === ''
                ? null
                : Number(payload.totalWarrantyMonths);
            const elapsedMonths = Number(payload.elapsedMonths);
            if (!allowedCategories.has(category)) {
                return sendJson(res, 400, { success: false, message: '不支援這個硬體分類。' });
            }
            if (!Number.isFinite(elapsedMonths) || elapsedMonths < 0) {
                return sendJson(res, 400, { success: false, message: '已過月份不可小於 0。' });
            }
            if (category !== 'ram' && submittedWarrantyMonths !== null &&
                (!Number.isFinite(submittedWarrantyMonths) || submittedWarrantyMonths < 0)) {
                return sendJson(res, 400, { success: false, message: '保固總月數不可小於 0。' });
            }
            const extensionRegistered = ['yes', 'no', 'unknown'].includes(payload.extensionRegistered)
                ? payload.extensionRegistered
                : 'unknown';
            const resolved = await db.HardwareCatalog.resolveValuationInput({
                category,
                brand,
                model: payload.model,
                modelId: payload.modelId,
                elapsedMonths,
                extensionRegistered
            });
            const warranty = category === 'ram' || submittedWarrantyMonths === null
                ? resolved.warranty
                : {
                    ...resolved.warranty,
                    type: 'months',
                    baseMonths: submittedWarrantyMonths,
                    extensionMonths: 0,
                    totalMonths: submittedWarrantyMonths,
                    elapsedMonths,
                    remainingMonths: Math.max(submittedWarrantyMonths - elapsedMonths, 0),
                    expiredByMonths: Math.max(elapsedMonths - submittedWarrantyMonths, 0),
                    isExpired: elapsedMonths > submittedWarrantyMonths,
                    extensionAvailable: false,
                    registrationRequired: false,
                    registrationApplied: false,
                    matchLevel: 'user_input',
                    note: '保固期限由使用者輸入，最終仍以購買證明與原廠判定為準。'
                };
            const formulaConfig = await db.getValuationFormulaConfig();
            const nvidiaCandidate = category === 'gpu' && !resolved.gpuPricing &&
                isNvidiaGpuModel(payload.model, resolved.model && resolved.model.manufacturer);
            if (nvidiaCandidate && !getNvidiaGpuPricingProfile(
                payload.model, warranty.totalMonths, formulaConfig.nvidiaGpu
            )) {
                return sendJson(res, 400, {
                    success: false, message: '目前沒有對應的 NVIDIA 估價公式。'
                });
            }
            if (!resolved.gpuPricing && !resolved.cpuPricing && !resolved.referencePrice && (!Number.isFinite(originalPrice) || originalPrice <= 0)) {
                return sendJson(res, 400, { success: false, message: '新品參考價需大於 0。' });
            }
            const formulaInput = {
                category,
                brand: resolved.canonicalBrand || brand,
                model: resolved.model && resolved.model.manufacturer !== 'NVIDIA'
                    ? resolved.model.canonicalModel : String(payload.model).trim(),
                modelId: resolved.model ? resolved.model.id : null,
                originalPrice,
                elapsedMonths,
                totalWarrantyMonths: warranty.totalMonths,
                remainingWarrantyMonths: warranty.remainingMonths,
                isWarrantyExpired: warranty.isExpired,
                extensionRegistered,
                condition: 'good',
                details: payload.details && typeof payload.details === 'object' ? payload.details : {},
                formulaConfig
            };
            if (resolved.gpuPricing) {
                formulaInput.gpuPricing = {
                    ...resolved.gpuPricing,
                    ...(hasSubmittedPrice ? { launchPriceNtd: originalPrice } : {})
                };
                formulaInput.originalPrice = hasSubmittedPrice
                    ? originalPrice
                    : resolved.gpuPricing.launchPriceNtd;
            } else if (resolved.cpuPricing) {
                formulaInput.cpuPricing = resolved.cpuPricing;
                formulaInput.originalPrice = hasSubmittedPrice
                    ? originalPrice
                    : resolved.cpuPricing.referencePriceNtd;
            } else if (resolved.referencePrice) {
                formulaInput.originalPrice = hasSubmittedPrice
                    ? originalPrice
                    : resolved.referencePrice.priceNtd;
            }

            let pricingResult = null;
            let fallbackReason = null;
            if (nvidiaCandidate) {
                pricingResult = calculateNvidiaGpuValuation(formulaInput);
            }
            const valuationApiUrl = category === 'ram'
                ? ''
                : String(process.env.VALUATION_API_URL || '').trim();
            if (valuationApiUrl && !pricingResult) {
                const headers = { 'Content-Type': 'application/json' };
                const valuationApiKey = String(process.env.VALUATION_API_KEY || '').trim();
                if (valuationApiKey) headers.Authorization = `Bearer ${valuationApiKey}`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), Number(process.env.VALUATION_TIMEOUT_MS || 15000));
                try {
                    const upstream = await fetch(valuationApiUrl, {
                        method: 'POST', headers, body: JSON.stringify(formulaInput), signal: controller.signal
                    });
                    const result = await upstream.json();
                    if (!upstream.ok || !Number.isFinite(Number(result.price))) {
                        throw new Error(result.message || `HTTP ${upstream.status}`);
                    }
                    pricingResult = {
                        success: true,
                        pricingMode: process.env.VALUATION_PRICING_MODE === 'official' ? 'official' : 'test',
                        warning: process.env.VALUATION_PRICING_MODE === 'official' ? null : TEST_WARNING,
                        price: Math.max(0, Math.round(Number(result.price))),
                        range: result.range || {
                            min: Math.max(0, Math.round(Number(result.price) * 0.9)),
                            max: Math.max(0, Math.round(Number(result.price) * 1.1))
                        }
                    };
                } catch (error) {
                    fallbackReason = '外部定價服務目前無法使用，已改用測試公式。';
                    console.error('❌ 外部定價服務失敗，改用測試公式:', error.message);
                } finally {
                    clearTimeout(timeout);
                }
            }
            if (!pricingResult) pricingResult = calculateValuation(formulaInput);
            sendJson(res, 200, {
                ...pricingResult,
                fallbackReason,
                hardware: {
                    matched: Boolean(resolved.model),
                    matchLevel: resolved.model ? 'exact_model' : 'category_default',
                    requestedModel: String(payload.model).trim(),
                    canonicalBrand: resolved.canonicalBrand || brand,
                    canonicalModel: resolved.model ? resolved.model.canonicalModel : String(payload.model).trim(),
                    manufacturer: resolved.model ? resolved.model.manufacturer : null,
                    series: resolved.model ? resolved.model.series : null,
                    cpuPricing: resolved.cpuPricing || null
                },
                    warranty,
                formulaInput
            });
        } catch (error) {
            console.error('❌ 估價處理失敗:', error);
            sendJson(res, 500, { success: false, message: '估價資料處理失敗，請稍後再試。' });
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
        if (pathname === '/scrape') filePath = path.join(__dirname, 'scrape.html');
        else if (pathname === '/recommend') filePath = path.join(__dirname, 'recommend.html');
        else if (pathname === '/tools') filePath = path.join(__dirname, 'tools.html');
        else if (pathname === '/valuation') filePath = path.join(__dirname, 'valuation.html');
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
    ▶️ 測試 API: http://localhost:${PORT}/api
    ▶️ 工具頁面: http://localhost:${PORT}/tools
    ==========================================
    `);
});
