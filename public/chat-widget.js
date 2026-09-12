(function () {
    // --- 0. 動態注入 CSS 樣式 ---
    const style = document.createElement('style');
    style.innerHTML = `
        /* 按鈕樣式：用於將 Markdown 連結轉換為視覺化導航按鈕 */
        .ai-valuation-btn {
            display: inline-block;
            margin-top: 8px;
            padding: 8px 16px;
            background-color: #2563eb; /* 主題藍色 */
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            text-align: center;
            transition: background-color 0.2s ease, transform 0.1s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            cursor: pointer;
        }
        
        .ai-valuation-btn:hover {
            background-color: #1d4ed8;
            transform: translateY(-1px);
        }
        
        .ai-valuation-btn:active {
            transform: translateY(1px);
        }

        /* 確保連結換行，視覺上更像獨立按鈕 */
        .ai-chat-message.assistant p a.ai-valuation-btn {
            display: block;
            width: fit-content;
        }

        /* 建議問題的特殊樣式 */
        .suggestion-btn {
            background-color: #f3f4f6;
            color: #374151 !important;
            border: 1px solid #d1d5db;
            margin-right: 8px;
            margin-bottom: 8px;
            font-size: 13px;
        }
        
        .suggestion-btn:hover {
            background-color: #e5e7eb;
            color: #1f2937 !important;
        }
    `;
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.className = 'ai-chat-widget';
    
    // 1. 修改 HTML：渲染 UI 結構
    widget.innerHTML = `
        <section class="ai-chat-panel" id="ai-chat-panel" aria-label="網站導遊" aria-hidden="true">
            <header class="ai-chat-header">
                <div class="ai-chat-heading">
                    <span class="ai-chat-avatar" aria-hidden="true">專業</span>
                    <div>
                        <strong> 網站導遊</strong>
                        <span style="color: #4ade80;"><i aria-hidden="true">●</i> 為您效勞</span>
                    </div>
                </div>
                <button class="ai-chat-close" type="button" aria-label="關閉 AI 對話框">&times;</button>
            </header>

            <div class="ai-chat-messages" aria-live="polite">
                <div class="ai-chat-message assistant">
                    <span class="ai-chat-message-avatar" aria-hidden="true">專業</span>
                    <div class="message-content">
                        <p>您好！我是網站的內建客服助手，請問有什麼我可以幫忙的嗎？</p>
                        <p style="font-size: 13px; color: #666; margin-top: 8px;">您可以試著點擊下方按鈕，或是在聊天欄直接輸入問題：</p>
                        <div class="suggestions-container" style="margin-top: 8px;">
                            <button class="ai-valuation-btn suggestion-btn" data-query="我想估價顯示卡" type="button">我想估價顯示卡</button>
                            <button class="ai-valuation-btn suggestion-btn" data-query="查詢最近的硬體行情" type="button">查詢最近的硬體行情</button>
                            <button class="ai-valuation-btn suggestion-btn" data-query="我要計算電源供應器瓦數" type="button">我要計算電源供應器瓦數</button>
                        </div>
                    </div>
                </div>
            </div>

            <form class="ai-chat-form">
                <label class="sr-only" for="ai-chat-input">輸入訊息</label>
                <textarea id="ai-chat-input" rows="1" maxlength="500" placeholder="輸入您的問題……"></textarea>
                <button type="submit" aria-label="傳送訊息">傳送</button>
            </form>
        </section>

        <button class="ai-chat-launcher" type="button" aria-label="開啟 AI 對話框" aria-controls="ai-chat-panel" aria-expanded="false">
            <span class="ai-chat-launcher-icon" aria-hidden="true"></span>
        </button>
    `;

    document.body.appendChild(widget);

    const panel = widget.querySelector('.ai-chat-panel');
    const launcher = widget.querySelector('.ai-chat-launcher');
    const closeButton = widget.querySelector('.ai-chat-close');
    const form = widget.querySelector('.ai-chat-form');
    const input = widget.querySelector('#ai-chat-input');
    const messages = widget.querySelector('.ai-chat-messages');
    const submitBtn = form.querySelector('button[type="submit"]');

    // 記錄對話歷史的陣列
    let chatHistory = [];

    // --- 綁定建議問題按鈕的點擊事件 ---
    document.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const query = e.target.getAttribute('data-query');
            input.value = query;
            form.requestSubmit(); // 點擊後直接送出
        });
    });

    function setOpen(isOpen) {
        widget.classList.toggle('is-open', isOpen);
        panel.setAttribute('aria-hidden', String(!isOpen));
        launcher.setAttribute('aria-expanded', String(isOpen));
        launcher.setAttribute('aria-label', isOpen ? '關閉 AI 對話框' : '開啟 AI 對話框');

        if (isOpen) {
            window.setTimeout(() => input.focus(), 120);
        }
    }

    launcher.addEventListener('click', () => {
        setOpen(!widget.classList.contains('is-open'));
    });

    closeButton.addEventListener('click', () => {
        setOpen(false);
        launcher.focus();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && widget.classList.contains('is-open')) {
            setOpen(false);
            launcher.focus();
        }
    });

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
        }
    });

    // 處理表單送出邏輯，串接後端 /api/chat
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = input.value.trim();

        if (!text) return;

        // --- 1. 顯示使用者的訊息 ---
        const userMessage = document.createElement('div');
        userMessage.className = 'ai-chat-message user';
        const userText = document.createElement('p');
        userText.textContent = text;
        userMessage.appendChild(userText);
        messages.appendChild(userMessage);

        // 將使用者訊息加入歷史紀錄
        chatHistory.push({ role: 'user', content: text });

        // 清空輸入框、還原高度、捲動到底部
        input.value = '';
        input.style.height = 'auto';
        messages.scrollTop = messages.scrollHeight;

        // 鎖定輸入框，防止重複發送
        input.disabled = true;
        submitBtn.disabled = true;

        // 顯示「思考中...」提示
        const loadingMessage = document.createElement('div');
        loadingMessage.className = 'ai-chat-message assistant';
        loadingMessage.innerHTML = '<span class="ai-chat-message-avatar" aria-hidden="true">專業</span><p class="loading-text">思考中...</p>';
        messages.appendChild(loadingMessage);
        messages.scrollTop = messages.scrollHeight;

        try {
            // --- 2. 發送請求到後端 (只發送最後 20 則歷史，避免 Token 過長) ---
            const payloadMessages = chatHistory.slice(-20);
            const apiUrl = (window.location && window.location.origin ? window.location.origin : '') + '/api/chat';
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ messages: payloadMessages })
            });

            let data;
            try {
                data = await response.json();
            } catch (e) {
                const rawText = await response.text().catch(() => '無法讀取回應');
                throw new Error(`伺服器回應非 JSON (status ${response.status}): ${rawText}`);
            }

            // 移除思考中訊息
            if (loadingMessage.parentNode) {
                messages.removeChild(loadingMessage);
            }

            // --- 3. 顯示 AI 的回覆與解析 Markdown 按鈕 ---
            const aiMessage = document.createElement('div');
            aiMessage.className = 'ai-chat-message assistant';
            
            const aiText = document.createElement('p');
            aiText.style.whiteSpace = 'pre-wrap'; 

            if (data.success) {
                const escapeHTML = (str) => {
                    const div = document.createElement('div');
                    div.textContent = str;
                    return div.innerHTML;
                };
                
                let safeHTML = escapeHTML(data.answer);
                
                safeHTML = safeHTML.replace(
                  /\[([^\]]+)\]\(([^)]+)\)/g, 
                   '<a href="$2" class="ai-valuation-btn">$1</a>'
                );

                aiText.innerHTML = safeHTML;
                chatHistory.push({ role: 'assistant', content: data.answer });
            } else {
                let errText = data.message;
                if (errText && (errText.includes('high demand') || errText.includes('Spikes in demand') || errText.includes('502'))) {
                   errText = '目前 AI 客服線路較忙碌，請稍等幾分鐘後再試一次喔！';
                }
    
                aiText.textContent = `⚠️ 發生錯誤：${errText}`;
                chatHistory.pop(); 
            }
            aiMessage.innerHTML = '<span class="ai-chat-message-avatar" aria-hidden="true">專業</span>';
            aiMessage.appendChild(aiText);
            messages.appendChild(aiMessage);

        } catch (error) {
            console.error('API 請求失敗:', error);
            if (loadingMessage.parentNode) {
                messages.removeChild(loadingMessage);
            }
            chatHistory.pop(); 

            const errorMessage = document.createElement('div');
            errorMessage.className = 'ai-chat-message assistant';
            const errText = (error && error.message) ? `⚠️ 無法連線到伺服器：${error.message}` : '⚠️ 無法連線到伺服器，請確認網路或稍後再試。';
            errorMessage.innerHTML = `<span class="ai-chat-message-avatar" aria-hidden="true">專業</span><p>${errText}</p>`;
            messages.appendChild(errorMessage);
        } finally {
            input.disabled = false;
            submitBtn.disabled = false;
            input.focus();
            messages.scrollTop = messages.scrollHeight;
        }
    });
})();