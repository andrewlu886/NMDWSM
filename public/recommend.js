(function () {
    const form = document.getElementById('recommend-form');
    const submitButton = document.getElementById('recommend-submit');
    const resultDisplay = document.getElementById('result-display');
    const productTypeSelect = document.getElementById('productType');
    const usageSelect = document.getElementById('usage');
    const conditionSelect = document.getElementById('condition');

    function addTextElement(parent, tag, className, text) {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    function getCalculatorUrl(item) {
        const knownModel = (value) => value && value !== 'UNKNOWN' ? value : '';
        const params = new URLSearchParams({
            gpu: knownModel(item.gpu),
            cpu: knownModel(item.cpu)
        });
        return `/tools.html?${params.toString()}`;
    }

    function renderResults(result, budget, usage, productType, condition) {
        resultDisplay.replaceChildren();

        const marketMeta = result.marketMeta;
        const conditionLabel = condition === 'used' ? '二手' : '全新';
        const actions = document.createElement('div');
        actions.className = 'recommend-agent-actions';
        const freshness = addTextElement(
            actions,
            'span',
            'recommend-data-freshness',
            marketMeta?.updatedAt
                ? `市場資料更新於 ${new Date(marketMeta.updatedAt).toLocaleString('zh-TW')}${marketMeta.liveListings ? '，二手刊登即時查詢' : '，每日更新一次'}`
                : condition === 'used' ? '二手刊登即時查詢；實際狀態請在原頁確認' : '市場資料每日更新一次'
        );
        freshness.setAttribute('role', 'status');
        if (marketMeta?.partial) {
            addTextElement(resultDisplay, 'div', 'recommend-warning', '部分商品來源暫時無法讀取，以下顯示其餘來源的推薦結果。');
        }

        const agentPrompt = (mode) => {
            const kind = `${productType === 'laptop' ? '筆電' : '套裝主機'}，用途為${usage === 'gaming' ? '遊戲' : '文書／影音'}`;
            return mode === 'review'
                ? `我剛在智慧推薦頁以預算 NT$${budget.toLocaleString()} 查詢${conditionLabel}${kind}。請依最新市場資料解讀推薦結果、說明挑選時的取捨，並提醒我購買前應確認的規格。`
                : `我剛在智慧推薦頁以預算 NT$${budget.toLocaleString()} 查詢${conditionLabel}${kind}。請先詢問我最在意的條件，再協助調整條件並重新推薦；若市場資料不足也請明確說明。`;
        };

        [['請 AI 解讀推薦', 'review'], ['和 AI 一起調整條件', 'adjust']].forEach(([label, mode]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'recommend-agent-button';
            button.textContent = label;
            button.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('nmdwsm:agent-prompt', { detail: { prompt: agentPrompt(mode) } }));
            });
            actions.appendChild(button);
        });

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
            resultDisplay.appendChild(actions);
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
                `商品狀況：${conditionLabel}`,
                `CPU：${item.cpu && item.cpu !== 'UNKNOWN' ? item.cpu : '未提供'}`,
                `GPU：${item.gpu && item.gpu !== 'UNKNOWN' ? item.gpu : '未提供'}`,
                `RAM：${item.ram && item.ram !== 'UNKNOWN' ? item.ram : '未提供'}`,
                `系統：${item.os && item.os !== 'UNKNOWN' ? item.os : '未提供'}`
            ];
            specs.forEach((spec) => addTextElement(tags, 'span', 'recommend-tag', spec));
            card.appendChild(tags);

            const actions = document.createElement('div');
            actions.className = 'recommend-result-actions';

            const toolsLink = document.createElement('a');
            toolsLink.className = 'recommend-tools-link';
            toolsLink.href = getCalculatorUrl(item);
            toolsLink.target = '_self';
            toolsLink.textContent = '計算整機建議瓦數';
            actions.appendChild(toolsLink);
            card.appendChild(actions);

            list.appendChild(card);
        });

        resultDisplay.appendChild(list);
        resultDisplay.appendChild(actions);
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const budget = Number(document.getElementById('budget').value);
        const productType = productTypeSelect.value;
        const usage = usageSelect.value;
        const condition = conditionSelect.value;

        if (!Number.isFinite(budget) || budget <= 0) {
            document.getElementById('budget').focus();
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = '正在整理推薦資料…';
        resultDisplay.innerHTML = '<div class="recommend-empty"><strong>正在尋找適合的硬體</strong><span>這可能需要一點時間。</span></div>';

        try {
            const response = await fetch('/api/recommend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget, usage, productType, condition })
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
            renderResults(result, budget, usage, productType, condition);
        } catch (error) {
            console.error('推薦服務錯誤：', error);
            resultDisplay.innerHTML = '<div class="recommend-error">目前無法取得推薦資料，請確認網站伺服器正在運作，稍後再試一次。</div>';
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = '立即生成推薦清單';
        }
    });
})();
