// --- AiService.js (Google Gemini 版本 - CSV 試算表紀錄版) ---
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
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

// 🌟 新增：處理 CSV 格式的小工具，避免逗號或換行破壞表格
function escapeCSV(text) {
    if (!text) return '""';
    // 將內容轉為字串，把裡面的雙引號替換為兩個雙引號，最後在最外層包上雙引號
    return `"${String(text).replace(/"/g, '""')}"`;
}

async function handle(req, res) {
    try {
        const body = await parseJsonBody(req);
        const rawMessages = Array.isArray(body.messages) ? body.messages : [];

        const apiKey = process.env.GEMINI_API_KEY;
        const configuredModel = process.env.GEMINI_MODEL;
        const fallbackModels = [
            configuredModel,
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite'
        ].filter((value, index, array) => value && array.indexOf(value) === index);

        if (!apiKey) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: '伺服器未設定 GEMINI_API_KEY' }));
        }

        const contents = rawMessages
            .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'model')
            .map(m => ({
                role: (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user',
                parts: [{ text: String(m.content || '').trim() }]
            }))
            .filter(m => m.parts[0].text);

        if (!contents.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: '請提供有效的訊息內容' }));
        }

        let lastError = null;

        for (const model of fallbackModels) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

                const geminiResponse = await fetch(geminiApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{
                                text: `你是一個專業、親切的網站 AI 客服助手。
                                你的任務是解答使用者關於我們工具的問題。
                                請遵守以下原則：
                                1. 語氣保持禮貌、專業且簡潔。
                                2. 如果不確定或無法回答，請引導使用者聯繫真人客服。
                                3. 嚴禁回答與本產品無關的政治、娛樂等話題。`
                            }]
                        },
                        contents: contents,
                        generationConfig: {
                            temperature: 0.5
                        }
                    })
                });

                clearTimeout(timeoutId);

                const responseText = await geminiResponse.text();
                let payload;
                try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = {}; }

                if (!geminiResponse.ok) {
                    const errorMessage = payload?.error?.message || 'Gemini API 請求失敗';
                    lastError = errorMessage;
                    const isModelUnavailable = /not available|model .* no longer available|unsupported model|not found/i.test(errorMessage);
                    if (!isModelUnavailable) {
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: errorMessage }));
                    }
                    continue;
                }

                const answer = payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '抱歉，AI 沒有回覆內容。';

                // ==========================================
                // 🌟 新增：將對話紀錄寫入 CSV 試算表
                // ==========================================
                try {
                    const userMessage = [...contents].reverse().find(m => m.role === 'user')?.parts[0]?.text || '未知問題';
                    const timeString = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
                    const logPath = path.join(__dirname, 'chat_logs.csv');

                    // 準備要寫入的一行資料 (時間, 問題, 回答)
                    const csvLine = `${escapeCSV(timeString)},${escapeCSV(userMessage)},${escapeCSV(answer)}\n`;

                    // 如果檔案不存在，先建立檔案並寫入標題列 (Header)
                    if (!fs.existsSync(logPath)) {
                        const header = '\uFEFF時間,使用者問題,AI回答\n'; // \uFEFF 是 BOM，讓 Excel 開啟時不會中文亂碼
                        fs.writeFileSync(logPath, header);
                    }

                    // 將資料附加到檔案最後
                    fs.appendFile(logPath, csvLine, (err) => {
                        if (err) console.error('⚠️ 寫入 CSV 失敗:', err);
                        else console.log(`✅ 紀錄已存入試算表 chat_logs.csv`);
                    });
                } catch (csvError) {
                    console.error('⚠️ 處理 CSV 紀錄時發生錯誤:', csvError);
                }
                // ==========================================

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, answer }));
            } catch (error) {
                lastError = error?.message || 'AI 聊天服務發生錯誤';
                if (error?.name === 'AbortError') {
                    res.writeHead(504, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'AI 伺服器回應超時，請稍後再試。' }));
                }
            }
        }

        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: lastError || 'Gemini API 請求失敗' }));
    } catch (error) {
        console.error('❌ Gemini AiService error:', error);

        if (error.name === 'AbortError') {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'AI 伺服器回應超時，請稍後再試。' }));
        }

        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'AI 聊天服務發生錯誤' }));
    }
}

module.exports = { handle };