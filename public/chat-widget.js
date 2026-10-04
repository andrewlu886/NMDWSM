/* eslint-env browser */
(function () {
    // 動態注入 CSS 樣式
    const style = document.createElement('style');
    style.innerHTML = `
        /* 按鈕樣式：用於將 Markdown 連結轉換為視覺化導航按鈕 */
        .ai-valuation-btn {
            display: inline-block;
            margin-top: 8px;
            padding: 8px 16px;
            background-color: var(--ai-chat-accent, #36a9e1);
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
            background-color: var(--ai-chat-accent-hover, #258fc5);
            transform: translateY(-1px);
        }
        
        .ai-valuation-btn:active {
            transform: translateY(1px);
        }

        /* 確保連結換行 */
        .ai-chat-message.assistant p a.ai-valuation-btn {
            display: block;
            width: fit-content;
        }

        .ai-chat-message.assistant a.ai-product-link {
            color: #0066cc;
            text-decoration: underline;
            text-underline-offset: 2px;
            overflow-wrap: anywhere;
        }
        .ai-chat-message.assistant a.ai-product-link:hover {
            color: #004999;
        }
        .ai-chat-message.assistant a.ai-product-link:focus-visible {
            outline: 2px solid #0066cc;
            outline-offset: 2px;
        }

        /* 建議問題的特殊樣式 */
        .suggestion-btn {
            background-color: var(--ai-chat-accent-soft, #eaf7ff);
            color: #28658a !important;
            border: 1px solid #c5e9fa;
            margin-right: 8px;
            margin-bottom: 8px;
            font-size: 13px;
        }
        
        .suggestion-btn:hover {
            background-color: #d8f0fc;
            color: #204f6c !important;
        }

        .ai-chat-attach {
            padding: 8px 10px;
            border: 1px solid transparent;
            border-radius: 10px;
            background: var(--ai-chat-accent);
            color: #fff;
            cursor: pointer;
            font: inherit;
            font-size: 12px;
            white-space: nowrap;
        }
        .ai-chat-attach:hover { background: var(--ai-chat-accent-hover); }

        .ai-chat-preview {
            display: none;
            align-items: center;
            gap: 9px;
            padding: 8px 13px;
            border-top: 1px solid #e6ebef;
            background: #fff;
            color: #475569;
            font-size: 12px;
        }

        .ai-chat-preview.is-visible { display: flex; }
        .ai-chat-preview img { width: 42px; height: 42px; border-radius: 7px; object-fit: cover; }
        .ai-chat-preview button { margin-left: auto; border: 0; background: transparent; color: #64748b; cursor: pointer; }
        .ai-chat-edit { margin: 0 0 4px 35px; padding: 3px 7px; border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 11px; }
        .ai-chat-message-editor { display: grid; gap: 8px; width: 100%; max-width: 100%; box-sizing: border-box; }
        .ai-chat-message-editor textarea { width: 100%; min-height: 90px; box-sizing: border-box; resize: vertical; padding: 10px 12px; border: 1px solid #94a3b8; border-radius: 10px; background: #fff; color: #314052; font: inherit; }
        .ai-chat-edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .ai-chat-edit-actions button { padding: 7px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #314052; font: inherit; cursor: pointer; }
        .ai-chat-edit-actions button:first-child { border-color: var(--ai-chat-accent, #36a9e1); background: var(--ai-chat-accent, #36a9e1); color: #fff; }
        .ai-chat-message.user { align-items: center; }
        .ai-chat-message.user > img { flex: 0 0 auto; }
        .ai-chat-message.user > small { flex: 0 1 110px; overflow-wrap: anywhere; }
        .ai-chat-message.user > p { min-width: 0; overflow-wrap: anywhere; }
        .ai-chat-avatar, .ai-chat-message-avatar { background: #fff; border-radius: 50%; overflow: hidden; }
        .ai-chat-avatar img, .ai-chat-message-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
        .ai-chat-status > i { display: block; flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; }
        .ai-chat-status[data-available="true"] > i { background: #22c55e; }
        .ai-chat-launcher, .ai-chat-launcher:hover { background: #fff; overflow: hidden; box-shadow: none; }
        .ai-chat-launcher-icon { display: block; width: 100%; height: 100%; border: 0; border-radius: 50%; overflow: hidden; background: #fff; }
        .ai-chat-launcher-icon::after { display: none; }
        .ai-chat-launcher-icon img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center top; }
        .ai-chat-idle-prompt { position: fixed; right: 24px; bottom: 98px; width: min(300px, calc(100vw - 32px)); box-sizing: border-box; display: flex; align-items: flex-start; gap: 4px; padding: 14px; border: 1px solid #bfe7fa; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px rgba(35, 94, 135, 0.18); pointer-events: auto; }
        .ai-chat-idle-prompt[hidden] { display: none; }
        .ai-chat-idle-prompt:not([hidden]) { animation: ai-idle-pop 280ms ease-out; }
        @keyframes ai-idle-pop { from { opacity: 0; transform: translateY(12px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @media (prefers-reduced-motion: reduce) { .ai-chat-idle-prompt:not([hidden]) { animation: none; } }
        .ai-chat-idle-prompt::after { content: ''; position: absolute; right: 22px; bottom: -7px; width: 12px; height: 12px; background: #fff; border-right: 1px solid #bfe7fa; border-bottom: 1px solid #bfe7fa; transform: rotate(45deg); }
        .ai-chat-idle-text { flex: 1; border: 0; padding: 0; background: transparent; color: #28658a; font: inherit; font-size: 14px; line-height: 1.6; text-align: left; cursor: pointer; }
        .ai-chat-idle-close { border: 0; padding: 0 3px; background: transparent; color: #64748b; font-size: 20px; cursor: pointer; }
        @media (max-width: 600px) { .ai-chat-idle-prompt { right: 16px; bottom: 90px; } }
        .ai-chat-user-group { display: flex; width: 100%; box-sizing: border-box; flex-direction: column; align-items: flex-end; align-self: flex-end; max-width: 100%; }
        .ai-chat-response { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; align-items: stretch; gap: 8px; }
        .ai-chat-response > p { width: fit-content; max-width: 100%; box-sizing: border-box; }
        .ai-image-actions { display: flex; width: 100%; box-sizing: border-box; flex-wrap: nowrap; gap: 8px; }
        .ai-image-actions button, .ai-image-actions a { display: block; min-width: 0; flex: 1 1 0; border: 0; border-radius: 8px; padding: 9px 8px; background: var(--ai-chat-accent); color: #fff !important; font: inherit; font-size: 13px; text-align: center; text-decoration: none; white-space: nowrap; cursor: pointer; }
        .ai-image-actions button:hover, .ai-image-actions a:hover { background: var(--ai-chat-accent-hover); }
        .ai-counterpart-form { display: grid; gap: 8px; margin-top: 10px; }
        .ai-counterpart-form input, .ai-counterpart-form select { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
        .ai-valuation-wizard { display: grid; gap: 8px; margin-top: 10px; padding: 12px; border: 1px solid #dbe4ee; border-radius: 10px; background: #f8fafc; }
        .ai-valuation-wizard label { display: grid; gap: 4px; color: #334155; font-size: 12px; font-weight: 600; }
        .ai-valuation-wizard input, .ai-valuation-wizard select { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #1e293b; font: inherit; font-size: 13px; }
        .ai-valuation-wizard button, .ai-valuation-result a { display: inline-block; padding: 9px 12px; border: 0; border-radius: 8px; background: var(--ai-chat-accent); color: #fff !important; font: inherit; font-size: 13px; text-align: center; text-decoration: none; cursor: pointer; }
        .ai-valuation-wizard button:disabled { opacity: 0.65; cursor: wait; }
        .ai-valuation-wizard .ai-valuation-error { margin: 0; color: #b91c1c; font-size: 12px; }
        .ai-valuation-result { display: grid; gap: 8px; margin-top: 10px; }
        .ai-valuation-result p { margin: 0; }
    `;
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.className = 'ai-chat-widget';

    // 修改 HTML：渲染 UI 結構
    widget.innerHTML = `
        <section class="ai-chat-panel" id="ai-chat-panel" aria-label="ai小幫手-紀亦緹" aria-hidden="true">
            <header class="ai-chat-header">
                <div class="ai-chat-heading">
                    <span class="ai-chat-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>
                    <div>
                    <strong>ai小幫手-紀亦緹</strong>
                        <span class="ai-chat-status" data-available="false" role="status"><i aria-hidden="true"></i><span>下線</span></span>
                    </div>
                </div>
                <div class="ai-chat-header-actions">
                    <button class="ai-chat-close" type="button" aria-label="關閉 AI 對話框">&times;</button>
                </div>
            </header>

            <div class="ai-chat-messages" aria-live="polite">
                <div class="ai-chat-message assistant">
                    <span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>
                    <div class="message-content">
<p>嗨，我是紀亦緹！想查價格、估二手價、配電腦或算瓦數，都可以直接跟我說。也可以傳硬體照片；型號看不清楚時，我會再跟你確認。</p>
                    </div>
                </div>
            </div>
            

            <div class="ai-chat-preview" aria-live="polite"></div>
            <form class="ai-chat-form">
                <label class="sr-only" for="ai-chat-input">輸入訊息</label>
                <textarea id="ai-chat-input" rows="1" maxlength="500" placeholder="輸入您的問題……"></textarea>
                <input id="ai-chat-image" type="file" accept="image/jpeg,image/png,image/webp" hidden>
                <button class="ai-chat-attach" type="button" aria-label="圖片查詢">圖片查詢</button>
                <button type="submit" aria-label="傳送訊息">傳送</button>
            </form>
        </section>
        <button class="ai-chat-launcher" type="button" aria-label="開啟 AI 助手" aria-controls="ai-chat-panel" aria-expanded="false">
            <span class="ai-chat-launcher-icon" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>
        </button>
        <aside class="ai-chat-idle-prompt" hidden aria-live="polite" aria-label="ai小幫手-紀亦緹的提示">
            <button class="ai-chat-idle-text" type="button">看來你遇到困難了，有什麼心事想和姐姐說嗎?</button>
            <button class="ai-chat-idle-close" type="button" aria-label="關閉提示">&times;</button>
        </aside>
    `;

    document.body.appendChild(widget);

    const panel = widget.querySelector('.ai-chat-panel');
    const launcher = widget.querySelector('.ai-chat-launcher');
    const closeButton = widget.querySelector('.ai-chat-close');
    const form = widget.querySelector('.ai-chat-form');
    const input = widget.querySelector('#ai-chat-input');
    const messages = widget.querySelector('.ai-chat-messages');
    const submitBtn = form.querySelector('button[type="submit"]');
    const statusLabel = widget.querySelector('.ai-chat-status');
    const imageInput = widget.querySelector('#ai-chat-image');
    const attachButton = widget.querySelector('.ai-chat-attach');
    const imagePreview = widget.querySelector('.ai-chat-preview');
    let pendingImage = null;
    let powerFlow = null;
    const powerApiReady = import('/psu-flow.js?v=20261003').then(() => window.PsuFlow).catch(() => {
        throw new Error('瓦數計算暫時無法載入，請重新整理後再試。');
    });
    // Attach a handler immediately; a failed load is also reported when the flow is used.
    powerApiReady.catch(() => {});
    let valuationFlow = null;
    let recommendationFlow = null;
    let marketQueryActive = false;
    let cancelActiveMessageEdit = null;
    const idlePrompt = widget.querySelector('.ai-chat-idle-prompt');
    let idlePromptTimer;
    function resetIdlePromptTimer() {
        window.clearTimeout(idlePromptTimer);
        if (document.hidden || widget.classList.contains('is-open')) return;
        idlePromptTimer = window.setTimeout(() => {
            if (!document.hidden && !widget.classList.contains('is-open')) idlePrompt.hidden = false;
        }, 20000);
    }
    for (const eventName of ['pointermove', 'pointerdown', 'wheel', 'keydown']) {
        document.addEventListener(eventName, resetIdlePromptTimer, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
        idlePrompt.hidden = true;
        resetIdlePromptTimer();
    });
    idlePrompt.querySelector('.ai-chat-idle-text').addEventListener('click', () => setOpen(true));
    idlePrompt.querySelector('.ai-chat-idle-close').addEventListener('click', () => {
        idlePrompt.hidden = true;
        resetIdlePromptTimer();
    });

    async function refreshAiStatus() {
        let online = false;
        try {
            const response = await fetch('/api/chat/status', { signal: AbortSignal.timeout(7000), cache: 'no-store' });
            if (response.ok) {
                const status = await response.json();
                online = Boolean(status.available && status.modelInstalled && status.visionModelInstalled);
            }
        } catch {
            // Unreachable or missing models are shown as offline.
        }
        statusLabel.dataset.available = String(online);
        statusLabel.querySelector('span').textContent = online ? '上線中' : '下線';
    }
    refreshAiStatus();
    window.setInterval(refreshAiStatus, 60000);

    const historyStorageKey = 'nmdwsm-ai-chat-history';
    const interfaceStorageKey = 'nmdwsm-ai-chat-interface';
    function isStaleOffTopicRecommendation(message) {
        return message.role === 'assistant'
            && /(?:依照|根據)預算/.test(message.content)
            && /\[[^\]]+\]\([^)]+\)/.test(message.content)
            && /鏈鋸|電鋸|電剪|電鑽|電動工具|手持工具|砂輪機|修剪機|吹葉機|割草機/i.test(message.content);
    }
    let chatHistory = [];
    let removedStaleRecommendation = false;
    let savedInterfaceState = { isOpen: false, recommendationText: '' };
    try {
        const navigation = window.performance?.getEntriesByType?.('navigation')?.[0];
        const isReload = navigation
            ? navigation.type === 'reload'
            : window.performance?.navigation?.type === 1;
        if (isReload) {
            sessionStorage.removeItem(historyStorageKey);
            sessionStorage.removeItem(interfaceStorageKey);
        }
        const storedHistory = JSON.parse(sessionStorage.getItem(historyStorageKey) || '[]');
        if (Array.isArray(storedHistory)) {
            chatHistory = storedHistory
                .filter(item => ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
                .filter(item => {
                    if (!isStaleOffTopicRecommendation(item)) return true;
                    removedStaleRecommendation = true;
                    return false;
                })
                .slice(-40)
                .map(item => ({ ...item, imageData: null, previewUrl: '' }));
        }
        const storedInterfaceState = JSON.parse(sessionStorage.getItem(interfaceStorageKey) || '{}');
        savedInterfaceState = {
            isOpen: Boolean(storedInterfaceState.isOpen),
            isExpanded: Boolean(storedInterfaceState.isExpanded),
            powerFlow: storedInterfaceState.powerFlow || null,
            marketQueryActive: Boolean(storedInterfaceState.marketQueryActive),
            recommendationText: typeof storedInterfaceState.recommendationText === 'string'
                ? storedInterfaceState.recommendationText
                : ''
        };
    } catch {
        chatHistory = [];
    }
    powerFlow = savedInterfaceState.powerFlow;
    marketQueryActive = Boolean(savedInterfaceState.marketQueryActive);
    if (savedInterfaceState.recommendationText) {
        recommendationFlow = { text: savedInterfaceState.recommendationText };
    }

    function persistChatHistory() {
        try {
            const savedHistory = chatHistory.slice(-40).map(({ role, content, displayContent, imageName, imageAnalysis, thumbnailUrl }) => ({
                role,
                content,
                displayContent,
                thumbnailUrl: thumbnailUrl || '',
                imageName: imageName || '',
                imageAnalysis: imageAnalysis || ''
            }));
            sessionStorage.setItem(historyStorageKey, JSON.stringify(savedHistory));
        } catch {
            statusLabel.title = '瀏覽器無法保留聊天紀錄';
        }
    }
    if (removedStaleRecommendation) persistChatHistory();

    function latestProductKeyword(currentAnswer = '') {
        const patterns = [
            /\b(?:RTX|GTX)\s*\d{4}\s*(?:(?:TI|SUPER)\b)?/gi,
            /\bRX\s*\d{4}\s*(?:(?:XT|XTX|GRE)\b)?/gi,
            /\b(?:INTEL\s+)?CORE\s+ULTRA\s+[3579]\s+\d{3,4}[A-Z]{0,3}\b/gi,
            /\b(?:CORE\s*)?I[3579][-\s]*\d{4,5}[A-Z]{0,3}\b/gi,
            /\b(?:RYZEN\s*)?[3579][-\s]*\d{4}[A-Z\d]{0,5}\b/gi,
            /\b(?:B|Z|X|H)\d{3}(?:[-\s][A-Z\d]+)?\b/gi,
            /\bDDR[45](?:[-\s]?\d{4})?\b/gi,
            /\b\d{4}\s*(?:TI|SUPER|XT|XTX|GRE)?\b/gi
        ];
        const messagesToSearch = currentAnswer
            ? [{ content: currentAnswer }, ...[...chatHistory].reverse()]
            : [...chatHistory].reverse();
        for (const message of messagesToSearch) {
            const text = `${message.displayContent || ''}\n${message.content || ''}`;
            const matches = patterns.flatMap(pattern => [...text.matchAll(pattern)]);
            if (matches.length) {
                matches.sort((left, right) => right.index - left.index);
                return matches[0][0].replace(/\s+/g, ' ').trim();
            }
        }
        return null;
    }

    function renderAssistantAnswer(answer, suppressMarketAction = false) {
        const escapeHTML = str => {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        };
        // Hide unrelated tool shortcuts, including replies restored from history.
        const cleanedAnswer = String(answer)
            .replace(/(?:^[ \t]*[-*]\s*)?\[(?:[^\]]+)\]\(\/(?:valuation|recommend)(?:\?[^)]*)?\)[ \t]*/gm, '')
            .replace(/^[ \t]*(?:\*\*)?相關工具頁連結\s*[：:](?:\*\*)?[ \t]*$/gm, '')
            .replace(/\n{3,}/g, '\n\n').trim();
        const source = suppressMarketAction
            ? cleanedAnswer.replace(/\s*(?:工具結果\s*[：:]?\s*)?\[[^\]]+\]\(\/scrape(?:\?[^)]*)?\)/g, '')
            : cleanedAnswer;
        return escapeHTML(source).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, escapedHref) => {
            const href = escapedHref.replace(/&amp;/g, '&');
            if (/^https?:\/\//i.test(href)) {
                try {
                    const url = new URL(href);
                    if (!['http:', 'https:'].includes(url.protocol)) return match;
                    const safeHref = url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                    return `<a href="${safeHref}" class="ai-product-link" target="_blank" rel="noopener noreferrer">${label}</a>`;
                } catch {
                    return match;
                }
            }
            if (!href.startsWith('/')) return match;
            if (/^\/tools(?:\?[^)]*)?$/.test(href)) {
                const safeHref = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                return `<a href="${safeHref}" class="ai-valuation-btn">${label}</a>`;
            }
            const marketRoute = href.match(/^\/scrape(?:\?([^)]*))?$/);
            if (!marketRoute) return match;
            const params = new URLSearchParams(marketRoute[1] || '');
            const keyword = params.get('keyword') || latestProductKeyword(answer);
            const marketHref = keyword ? `/scrape?keyword=${encodeURIComponent(keyword)}` : '/scrape';
            return `<a href="${marketHref}" class="ai-valuation-btn">${label}</a>`;
        });
    }

    function clearPendingImage(revokePreview = true) {
        if (revokePreview && pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
        pendingImage = null;
        imageInput.value = '';
        imagePreview.replaceChildren();
        imagePreview.classList.remove('is-visible');
    }

    function setPendingImage(file, data, thumbnailUrl = '') {
        clearPendingImage();
        pendingImage = {
            name: file.name,
            data,
            thumbnailUrl,
            previewUrl: file.size ? URL.createObjectURL(file) : ''
        };
        const thumbnail = document.createElement('img');
        thumbnail.src = pendingImage.previewUrl || `data:image/jpeg;base64,${data}`;
        thumbnail.alt = '待上傳硬體圖片預覽';
        const name = document.createElement('span');
        name.textContent = file.name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '移除';
        remove.addEventListener('click', clearPendingImage);
        imagePreview.replaceChildren(thumbnail, name, remove);
        imagePreview.classList.add('is-visible');
    }

    function renderUserMessage(historyItem, historyIndex) {
        const userMessage = document.createElement('div');
        userMessage.className = 'ai-chat-message user';
        const userText = document.createElement('p');
        userText.textContent = historyItem.displayContent || historyItem.content;
        userMessage.appendChild(userText);

        if (historyItem.thumbnailUrl || historyItem.previewUrl) {
            const thumbnail = document.createElement('img');
            thumbnail.src = historyItem.thumbnailUrl || historyItem.previewUrl;
            thumbnail.alt = '使用者上傳的硬體圖片';
            thumbnail.style.cssText = 'width: 96px; max-height: 96px; object-fit: cover; border-radius: 8px;';
            userMessage.prepend(thumbnail);
        } else if (historyItem.imageName) {
            const imageNote = document.createElement('small');
            imageNote.textContent = `已上傳圖片：${historyItem.imageName}`;
            userMessage.prepend(imageNote);
        }

        const messageGroup = document.createElement('div');
        messageGroup.className = 'ai-chat-user-group';
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'ai-chat-edit';
        editButton.textContent = '編輯';
        editButton.addEventListener('click', () => {
            const item = chatHistory[historyIndex];
            if (!item || input.disabled) return;
            if (cancelActiveMessageEdit) cancelActiveMessageEdit();

            const editor = document.createElement('div');
            editor.className = 'ai-chat-message-editor';
            const textarea = document.createElement('textarea');
            textarea.value = item.displayContent || item.content;
            textarea.maxLength = 500;
            textarea.setAttribute('aria-label', '編輯訊息內容');
            const actions = document.createElement('div');
            actions.className = 'ai-chat-edit-actions';
            const saveButton = document.createElement('button');
            saveButton.type = 'button';
            saveButton.textContent = '儲存';
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.textContent = '取消';

            const closeEditor = () => {
                editor.remove();
                userText.hidden = false;
                editButton.hidden = false;
                if (cancelActiveMessageEdit === closeEditor) cancelActiveMessageEdit = null;
                editButton.focus();
            };
            cancelActiveMessageEdit = closeEditor;
            saveButton.addEventListener('click', () => {
                const updatedText = textarea.value.trim();
                if (!updatedText) {
                    textarea.setCustomValidity('請輸入訊息內容。');
                    textarea.reportValidity();
                    return;
                }
                if (input.disabled || chatHistory[historyIndex] !== item) return;
                item.displayContent = updatedText;
                item.content = item.imageAnalysis
                    ? `${updatedText}\n\n[圖片辨識結果：${item.imageAnalysis}]`
                    : updatedText;
                userText.textContent = updatedText;
                persistChatHistory();
                closeEditor();
            });
            cancelButton.addEventListener('click', closeEditor);
            textarea.addEventListener('input', () => textarea.setCustomValidity(''));
            textarea.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeEditor();
                } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    saveButton.click();
                }
            });
            actions.append(saveButton, cancelButton);
            editor.append(textarea, actions);
            userText.hidden = true;
            editButton.hidden = true;
            messageGroup.appendChild(editor);
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        });
        messageGroup.append(userMessage, editButton);
        messages.appendChild(messageGroup);
    }

    function appendImageActionButtons(container, analysis) {
        const isGpu = /\b(?:gpu|graphics card|video card|display card)\b|顯示卡|顯卡/i.test(analysis);
        const isCpu = /\b(?:cpu|processor|central processing unit)\b|處理器/i.test(analysis);
        if (!isGpu && !isCpu) return;

        const identifiedModel = analysis.match(/(?:^|\n)\s*(?:Model|型號)\s*[：:]\s*([^\n]+)/i)?.[1]?.trim();
        if (identifiedModel && /^(?:unknown|unclear|unreadable|不明|未知|無法辨識)/i.test(identifiedModel)) return;
        if (/(?:Confidence|信心)\s*[：:]\s*(?:low|低)/i.test(analysis)) return;
        const model = identifiedModel;
        if (!model) return;

        const actions = document.createElement('div');
        actions.className = 'ai-image-actions';
        const marketLink = document.createElement('a');
        marketLink.href = `/scrape?keyword=${encodeURIComponent(model)}`;
        marketLink.textContent = '市價查詢';
        actions.appendChild(marketLink);

        const wattageButton = document.createElement('button');
        wattageButton.type = 'button';
        wattageButton.textContent = '瓦數計算';
        wattageButton.addEventListener('click', () => {
            startPowerWizard();
            appendPowerReply(`照片初步辨識為「${model}」；請在對話框輸入並確認 CPU 型號，再繼續提供 GPU。`);
        });
        actions.appendChild(wattageButton);
        container.appendChild(actions);
    }

    function renderAssistantMessage(answer, imageAnalysis = '') {
        const aiMessage = document.createElement('div');
        aiMessage.className = 'ai-chat-message assistant';
        aiMessage.innerHTML = '<span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>';
        const responseContent = document.createElement('div');
        responseContent.className = 'ai-chat-response';
        const aiText = document.createElement('p');
        aiText.style.whiteSpace = 'pre-wrap';
        aiText.innerHTML = renderAssistantAnswer(answer, Boolean(imageAnalysis));
        responseContent.appendChild(aiText);
        if (imageAnalysis) appendImageActionButtons(responseContent, imageAnalysis);
        aiMessage.appendChild(responseContent);
        messages.appendChild(aiMessage);
    }

    let pendingImageAnalysis = '';
    chatHistory.forEach((message, index) => {
        if (message.role === 'user') renderUserMessage(message, index);
        else {
            renderAssistantMessage(message.content, pendingImageAnalysis);
            pendingImageAnalysis = '';
        }
        if (message.role === 'user' && message.imageAnalysis) pendingImageAnalysis = message.imageAnalysis;
    });
    if (chatHistory.length) messages.scrollTop = messages.scrollHeight;

    function appendPowerReply(text) {
        chatHistory.push({ role: 'assistant', content: text });
        persistChatHistory();
        renderAssistantMessage(text);
        messages.scrollTop = messages.scrollHeight;
    }

    function resetPowerFlow() {
        powerFlow = null;
        saveInterfaceState({ powerFlow: null });
        messages.querySelectorAll('.ai-power-options button').forEach(button => { button.disabled = true; });
    }

    function startPowerWizard() {
        resetPowerFlow();
        valuationFlow = null;
        recommendationFlow = null;
        marketQueryActive = false;
        powerFlow = { stage: 'cpu', cpuModel: '', gpuModel: '' };
        saveInterfaceState({ powerFlow, marketQueryActive: false, recommendationText: '' });
        appendPowerReply('可以先告訴我你使用的CPU嗎？例如 i5-14600K 或 Ryzen 5 7600。');
        input.focus();
    }

    async function requestPowerModel(category, model) {
        const api = await powerApiReady;
        const response = await fetch(category === 'cpu' ? '/api/cpu-data' : '/api/gpu-data', { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('功耗資料庫暫時無法連線，請稍後再輸入型號。');
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('功耗資料庫暫時無法讀取，請稍後再試。');
        return api.resolveModel(rows, category, model);
    }

    async function handlePowerText(text) {
        const flow = powerFlow;
        if (!flow) return;
        if (/^(?:取消|結束|重新開始)$/.test(text)) {
            resetPowerFlow();
            if (text === '重新開始') startPowerWizard();
            else appendPowerReply('好，這次先算到這裡。需要時再叫我就好。');
            return;
        }
        if (flow.stage === 'components') {
            appendPowerReply('請使用下方選單選擇主機板與散熱系統，再按「計算建議瓦數」。');
            return;
        }
        const category = flow.stage;
        flow[category + 'Model'] = text;
        saveInterfaceState({ powerFlow: flow });
        const match = await requestPowerModel(category, text);
        if (powerFlow !== flow) return;
        if (match.status === 'ambiguous') {
            appendPowerReply(`我找到幾個相近型號：${match.candidates.slice(0, 5).join('、')}。可以再補完整型號嗎？這樣比較不會算錯。`);
            return;
        }
        if (match.status !== 'matched') {
            const api = await powerApiReady;
            const url = api.calculatorUrl(flow);
            resetPowerFlow();
            appendPowerReply(`這個型號姐姐貌似不知道唷~，要不我們去頁面看看
[前往瓦數計算](${url})`);
            return;
        }
        flow[category + 'Model'] = match.model;
        flow[category + 'Watts'] = match.watts;
        if (category === 'gpu') flow.gpuRecommendedPsu = match.recommendedPsu;
        flow.stage = category === 'cpu' ? 'gpu' : 'components';
        saveInterfaceState({ powerFlow: flow });
        if (category === 'cpu') appendPowerReply('好極了，那可以再告訴我你的GPU型號嗎？如果沒有獨立顯卡，說「內顯」就好。');
        else await showPowerOptions();
    }

    async function showPowerOptions(recordPrompt = true) {
        const api = await powerApiReady;
        const flow = powerFlow;
        if (!flow || flow.stage !== 'components') return;
        if (recordPrompt) appendPowerReply('那最後，選擇你用的主板與散熱系統吧。選好後我就能幫你算建議瓦數。');
        const optionsForm = document.createElement('form');
        optionsForm.className = 'ai-valuation-wizard ai-power-options';
        const createSelect = (caption, choices, selected) => {
            const label = document.createElement('label');
            label.textContent = caption;
            const select = document.createElement('select');
            select.required = true;
            select.setAttribute('aria-label', caption);
            select.appendChild(new Option('請選擇' + caption, ''));
            choices.forEach(([value, label]) => select.appendChild(new Option(label, value)));
            if (selected != null) select.value = String(selected);
            label.appendChild(select);
            optionsForm.appendChild(label);
            return select;
        };
        const motherboard = createSelect('主機板', api.motherboardOptions, flow.motherboardWatts);
        const cooling = createSelect('散熱系統', api.coolingOptions, flow.coolingWatts);
        const saveChoices = () => {
            if (powerFlow !== flow) return;
            flow.motherboardWatts = motherboard.value;
            flow.coolingWatts = cooling.value;
            saveInterfaceState({ powerFlow: flow });
        };
        motherboard.addEventListener('change', saveChoices);
        cooling.addEventListener('change', saveChoices);
        const calculate = document.createElement('button');
        calculate.type = 'submit';
        calculate.textContent = '計算建議瓦數';
        const errorText = document.createElement('p');
        errorText.className = 'ai-valuation-error';
        errorText.setAttribute('role', 'alert');
        optionsForm.append(calculate, errorText);
        const responseBubble = [...messages.querySelectorAll('.ai-chat-response')].pop();
        responseBubble.appendChild(optionsForm);
        optionsForm.addEventListener('submit', async event => {
            event.preventDefault();
            if (powerFlow !== flow || !optionsForm.reportValidity()) return;
            calculate.disabled = true;
            errorText.textContent = '';
            try {
                // Revalidate against the database so restored or changed records cannot produce stale estimates.
                const [cpu, gpu] = await Promise.all([requestPowerModel('cpu', flow.cpuModel), requestPowerModel('gpu', flow.gpuModel)]);
                if (powerFlow !== flow) return;
                if (cpu.status !== 'matched' || gpu.status !== 'matched') {
                    const url = api.calculatorUrl(flow);
                    resetPowerFlow();
                    appendPowerReply(`這個型號姐姐貌似不知道唷~，要不我們去頁面看看
[前往瓦數計算](${url})`);
                    return;
                }
                const result = api.estimate({ cpuWatts: cpu.watts, gpuWatts: gpu.watts, gpuRecommendedPsu: gpu.recommendedPsu, motherboardWatts: Number(motherboard.value), coolingWatts: Number(cooling.value) });
                const calculatorUrl = api.calculatorUrl({ ...flow, cpuModel: cpu.model, gpuModel: gpu.model, motherboardWatts: motherboard.value, coolingWatts: cooling.value });
                const selection = { role: 'user', content: `主機板：${motherboard.selectedOptions[0].textContent}；散熱系統：${cooling.selectedOptions[0].textContent}` };
                renderUserMessage(selection, chatHistory.length);
                chatHistory.push(selection);
                persistChatHistory();
                motherboard.disabled = true;
                cooling.disabled = true;
                resetPowerFlow();
                appendPowerReply(`算好了，我們一起看看：CPU「${cpu.model}」約 ${cpu.watts}W，GPU「${gpu.model}」約 ${gpu.watts}W。
主機板約 ${motherboard.value}W，散熱約 ${cooling.value}W，硬碟以 1 顆、10W 估算。
整機滿載預估約 ${result.totalWatts}W，建議選擇至少 ${result.recommendedWatts}W 的電源供應器。
建議已加入 30% 餘裕，進位至 50W、最低 300W，並採納較高的顯卡原廠建議。
[瓦數計算](${calculatorUrl})`);
            } catch (error) {
                errorText.textContent = error.message || '計算暫時無法完成，請再試一次。';
                if (powerFlow === flow) calculate.disabled = false;
            }
            messages.scrollTop = messages.scrollHeight;
        });
        messages.scrollTop = messages.scrollHeight;
    }

    if (powerFlow?.stage === 'components') {
        showPowerOptions(false).catch(() => appendPowerReply('選單暫時無法載入，請重新開始瓦數計算。'));
    }

    function startValuationWizard() {
        resetPowerFlow();
        valuationFlow = { stage: 'category', catalogs: [] };
        const message = document.createElement('div');
        message.className = 'ai-chat-message assistant';
        message.innerHTML = '<span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>';
        const response = document.createElement('div');
        response.className = 'ai-chat-response';
        const prompt = document.createElement('p');
        prompt.textContent = '您想估哪一種零件？也可以按「圖片查詢」上傳照片，我會嘗試辨識種類與型號。';
        response.appendChild(prompt);
        const choices = document.createElement('div');
        choices.className = 'suggestions-container';
        [['cpu', 'CPU'], ['ram', '記憶體'], ['gpu', '顯卡'], ['motherboard', '主機板']].forEach(([value, label]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ai-valuation-btn suggestion-btn';
            button.textContent = label;
            button.addEventListener('click', () => chooseValuationCategory(value, label));
            choices.appendChild(button);
        });
        response.appendChild(choices);
        message.appendChild(response);
        messages.appendChild(message);
        chatHistory.push({ role: 'assistant', content: `${prompt.textContent}（CPU、記憶體、顯卡、主機板）` });
        persistChatHistory();
        messages.scrollTop = messages.scrollHeight;
    }

    const valuationCategoryLabels = { cpu: 'CPU', ram: '記憶體', gpu: '顯卡', motherboard: '主機板' };

    function catalogReferencePrice(item) {
        return Number(item.cpuPricing?.referencePriceNtd
            || item.gpuPricing?.launchPriceNtd
            || item.referencePrice?.priceNtd
            || 0);
    }

    async function resolveValuationModel(text) {
        const flow = valuationFlow;
        const normalize = value => String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const query = normalize(text);
        const catalogMatch = flow.catalogs.find(item => {
            const model = normalize(item.canonicalModel);
            return query === model || query.includes(model) || model.includes(query);
        });
        let match = catalogMatch;
        if (!match || !catalogReferencePrice(match)) {
            try {
                const params = new URLSearchParams({ category: flow.category, q: text, limit: '20' });
                const response = await fetch(`/api/valuation/models?${params}`);
                const result = await response.json();
                if (response.ok && result.success) {
                    const candidates = result.data.filter(item => {
                        const model = normalize(item.canonicalModel);
                        return query === model || query.includes(model) || model.includes(query);
                    });
                    candidates.sort((left, right) => {
                        const leftExact = normalize(left.canonicalModel) === query ? 1 : 0;
                        const rightExact = normalize(right.canonicalModel) === query ? 1 : 0;
                        return rightExact - leftExact || normalize(left.canonicalModel).length - normalize(right.canonicalModel).length;
                    });
                    const pricedMatch = candidates.find(item => catalogReferencePrice(item));
                    if (pricedMatch) match = pricedMatch;
                    else if (!match && candidates.length) match = candidates[0];
                }
            } catch {
                // Keep manual model entry available when the optional price lookup is unavailable.
            }
        }
        if (!match) return null;
        flow.model = match.canonicalModel;
        flow.modelId = match.id;
        flow.brand = match.manufacturer;
        flow.originalPrice = catalogReferencePrice(match);
        return match;
    }

    function selectValuationWarranty(months, label) {
        const flow = valuationFlow;
        renderUserMessage({ role: 'user', content: label }, chatHistory.length);
        chatHistory.push({ role: 'user', content: label });
        persistChatHistory();
        flow.totalWarrantyMonths = months;
        flow.stage = 'usage';
        appendValuationReply(`已採用${label}。請問已使用多久？可輸入「18個月」、「2年」，或輸入購買日期（例如「2024年3月」），我會換算成使用月數。`);
    }

    function requestWarrantyOrUsage() {
        const flow = valuationFlow;
        const model = String(flow.model || '');
        const brand = String(flow.brand || '').toLowerCase();
        const intelCpu = /intel/.test(brand) || /\bcore\s*(?:i[3579]|ultra)|\bi[3579]\s*[-\d]/i.test(model);
        const amdCpu = /amd/.test(brand) || /\b(?:ryzen|athlon|threadripper|fx\s*[-\d])/i.test(model);

        if (flow.category === 'cpu' && intelCpu) {
            const generationMatch = model.match(/(?:i[3579]\s*[- ]*)?(\d{4,5})/i);
            const digits = generationMatch?.[1] || '';
            const generation = digits.length === 5 ? Number(digits.slice(0, 2)) : Number(digits[0]);
            if (generation === 13 || generation === 14) {
                flow.stage = 'warranty';
                appendValuationReply(`Intel 第 ${generation} 代 CPU 可選擇保固期間：一般保固 3 年，或含延長保固 5 年。`, [
                    ['3 年（一般保固）', () => selectValuationWarranty(36, '3 年一般保固')],
                    ['5 年（含延長保固）', () => selectValuationWarranty(60, '5 年延長保固')]
                ]);
                return;
            }
        }

        if (flow.category === 'cpu' && (intelCpu || amdCpu)) {
            flow.totalWarrantyMonths = 36;
            flow.stage = 'usage';
            appendValuationReply(`${intelCpu ? '此 Intel CPU' : '此 AMD CPU'}依一般保固先採 3 年（36 個月）。請問已使用多久？可輸入「18個月」、「2年」，或輸入購買日期（例如「2024年3月」），我會換算成使用月數。`);
            return;
        }

        flow.stage = 'warranty';
        appendValuationReply('請問這個零件的完整保固期間是多久？可輸入年或月，例如「3年」或「36個月」。');
    }

    function appendValuationReply(text, buttons = []) {
        chatHistory.push({ role: 'assistant', content: text });
        persistChatHistory();
        const message = document.createElement('div');
        message.className = 'ai-chat-message assistant';
        message.innerHTML = '<span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>';
        const response = document.createElement('div');
        response.className = 'ai-chat-response';
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        response.appendChild(paragraph);
        if (buttons.length) {
            const group = document.createElement('div');
            group.className = 'suggestions-container';
            buttons.forEach(([label, onClick]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ai-valuation-btn suggestion-btn';
                button.textContent = label;
                button.addEventListener('click', onClick);
                group.appendChild(button);
            });
            response.appendChild(group);
        }
        message.appendChild(response);
        messages.appendChild(message);
        messages.scrollTop = messages.scrollHeight;
    }

    async function chooseValuationCategory(category, label = valuationCategoryLabels[category]) {
        if (!valuationFlow) valuationFlow = {};
        valuationFlow.category = category;
        valuationFlow.stage = 'model';
        renderUserMessage({ role: 'user', content: label }, chatHistory.length);
        chatHistory.push({ role: 'user', content: label });
        persistChatHistory();
        try {
            const response = await fetch(`/api/valuation/model-options?category=${encodeURIComponent(category)}`);
            const result = await response.json();
            valuationFlow.catalogs = response.ok && result.success ? result.data : [];
        } catch {
            valuationFlow.catalogs = [];
        }
        const knownCount = valuationFlow.catalogs.length;
        appendValuationReply(`請在聊天框輸入${label}型號${knownCount ? `（資料庫有 ${knownCount} 個型號，輸入時會自動比對）` : ''}。也可以上傳清楚的產品標籤照片。`);
        input.focus();
    }

    function parseDurationMonths(text) {
        const value = String(text || '').normalize('NFKC');
        const yearMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:年|years?|yrs?)/i);
        const monthMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:個?月|months?|mos?)/i);
        if (yearMatch || monthMatch) return Math.round(Number(yearMatch?.[1] || 0) * 12 + Number(monthMatch?.[1] || 0));
        const numeric = value.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
        return numeric ? Math.round(Number(numeric[1])) : null;
    }

    function parsePurchaseDateMonths(text) {
        const normalized = String(text || '').normalize('NFKC');
        const match = normalized.match(/(20\d{2})\s*(?:年|[-/.])\s*(\d{1,2})(?:\s*(?:月|[-/.])\s*(\d{1,2}))?/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3] || 1);
        const now = new Date();
        let elapsed = (now.getFullYear() - year) * 12 + now.getMonth() + 1 - month;
        if (day > now.getDate()) elapsed -= 1;
        return elapsed >= 0 && month >= 1 && month <= 12 ? elapsed : null;
    }

    function parseMoney(text) {
        const match = String(text || '').normalize('NFKC').replace(/,/g, '').match(/(?:NT\$|新臺幣|台幣|價格|約)?\s*(\d{2,9})(?:\s*元)?/i);
        return match ? Number(match[1]) : 0;
    }

    async function submitValuationEstimate() {
        const flow = valuationFlow;
        const payload = {
            category: flow.category,
            model: flow.model,
            modelId: flow.modelId || null,
            brand: flow.brand || '',
            elapsedMonths: flow.elapsedMonths,
            totalWarrantyMonths: flow.totalWarrantyMonths,
            originalPrice: flow.originalPrice || 0,
            condition: 'good'
        };
        const response = await fetch('/api/valuation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            if (String(result.message || '').includes('新品參考價')) {
                flow.stage = 'price';
                appendValuationReply('我查到型號了，但目前缺少新品參考價。你還記得當初買多少嗎？可以直接輸入價格，或按「圖片查詢」上傳發票。');
                return;
            }
            throw new Error(result.message || '估價失敗，請確認型號及資料。');
        }
        flow.stage = 'done';
        const title = `${result.hardware.canonicalBrand || ''} ${result.hardware.canonicalModel || payload.model}`.trim();
        const estimate = `${title}：估價約 NT$ ${Number(result.price).toLocaleString('zh-TW')}（${Number(result.range.min).toLocaleString('zh-TW')}–${Number(result.range.max).toLocaleString('zh-TW')}）`;
        const params = new URLSearchParams({
            category: payload.category,
            model: payload.model,
            elapsedMonths: String(payload.elapsedMonths),
            totalWarrantyMonths: String(payload.totalWarrantyMonths),
            calculate: '1'
        });
        if (payload.modelId) params.set('modelId', String(payload.modelId));
        if (payload.originalPrice > 0) params.set('originalPrice', String(payload.originalPrice));
        appendValuationReply(`${estimate}\n${result.warning || result.fallbackReason || '此為估算結果，實際價格會依商品狀況與市場行情變動。'}`, [
            ['前往二手估價頁', () => { window.location.href = `/valuation.html?${params.toString()}`; }]
        ]);
    }

    async function handleValuationText(text) {
        const flow = valuationFlow;
        if (!flow) return;
        if (flow.stage === 'model') {
            flow.model = text.trim();
            await resolveValuationModel(flow.model);
            requestWarrantyOrUsage();
        } else if (flow.stage === 'warranty') {
            const months = parseDurationMonths(text);
            if (months === null && /[a-z\d\u3400-\u9fff]/i.test(text)) {
                flow.model = text.trim();
                flow.modelId = null;
                flow.brand = '';
                flow.originalPrice = 0;
                await resolveValuationModel(flow.model);
                requestWarrantyOrUsage();
                return;
            }
            if (months === null || months > 600) return appendValuationReply('我沒有辨識到保固期間，請輸入例如「3年」或「36個月」。');
            flow.totalWarrantyMonths = months;
            flow.stage = 'usage';
            appendValuationReply('請問已使用多久？可輸入「18個月」、「2年」，或輸入購買日期（例如「2024年3月」），我會換算成使用月數。');
        } else if (flow.stage === 'usage') {
            const elapsedMonths = parsePurchaseDateMonths(text) ?? parseDurationMonths(text);
            if (elapsedMonths === null || elapsedMonths > 1200) return appendValuationReply('我沒有辨識到使用時間，請輸入年／月數，或購買日期，例如「1年」或「2024-03」。');
            flow.elapsedMonths = elapsedMonths;
            await submitValuationEstimate();
        } else if (flow.stage === 'price') {
            const price = parseMoney(text);
            if (!price) return appendValuationReply('請輸入發票上的實付金額或當初購買價格，例如「12000元」；也可上傳發票圖片。');
            flow.originalPrice = price;
            await submitValuationEstimate();
        }
    }

    function parseRecommendationBudget(text) {
        const patterns = [
            /(?:預算|budget)[^\d]{0,16}([\d,.]+)\s*(萬|千)?/i,
            /(?:NTD?|新台幣|台幣)\s*\$?\s*([\d,.]+)\s*(萬|千)?/i,
            /([\d,.]+)\s*(萬|千)\s*(?:元|塊)?/i,
            /([\d,]+)\s*(?:元|塊)/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (!match) continue;
            const value = Number(match[1].replace(/,/g, ''));
            const multiplier = match[2] === '萬' ? 10000 : match[2] === '千' ? 1000 : 1;
            const budget = Math.round(value * multiplier);
            if (Number.isFinite(budget) && budget >= 1000 && budget <= 100000000) return budget;
        }

        const textWithoutHardwareModels = text
            .replace(/\b(?:RTX|GTX)\s*\d{4}\b/gi, ' ')
            .replace(/\bRX\s*\d{4}(?:\s?(?:XT|XTX|GRE))?\b/gi, ' ')
            .replace(/\b(?:CORE\s*)?I[3579][-\s]*\d{4,5}[A-Z]{0,3}\b/gi, ' ')
            .replace(/\bRYZEN\s*[3579]\s*\d{4}[A-Z\d]*\b/gi, ' ');
        const numericOnly = textWithoutHardwareModels.match(/(?:^|[^\w])([\d,]{4,})(?![\w])/);
        if (numericOnly) {
            const budget = Number(numericOnly[1].replace(/,/g, ''));
            if (Number.isFinite(budget) && budget >= 1000 && budget <= 100000000) return budget;
        }
        return null;
    }

    function appendRecommendationReply(text) {
        chatHistory.push({ role: 'assistant', content: text });
        persistChatHistory();
        renderAssistantMessage(text);
        messages.scrollTop = messages.scrollHeight;
    }

    function getRecommendationProductType(text) {
        if (/筆電|筆記型電腦|laptop/i.test(text)) return 'laptop';
        if (/單買|單一零件|處理器|\bCPU\b|顯示卡|顯卡|\bGPU\b/i.test(text)) return 'component';
        if (/桌機|桌上型|桌電|主機|desktop/i.test(text)) return 'desktop';
        return null;
    }

    function getRecommendationUsage(text) {
        if (/遊戲|gaming|打機|3A|電競/i.test(text)) return 'gaming';
        if (/文書|辦公|影音|上網|office|剪輯|繪圖/i.test(text)) return 'office';
        return '';
    }

    function getRecommendationComponentType(text) {
        return /顯示卡|顯卡|\bGPU\b/i.test(text) ? 'gpu' : 'cpu';
    }

    function getRecommendationCondition(text) {
        const normalized = text.normalize('NFKC');
        if (/(?:二手|中古).*(?:全新|新品).*(?:都可以|都可|都行|皆可)|(?:全新|新品).*(?:二手|中古).*(?:都可以|都可|都行|皆可)/.test(normalized)) return null;
        const choices = [...normalized.matchAll(/(?:不要|不想(?:要|買)?|不接受|不考慮|不需要|不買|不是|拒絕|排除)\s*(二手|中古|全新品?|新品|新機)|二手|中古|全新品?|新品|新機/g)];
        const latest = choices.at(-1);
        if (!latest) return null;
        const used = /二手|中古/.test(latest[1] || latest[0]);
        return latest[1] ? (used ? 'new' : 'used') : (used ? 'used' : 'new');
    }

    function getRecommendationProductUrl(item) {
        try {
            const url = new URL(item.url, window.location.origin);
            if (['http:', 'https:'].includes(url.protocol) && url.origin !== window.location.origin) {
                return url.href;
            }
        } catch {
            // Fall back to a market search link when a scraper has no valid product URL.
        }
        return `/scrape?keyword=${encodeURIComponent(item.title || '')}`;
    }

    async function continueRecommendationFlow(text) {
        if (/^(取消|先不要|不用了)$/i.test(text.trim())) {
            recommendationFlow = null;
            saveInterfaceState({ recommendationText: '' });
            appendRecommendationReply('已取消智慧推薦，需要時再按「智慧推薦」即可重新開始。');
            return;
        }

        recommendationFlow.text = `${recommendationFlow.text || ''} ${text}`.trim().slice(-500);
        saveInterfaceState({ recommendationText: recommendationFlow.text });
        const requestText = recommendationFlow.text;
        const budget = parseRecommendationBudget(requestText);
        const usage = getRecommendationUsage(requestText);

        if (!budget && !usage) {
            appendRecommendationReply('請告訴我預算上限和主要用途，例如「4萬元，主要玩 3A 遊戲，想組桌機」。');
            return;
        }
        if (!budget) {
            appendRecommendationReply('用途收到！再給我一個預算上限就好，例如「4萬元」或「50000」。');
            return;
        }
        if (!usage) {
            appendRecommendationReply('預算記下來了。你主要拿來做什麼？例如玩 3A 遊戲，或是文書、看影片。');
            return;
        }

        const condition = getRecommendationCondition(text) || getRecommendationCondition(requestText);
        if (!condition) {
            appendRecommendationReply('你想找二手（通常較便宜的主機），還是全新品？回覆「二手」或「全新品」，我就依你的選擇找商品。');
            return;
        }
        const productType = getRecommendationProductType(requestText);
        const componentType = productType === 'component' ? getRecommendationComponentType(requestText) : '';
        const productTypes = !productType && usage === 'office' ? ['desktop', 'laptop'] : [productType || 'desktop'];
        const payloads = productTypes.map((type) => type === 'component'
            ? { budget, usage, productType: type, componentType, condition }
            : { budget, usage, productType: type, condition });
        recommendationFlow = null;
        saveInterfaceState({ recommendationText: '' });

        const loading = document.createElement('div');
        loading.className = 'ai-chat-message assistant';
        loading.innerHTML = '<span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span><p class="loading-text">正在依預算與用途整理推薦…</p>';
        messages.appendChild(loading);
        messages.scrollTop = messages.scrollHeight;

        try {
            const results = await Promise.all(payloads.map(async (payload) => {
                const response = await fetch('/api/recommend', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || '推薦服務暫時無法使用。');
                return result;
            }));

            const usageLabel = usage === 'gaming' ? '遊戲' : '文書／影音';
            const conditionLabel = condition === 'used' ? '二手' : '全新品';
            const products = results.flatMap((result) => Array.isArray(result.recommendations) ? result.recommendations : [])
                .filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url && candidate.title === item.title) === index)
                .sort((left, right) => (right.matchScore || 0) - (left.matchScore || 0) || left.price - right.price)
                .slice(0, 3);
            const lines = [`依照預算 NT$ ${budget.toLocaleString('zh-TW')}、${usageLabel}用途、商品狀況「${conditionLabel}」${productTypes.length > 1 ? '（已同時搜尋桌機與筆電）' : ''}，為你找到以下推薦：`];
            if (!products.length) {
                lines.push('目前沒有找到符合條件的商品。可以放寬預算，或調整用途後再試一次。');
            } else {
                products.slice(0, 3).forEach((item, index) => {
                    const title = String(item.title || '查看推薦商品').replace(/[[\]]/g, '').trim();
                    const url = getRecommendationProductUrl({ ...item, title });
                    const price = Number(item.price) || 0;
                    lines.push(`${index + 1}. [${title}](${url})\n   NT$ ${price.toLocaleString('zh-TW')} · ${String(item.platform || '通路資訊')}`);
                });
            }
            const updatedAt = results.map((result) => result.marketMeta?.updatedAt).filter(Boolean).sort().at(-1);
            if (updatedAt) {
                lines.push(`市場資料更新於 ${new Date(updatedAt).toLocaleString('zh-TW')}。`);
            }
            appendRecommendationReply(lines.join('\n\n'));
        } catch (error) {
            appendRecommendationReply(`剛才查推薦時遇到問題：${error.message || '請稍後再試。'} 再傳一次預算和用途，我會重新查。`);
            recommendationFlow = { text: requestText };
            saveInterfaceState({ recommendationText: requestText });
        } finally {
            loading.remove();
        }
    }

    function startMarketQuery(model = '') {
        resetPowerFlow();
        marketQueryActive = true;
        valuationFlow = null;
        recommendationFlow = null;
        saveInterfaceState({ marketQueryActive: true, recommendationText: '' });
        appendRecommendationReply('想查詢哪一項產品的資訊與市價？請在對話框輸入產品名稱或完整型號，也可以按「圖片查詢」上傳型號清楚的照片。');
        if (model) input.value = model;
        input.focus();
    }

    function showQuickActions() {
        messages.querySelectorAll('.ai-chat-reopen-suggestions').forEach(message => message.remove());

        const quickActions = [
            ['二手估價', '幫我估二手 RTX 4070，使用 18 個月，外觀正常'],
            ['市價查詢', ''],
            ['智慧推薦', '我有 4 萬元，想組一台打遊戲的桌機'],
            ['瓦數計算', '']
        ];
        const message = document.createElement('div');
        message.className = 'ai-chat-message assistant ai-chat-reopen-suggestions';
        message.innerHTML = '<span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>';

        const content = document.createElement('div');
        content.className = 'message-content';
        const prompt = document.createElement('p');
        prompt.textContent = '想先做哪件事？點一下，或直接告訴我你的需求：';
        prompt.style.cssText = 'font-size: 13px; color: #666; margin-top: 8px;';
        const buttons = document.createElement('div');
        buttons.className = 'suggestions-container';
        buttons.style.marginTop = '8px';

        quickActions.forEach(([label, query]) => {
            const button = document.createElement('button');
            button.className = 'ai-valuation-btn suggestion-btn';
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => {
                if (label === '瓦數計算') {
                    const action = { role: 'user', content: '我要進行瓦數計算' };
                    renderUserMessage(action, chatHistory.length);
                    chatHistory.push(action);
                    persistChatHistory();
                    startPowerWizard();
                    return;
                }
                resetPowerFlow();
                valuationFlow = null;
                recommendationFlow = null;
                if (label === '市價查詢') {
                    startMarketQuery();
                    return;
                }
                marketQueryActive = false;
                saveInterfaceState({ marketQueryActive: false });
                if (label === '二手估價') {
                    const action = { role: 'user', content: '我要進行二手估價' };
                    renderUserMessage(action, chatHistory.length);
                    chatHistory.push(action);
                    persistChatHistory();
                    startValuationWizard();
                    return;
                }
                if (label === '智慧推薦') {
                    recommendationFlow = { text: '' };
                    saveInterfaceState({ recommendationText: '' });
                    appendRecommendationReply('我們先從預算和用途開始吧，例如「4萬元，主要玩 3A 遊戲，想組桌機」。只知道預算也沒關係，先告訴我就好。');
                    return;
                }
                input.value = query;
                form.requestSubmit();
            });
            buttons.appendChild(button);
        });

        content.append(prompt, buttons);
        message.appendChild(content);
        messages.appendChild(message);
        messages.scrollTop = messages.scrollHeight;
    }

    attachButton.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', async () => {
        const file = imageInput.files?.[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
            window.alert('請選擇 12 MB 以內的 JPG、PNG 或 WebP 圖片。');
            imageInput.value = '';
            return;
        }

        try {
            const bitmap = await createImageBitmap(file);
            const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close();
            let imageData = '';
            for (const quality of [0.78, 0.68, 0.58]) {
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                imageData = dataUrl.slice(dataUrl.indexOf(',') + 1);
                if (imageData.length <= 2_400_000) break;
            }
            if (imageData.length > 2_400_000) throw new Error('壓縮後圖片仍太大，請改用較小的照片。');
            const thumbnail = document.createElement('canvas');
            const thumbnailScale = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
            thumbnail.width = Math.max(1, Math.round(canvas.width * thumbnailScale));
            thumbnail.height = Math.max(1, Math.round(canvas.height * thumbnailScale));
            thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
            setPendingImage(file, imageData, thumbnail.toDataURL('image/jpeg', 0.65));
        } catch (error) {
            window.alert(error.message || '圖片讀取失敗，請重新選擇。');
            imageInput.value = '';
        }
    });

    function setOpen(isOpen, focusInput = true) {
        widget.classList.toggle('is-open', isOpen);
        idlePrompt.hidden = true;
        resetIdlePromptTimer();
        document.body.classList.toggle('ai-chat-docked', isOpen);
        panel.setAttribute('aria-hidden', String(!isOpen));
        launcher.setAttribute('aria-expanded', String(isOpen));
        launcher.setAttribute('aria-label', isOpen ? 'AI 助手已開啟' : '開啟 AI 助手');
        saveInterfaceState({ isOpen });

        if (isOpen) {
            showQuickActions();
            if (focusInput) window.setTimeout(() => input.focus(), 120);
        }
    }

    function saveInterfaceState(update) {
        savedInterfaceState = { ...savedInterfaceState, ...update };
        try {
            sessionStorage.setItem(interfaceStorageKey, JSON.stringify(savedInterfaceState));
        } catch {
            statusLabel.title = '瀏覽器無法保留 AI 介面狀態';
        }
    }

    window.addEventListener('nmdwsm:agent-prompt', event => {
        const prompt = String(event.detail?.prompt || '').trim();
        if (!prompt) return;
        setOpen(true);
        input.value = prompt;
        input.style.height = 'auto';
        form.requestSubmit();
    });

    closeButton.addEventListener('click', () => {
        setOpen(false);
        launcher.focus();
    });

    launcher.addEventListener('click', () => {
        if (!widget.classList.contains('is-open')) setOpen(true);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && widget.classList.contains('is-open')) {
            setOpen(false);
            launcher.focus();
        }
    });

    setOpen(false, false);

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
    });

    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
        }
    });

    // 處理表單送出邏輯，串接後端 /api/chat
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const text = input.value.trim();

        if (!text && !pendingImage) return;

        // 顯示使用者的訊息
        const userHistory = {
            role: 'user',
            content: text || (marketQueryActive ? '請查詢照片中產品的資訊與市價' : valuationFlow?.stage === 'price' ? '請辨識這張發票收據，擷取購買日期、品名與實付金額。' : '請辨識這張硬體圖片'),
            displayContent: text || (marketQueryActive ? '請查詢照片中產品的資訊與市價' : valuationFlow?.stage === 'price' ? '請辨識這張發票收據' : '請辨識這張硬體圖片'),
            thumbnailUrl: pendingImage?.thumbnailUrl || '',
            imageData: pendingImage?.data || null,
            imageName: pendingImage?.name || '',
            previewUrl: pendingImage?.previewUrl || ''
        };
        const historyIndex = chatHistory.length;
        renderUserMessage(userHistory, historyIndex);

        // 將使用者訊息加入歷史紀錄
        chatHistory.push(userHistory);
        persistChatHistory();
        const imageToSend = pendingImage;
        clearPendingImage(false);

        // 清空輸入框、還原高度、捲動到底部
        input.value = '';
        input.style.height = 'auto';
        messages.scrollTop = messages.scrollHeight;

        // Let standalone social turns reach the server without consuming an
        // in-progress CPU, valuation, recommendation or market answer.
        const socialText = text.normalize('NFKC').trim().replace(/[\s，,。.!！?？～~]+/g, '').toLowerCase();
        const standaloneSocialTurn = !imageToSend && (
            /^(?:你好|您好|哈囉|哈啰|嗨|hi|hello|早安|午安|晚安|有人在嗎|在嗎|你在嗎|你是誰|你是啥|所以你是啥|你是什麼|你叫什麼名字|你能做什麼|你會做什麼|自我介紹|自我介紹一下|你是機器人嗎|你是客服嗎|謝謝|謝謝你|感謝|感謝你|感恩|多謝|辛苦了|拜拜|再見|掰掰|今天天氣(?:如何|怎樣|怎麼樣)?|天氣(?:如何|怎樣|怎麼樣)?|誰是.{0,30}|bbb|123|隨便|測試)(?:呀|啊|喔|哦)?$/.test(socialText)
            || /^(?:(?:我想|我要|想)?(?:幫我)?(?:估價|估算|查二手價|算二手價)(?:一台|一下)?(?:手機|平板)|(?:手機|平板)(?:可以)?(?:估價|估算|查二手價|算二手價)(?:嗎)?)$/.test(socialText)
        );
        if (!standaloneSocialTurn && !imageToSend && (powerFlow || (!marketQueryActive && !valuationFlow && !recommendationFlow && /瓦數|電源|供電|電供|PSU|幾瓦/i.test(text)))) {
            input.disabled = true;
            submitBtn.disabled = true;
            try {
                if (powerFlow) await handlePowerText(text);
                else startPowerWizard();
            } catch (error) {
                appendPowerReply(error.message || '功耗資料庫暫時無法讀取，請稍後再試。');
            } finally {
                input.disabled = false;
                submitBtn.disabled = false;
                input.focus();
            }
            return;
        }

        if (recommendationFlow && !imageToSend && !standaloneSocialTurn) {
            input.disabled = true;
            submitBtn.disabled = true;
            try {
                await continueRecommendationFlow(text);
            } catch (error) {
                appendRecommendationReply(error.message || '智慧推薦暫時無法完成，請稍後再試。');
            } finally {
                input.disabled = false;
                submitBtn.disabled = false;
                input.focus();
            }
            return;
        }

        if (valuationFlow && !imageToSend && !standaloneSocialTurn) {
            try {
                await handleValuationText(text);
            } catch (error) {
                appendValuationReply(error.message || '估價暫時無法完成，請稍後再試。');
            }
            input.focus();
            return;
        }

        // 鎖定輸入框，防止重複發送
        input.disabled = true;
        submitBtn.disabled = true;

        // 顯示「思考中...」提示
        const loadingMessage = document.createElement('div');
        loadingMessage.className = 'ai-chat-message assistant';
        loadingMessage.innerHTML =
            '<span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span><p class="loading-text">我來看看…</p>';
        messages.appendChild(loadingMessage);
        messages.scrollTop = messages.scrollHeight;

        try {
            // --- 2. 發送請求到後端 (只發送最後 20 則歷史，避免 Token 過長) ---
            const payloadMessages = chatHistory.slice(-20).map((message, index, selected) => ({
                role: message.role,
                content: message.content,
                ...(index === selected.length - 1 && imageToSend
                    ? { images: [imageToSend.data] }
                    : {})
            }));
            const apiUrl = '/api/chat';

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ messages: payloadMessages, ...(marketQueryActive && !standaloneSocialTurn ? { intent: 'market' } : {}) })
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

            if (data.success && valuationFlow && imageToSend) {
                if (data.imageAnalysis) {
                    userHistory.content += `\n\n[圖片辨識結果：${data.imageAnalysis}]`;
                    userHistory.imageAnalysis = data.imageAnalysis;
                    persistChatHistory();
                }
                if (valuationFlow.stage === 'price') {
                    const objectText = String(data.imageAnalysis || '').replace(/```(?:json)?/gi, '').replace(/```/g, '');
                    let invoice = {};
                    try {
                        invoice = JSON.parse(objectText.slice(objectText.indexOf('{'), objectText.lastIndexOf('}') + 1));
                    } catch {
                        const amount = parseMoney(objectText);
                        if (amount) invoice.total_paid_ntd = amount;
                    }
                    const amount = Number(invoice.total_paid_ntd || invoice.amount || invoice.price || 0);
                    if (Number.isFinite(amount) && amount > 0) {
                        valuationFlow.originalPrice = amount;
                        const purchaseDate = invoice.purchase_date || invoice.date;
                        if (purchaseDate) {
                            const months = parsePurchaseDateMonths(String(purchaseDate));
                            if (months !== null) valuationFlow.elapsedMonths = months;
                        }
                        appendValuationReply(`從發票辨識到實付金額 NT$ ${amount.toLocaleString('zh-TW')}${invoice.product_name ? `，品名：${invoice.product_name}` : ''}，正在用此價格估算。`);
                        try {
                            await submitValuationEstimate();
                        } catch (error) {
                            appendValuationReply(error.message || '估價暫時無法完成，請稍後再試。');
                        }
                    } else {
                        appendValuationReply('我無法從這張圖片確認發票金額，請拍清楚「品名、日期、金額」欄位，或直接在聊天框輸入當初購買價格。');
                    }
                } else {
                    const analysis = String(data.imageAnalysis || '');
                    const category = /主機板|motherboard/i.test(analysis) ? 'motherboard'
                        : /記憶體|memory|ram/i.test(analysis) ? 'ram'
                            : /顯示卡|顯卡|graphics card|video card|gpu/i.test(analysis) ? 'gpu'
                                : /處理器|processor|\bcpu\b/i.test(analysis) ? 'cpu' : '';
                    const modelMatch = analysis.match(/(?:model|型號|identified as|product)\s*[:：]?\s*["「]?([^\n,.;」"]{3,80})/i);
                    const model = modelMatch?.[1]?.trim();
                    if (category && (!valuationFlow.category || valuationFlow.stage === 'model')) {
                        valuationFlow.category = category;
                        try {
                            const optionsResponse = await fetch(`/api/valuation/model-options?category=${encodeURIComponent(category)}`);
                            const options = await optionsResponse.json();
                            valuationFlow.catalogs = optionsResponse.ok && options.success ? options.data : [];
                        } catch {
                            valuationFlow.catalogs = [];
                        }
                    }
                    if (category && model && !/^unknown|不明$/i.test(model) && ['category', 'model'].includes(valuationFlow.stage)) {
                        valuationFlow.model = model;
                        await resolveValuationModel(model);
                        appendValuationReply(`圖片初步辨識為${valuationCategoryLabels[category]}「${valuationFlow.model}」。若型號需修正，請直接輸入正確型號；若正確，請繼續提供保固／使用時間。`);
                        requestWarrantyOrUsage();
                    } else if (category && valuationFlow.stage === 'category') {
                        valuationFlow.stage = 'model';
                        chooseValuationCategory(category, valuationCategoryLabels[category]);
                    } else {
                        appendValuationReply('我無法從圖片可靠辨識零件種類或型號，請上傳標籤清楚的照片，或在聊天框直接輸入型號。');
                    }
                }
                return;
            }

            // --- 3. 顯示 AI 的回覆與解析 Markdown 按鈕 ---
            const aiMessage = document.createElement('div');
            aiMessage.className = 'ai-chat-message assistant';

            const aiText = document.createElement('p');
            aiText.style.whiteSpace = 'pre-wrap';

            let imageAnalysisForActions = '';
            if (data.success) {
                if (data.imageAnalysis) {
                    userHistory.content += `\n\n[圖片辨識結果：${data.imageAnalysis}]`;
                    userHistory.imageAnalysis = data.imageAnalysis;
                    imageAnalysisForActions = data.imageAnalysis;
                }
                aiText.innerHTML = renderAssistantAnswer(data.answer, Boolean(imageAnalysisForActions));
                chatHistory.push({ role: 'assistant', content: data.answer });
                persistChatHistory();
            } else {
                let errText = data.message;
                if (
                    errText &&
                    (errText.includes('high demand') ||
                        errText.includes('Spikes in demand') ||
                        errText.includes('502'))
                ) {
                    errText = '目前 AI 客服線路較忙碌，請稍等幾分鐘後再試一次喔！';
                }

                aiText.textContent = `⚠️ 發生錯誤：${errText}`;
                chatHistory.pop();
                persistChatHistory();
            }
            aiMessage.innerHTML =
                '<span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>';
            const responseContent = document.createElement('div');
            responseContent.className = 'ai-chat-response';
            responseContent.appendChild(aiText);
            if (imageAnalysisForActions) appendImageActionButtons(responseContent, imageAnalysisForActions);
            aiMessage.appendChild(responseContent);
            messages.appendChild(aiMessage);
        } catch (error) {
            console.error('API 請求失敗:', error);
            if (loadingMessage.parentNode) {
                messages.removeChild(loadingMessage);
            }
            chatHistory.pop();
            persistChatHistory();

            const errorMessage = document.createElement('div');
            errorMessage.className = 'ai-chat-message assistant';
            const errText = document.createElement('p');
            errText.textContent =
                error && error.message
                    ? `無法連線到 AI 助手：${error.message}`
                    : '無法連線到 AI 助手，請稍後再試。';
            errorMessage.innerHTML =
                '<span class="ai-chat-message-avatar" aria-hidden="true"><img src="/assets/ji-yiti-headshot.png" alt=""></span>';
            errorMessage.appendChild(errText);
            messages.appendChild(errorMessage);
        } finally {
            input.disabled = false;
            submitBtn.disabled = false;
            input.focus();
            messages.scrollTop = messages.scrollHeight;
        }
    });
})();
