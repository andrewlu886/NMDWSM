const TEST_WARNING = '目前使用測試公式，結果僅供功能測試，不代表實際市場價格。';

const conditionFactors = {
  like_new: 0.92,
  good: 0.82,
  fair: 0.68,
  poor: 0.45
};

function calculateTestValuation(input) {
  const originalPrice = Number(input.originalPrice);
  const elapsedMonths = Math.max(0, Number(input.elapsedMonths) || 0);
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    throw new TypeError('新品參考價必須大於 0。');
  }

  // 僅供串接測試：正式公式完成後只需替換這個函式。
  const ageFactor = Math.max(0.2, 1 - Math.min(elapsedMonths, 120) * 0.008);
  const conditionFactor = conditionFactors[input.condition] || conditionFactors.good;
  const price = Math.max(0, Math.round(originalPrice * ageFactor * conditionFactor));

  return {
    success: true,
    pricingMode: 'test',
    warning: TEST_WARNING,
    price,
    range: {
      min: Math.round(price * 0.9),
      max: Math.round(price * 1.1)
    }
  };
}

module.exports = { TEST_WARNING, calculateTestValuation };
