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

    let powerDataPromise;
    function loadPowerData() {
        if (!powerDataPromise) {
            powerDataPromise = Promise.all(['cpu', 'gpu'].map(async category => {
                const response = await fetch(`/api/${category}-data`);
                if (!response.ok) throw new Error('暫時無法載入功耗資料，請稍後再試。');
                const rows = await response.json();
                if (!Array.isArray(rows)) throw new Error('功耗資料格式不正確。');
                return rows;
            })).catch(error => { powerDataPromise = null; throw error; });
        }
        return powerDataPromise;
    }

    function addInlineCalculator(card, actions, item, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recommend-tools-link';
        button.textContent = '計算整機建議瓦數';
        button.setAttribute('aria-expanded', 'false');
        actions.appendChild(button);
        const panel = document.createElement('section');
        panel.className = 'recommend-psu-panel';
        panel.id = `recommend-psu-${index}`;
        panel.hidden = true;
        panel.setAttribute('aria-label', '整機建議瓦數計算');
        button.setAttribute('aria-controls', panel.id);
        const fields = document.createElement('div');
        fields.className = 'recommend-psu-fields';
        panel.appendChild(fields);
        function field(labelText, element) {
            const label = document.createElement('label');
            addTextElement(label, 'span', '', labelText);
            label.appendChild(element);
            fields.appendChild(label);
            element.addEventListener('change', calculate);
            return element;
        }
        const inputs = {};
        const lists = {};
        for (const category of ['cpu', 'gpu']) {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = item[category] && item[category] !== 'UNKNOWN' ? item[category] : '';
            input.placeholder = category === 'cpu' ? '請選擇或輸入完整 CPU 型號' : '請選擇顯卡型號，或輸入「內顯」';
            const list = document.createElement('datalist');
            list.id = `${panel.id}-${category}`;
            input.setAttribute('list', list.id);
            panel.appendChild(list);
            inputs[category] = field(`${category.toUpperCase()} 型號`, input);
            lists[category] = list;
        }
        function select(label, options) {
            const element = document.createElement('select');
            options.forEach(([value, text]) => {
                const option = document.createElement('option');
                option.value = value; option.textContent = text; element.appendChild(option);
            });
            return field(label, element);
        }
        const motherboard = select('主機板', window.PsuFlow.motherboardOptions);
        const cooling = select('散熱配置', window.PsuFlow.coolingOptions);
        const drives = document.createElement('input');
        drives.type = 'number'; drives.min = '0'; drives.max = '20'; drives.step = '1'; drives.value = '1';
        field('硬碟數量', drives);
        const result = addTextElement(panel, 'div', 'recommend-psu-result', '');
        result.setAttribute('role', 'status');
        result.setAttribute('aria-live', 'polite');
        addTextElement(panel, 'p', 'recommend-psu-note', '依 CPU／GPU 功耗及所選配置估算，含 30% 餘裕並參考顯卡官方電源建議。筆電請以原廠變壓器規格為準。');
        let rows;
        async function calculate() {
            result.textContent = '正在計算建議瓦數…';
            try {
                if (!rows) {
                    rows = await loadPowerData();
                    ['cpu', 'gpu'].forEach((category, position) => {
                        rows[position].forEach(row => {
                            const key = Object.keys(row).find(name => name.replace(/\s/g, '').includes(category === 'cpu' ? 'CPU型號' : '顯示卡型號'));
                            if (!key || !row[key]) return;
                            const option = document.createElement('option'); option.value = row[key]; lists[category].appendChild(option);
                        });
                    });
                }
                const cpu = window.PsuFlow.resolveModel(rows[0], 'cpu', inputs.cpu.value);
                const gpu = window.PsuFlow.resolveModel(rows[1], 'gpu', inputs.gpu.value);
                for (const [category, match] of [['CPU', cpu], ['GPU', gpu]]) {
                    if (match.status !== 'matched') throw new Error(`${category} 型號${match.status === 'ambiguous' ? '對應多筆資料' : '或功耗資料不完整'}，請從上方選擇完整型號後再計算。`);
                }
                const driveCount = Number(drives.value);
                if (drives.value === '' || !Number.isInteger(driveCount) || driveCount < 0 || driveCount > 20) throw new Error('硬碟數量請填入 0 至 20 的整數。');
                const estimate = window.PsuFlow.estimate({ cpuWatts: cpu.watts, gpuWatts: gpu.watts, gpuRecommendedPsu: gpu.recommendedPsu, motherboardWatts: Number(motherboard.value), coolingWatts: Number(cooling.value), driveCount });
                result.replaceChildren();
                addTextElement(result, 'strong', '', `建議電源：${estimate.recommendedWatts} W`);
                addTextElement(result, 'span', '', `估算整機功耗：${estimate.totalWatts} W（CPU ${cpu.watts} W／GPU ${gpu.watts} W）`);
            } catch (error) { result.textContent = error.message; }
        }
        button.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
            button.textContent = panel.hidden ? '計算整機建議瓦數' : '收合瓦數計算';
            if (!panel.hidden) calculate();
        });
        card.appendChild(panel);
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

            card.appendChild(actions);
            addInlineCalculator(card, actions, item, index);

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
