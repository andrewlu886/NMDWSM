document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('valuation-form');
    const categoryTabs = document.querySelectorAll('.category-tab');
    const categoryInput = document.getElementById('category');
    const dynamicGroups = document.querySelectorAll('.valuation-dynamic-group');
    const resultEmpty = document.getElementById('result-empty');
    const resultContent = document.getElementById('result-content');
    const resultPrice = document.getElementById('result-price');
    const resultCategory = document.getElementById('result-category');
    const resultRange = document.getElementById('result-range');
    const resultConfidence = document.getElementById('result-confidence');

    // 分類標籤切換邏輯
    categoryTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 重置所有 Active 狀態
            categoryTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const selectedCategory = tab.dataset.category;
            categoryInput.value = selectedCategory;

            // 隱藏所有動態表單區塊
            dynamicGroups.forEach(group => group.hidden = true);

            // 根據選擇顯示對應表單區塊
            if (['cpu', 'gpu', 'motherboard'].includes(selectedCategory)) {
                document.getElementById('cpu-fields').hidden = false;
            } else if (selectedCategory === 'ram') {
                document.getElementById('ram-fields').hidden = false;
            } else if (selectedCategory === 'mouse') {
                document.getElementById('mouse-fields').hidden = false;
            } else if (selectedCategory === 'keyboard') {
                document.getElementById('keyboard-fields').hidden = false;
            }
        });
    });

    // 估價公式計算邏輯
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const category = categoryInput.value;
        let estimatedPrice = 0;
        let originalPrice = 0;

        // 預設產品標準總保固期 (以月為單位)
        const STANDARD_WARRANTY_PC = 36; // 核心硬體如 CPU/GPU/MB 預設 3 年保
        const STANDARD_WARRANTY_PERIPHERAL = 24; // 周邊如滑鼠/鍵盤 預設 2 年保

        // -----------------------------------------------------
        // 1. CPU / GPU / 主機板 計算邏輯
        // 根據 CPU.jpg 提供之公式：P1 = P0 * e^(-0.02 * t)
        // -----------------------------------------------------
        if (['cpu', 'gpu', 'motherboard'].includes(category)) {
            originalPrice = parseFloat(form.cpuOriginalPrice.value) || 0;
            const warrantyRemaining = parseFloat(form.cpuWarrantyMonths.value) || 0;

            // 推算已使用月數 t (總保固 - 剩餘保固)
            let t = STANDARD_WARRANTY_PC - warrantyRemaining;
            if (t < 0) t = 0; // 避免負值(延長保固等情況)

            estimatedPrice = originalPrice * Math.exp(-0.02 * t);
        }
        
        // -----------------------------------------------------
        // 2. RAM 記憶體 計算邏輯 (終身保固居多，採自定義微幅折舊)
        // -----------------------------------------------------
        else if (category === 'ram') {
            originalPrice = parseFloat(form.ramOriginalPrice.value) || 0;
            const condition = form.ramSpecialCondition.value;
            // 若有填寫特殊非功能性故障/損耗，扣減較多；否則一般視為 85 折左右
            let penalty = condition.trim().length > 0 ? 0.70 : 0.85;
            estimatedPrice = originalPrice * penalty;
        }
        
        // -----------------------------------------------------
        // 3. 滑鼠 / 鍵盤 計算邏輯
        // 根據 滑鼠.jpg / 鍵盤.jpg 提供之公式：
        // P1 = P0 * e^(-0.014 * t) * C - P0 * (1 - e^(-0.021 * t))
        // (耗損計算) - (保固消耗計算)
        // -----------------------------------------------------
        else if (['mouse', 'keyboard'].includes(category)) {
            let prefix = category === 'mouse' ? 'mouse' : 'keyboard';
            originalPrice = parseFloat(form[`${prefix}OriginalPrice`].value) || 0;
            const warrantyRemaining = parseFloat(form[`${prefix}WarrantyMonths`].value) || 0;
            const usageCondition = form[`${prefix}UsageCondition`].value;
            const appearanceCondition = form[`${prefix}AppearanceCondition`].value;

            // 推算已使用月數 t
            let t = STANDARD_WARRANTY_PERIPHERAL - warrantyRemaining;
            if (t < 0) t = 0;

            // 外觀係數 C 對照表 (參考圖中筆記：99新=0.83, 95新=0.71, 9成新=0.55, 8成新=0.43)
            let C = 0.75; // 預設「正常痕跡」(介於 95新~99新 之間)
            if (appearanceCondition === 'minor') C = 0.55; // 輕微打油/掉漆 (~9成新)
            if (appearanceCondition === 'heavy') C = 0.43; // 嚴重破損 (~8成新)

            // 功能損耗進一步扣減係數
            if (usageCondition === 'heavy') {
                C -= 0.15;
            } else if (usageCondition === 'minor') {
                C -= 0.05;
            }

            // 確保 C 不會過低或變負數
            C = Math.max(0.1, C);

            // 套入公式
            const wearTerm = Math.exp(-0.014 * t) * C;
            const warrantyTerm = 1 - Math.exp(-0.021 * t);

            estimatedPrice = (originalPrice * wearTerm) - (originalPrice * warrantyTerm);
        }

        // 確保價格不為負數
        estimatedPrice = Math.max(0, estimatedPrice);

        // -----------------------------------------------------
        // 渲染結果至畫面
        // -----------------------------------------------------
        resultEmpty.hidden = true;
        resultContent.hidden = false;

        const finalPrice = Math.round(estimatedPrice);
        
        // 產生上下 10% 的合理收購/販售價格區間
        const rangeMin = Math.round(finalPrice * 0.9);
        const rangeMax = Math.round(finalPrice * 1.1);

        const categoryNames = {
            cpu: 'CPU',
            gpu: '顯示卡',
            motherboard: '主機板',
            ram: '記憶體',
            mouse: '滑鼠',
            keyboard: '鍵盤'
        };

        // 加入一點載入感視覺效果
        resultContent.style.opacity = '0';
        setTimeout(() => {
            resultCategory.textContent = categoryNames[category] || category.toUpperCase();
            resultPrice.textContent = `NT$ ${finalPrice.toLocaleString()}`;
            resultRange.textContent = `NT$ ${rangeMin.toLocaleString()} - NT$ ${rangeMax.toLocaleString()}`;
            
            // 決定模型信心度
            if (originalPrice === 0) {
                resultConfidence.textContent = '無法評估 (缺少原價)';
                resultConfidence.style.color = '#ef4444';
            } else {
                resultConfidence.textContent = finalPrice > 0 ? '高 (85%) - 基於演算法與市價折舊' : '偏低 (硬體殘值過低)';
                resultConfidence.style.color = finalPrice > 0 ? '#10b981' : '#f59e0b';
            }
            
            resultContent.style.transition = 'opacity 0.4s ease';
            resultContent.style.opacity = '1';
        }, 100);
    });
});
