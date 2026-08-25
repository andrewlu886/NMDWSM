(function () {
    const form = document.getElementById('recommend-form');
    const submitButton = document.getElementById('recommend-submit');
    const resultDisplay = document.getElementById('result-display');
    const searchInput = document.getElementById('site-search');

    function goToPriceSearch() {
        const keyword = searchInput.value.trim();
        if (keyword) window.location.href = `/scrape?keyword=${encodeURIComponent(keyword)}`;
    }

    searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') goToPriceSearch();
    });

    function addTextElement(parent, tag, className, text) {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    function renderResults(result, budget, usage, productType) {
        resultDisplay.replaceChildren();

        if (usage === 'gaming' && productType !== 'component' && budget < 30000) {
            addTextElement(
                resultDisplay,
                'div',
                'recommend-warning',
                `提醒：NT$ ${budget.toLocaleString()} 的預算用於 3A 遊戲可能較吃緊，建議優先比較顯示卡與記憶體配置。`
            );
        }

        if (!result.recommendations || result.recommendations.length === 0) {
            const empty = addTextElement(resultDisplay, 'div', 'recommend-empty', '目前找不到符合條件的結果，請調整預算或商品類型後再試一次。');
            empty.setAttribute('role', 'status');
            return;
        }

        const list = document.createElement('div');
        list.className = 'recommend-result-list';

        result.recommendations.forEach((item, index) => {
            const card = document.createElement('article');
            card.className = 'recommend-result-item';

            const head = document.createElement('div');
            head.className = 'recommend-result-head';

            const title = document.createElement('a');
            title.className = 'recommend-result-title';
            title.href = item.url || '#';
            title.target = '_blank';
            title.rel = 'noopener noreferrer';
            title.textContent = `#${index + 1} [${item.platform || '來源'}] ${item.title || '硬體推薦'}`;
            head.appendChild(title);

            const price = Number(item.price) || 0;
            addTextElement(head, 'span', 'recommend-result-price', `NT$ ${price.toLocaleString()}`);
            card.appendChild(head);

            const tags = document.createElement('div');
            tags.className = 'recommend-tags';
            const specs = [
                `CPU：${item.cpu || '未提供'}`,
                `GPU：${item.gpu || '未提供'}`,
                `RAM：${item.ram && item.ram !== 'UNKNOWN' ? item.ram : '未提供'}`,
                `系統：${item.os && item.os !== 'UNKNOWN' ? item.os : '未提供'}`
            ];
            specs.forEach((spec) => addTextElement(tags, 'span', 'recommend-tag', spec));
            card.appendChild(tags);

            const actions = document.createElement('div');
            actions.className = 'recommend-result-actions';

            const toolsLink = document.createElement('a');
            toolsLink.className = 'recommend-tools-link';
            toolsLink.href = `/tools.html?gpu=${encodeURIComponent(item.gpu || '')}&cpu=${encodeURIComponent(item.cpu || '')}`;
            toolsLink.target = '_blank';
            toolsLink.rel = 'noopener noreferrer';
            toolsLink.textContent = '計算整機建議瓦數';
            actions.appendChild(toolsLink);
            card.appendChild(actions);

            list.appendChild(card);
        });

        resultDisplay.appendChild(list);
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const budget = Number(document.getElementById('budget').value);
        const usage = document.getElementById('usage').value;
        const productType = document.getElementById('productType').value;

        if (!Number.isFinite(budget) || budget <= 0) {
            document.getElementById('budget').focus();
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = '正在整理推薦資料…';
        resultDisplay.innerHTML = '<div class="recommend-empty"><span class="recommend-empty-icon" aria-hidden="true">⋯</span><strong>正在尋找適合的硬體</strong><span>這可能需要一點時間。</span></div>';

        try {
            const response = await fetch('/api/recommend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget, usage, productType })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            renderResults(await response.json(), budget, usage, productType);
        } catch (error) {
            console.error('推薦服務錯誤：', error);
            resultDisplay.innerHTML = '<div class="recommend-error">目前無法取得推薦資料，請確認網站伺服器正在運作，稍後再試一次。</div>';
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = '✨ 立即生成推薦清單';
        }
    });
})();
