(function () {
    const widget = document.createElement('div');
    widget.className = 'ai-chat-widget';
    widget.innerHTML = `
        <section class="ai-chat-panel" id="ai-chat-panel" aria-label="AI 硬體助手" aria-hidden="true">
            <header class="ai-chat-header">
                <div class="ai-chat-heading">
                    <span class="ai-chat-avatar" aria-hidden="true">AI</span>
                    <div>
                        <strong>硬體小助手</strong>
                        <span><i aria-hidden="true"></i> 尚未啟用</span>
                    </div>
                </div>
                <button class="ai-chat-close" type="button" aria-label="關閉 AI 對話框">&times;</button>
            </header>

            <div class="ai-chat-messages" aria-live="polite">
                <div class="ai-chat-message assistant">
                    <span class="ai-chat-message-avatar" aria-hidden="true">AI</span>
                    <p>嗨！未來我可以協助你挑選硬體、比較規格，或解答跑分相關問題。</p>
                </div>
                <div class="ai-chat-notice">
                    <strong>AI 助手尚未啟用</strong>
                    <span>設定 API 金鑰後，就能開始對話。</span>
                </div>
            </div>

            <form class="ai-chat-form">
                <label class="sr-only" for="ai-chat-input">輸入訊息</label>
                <textarea id="ai-chat-input" rows="1" maxlength="500" placeholder="輸入你的硬體問題……"></textarea>
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

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();

        if (!text) return;

        const userMessage = document.createElement('div');
        userMessage.className = 'ai-chat-message user';
        const messageText = document.createElement('p');
        messageText.textContent = text;
        userMessage.appendChild(messageText);
        messages.appendChild(userMessage);

        const disabledMessage = document.createElement('div');
        disabledMessage.className = 'ai-chat-message assistant';
        disabledMessage.innerHTML = '<span class="ai-chat-message-avatar" aria-hidden="true">AI</span><p>目前尚未連接 AI 服務，設定 API 金鑰後我就能回答這個問題。</p>';
        messages.appendChild(disabledMessage);

        input.value = '';
        input.style.height = 'auto';
        messages.scrollTop = messages.scrollHeight;
    });
})();
