const categoryNames = {
    cpu: 'CPU',
    gpu: '顯示卡',
    ram: '記憶體',
    ssd: 'SSD',
    motherboard: '主機板',
    mouse: '滑鼠',
    keyboard: '鍵盤'
};

const form = document.getElementById('valuation-form');
const categoryInput = document.getElementById('category');
const submitButton = document.getElementById('valuation-submit');
const formMessage = document.getElementById('form-message');
const modelBadge = document.getElementById('model-badge');
const resultEmpty = document.getElementById('result-empty');
const resultContent = document.getElementById('result-content');
const fieldGroups = document.querySelectorAll('.valuation-dynamic-group');

function updateCategoryFields() {
    const selectedCategory = categoryInput.value;

    fieldGroups.forEach(group => {
        group.setAttribute('hidden', 'hidden');
    });

    const activeGroup = document.getElementById(`${selectedCategory}-fields`);
    if (activeGroup) {
        activeGroup.removeAttribute('hidden');
    }
}

document.querySelectorAll('.category-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.category-tab').forEach(item => {
            const selected = item === tab;
            item.classList.toggle('active', selected);
            item.setAttribute('aria-selected', String(selected));
        });

        const selectedCategory = tab.getAttribute('data-category');
        if (categoryInput) {
            categoryInput.value = selectedCategory;
        }

        document.getElementById('result-category').textContent = categoryNames[selectedCategory];
        updateCategoryFields();
    });
});

updateCategoryFields();

form.addEventListener('submit', async event => {
    event.preventDefault();
    formMessage.textContent = '';
    submitButton.disabled = true;
    submitButton.querySelector('span').textContent = '模型估價中...';

    const data = new FormData(form);
    const category = data.get('category'); // 取得當前的分類

    // 動態組合對應分類的 payload 資料
    const payload = {
        category: category,
        brand: String(data.get('brand') || '').trim(),
        model: String(data.get('model') || '').trim(),
        originalPrice: Number(data.get(`${category}OriginalPrice`)),
        warrantyMonths: Number(data.get(`${category}WarrantyMonths`) || 0),
        // 滑鼠與鍵盤專屬欄位
        usageCondition: data.get(`${category}UsageCondition`),
        appearanceCondition: data.get(`${category}AppearanceCondition`),
        // RAM 專屬欄位
        specialCondition: data.get(`${category}SpecialCondition`)
    };

    try {
        const response = await fetch('/api/valuation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (!response.ok || result.success === false) {
            throw new Error(result.message || '模型暫時無法完成估價。');
        }

        renderValuation(result.data || result, payload.category);
        modelBadge.textContent = '模型已連接';
        modelBadge.classList.add('ready');
    } catch (error) {
        resultContent.hidden = true;
        resultEmpty.hidden = false;
        formMessage.textContent = error.message;
    } finally {
        submitButton.disabled = false;
        submitButton.querySelector('span').textContent = '✨ 開始估價';
    }
});

function renderValuation(data, category) {
    const estimatedPrice = firstNumber(data.estimatedPrice, data.estimated_price, data.price, data.prediction);
    if (estimatedPrice === null) {
        throw new Error('模型已回應，但沒有可顯示的估價金額。');
    }

    const minPrice = firstNumber(data.minPrice, data.min_price, data.priceRange?.min, data.range?.min);
    const maxPrice = firstNumber(data.maxPrice, data.max_price, data.priceRange?.max, data.range?.max);
    const confidence = firstNumber(data.confidence, data.confidenceScore, data.confidence_score);

    document.getElementById('result-price').textContent = formatCurrency(estimatedPrice);
    document.getElementById('result-range').textContent = minPrice !== null && maxPrice !== null
        ? `${formatCurrency(minPrice)} ～ ${formatCurrency(maxPrice)}`
        : '模型未提供';
    document.getElementById('result-category').textContent = categoryNames[category] || category;
    document.getElementById('result-confidence').textContent = confidence === null
        ? '模型未提供'
        : `${confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence)}%`;

    resultEmpty.hidden = true;
    resultContent.hidden = false;
}

function firstNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (value !== null && value !== undefined && value !== '' && Number.isFinite(number)) return number;
    }
    return null;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        maximumFractionDigits: 0
    }).format(value);
}

const loggedInUser = localStorage.getItem('userEmail');
const userName = localStorage.getItem('userName');
if (loggedInUser) {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('user-profile').style.display = 'flex';
    document.getElementById('user-display-name').textContent = userName || loggedInUser.split('@')[0];
}

document.getElementById('logout-link').addEventListener('click', event => {
    event.preventDefault();
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    window.location.reload();
});