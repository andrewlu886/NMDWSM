// --- AiService.js (Google Gemini API / GitHub Fallback) ---
const fs = require('fs');
const path = require('path');

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                console.error('❌ 無法解析 incoming JSON，raw body:', body);
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function escapeCSV(text) {
    if (!text) return '""';
    return `"${String(text).replace(/"/g, '""')}"`;
}

async function handle(req, res) {
    try {
        const body = await parseJsonBody(req);
        const rawMessages = Array.isArray(body.messages) ? body.messages : [];

        const rawGeminiKey = process.env.GEMINI_API_KEY || '';
        const geminiKey = rawGeminiKey.replace(/^"|"$/g, '').trim(); // 清理外層引號

        // 1. 強制過濾並自動修復模型名稱（預設使用 gemini-3.6-flash）
        let envModel = process.env.GEMINI_MODEL || process.env.GEMINI_MODEL_NAME || 'gemini-3.6-flash';
        if (envModel.includes('2.5') || envModel.includes('mini')) {
            envModel = 'gemini-3.6-flash';
        }
        const geminiModel = envModel;

        const token = process.env.GITHUB_TOKEN;
        const githubApiUrl = process.env.GITHUB_MODELS_URL;
        const githubModel = process.env.GITHUB_MODEL || 'gpt-4o-mini';

        const messages = [
            { role: 'system', content: `你是一個專業、親切的網站 AI 客服助手。` }
        ];
        rawMessages.forEach(m => {
            if (m.role === 'user' || m.role === 'assistant') {
                const text = String(m.content || '').trim();
                if (text) messages.push({ role: m.role, content: text });
            }
        });

        if (messages.length <= 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: '請提供有效的訊息內容' }));
        }

        const timeoutMs = Number(process.env.AI_TIMEOUT_MS || process.env.GEMINI_TIMEOUT_MS || 30000);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.warn(`⏱️ AI request timed out after ${timeoutMs}ms, aborting`);
            controller.abort();
        }, timeoutMs);

        // 若有 GEMINI_API_KEY，優先呼叫 Gemini
        if (geminiKey) {
            // 將下列變數提升到外層，以便在 catch/retry 裡也能使用
            let endpoint;
            let bodyPayload;
            let headers;
            try {
                // 2. 直接組合 Google v1beta 標準 Endpoint（不讀取可能殘留錯誤網址的 GEMINI_API_URL）
                endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(geminiKey)}`;

                console.log('--------------------------------------------------');
                console.log('👉 [Gemini] 正在發送請求至:', `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`);
                console.log('--------------------------------------------------');

                // 3. 組合標準 Payload 結構
                const systemInstruction = {
                    parts: [{ text: messages.find(m => m.role === 'system')?.content || '' }]
                };

                const contents = messages
                    .filter(m => m.role !== 'system')
                    .map(m => ({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: String(m.content || '') }]
                    }));

                bodyPayload = {
                    system_instruction: systemInstruction,
                    contents: contents
                };

                headers = { 'Content-Type': 'application/json' };

                let r = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    signal: controller.signal,
                    body: JSON.stringify(bodyPayload)
                });

                const text = await r.text();
                console.log('← gemini status:', r.status);

                let payload = {};
                try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }

                if (!r.ok) {
                    console.error('❌ Gemini Error Detail:', text);
                    const errMsg = payload?.error?.message || payload?.message || `Gemini API 請求失敗 (status ${r.status})`;
                    clearTimeout(timeoutId);
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: errMsg }));
                }

                // 4. 解析 Gemini 標準回應
                const answer = payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '抱歉，AI 沒回覆內容。';
                clearTimeout(timeoutId);

                // 寫入 CSV Log
                try {
                    const userMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '未知問題';
                    const timeString = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
                    const logPath = path.join(__dirname, 'chat_logs.csv');
                    const csvLine = `${escapeCSV(timeString)},${escapeCSV(userMessage)},${escapeCSV(answer)}\n`;
                    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '\uFEFF時間,使用者問題,AI回答\n');
                    fs.appendFile(logPath, csvLine, err => { if (err) console.error('⚠️ 寫入 CSV 失敗:', err); });
                } catch (e) { console.error('CSV error', e); }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, answer }));
            } catch (err) {
                clearTimeout(timeoutId);
                console.error('❌ Gemini AiService request error:', err);
                // 若為超時，嘗試一次延長重試（預設 60s，可由 AI_RETRY_TIMEOUT_MS 設定）
                if (err?.name === 'AbortError') {
                    const retryTimeout = Number(process.env.AI_RETRY_TIMEOUT_MS || 60000);
                    console.warn(`⏱️ 首次 Gemini 請求逾時，嘗試延長 ${retryTimeout}ms 後重試一次`);
                    try {
                        const retryController = new AbortController();
                        const retryTimeoutId = setTimeout(() => retryController.abort(), retryTimeout);
                        const retryEndpoint = endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(geminiKey)}`;
                        console.log('→ gemini retry endpoint:', retryEndpoint);
                        const r2 = await fetch(retryEndpoint, {
                            method: 'POST',
                            headers,
                            signal: retryController.signal,
                            body: JSON.stringify(bodyPayload)
                        });
                        clearTimeout(retryTimeoutId);
                        const text2 = await r2.text();
                        console.log('← gemini retry status:', r2.status);
                        let payload2 = {};
                        try { payload2 = text2 ? JSON.parse(text2) : {}; } catch { payload2 = {}; }

                        if (!r2.ok) {
                            console.error('❌ Gemini retry Error Detail:', text2);
                            const errMsg2 = payload2?.error?.message || payload2?.message || `Gemini API retry 請求失敗 (status ${r2.status})`;
                            res.writeHead(502, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ success: false, message: errMsg2 }));
                        }

                        const answer2 = payload2?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '抱歉，AI 沒回覆內容。';

                        // 寫入 CSV Log
                        try {
                            const userMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '未知問題';
                            const timeString = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
                            const logPath = path.join(__dirname, 'chat_logs.csv');
                            const csvLine = `${escapeCSV(timeString)},${escapeCSV(userMessage)},${escapeCSV(answer2)}\n`;
                            if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '\uFEFF時間,使用者問題,AI回答\n');
                            fs.appendFile(logPath, csvLine, err => { if (err) console.error('⚠️ 寫入 CSV 失敗:', err); });
                        } catch (e) { console.error('CSV error', e); }

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true, answer: answer2 }));
                    } catch (err2) {
                        console.error('❌ Gemini retry error:', err2);
                        if (err2?.name === 'AbortError') {
                            res.writeHead(504, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ success: false, message: 'AI 伺服器回應超時，請稍後再試。' }));
                        }
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: err2?.message || 'Gemini API retry 錯誤' }));
                    }
                }
                res.writeHead(502, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: err?.message || 'Gemini API 請求錯誤' }));
            }
        }

        // Fallback: GitHub Models
        console.log('→ AI request (github):', { endpoint: githubApiUrl, model: githubModel });
        try {
            if (!token) {
                clearTimeout(timeoutId);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: '伺服器未設定 GITHUB_TOKEN' }));
            }

            if (!githubApiUrl) {
                clearTimeout(timeoutId);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: '伺服器未設定 GITHUB_MODELS_URL' }));
            }

            const r = await fetch(githubApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                signal: controller.signal,
                body: JSON.stringify({ model: githubModel, messages, temperature: 0.5 })
            });
            const text = await r.text();
            console.log('← github status', r.status);
            let payload = {};
            try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }

            if (!r.ok) {
                const errMsg = payload?.error?.message || payload?.message || `GitHub Models API 請求失敗 (status ${r.status})`;
                clearTimeout(timeoutId);
                const userMessage = r.status === 404 ? '模型端點未找到 (404)，請確認 GITHUB_MODELS_URL 與模型名稱是否正確' : errMsg;
                res.writeHead(502, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: userMessage }));
            }

            const answer = payload?.choices?.[0]?.message?.content?.trim() || payload?.choices?.[0]?.text?.trim() || '抱歉，AI 沒回覆內容。';
            clearTimeout(timeoutId);

            // 寫入 CSV
            try {
                const userMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '未知問題';
                const timeString = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
                const logPath = path.join(__dirname, 'chat_logs.csv');
                const csvLine = `${escapeCSV(timeString)},${escapeCSV(userMessage)},${escapeCSV(answer)}\n`;
                if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '\uFEFF時間,使用者問題,AI回答\n');
                fs.appendFile(logPath, csvLine, err => { if (err) console.error('⚠️ 寫入 CSV 失敗:', err); });
            } catch (e) { console.error('CSV error', e); }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, answer }));
        } catch (err) {
            clearTimeout(timeoutId);
            console.error('❌ GitHub AiService request error:', err);
            if (err?.name === 'AbortError') {
                res.writeHead(504, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'AI 伺服器回應超時，請稍後再試。' }));
            }
            res.writeHead(502, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: err?.message || 'GitHub Models API 請求錯誤' }));
        }
    } catch (error) {
        console.error('❌ AiService global error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'AI 聊天服務發生錯誤' }));
    }
}

module.exports = { handle };