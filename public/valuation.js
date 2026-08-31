/* eslint-env browser */
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('valuation-form');
    const categoryInput = document.getElementById('category');
    const modelInput = document.getElementById('model');
    const modelIdInput = document.getElementById('model-id');
    const brandInput = document.getElementById('brand');
    const suggestions = document.getElementById('model-suggestions');
    const modelHint = document.getElementById('model-hint');
    const brandHint = document.getElementById('brand-hint');
    const extensionField = document.getElementById('extension-field');
    const extensionSelect = document.getElementById('extension-registered');
    const elapsedMonthsInput = document.getElementById('elapsed-months');
    const detectedPanel = document.getElementById('detected-hardware');
    const submitButton = document.getElementById('valuation-submit');
    const formMessage = document.getElementById('form-message');
    const conditionField = document.getElementById('condition-field');
    const peripheralFields = document.getElementById('peripheral-fields');
    const usageCondition = document.getElementById('usage-condition');
    const appearanceCondition = document.getElementById('appearance-condition');
    let searchTimer;
    let searchController;
    let selectedModel = null;

    const categoryNames = {
        cpu: 'CPU',
        gpu: '顯示卡',
        motherboard: '主機板',
        ram: '記憶體',
        mouse: '滑鼠',
        keyboard: '鍵盤'
    };
    const matchLabels = {
        exact_model: '精確型號',
        series: '系列保固規則',
        brand_category: '品牌分類保固規則',
        category_default: '分類預設資料'
    };
    const fieldExamples = {
        cpu: { brand: '例如：Intel、AMD', model: '例如：Intel Core Ultra 7 265K' },
        gpu: { brand: '例如：ASUS、微星、技嘉', model: '例如：ASUS TUF Gaming RTX 4070 Super' },
        motherboard: { brand: '例如：ASUS、微星、技嘉、華擎', model: '例如：ASUS TUF Gaming B650-Plus WiFi' },
        ram: { brand: '例如：Kingston、威剛、芝奇', model: '例如：Kingston Fury Beast DDR5-6000 32GB' },
        mouse: { brand: '例如：Logitech、Razer、ROG', model: '例如：Logitech G Pro X Superlight 2' },
        keyboard: { brand: '例如：Keychron、Ducky、Logitech', model: '例如：Keychron K8 Pro' }
    };

    function formatMoney(value) {
        return `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`;
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
        document.getElementById('detected-match').textContent =
            matchLabels[item.warranty.matchLevel] || '型號資料已匹配';
        extensionField.hidden = !item.warranty.extensionAvailable;
        if (!item.warranty.extensionAvailable) extensionSelect.value = 'unknown';
        updateDetectedWarranty();
    }

    function updateDetectedWarranty() {
        if (!selectedModel) return;
        const warranty = { ...selectedModel.warranty };
        warranty.elapsedMonths = Math.max(0, Number(elapsedMonthsInput.value) || 0);
        warranty.registrationApplied = Boolean(
            warranty.extensionAvailable && extensionSelect.value === 'yes'
        );
        if (warranty.type === 'months') {
            warranty.totalMonths = Number(warranty.baseMonths || 0) +
                (warranty.registrationApplied ? Number(warranty.extensionMonths || 0) : 0);
            warranty.remainingMonths = Math.max(warranty.totalMonths - warranty.elapsedMonths, 0);
            warranty.expiredByMonths = Math.max(warranty.elapsedMonths - warranty.totalMonths, 0);
            warranty.isExpired = warranty.elapsedMonths > warranty.totalMonths;
        }
        document.getElementById('detected-warranty').textContent = formatWarranty(warranty);
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
                if (categoryInput.value === 'cpu') brandInput.value = item.manufacturer;
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
        if (category !== 'cpu' || query.length < 2) {
            hideSuggestions();
            return;
        }
        if (searchController) searchController.abort();
        searchController = new AbortController();
        const params = new URLSearchParams({
            category,
            q: query,
            brand: brandInput.value.trim(),
            limit: '8'
        });
        try {
            const response = await fetch(`/api/valuation/models?${params}`, {
                signal: searchController.signal
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || '型號查詢失敗');
            renderSuggestions(result.data);
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
        clearDetected();
        scheduleSearch();
    });
    modelInput.addEventListener('focus', scheduleSearch);
    brandInput.addEventListener('input', () => {
        if (selectedModel) {
            clearDetected();
        }
        scheduleSearch();
    });
    elapsedMonthsInput.addEventListener('input', updateDetectedWarranty);
    extensionSelect.addEventListener('change', updateDetectedWarranty);
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
            brandInput.value = '';
            brandInput.placeholder = fieldExamples[tab.dataset.category].brand;
            modelInput.placeholder = fieldExamples[tab.dataset.category].model;
            clearDetected();
            hideSuggestions();
            formMessage.textContent = '';
            const isPeripheral = ['mouse', 'keyboard'].includes(tab.dataset.category);
            conditionField.hidden = isPeripheral;
            peripheralFields.hidden = !isPeripheral;
            const hasAutocomplete = tab.dataset.category === 'cpu';
            modelHint.textContent = hasAutocomplete
                ? '輸入至少 2 個字元即可搜尋型號。'
                : tab.dataset.category === 'gpu'
                    ? '請手動輸入完整顯示卡型號，系統會在送出後辨識保固資料。'
                    : '此分類尚未收錄型號，可手動輸入並使用分類預設保固。';
            brandHint.textContent = tab.dataset.category === 'gpu'
                ? '請填板卡品牌，例如 ASUS、微星、技嘉；不是 NVIDIA 或 AMD。'
                : '請填產品外盒或本體標示的品牌。';
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        submitButton.disabled = true;
        submitButton.textContent = '處理中...';
        formMessage.textContent = '';
        const isPeripheral = ['mouse', 'keyboard'].includes(categoryInput.value);
        const conditionMap = { good: 'good', minor: 'fair', heavy: 'poor' };
        const payload = {
            category: categoryInput.value,
            brand: brandInput.value.trim(),
            model: modelInput.value.trim(),
            modelId: modelIdInput.value ? Number(modelIdInput.value) : null,
            originalPrice: Number(document.getElementById('original-price').value),
            elapsedMonths: Number(document.getElementById('elapsed-months').value),
            extensionRegistered: extensionSelect.value,
            condition: isPeripheral
                ? conditionMap[usageCondition.value]
                : document.getElementById('condition').value,
            details: isPeripheral
                ? {
                    usageCondition: usageCondition.value,
                    appearanceCondition: appearanceCondition.value
                }
                : {}
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
            document.getElementById('result-match').textContent = result.hardware.matched
                ? `型號已匹配；保固採${matchLabels[result.warranty.matchLevel] || '已知規則'}`
                : '找不到精確型號，使用分類預設資料';
            document.getElementById('result-warranty').textContent = formatWarranty(result.warranty);
            document.getElementById('result-note').textContent =
                [result.fallbackReason, result.warranty.note].filter(Boolean).join(' ');
            detectedPanel.hidden = false;
            document.getElementById('detected-model').textContent =
                `${result.hardware.canonicalBrand} ${result.hardware.canonicalModel}`;
            document.getElementById('detected-warranty').textContent = formatWarranty(result.warranty);
            document.getElementById('detected-match').textContent =
                matchLabels[result.warranty.matchLevel] || '資料已匹配';
            extensionField.hidden = !result.warranty.extensionAvailable;
        } catch (error) {
            formMessage.textContent = error.message || '估價失敗，請稍後再試。';
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = '開始估價';
        }
    });

    const loggedInUser = localStorage.getItem('userEmail');
    const userName = localStorage.getItem('userName');
    if (loggedInUser) {
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('user-profile').style.display = 'flex';
        document.getElementById('user-display-name').textContent = userName || loggedInUser.split('@')[0];
    }
    document.getElementById('user-profile').addEventListener('click', function () {
        const menu = this.querySelector('.dropdown-menu');
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });
    document.getElementById('logout-link').addEventListener('click', (event) => {
        event.preventDefault();
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userName');
        window.location.reload();
    });
});
