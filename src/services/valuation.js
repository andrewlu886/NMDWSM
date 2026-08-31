const TEST_WARNING = '目前使用測試公式，結果僅供功能測試，不代表實際市場價格。';

const conditionFactors = {
  like_new: 0.92,
  good: 0.82,
  fair: 0.68,
  poor: 0.45
};

const peripheralBrandTiers = {
  S: {
    k: 0.03,
    startAppearance: { good: 0.60, minor: 0.45, heavy: 0.25 },
    startUsage: { good: 0.35, minor: 0.30, heavy: 0.15 },
    floorAppearance: { good: 0.25, minor: 0.15, heavy: 0.05 },
    floorUsage: { good: 0.15, minor: 0.10, heavy: 0.05 }
  },
  A: {
    k: 0.06,
    startAppearance: { good: 0.50, minor: 0.35, heavy: 0.07 },
    startUsage: { good: 0.40, minor: 0.25, heavy: 0.08 },
    floorAppearance: { good: 0.25, minor: 0.10, heavy: 0.02 },
    floorUsage: { good: 0.15, minor: 0.10, heavy: 0.03 }
  },
  B: {
    k: 0.10,
    startAppearance: { good: 0.40, minor: 0.25, heavy: 0.10 },
    startUsage: { good: 0.25, minor: 0.15, heavy: 0.05 },
    floorAppearance: { good: 0.10, minor: 0.05, heavy: 0 },
    floorUsage: { good: 0.05, minor: 0.05, heavy: 0 }
  }
};

function getPeripheralBrandTier(brandInput) {
  const brand = String(brandInput || '').toLowerCase().trim();
  if (/wooting|finalmouse|vaxee|zowie|hhkb|leopold|matrix|keycult|rog|asus/i.test(brand)) return 'S';
  if (/logitech|logi|razer|keychron|ducky|steelseries|corsair|hyperx|akko/i.test(brand)) return 'A';
  if (/lexma|bfriend|fantech|rapoo|dareu|e-yooso/i.test(brand)) return 'B';
  return 'A';
}

function calculatePeripheralValuation(input) {
  const originalPrice = Number(input.originalPrice);
  const elapsedMonths = Math.max(0, Number(input.elapsedMonths) || 0);
  const usage = ['good', 'minor', 'heavy'].includes(input.details?.usageCondition)
    ? input.details.usageCondition
    : 'good';
  const appearance = ['good', 'minor', 'heavy'].includes(input.details?.appearanceCondition)
    ? input.details.appearanceCondition
    : 'good';
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    throw new TypeError('新品參考價必須大於 0。');
  }

  const tierKey = getPeripheralBrandTier(input.brand);
  const tier = peripheralBrandTiers[tierKey];
  const startRatio = tier.startAppearance[appearance] + tier.startUsage[usage];
  const floorRatio = tier.floorAppearance[appearance] + tier.floorUsage[usage];
  const startPrice = originalPrice * startRatio;
  const floorPrice = originalPrice * floorRatio;
  const price = Math.max(0, Math.round(
    floorPrice + (startPrice - floorPrice) * Math.exp(-tier.k * elapsedMonths)
  ));

  return {
    success: true,
    pricingMode: 'test',
    pricingFormula: 'peripheral_brand_tier',
    warning: TEST_WARNING,
    price,
    range: {
      min: Math.round(price * 0.9),
      max: Math.round(price * 1.1)
    }
  };
}

function calculateTestValuation(input) {
  if (['mouse', 'keyboard'].includes(input.category)) {
    return calculatePeripheralValuation(input);
  }
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
    pricingFormula: 'generic_test',
    warning: TEST_WARNING,
    price,
    range: {
      min: Math.round(price * 0.9),
      max: Math.round(price * 1.1)
    }
  };
}

module.exports = {
  TEST_WARNING,
  calculateTestValuation,
  calculatePeripheralValuation,
  getPeripheralBrandTier
};
