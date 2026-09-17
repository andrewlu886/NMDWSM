// --- AiService.js (NLP.js 輕量版) ---
const fs = require('fs');
const path = require('path');
const { isBodyTooLarge, parseJsonBody } = require('./json-body');

let NlpManager;
let manager;

try {
    const nlp = require('node-nlp');
    NlpManager = nlp.NlpManager;
    manager = new NlpManager({ languages: ['zh'], forceNER: true });
} catch (error) {
    console.warn('⚠️ node-nlp 未安裝或無法載入，AIService 轉為關鍵字型備援回應。');
}

let isModelTrained = false;

function fallbackAnswerForUserMessage(userMessage) {
    const text = String(userMessage || '').trim();
    const normalized = text.toLowerCase();

    // 打招呼與身分詢問的關鍵字判斷
    if (/你好|您好|嗨|哈囉|有人在嗎|早安|午安|晚安|你是誰|你是啥|你是什麼|自我介紹|機器人|客服/.test(normalized)) {
        return '您好！我是網站的專屬導遊，有什麼電腦零件估價或行情查詢的需求，都可以問我喔！';
    }

    // 感謝與道別的關鍵字判斷
    if (/謝謝|感謝|感恩|拜拜|再見|掰掰/.test(normalized)) {
        return '不會！很高興能為您服務。如果有其他問題，隨時歡迎再來找我喔！';
    }

    // 裝機、推薦、組裝等關鍵字
    if (/估價|價錢|價格|價格估算|幾錢|多少|裝機|組裝|推薦|菜單|配電腦/.test(normalized)) {
        return '需要估算電腦零件的價格或尋找裝機推薦嗎？請點擊這裡：[點此前往零件估價工具](/valuation)';
    }

    if (/行情|市價|市場價格|價格查詢|買賣|價格/.test(normalized)) {
        return '想了解最新的市場行情嗎？[點此前往市價查詢](/scrape)';
    }

    if (/瓦數|電源|供應器|電供/.test(normalized)) {
        return '若需計算電源供應器瓦數：[點此前往瓦數計算工具](/tools)';
    }

    if (/手機|平板|筆電|筆記型電腦/.test(normalized)) {
        return '非常抱歉，目前我們僅針對電腦零件提供估價喔！[點此前往零件估價工具](/valuation)';
    }

    // 更人性化的兜底回覆
    return '不好意思，這部分超出了我的專業範圍😅。我能幫助你跳轉到電腦零件的估價、裝機推薦與行情查詢，您要不要試試看問我這類的問題呢？';
}

// 定義並訓練對話模型
async function trainNlpModel() {
    if (!manager || isModelTrained) return;

    // 打招呼與身分詢問意圖
    manager.addDocument('zh', '你好', 'intent.greeting');
    manager.addDocument('zh', '您好', 'intent.greeting');
    manager.addDocument('zh', '嗨', 'intent.greeting');
    manager.addDocument('zh', '哈囉', 'intent.greeting');
    manager.addDocument('zh', '有人在嗎', 'intent.greeting');
    manager.addDocument('zh', '早安', 'intent.greeting');
    manager.addDocument('zh', '午安', 'intent.greeting');
    manager.addDocument('zh', '晚安', 'intent.greeting');
    manager.addDocument('zh', '你是誰', 'intent.greeting');
    manager.addDocument('zh', '你是啥', 'intent.greeting');
    manager.addDocument('zh', '你是什麼', 'intent.greeting');
    manager.addDocument('zh', '自我介紹一下', 'intent.greeting');
    manager.addDocument('zh', '你是機器人嗎', 'intent.greeting');
    manager.addDocument('zh', '你是客服嗎', 'intent.greeting');
    manager.addDocument('zh', '所以你是啥', 'intent.greeting');
    manager.addAnswer('zh', 'intent.greeting', '您好！我是網站的專屬導遊，有什麼電腦零件估價或行情查詢的需求，都可以問我喔！');

    // 感謝與道別意圖
    manager.addDocument('zh', '謝謝', 'intent.thanks');
    manager.addDocument('zh', '感謝', 'intent.thanks');
    manager.addDocument('zh', '感恩', 'intent.thanks');
    manager.addDocument('zh', '拜拜', 'intent.thanks');
    manager.addDocument('zh', '再見', 'intent.thanks');
    manager.addDocument('zh', '掰掰', 'intent.thanks');
    manager.addAnswer('zh', 'intent.thanks', '不會！很高興能為您服務。如果有其他問題，隨時歡迎再來找我喔！');

    // 零件估價與裝機推薦意圖
    manager.addDocument('zh', '我想估價', 'intent.valuation');
    manager.addDocument('zh', '顯示卡', 'intent.valuation');
    manager.addDocument('zh', 'CPU', 'intent.valuation');
    manager.addDocument('zh', 'GPU', 'intent.valuation');
    manager.addDocument('zh', '主機板', 'intent.valuation');
    manager.addDocument('zh', '滑鼠鍵盤', 'intent.valuation');
    manager.addDocument('zh', '電腦零件', 'intent.valuation');

    // 新增裝機與推薦相關詞彙
    manager.addDocument('zh', '電腦裝機', 'intent.valuation');
    manager.addDocument('zh', '我想找電腦裝機', 'intent.valuation');
    manager.addDocument('zh', '組裝電腦', 'intent.valuation');
    manager.addDocument('zh', '智慧推薦', 'intent.valuation');
    manager.addDocument('zh', '推薦電腦', 'intent.valuation');
    manager.addDocument('zh', '電腦菜單', 'intent.valuation');
    manager.addDocument('zh', '幫我配電腦', 'intent.valuation');
    manager.addAnswer('zh', 'intent.valuation', '需要估算電腦零件的價格或尋找裝機推薦嗎？請點擊這裡：[點此前往零件估價工具](/valuation)');

    // 市價查詢意圖
    manager.addDocument('zh', '市場價格', 'intent.scrape');
    manager.addDocument('zh', '市價', 'intent.scrape');
    manager.addDocument('zh', '行情', 'intent.scrape');
    manager.addAnswer('zh', 'intent.scrape', '想了解最新的市場行情嗎？[點此前往市價查詢](/scrape)');

    // 瓦數計算意圖
    manager.addDocument('zh', '瓦數計算', 'intent.tools');
    manager.addDocument('zh', '電源供應器', 'intent.tools');
    manager.addDocument('zh', '電供', 'intent.tools');
    manager.addAnswer('zh', 'intent.tools', '若需計算電源供應器瓦數：[點此前往瓦數計算工具](/tools)');

    // 不支援的產品 (邊界管控)
    manager.addDocument('zh', '手機', 'intent.unsupported');
    manager.addDocument('zh', '平板', 'intent.unsupported');
    manager.addDocument('zh', '筆電', 'intent.unsupported');
    manager.addDocument('zh', '筆記型電腦', 'intent.unsupported');
    manager.addAnswer('zh', 'intent.unsupported', '非常抱歉，目前我們僅針對電腦零組件提供估價喔！[點此前往零件估價工具](/valuation)');

    // 無關意圖，邊界管控
    manager.addDocument('zh', '誰是', 'intent.none');
    manager.addDocument('zh', '這是什麼', 'intent.none');
    manager.addDocument('zh', '天氣', 'intent.none');
    manager.addAnswer('zh', 'intent.none', '不好意思，這部分超出了我的專業範圍😅。我能幫助你跳轉到電腦零組件的估價、裝機推薦與行情查詢，您要不要試試看問我這類的問題呢？');

    try {
        await manager.train();
        manager.save();
        isModelTrained = true;
        console.log('✅ 輕量級 NLP 模型訓練完成');
    } catch (error) {
        console.warn('⚠️ NLP 模型訓練失敗，將使用詞彙備援回應。');
        isModelTrained = true;
    }
}

function escapeCSV(text) {
    if (!text) return '""';
    return `"${String(text).replace(/"/g, '""')}"`;
}

async function handle(req, res) {
    try {
        let body;
        try {
            body = await parseJsonBody(req);
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            body = {};
        }
        const rawMessages = Array.isArray(body.messages) ? body.messages : [];
        
        // 取得使用者最後一句話作為 NLP 的判斷依據
        const userMessage = [...rawMessages].reverse().find(m => m.role === 'user')?.content || '';

        if (!userMessage) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: '請提供有效的訊息內容' }));
        }

        // 確保模型已經訓練完畢
        await trainNlpModel();

        let answer = fallbackAnswerForUserMessage(userMessage);

        if (manager) {
            try {
                const response = await manager.process('zh', userMessage);
                
                // 若意圖為 None 或信心分數 (score) 低於 0.6，強制使用兜底回覆避免亂猜
                if (response.intent === 'None' || response.score < 0.6) {
                    answer = fallbackAnswerForUserMessage(userMessage);
                } else {
                    answer = response.answer || fallbackAnswerForUserMessage(userMessage);
                }
            } catch (error) {
                console.warn('⚠️ NLP 執行失敗，改用關鍵字備援回答。');
                answer = fallbackAnswerForUserMessage(userMessage);
            }
        }

        // 寫入 CSV 的對話紀錄
        try {
            const timeString = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            const logPath = path.join(__dirname, 'chat_logs.csv');
            const csvLine = `${escapeCSV(timeString)},${escapeCSV(userMessage)},${escapeCSV(answer)}\n`;
            if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '\uFEFF時間,使用者問題,AI回答\n');
            fs.appendFile(logPath, csvLine, () => {});
        } catch (e) {}

        // 回傳給前端
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, answer }));

    } catch (error) {
        console.error('❌ NLP 服務發生錯誤:', error);
        res.writeHead(isBodyTooLarge(error) ? 413 : 500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: false,
            message: isBodyTooLarge(error) ? error.message : '系統錯誤'
        }));
    }
}

module.exports = { handle };
