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

function createResult(price, pricingFormula, calculation = null) {
  const roundedPrice = Math.max(0, Math.round(price));
  return {
    success: true,
    pricingMode: 'test',
    pricingFormula,
    warning: TEST_WARNING,
    price: roundedPrice,
    range: {
      min: Math.round(roundedPrice * 0.9),
      max: Math.round(roundedPrice * 1.1)
    },
    ...(calculation ? { calculation } : {})
  };
}

function requireOriginalPrice(input) {
  const originalPrice = Number(input.originalPrice);
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    throw new TypeError('新品參考價必須大於 0。');
  }
  return originalPrice;
}

function calculateCpuAndMotherboardValuation(input) {
  const originalPrice = requireOriginalPrice(input);
  const elapsedMonths = Math.max(0, Number(input.elapsedMonths) || 0);
  const monthlyDecayRate = 0.02;
  return createResult(
    originalPrice * Math.exp(-monthlyDecayRate * elapsedMonths),
    'cpu_motherboard_exponential',
    { originalPrice, elapsedMonths, monthlyDecayRate }
  );
}

function calculateAmdGpuValuation(input) {
  const elapsedMonths = Math.max(0, Number(input.elapsedMonths) || 0);
  const pricing = input.gpuPricing || {};
  const generation = Number(pricing.generation);
  const vramGb = Number(pricing.vramGb);
  const originalPrice = Number(pricing.launchPriceNtd);
  const floorPrice = Number(pricing.floorPriceNtd);
  const latestGeneration = Number(pricing.latestGeneration);
  const landingCoefficient = Number(pricing.landingCoefficient);
  const marketFactor = Number(pricing.marketFactor);
  const values = [generation, vramGb, originalPrice, floorPrice, latestGeneration, landingCoefficient, marketFactor];
  if (values.some(value => !Number.isFinite(value)) || originalPrice <= 0 || floorPrice < 0) {
    throw new TypeError('AMD 顯示卡定價參數不完整。');
  }

  const monthlyDecayRate = 0.020
    + 0.002 * (latestGeneration - generation)
    - 0.0006 * (vramGb - 8);
  const decayPrice = originalPrice
    * Math.exp(landingCoefficient)
    * Math.exp(-monthlyDecayRate * elapsedMonths);
  const price = Math.max(decayPrice, floorPrice) * (1 + marketFactor);
  return createResult(price, pricing.modelVersion || 'amd_dynamic_v9', {
    originalPrice,
    floorPrice,
    generation,
    vramGb,
    latestGeneration,
    landingCoefficient,
    monthlyDecayRate,
    marketFactor,
    elapsedMonths
  });
}

function calculateRamValuation(input) {
  const originalPrice = requireOriginalPrice(input);
  const elapsedMonths = Math.max(0, Math.floor(Number(input.elapsedMonths) || 0));
  let marketCorrection = 0;
  if (elapsedMonths >= 1 && elapsedMonths <= 5) marketCorrection = 0.241;
  else if (elapsedMonths >= 6 && elapsedMonths <= 8) marketCorrection = 0.465;
  else if (elapsedMonths === 9) marketCorrection = 0.772;
  else if (elapsedMonths >= 10) marketCorrection = 1.57;

  let decaySum = 0;
  for (let month = 1; month <= elapsedMonths; month += 1) {
    decaySum += -0.11 / month;
  }
  const hasSpecialDamage = Boolean(String(input.details?.specialCondition || '').trim());
  const damageFactor = hasSpecialDamage ? 0.8 : 1;
  const price = originalPrice * Math.exp(marketCorrection) * Math.exp(decaySum) * damageFactor;
  return createResult(price, 'ram_sigma_decay', {
    originalPrice,
    elapsedMonths,
    marketCorrection,
    decaySum,
    damageFactor
  });
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

function calculateValuation(input) {
  if (['cpu', 'motherboard'].includes(input.category)) {
    return calculateCpuAndMotherboardValuation(input);
  }
  if (input.category === 'gpu' && input.gpuPricing) {
    return calculateAmdGpuValuation(input);
  }
  if (input.category === 'ram') {
    return calculateRamValuation(input);
  }
  return calculateTestValuation(input);
}

module.exports = {
  TEST_WARNING,
  calculateValuation,
  calculateTestValuation,
  calculateCpuAndMotherboardValuation,
  calculateAmdGpuValuation,
  calculateRamValuation,
  calculatePeripheralValuation,
  getPeripheralBrandTier
};
