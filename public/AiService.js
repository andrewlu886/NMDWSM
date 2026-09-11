// --- AiService.js AI客服實作
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
        const geminiKey = rawGeminiKey.replace(/^"|"$/g, '').trim(); 

        let envModel = process.env.GEMINI_MODEL || process.env.GEMINI_MODEL_NAME || 'gemini-3.6-flash';
        if (envModel.includes('2.5') || envModel.includes('mini')) {
            envModel = 'gemini-3.6-flash';
        }
        const geminiModel = envModel;

        const messages = [
            { 
                role: 'system', 
                content: `你是一位專業、親切的電腦產品二手估價平台 AI 客服助手。
                    你的任務是協助使用者使用估價工具等相關問題。

                    【核心守則】
                    1. 語氣保持同理心與耐心，避免生硬的機器人官方用語。
                    2. 絕對邊界管控（最優先）：我們的服務範圍僅限於「電腦零件」之估價、市價查詢與瓦數計算。若使用者輸入的內容與電腦硬體完全無關、屬於胡鬧、惡作劇或日常聊天（例如詢問食物、工具、非電腦類物品等），請直接且禮貌地拒絕，嚴禁提及任何平台工具或推薦任何產品。
                    3. 拒絕格式：針對無關問題，請統一簡短回覆：「非常抱歉，本系統僅提供電腦零件相關之估價與市價查詢服務，我無法回答此類問題。」，不要多做解釋或延伸。
                    4. 資訊補全：當用戶提供的估價資訊不完整時，請勿直接給出估價，應主動引導用戶提供具體細節（如：品牌、型號、使用狀況）。
                    5. 預期管理：當估價與用戶預期不符時，請優先安撫情緒，並委婉說明這僅是基於市場大數據的初步估算，僅供參考。
                    6. 操作引導：當用戶詢問如何使用估價工具或查詢市價時，請以條列式提供簡單明瞭的步驟，避免艱澀術語，並務必附上對應的功能導航連結。
                    7. 準確性限制：避免提供不正確或捏造的行情數據；若遇到無法判斷的極端狀況，請建議用戶前往市價查詢頁面查看實際市場刊登價。

                    【功能導航觸發規則】
                    當用戶提到要估算特定產品，或詢問如何使用特定工具時，請務必在回答尾端加上對應的專屬連結，格式如下：
                    - 若提及「顯示卡」、「CPU」、「GPU」、「主機板」、「滑鼠」、「鍵盤」或「電腦零件」：[點此前往零件估價工具](/valuation)
                    - 若提及「市場價格」、「市價」或「行情」：[點此前往市價查詢](/scrape)
                    - 若提及「手機」或「平板」或「筆電」或「筆記型電腦」：委婉告知目前僅針對電腦零件估價，並務必附上連結：[點此前往零件估價工具](/valuation)
                    - 若提及瓦數計算或電源供應器等相關問題：[點此前往瓦數計算工具](/tools)

                    【輸出限制】
                    - 除了上述的導航連結格式外，不要使用其他特殊符號渲染回答。
                    - 回答請盡量控制在 100 字以內，保持簡明扼要。
                    - 操作步驟請直接使用條列式呈現。`
            }
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

        if (!geminiKey) {
            clearTimeout(timeoutId);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: '伺服器未設定 GEMINI_API_KEY' }));
        }

        let endpoint;
        let bodyPayload;
        let headers;
        try {
            endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(geminiKey)}`;

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
            let payload = {};
            try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }

            if (!r.ok) {
                console.error('❌ Gemini Error Detail:', text);
                const errMsg = payload?.error?.message || payload?.message || `Gemini API 請求失敗 (status ${r.status})`;
                clearTimeout(timeoutId);
                res.writeHead(502, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: errMsg }));
            }

            const answer = payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '抱歉，AI 沒回覆內容。';
            clearTimeout(timeoutId);

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
            if (err?.name === 'AbortError') {
                const retryTimeout = Number(process.env.AI_RETRY_TIMEOUT_MS || 15000);
                try {
                    const retryController = new AbortController();
                    const retryTimeoutId = setTimeout(() => retryController.abort(), retryTimeout);
                    const retryEndpoint = endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(geminiKey)}`;
                    const r2 = await fetch(retryEndpoint, {
                        method: 'POST',
                        headers,
                        signal: retryController.signal,
                        body: JSON.stringify(bodyPayload)
                    });
                    clearTimeout(retryTimeoutId);
                    const text2 = await r2.text();
                    let payload2 = {};
                    try { payload2 = text2 ? JSON.parse(text2) : {}; } catch { payload2 = {}; }

                    if (!r2.ok) {
                        const errMsg2 = payload2?.error?.message || payload2?.message || `Gemini API retry 請求失敗 (status ${r2.status})`;
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: errMsg2 }));
                    }

                    const answer2 = payload2?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '抱歉，AI 沒回覆內容。';
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, answer: answer2 }));
                } catch (err2) {
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
    } catch (error) {
        console.error('❌ AiService global error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'AI 聊天服務發生錯誤' }));
    }
}

module.exports = { handle };