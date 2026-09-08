/* eslint-env browser */
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('valuation-form');
    const categoryInput = document.getElementById('category');
    const modelInput = document.getElementById('model');
    const modelIdInput = document.getElementById('model-id');
    const suggestions = document.getElementById('model-suggestions');
    const modelHint = document.getElementById('model-hint');
    const extensionField = document.getElementById('extension-field');
    const extensionSelect = document.getElementById('extension-registered');
    const totalWarrantyInput = document.getElementById('total-warranty-months');
    const conditionField = document.getElementById('condition-field');
    const conditionSelect = document.getElementById('condition');
    const detectedPanel = document.getElementById('detected-hardware');
    const submitButton = document.getElementById('valuation-submit');
    const formMessage = document.getElementById('form-message');
    const originalPriceInput = document.getElementById('original-price');
    const originalPriceLabel = document.getElementById('original-price-label');
    const originalPriceHint = document.getElementById('original-price-hint');
    let searchTimer;
    let searchController;
    let selectedModel = null;

    const categoryNames = {
        cpu: 'CPU',
        gpu: '顯示卡',
        motherboard: '主機板',
        ram: '記憶體'
    };
    const matchLabels = {
        exact_model: '精確型號',
        series: '系列保固規則',
        brand_category: '品牌分類保固規則',
        category_default: '分類預設資料',
        user_input: '使用者填寫資料'
    };
    const fieldExamples = {
        cpu: { model: '例如：Intel Core Ultra 7 265K' },
        gpu: { model: '例如：ASUS TUF Gaming RTX 4070 Super' },
        motherboard: { model: '例如：ASUS TUF Gaming B650-Plus WiFi' },
        ram: { model: '例如：Kingston Fury Beast DDR5-6000 32GB' }
    };

    function formatMoney(value) {
        return `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`;
    }

    function normalizeModel(value) {
        return String(value || '')
            .normalize('NFKC')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
    }

    function clearAutoFilledPrice() {
        if (originalPriceInput.dataset.autoFilled) {
            originalPriceInput.value = '';
            delete originalPriceInput.dataset.autoFilled;
        }
    }

    function applyCpuPrice(item) {
        if (!item || !item.cpuPricing) return false;
        originalPriceInput.value = item.cpuPricing.referencePriceNtd;
        originalPriceInput.dataset.autoFilled = 'cpu';
        originalPriceHint.textContent =
            `已辨識 ${item.canonicalModel}，自動填入新品參考價 ${formatMoney(item.cpuPricing.referencePriceNtd)}（${item.cpuPricing.sourceName}，查價 ${item.cpuPricing.sourceCheckedAt}）。`;
        return true;
    }

    function applyAmdGpuPrice(items, query) {
        hideSuggestions();
        const normalizedQuery = normalizeModel(query);
        const matched = items
            .filter((item) => item.gpuPricing && normalizedQuery.includes(normalizeModel(item.canonicalModel)))
            .sort((left, right) => normalizeModel(right.canonicalModel).length - normalizeModel(left.canonicalModel).length)[0];

        if (!matched) {
            clearAutoFilledPrice();
            originalPriceHint.textContent = '尚未辨識到已收錄的 AMD 型號，請手動填寫新品參考價。';
            return;
        }

        modelIdInput.value = matched.id;
        originalPriceInput.value = matched.gpuPricing.launchPriceNtd;
        originalPriceInput.dataset.autoFilled = 'amd';
        originalPriceHint.textContent =
            `已辨識 ${matched.canonicalModel}，自動填入新品參考價 ${formatMoney(matched.gpuPricing.launchPriceNtd)}。`;
        showDetected(matched);
    }

    function formatWarranty(warranty) {
        if (!warranty) return '尚未查詢';
        if (warranty.type === 'limited_lifetime') return '有限終身保固（以原廠條款為準）';
        if (warranty.isExpired) return `共 ${warranty.totalMonths} 個月，已過保 ${warranty.expiredByMonths} 個月`;
        const extensionText = warranty.registrationApplied ? '（已計入登錄延保）' : '';
        return `共 ${warranty.totalMonths} 個月，剩餘 ${warranty.remainingMonths} 個月${extensionText}`;
    }

    function showDetected(item) {
        selectedModel = item;
        detectedPanel.hidden = false;
        document.getElementById('detected-model').textContent =
            `${item.manufacturer} ${item.canonicalModel}`;
        extensionField.hidden = !item.warranty.extensionAvailable;
        if (!item.warranty.extensionAvailable) extensionSelect.value = 'unknown';
    }

    function clearDetected() {
        selectedModel = null;
        modelIdInput.value = '';
        detectedPanel.hidden = true;
        extensionField.hidden = true;
        extensionSelect.value = 'unknown';
    }

    function hideSuggestions() {
        suggestions.hidden = true;
        suggestions.replaceChildren();
    }

    function renderSuggestions(items) {
        suggestions.replaceChildren();
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'model-suggestion-empty';
            empty.textContent = '找不到精確型號，仍可使用分類預設保固進行測試。';
            suggestions.appendChild(empty);
            suggestions.hidden = false;
            return;
        }
        items.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'model-suggestion';
            button.setAttribute('role', 'option');
            const title = document.createElement('strong');
            title.textContent = `${item.manufacturer} ${item.canonicalModel}`;
            const detail = document.createElement('span');
            detail.textContent = `${item.series} · ${formatWarranty(item.warranty)}`;
            button.append(title, detail);
            button.addEventListener('click', () => {
                modelInput.value = item.canonicalModel;
                modelIdInput.value = item.id;
                if (!applyCpuPrice(item) && categoryInput.value === 'cpu') {
                    clearAutoFilledPrice();
                    originalPriceHint.textContent = '此型號目前沒有可靠的新品現貨報價，請手動填寫新品參考價。';
                }
                showDetected(item);
                hideSuggestions();
            });
            suggestions.appendChild(button);
        });
        suggestions.hidden = false;
    }

    async function searchModels() {
        const category = categoryInput.value;
        const query = modelInput.value.trim();
        if (!['cpu', 'gpu'].includes(category) || query.length < 2) {
            hideSuggestions();
            return;
        }
        if (searchController) searchController.abort();
        searchController = new AbortController();
        const params = new URLSearchParams({
            category,
            q: query,
            limit: '8'
        });
        try {
            const response = await fetch(`/api/valuation/models?${params}`, {
                signal: searchController.signal
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || '型號查詢失敗');
            if (category === 'gpu') {
                applyAmdGpuPrice(result.data, query);
            } else {
                renderSuggestions(result.data);
                const normalizedQuery = normalizeModel(query);
                const exactMatch = result.data.find(
                    (item) => normalizeModel(item.canonicalModel) === normalizedQuery
                        || normalizeModel(`${item.manufacturer} ${item.canonicalModel}`) === normalizedQuery
                );
                if (exactMatch) {
                    modelIdInput.value = exactMatch.id;
                    if (!applyCpuPrice(exactMatch)) {
                        clearAutoFilledPrice();
                        originalPriceHint.textContent = '此型號目前沒有可靠的新品現貨報價，請手動填寫新品參考價。';
                    }
                    showDetected(exactMatch);
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                formMessage.textContent = '型號建議暫時無法載入，仍可手動填寫。';
            }
        }
    }

    function scheduleSearch() {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(searchModels, 180);
    }

    modelInput.addEventListener('input', () => {
        clearAutoFilledPrice();
        clearDetected();
        if (categoryInput.value === 'gpu') {
            originalPriceHint.textContent = '正在辨識 AMD 顯示卡型號…';
        } else if (categoryInput.value === 'cpu') {
            originalPriceHint.textContent = '正在查詢已收錄的 CPU 新品價格…';
        }
        scheduleSearch();
    });
    modelInput.addEventListener('focus', scheduleSearch);
    originalPriceInput.addEventListener('input', () => {
        delete originalPriceInput.dataset.autoFilled;
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.model-search-field')) hideSuggestions();
    });

    document.querySelectorAll('.category-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.category-tab').forEach((item) => {
                const active = item === tab;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', String(active));
            });
            categoryInput.value = tab.dataset.category;
            modelInput.value = '';
            originalPriceInput.value = '';
            delete originalPriceInput.dataset.autoFilled;
            totalWarrantyInput.value = '';
            modelInput.placeholder = fieldExamples[tab.dataset.category].model;
            clearDetected();
            hideSuggestions();
            formMessage.textContent = '';
            const isGpu = tab.dataset.category === 'gpu';
            conditionField.hidden = !isGpu;
            if (!isGpu) conditionSelect.value = 'good';
            originalPriceInput.required = !isGpu;
            originalPriceLabel.textContent = isGpu
                ? '新品參考價（未收錄型號使用）'
                : '目前全新參考價（NTD）';
            originalPriceHint.textContent = isGpu
                ? '已收錄的 AMD 型號會自動採用同學模型中的發售原價，可留空。'
                : tab.dataset.category === 'cpu'
                    ? '選擇有報價的 CPU 型號後會自動填入台灣新品參考價。'
                    : '';
            const hasAutocomplete = tab.dataset.category === 'cpu';
            modelHint.textContent = hasAutocomplete
                ? '輸入至少 2 個字元即可搜尋型號。'
                : tab.dataset.category === 'gpu'
                    ? '請手動輸入完整顯示卡型號，系統會在送出後辨識保固資料。'
                    : '此分類尚未收錄型號，可手動輸入並使用分類預設保固。';
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        submitButton.disabled = true;
        submitButton.textContent = '處理中...';
        formMessage.textContent = '';
        const payload = {
            category: categoryInput.value,
            brand: '',
            model: modelInput.value.trim(),
            modelId: modelIdInput.value ? Number(modelIdInput.value) : null,
            originalPrice: Number(document.getElementById('original-price').value),
            totalWarrantyMonths: Number(totalWarrantyInput.value),
            elapsedMonths: Number(document.getElementById('elapsed-months').value),
            extensionRegistered: extensionSelect.value,
            condition: conditionSelect.value,
            details: {}
        };

        try {
            const response = await fetch('/api/valuation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || '估價失敗');

            document.getElementById('result-empty').hidden = true;
            document.getElementById('result-content').hidden = false;
            const warning = document.getElementById('test-warning');
            warning.hidden = result.pricingMode === 'official';
            warning.textContent = result.warning || '';
            document.getElementById('result-category').textContent = categoryNames[payload.category];
            document.getElementById('result-price').textContent = formatMoney(result.price);
            document.getElementById('result-range').textContent =
                `${formatMoney(result.range.min)} – ${formatMoney(result.range.max)}`;
            document.getElementById('result-model').textContent =
                `${result.hardware.canonicalBrand} ${result.hardware.canonicalModel}`;
            document.getElementById('result-warranty').textContent = formatWarranty(result.warranty);
            document.getElementById('result-note').textContent =
                [result.fallbackReason, result.warranty.note].filter(Boolean).join(' ');
            detectedPanel.hidden = false;
            document.getElementById('detected-model').textContent =
                `${result.hardware.canonicalBrand} ${result.hardware.canonicalModel}`;
            extensionField.hidden = !result.warranty.extensionAvailable;
        } catch (error) {
            formMessage.textContent = error.message || '估價失敗，請稍後再試。';
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = '開始估價';
        }
    });

});
