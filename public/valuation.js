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
    const cpuWarrantySelect = document.getElementById('cpu-warranty-months');
    const totalWarrantyLabel = document.getElementById('total-warranty-label');
    const totalWarrantyHint = document.getElementById('total-warranty-hint');
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

    function supportsFiveYearCpuWarranty(model) {
        if (categoryInput.value !== 'cpu') return false;
        const normalized = String(model || '').normalize('NFKC').toUpperCase();
        const match = normalized.match(/(?:CORE\s*)?I([579])[-\s]*(\d{4,5})/);
        if (!match) return false;
        const generation = Math.floor(Number(match[2]) / 1000);
        return generation === 13 || generation === 14;
    }

    function updateCpuWarrantyControl(model) {
        const showOptions = supportsFiveYearCpuWarranty(model);
        if (showOptions) {
            if (['36', '60'].includes(totalWarrantyInput.value)) {
                cpuWarrantySelect.value = totalWarrantyInput.value;
            }
            totalWarrantyInput.hidden = true;
            totalWarrantyInput.disabled = true;
            totalWarrantyInput.required = false;
            cpuWarrantySelect.hidden = false;
            cpuWarrantySelect.disabled = false;
            cpuWarrantySelect.required = true;
            totalWarrantyLabel.htmlFor = 'cpu-warranty-months';
            totalWarrantyHint.textContent = '此 CPU 可選擇 36 個月基本保固或 60 個月延長保固。';
            return;
        }

        if (!cpuWarrantySelect.hidden) totalWarrantyInput.value = cpuWarrantySelect.value;
        cpuWarrantySelect.hidden = true;
        cpuWarrantySelect.disabled = true;
        cpuWarrantySelect.required = false;
        totalWarrantyInput.hidden = false;
        totalWarrantyInput.disabled = false;
        totalWarrantyInput.required = true;
        totalWarrantyLabel.htmlFor = 'total-warranty-months';
        totalWarrantyHint.textContent = categoryInput.value === 'gpu'
            ? 'RTX 50 指定型號且保固為 36、48 或 60 個月時套用 NVIDIA 公式，不計商品狀況；其他情況沿用通用公式。'
            : '請填產品完整保固共有幾個月。';
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
            `已辨識 ${item.canonicalModel}，自動填入新品參考價 ${formatMoney(item.cpuPricing.referencePriceNtd)}（${item.cpuPricing.sourceName}，查價 ${item.cpuPricing.sourceCheckedAt}）。可直接修改，估價會以欄位內價格計算。`;
        return true;
    }

    function applyPrice(item) {
        if (item.referencePrice) {
            const price = item.referencePrice;
            originalPriceInput.value = price.priceNtd;
            originalPriceInput.dataset.autoFilled = 'reference';
            originalPriceLabel.textContent = price.basis === 'chipset_base'
                ? '晶片組估價基準價（NTD，非新品售價）' : '新品參考價（NTD）';
            originalPriceHint.textContent = `已帶入 ${formatMoney(price.priceNtd)} · ${price.notes}（來源：${price.source}）。修改後會以欄位內價格估價。`;
            return true;
        }
        if (applyCpuPrice(item)) return true;
        if (item.gpuPricing) {
            originalPriceInput.value = item.gpuPricing.launchPriceNtd;
            originalPriceInput.dataset.autoFilled = 'amd';
            originalPriceLabel.textContent = '模型發售價（NTD）';
            originalPriceHint.textContent = `已帶入 ${item.canonicalModel} 的模型發售價 ${formatMoney(item.gpuPricing.launchPriceNtd)}。修改後會以欄位內價格估價。`;
            return true;
        }
        clearAutoFilledPrice();
        originalPriceHint.textContent = '此型號尚未收錄價格，請手動輸入。';
        return false;
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
        originalPriceLabel.textContent = '模型發售價（NTD）';
        originalPriceHint.textContent =
            `已辨識 ${matched.canonicalModel}，自動填入模型發售價 ${formatMoney(matched.gpuPricing.launchPriceNtd)}。修改後會以欄位內價格估價。`;
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
        updateCpuWarrantyControl(item.canonicalModel);
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
            title.textContent = item.canonicalModel.startsWith(item.manufacturer)
                ? item.canonicalModel : `${item.manufacturer} ${item.canonicalModel}`;
            const detail = document.createElement('span');
            const price = item.referencePrice?.priceNtd ?? item.cpuPricing?.referencePriceNtd ?? item.gpuPricing?.launchPriceNtd;
            detail.textContent = `${item.series} · ${price == null ? '尚無參考價' : formatMoney(price)}${item.referencePrice?.basis === 'chipset_base' ? '（基準底價，非完整產品型號）' : ''}`;
            button.append(title, detail);
            button.addEventListener('click', () => {
                modelInput.value = item.canonicalModel;
                modelIdInput.value = item.id;
                delete originalPriceInput.dataset.userEdited;
                applyPrice(item);
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
        if (!['cpu', 'gpu', 'motherboard'].includes(category) || query.length < 2) {
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
            if (category !== categoryInput.value || query !== modelInput.value.trim()) return;
            renderSuggestions(result.data);
            const normalizedQuery = normalizeModel(query);
            const exactMatch = result.data.find(
                (item) => normalizeModel(item.canonicalModel) === normalizedQuery
                    || normalizeModel(`${item.manufacturer} ${item.canonicalModel}`) === normalizedQuery
            );
            if (exactMatch) {
                modelIdInput.value = exactMatch.id;
                if (!originalPriceInput.dataset.userEdited) applyPrice(exactMatch);
                showDetected(exactMatch);
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
        if (searchController) searchController.abort();
        clearAutoFilledPrice();
        delete originalPriceInput.dataset.userEdited;
        clearDetected();
        hideSuggestions();
        updateCpuWarrantyControl(modelInput.value);
        if (categoryInput.value === 'gpu') {
            originalPriceHint.textContent = '正在查詢顯示卡型號與參考價…';
        } else if (categoryInput.value === 'cpu') {
            originalPriceHint.textContent = '正在查詢已收錄的 CPU 新品價格…';
        }
        scheduleSearch();
    });
    modelInput.addEventListener('focus', scheduleSearch);
    originalPriceInput.addEventListener('input', () => {
        delete originalPriceInput.dataset.autoFilled;
        originalPriceInput.dataset.userEdited = 'true';
        originalPriceHint.textContent = Number(originalPriceInput.value) > 0
            ? `已改為 ${formatMoney(originalPriceInput.value)}；估價會以目前欄位價格計算。`
            : '請填入大於 0 的價格；已收錄型號也可重新選取來帶入參考價。';
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.model-search-field')) hideSuggestions();
    });

    document.querySelectorAll('.category-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            if (searchController) searchController.abort();
            window.clearTimeout(searchTimer);
            document.querySelectorAll('.category-tab').forEach((item) => {
                const active = item === tab;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', String(active));
            });
            categoryInput.value = tab.dataset.category;
            modelInput.value = '';
            originalPriceInput.value = '';
            delete originalPriceInput.dataset.autoFilled;
            delete originalPriceInput.dataset.userEdited;
            totalWarrantyInput.value = '';
            cpuWarrantySelect.value = '36';
            modelInput.placeholder = fieldExamples[tab.dataset.category].model;
            clearDetected();
            hideSuggestions();
            formMessage.textContent = '';
            const isGpu = tab.dataset.category === 'gpu';
            conditionField.hidden = !isGpu;
            if (!isGpu) conditionSelect.value = 'good';
            originalPriceInput.required = !isGpu;
            originalPriceLabel.textContent = tab.dataset.category === 'motherboard'
                ? '參考價／晶片組估價基準價（NTD）' : '新品參考價（NTD）';
            originalPriceHint.textContent = {
                cpu: '選取已收錄 CPU 可帶入新品參考價；修改後以欄位內價格估價。',
                gpu: '已收錄顯示卡可帶入參考價，AMD 模型帶入發售價；修改後以欄位內價格估價。',
                motherboard: '晶片組資料為二手估價基準底價，非新品售價；修改後以欄位內價格估價。',
                ram: '記憶體尚未收錄型號價格，請手動填入；估價以欄位內價格計算。'
            }[tab.dataset.category];
            const hasAutocomplete = ['cpu', 'gpu', 'motherboard'].includes(tab.dataset.category);
            modelHint.textContent = hasAutocomplete
                ? '輸入至少 2 個字元即可搜尋型號。'
                : tab.dataset.category === 'gpu'
                    ? '請手動輸入完整顯示卡型號，系統會在送出後辨識保固資料。'
                    : '此分類尚未收錄型號，可手動輸入並使用分類預設保固。';
            updateCpuWarrantyControl('');
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
            totalWarrantyMonths: Number(cpuWarrantySelect.hidden
                ? totalWarrantyInput.value
                : cpuWarrantySelect.value),
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
            document.getElementById('result-category').textContent = categoryNames[payload.category];
            document.getElementById('result-price').textContent = formatMoney(result.price);
            document.getElementById('result-range').textContent =
                `${formatMoney(result.range.min)} – ${formatMoney(result.range.max)}`;
            document.getElementById('result-model').textContent =
                `${result.hardware.canonicalBrand} ${result.hardware.canonicalModel}`;
            document.getElementById('result-warranty').textContent = formatWarranty(result.warranty);
            const nvidiaNote = result.pricingFormula === 'nvidia_rtx50_warranty_decay'
                ? `已套用 NVIDIA RTX 50 公式（k=${result.calculation.k}，g=${result.calculation.warrantyRate}${result.calculation.estimatedWarrantyRate ? '，此保固係數為推算值' : ''}）；過保後不再增加衰減，商品狀況不計入。`
                : '';
            document.getElementById('result-note').textContent =
                [result.fallbackReason, nvidiaNote, result.warranty.note].filter(Boolean).join(' ');
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
