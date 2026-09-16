const TEST_WARNING = '目前使用測試公式，結果僅供功能測試，不代表實際市場價格。';
const UNSUPPORTED_MODEL_MESSAGE = '目前尚未支援此型號';
const { valuationFormulaRules } = require('../data/valuation-formulas');

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
  const formulaConfig = getFormulaConfig(input);
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
  const tier = formulaConfig.peripheralBrandTiers[tierKey];
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
  if (input.category === 'cpu' && isLegacyIntelCoreCpuModel(input.model)) {
    throw new TypeError(UNSUPPORTED_MODEL_MESSAGE);
  }
  const originalPrice = requireOriginalPrice(input);
  const elapsedMonths = Math.max(0, Number(input.elapsedMonths) || 0);
  const monthlyDecayRate = Number(getFormulaConfig(input).motherboard.monthlyDecayRate);
  return createResult(
    originalPrice * Math.exp(-monthlyDecayRate * elapsedMonths),
    'cpu_motherboard_exponential',
    { originalPrice, elapsedMonths, monthlyDecayRate }
  );
}

const intelCpuPricingProfiles = {
  i3_12_14: { k: 0.223, warrantyRate: 0.013, warrantyDecay: 'linear', marketRate: 0.001, postWarrantyRate: 0.021 },
  i5_12_13: { k: 0.139, warrantyRate: 0.005, extendedWarrantyRate: 0.003, warrantyDecay: 'linear', marketRate: 0.003, postWarrantyRate: 0.021 },
  i5_14_ultra: { k: 0.139, warrantyRate: 0.024, extendedWarrantyRate: 0.021, warrantyDecay: 'harmonic', marketRate: 0.003, postWarrantyRate: 0.021 },
  i7_12_ultra: { k: 0.108, warrantyRate: 0.022, extendedWarrantyRate: 0.0196, warrantyDecay: 'harmonic', marketRate: 0.004, postWarrantyRate: 0.0016 },
  i9_12_ultra: { k: 0.09, warrantyRate: 0.013, extendedWarrantyRate: 0.0078, warrantyDecay: 'linear', marketRate: 0.001, postWarrantyRate: 0.004 }
};

function getFormulaConfig(input = {}) {
  const stored = input.formulaConfig || {};
  return {
    conditionFactors: stored.conditionFactors || conditionFactors,
    peripheralBrandTiers: stored.peripheralBrandTiers || peripheralBrandTiers,
    motherboard: stored.motherboard || { monthlyDecayRate: 0.02 },
    intelProfiles: stored.intelProfiles || intelCpuPricingProfiles,
    amdGpu: stored.amdGpu || { baseMonthlyDecayRate: 0.020, generationFactor: 0.002, vramFactor: -0.0006 },
    nvidiaGpu: stored.nvidiaGpu || valuationFormulaRules.nvidiaGpu,
    ram: stored.ram || valuationFormulaRules.ram,
    generic: stored.generic || { maxMonths: 120, monthlyAgeRate: 0.008, minimumAgeFactor: 0.2 }
  };
}

function calculateWarrantyDecay(profile, warrantyRate, inWarrantyMonths) {
  if (profile.warrantyDecay !== 'harmonic') {
    return warrantyRate * inWarrantyMonths;
  }

  let decay = 0;
  const wholeMonths = Math.floor(inWarrantyMonths);
  for (let month = 1; month <= wholeMonths; month += 1) {
    decay += warrantyRate / month;
  }

  const partialMonth = inWarrantyMonths - wholeMonths;
  if (partialMonth > 0) {
    decay += (warrantyRate / (wholeMonths + 1)) * partialMonth;
  }
  return decay;
}

function isLegacyIntelCoreCpuModel(modelInput) {
  const model = String(modelInput || '').normalize('NFKC').toUpperCase();
  const match = model.match(/(?:^|[^A-Z0-9])(?:INTEL[\s-]+)?(?:CORE[\s-]+)?I[3579][\s-]*(\d{3,5})(?!\d)/);
  if (!match) return false;
  const digits = match[1];
  const firstTwo = Number(digits.slice(0, 2));
  const generation = digits.length === 3 ? 1
    : digits.length === 5 || (firstTwo >= 10 && firstTwo <= 19)
      ? firstTwo : Number(digits[0]);
  return generation >= 1 && generation <= 11;
}

function getIntelCpuPricingProfile(modelInput, formulaProfiles = intelCpuPricingProfiles) {
  const model = String(modelInput || '').normalize('NFKC').toUpperCase();
  const ultraMatch = model.match(/CORE\s*ULTRA\s*([3579])/);
  if (ultraMatch) {
    const tier = Number(ultraMatch[1]);
    if (tier === 5) return { id: 'i5_14_ultra', tier, generation: 'ultra', ...formulaProfiles.i5_14_ultra };
    if (tier === 7) return { id: 'i7_12_ultra', tier, generation: 'ultra', ...formulaProfiles.i7_12_ultra };
    if (tier === 9) return { id: 'i9_12_ultra', tier, generation: 'ultra', ...formulaProfiles.i9_12_ultra };
    return null;
  }

  const coreMatch = model.match(/(?:CORE\s*)?I([3579])[-\s]*(\d{4,5})/);
  if (!coreMatch) return null;
  const tier = Number(coreMatch[1]);
  const generation = Math.floor(Number(coreMatch[2]) / 1000);
  if (tier === 3 && generation >= 12 && generation <= 14) {
    return { id: 'i3_12_14', tier, generation, ...formulaProfiles.i3_12_14 };
  }
  if (tier === 5 && generation >= 12 && generation <= 13) {
    return { id: 'i5_12_13', tier, generation, ...formulaProfiles.i5_12_13 };
  }
  if (tier === 5 && generation >= 14) {
    return { id: 'i5_14_ultra', tier, generation, ...formulaProfiles.i5_14_ultra };
  }
  if (tier === 7 && generation >= 12) {
    return { id: 'i7_12_ultra', tier, generation, ...formulaProfiles.i7_12_ultra };
  }
  if (tier === 9 && generation >= 12) {
    return { id: 'i9_12_ultra', tier, generation, ...formulaProfiles.i9_12_ultra };
  }
  return null;
}

function calculateIntelCpuValuation(input) {
  const originalPrice = requireOriginalPrice(input);
  const profile = getIntelCpuPricingProfile(input.model, getFormulaConfig(input).intelProfiles);
  if (!profile) return null;

  const elapsedMonths = Math.max(0, Number(input.elapsedMonths) || 0);
  const totalWarrantyMonths = Math.max(0, Number(input.totalWarrantyMonths) || 0);
  const inWarrantyMonths = Math.min(elapsedMonths, totalWarrantyMonths);
  const postWarrantyMonths = Math.max(elapsedMonths - totalWarrantyMonths, 0);
  const warrantyRate = totalWarrantyMonths >= 60 && profile.extendedWarrantyRate
    ? profile.extendedWarrantyRate
    : profile.warrantyRate;
  const warrantyDecay = calculateWarrantyDecay(profile, warrantyRate, inWarrantyMonths);
  const price = originalPrice
    * Math.exp(-profile.k)
    * Math.exp(-warrantyDecay)
    * Math.exp(-profile.marketRate * elapsedMonths)
    * Math.exp(-profile.postWarrantyRate * postWarrantyMonths);

  return createResult(price, 'intel_cpu_segment_decay', {
    originalPrice,
    elapsedMonths,
    totalWarrantyMonths,
    inWarrantyMonths,
    postWarrantyMonths,
    profile: profile.id,
    tier: profile.tier,
    generation: profile.generation,
    k: profile.k,
    warrantyRate,
    baseWarrantyRate: profile.warrantyRate,
    extendedWarrantyRate: profile.extendedWarrantyRate || null,
    warrantyDecayMode: profile.warrantyDecay,
    warrantyDecay,
    marketRate: profile.marketRate,
    postWarrantyRate: profile.postWarrantyRate
  });
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

  const gpuFormula = getFormulaConfig(input).amdGpu;
  const monthlyDecayRate = Number(gpuFormula.baseMonthlyDecayRate)
    + Number(gpuFormula.generationFactor) * (latestGeneration - generation)
    + Number(gpuFormula.vramFactor) * (vramGb - 8);
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

function isNvidiaGpuModel(model, manufacturer) {
  if (manufacturer === 'NVIDIA') return true;
  if (manufacturer === 'AMD') return false;
  return /(?:^|[^A-Z0-9])(?:NVIDIA|GEFORCE|RTX|GTX)(?:$|[^A-Z0-9]|\d)/
    .test(String(model || '').normalize('NFKC').toUpperCase());
}

function getNvidiaGpuPricingProfile(model, totalWarrantyMonths, profiles) {
  const normalized = String(model || '').normalize('NFKC').toUpperCase();
  const match = normalized.match(/(?:^|[^A-Z0-9])RTX[\s_-]*((?:30|40|50)(?:50|60|70|80|90))((?:[\s_-]*(?:TI|SUPER))*)(?![A-Z0-9])/);
  const months = Number(totalWarrantyMonths);
  if (!match || !Number.isFinite(months) || months < 0) return null;
  const series = match[1].slice(0, 2);
  const tier = match[1].slice(2);
  const variants = match[2].replace(/[\s_-]/g, '');
  const hasTi = variants.includes('TI');
  if (series === '50' && (variants.includes('SUPER') || (hasTi && !['60', '70'].includes(tier)))) return null;
  const modelKey = `50${tier}${hasTi && ['60', '70'].includes(tier) ? 'Ti' : ''}`;
  const profileSourceModel = `RTX 50${tier}${modelKey.endsWith('Ti') ? ' Ti' : ''}`;
  const profile = profiles[modelKey];
  const rates = Object.entries(profile?.warrantyRates || {})
    .map(([duration, rate]) => [Number(duration), Number(rate)])
    .sort((a, b) => a[0] - b[0]);
  if (rates.length < 2 || rates.some(([duration, rate]) => !Number.isFinite(duration) || !Number.isFinite(rate) || rate <= 0)) return null;
  const exactRate = profile.warrantyRates[months];
  let warrantyRate = Number(exactRate);
  if (exactRate === undefined) {
    const upperIndex = rates.findIndex(([duration]) => duration >= months);
    const lowerIndex = upperIndex === -1 ? rates.length - 2 : Math.max(0, upperIndex - 1);
    const [lowerMonths, lowerRate] = rates[lowerIndex];
    const [upperMonths, upperRate] = rates[lowerIndex + 1];
    const ratio = (months - lowerMonths) / (upperMonths - lowerMonths);
    // 已知年期之間線性插值；超出範圍以指數延伸，避免係數變為負數。
    warrantyRate = months < rates[0][0] || months > rates[rates.length - 1][0]
      ? lowerRate * Math.pow(upperRate / lowerRate, ratio)
      : lowerRate + (upperRate - lowerRate) * ratio;
  }
  if (!profile || !Number.isFinite(Number(profile.k)) || !Number.isFinite(warrantyRate)) return null;
  return {
    modelKey,
    profileSourceModel,
    estimatedModelProfile: series !== '50',
    k: Number(profile.k),
    warrantyRate,
    estimatedWarrantyRate: exactRate === undefined || (profile.estimatedWarrantyMonths || []).includes(months)
  };
}

function calculateNvidiaGpuValuation(input) {
  const profile = getNvidiaGpuPricingProfile(
    input.model, input.totalWarrantyMonths, getFormulaConfig(input).nvidiaGpu
  );
  if (!profile) return null;
  const originalPrice = requireOriginalPrice(input);
  const elapsedMonths = Math.max(0, Number(input.elapsedMonths) || 0);
  const totalWarrantyMonths = Number(input.totalWarrantyMonths);
  const inWarrantyMonths = Math.min(elapsedMonths, totalWarrantyMonths);
  const price = originalPrice
    * Math.exp(-profile.k)
    * Math.exp(-profile.warrantyRate * inWarrantyMonths);
  const result = createResult(price,
    profile.estimatedModelProfile ? 'nvidia_rtx_proxy_warranty_decay' : 'nvidia_rtx50_warranty_decay', {
    originalPrice,
    elapsedMonths,
    totalWarrantyMonths,
    inWarrantyMonths,
    modelKey: profile.modelKey,
    profileSourceModel: profile.profileSourceModel,
    estimatedModelProfile: profile.estimatedModelProfile,
    k: profile.k,
    warrantyRate: profile.warrantyRate,
    estimatedWarrantyRate: profile.estimatedWarrantyRate
  });
  return {
    ...result,
    profileSourceModel: profile.profileSourceModel,
    estimatedModelProfile: profile.estimatedModelProfile
  };
}

function calculateRamValuation(input) {
  const originalPrice = requireOriginalPrice(input);
  const ramFormula = getFormulaConfig(input).ram;
  const elapsedMonths = Math.max(0, Math.floor(Number(input.elapsedMonths) || 0));
  // 圖中的 n=9 是使用九個月的示例；上限 g 應取實際已使用月數。
  let decaySum = 0;
  for (let month = 1; month <= elapsedMonths; month += 1) {
    decaySum += Number(ramFormula.monthlyDecayRate) / month;
  }
  const price = originalPrice * Math.exp(decaySum);
  return createResult(price, 'ram_sigma_decay', {
    originalPrice,
    elapsedMonths,
    decaySum
  });
}

function calculateTestValuation(input) {
  if (['mouse', 'keyboard'].includes(input.category)) {
    return calculatePeripheralValuation(input);
  }
  const formulaConfig = getFormulaConfig(input);
  const originalPrice = Number(input.originalPrice);
  const elapsedMonths = Math.max(0, Number(input.elapsedMonths) || 0);
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    throw new TypeError('新品參考價必須大於 0。');
  }

  // 僅供串接測試：正式公式完成後只需替換這個函式。
  const ageFactor = Math.max(Number(formulaConfig.generic.minimumAgeFactor), 1 - Math.min(elapsedMonths, Number(formulaConfig.generic.maxMonths)) * Number(formulaConfig.generic.monthlyAgeRate));
  const conditionFactor = formulaConfig.conditionFactors.good;
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
  if (input.category === 'cpu') {
    if (isLegacyIntelCoreCpuModel(input.model)) throw new TypeError(UNSUPPORTED_MODEL_MESSAGE);
    return calculateIntelCpuValuation(input) || calculateCpuAndMotherboardValuation(input);
  }
  if (input.category === 'motherboard') {
    return calculateCpuAndMotherboardValuation(input);
  }
  if (input.category === 'gpu' && input.gpuPricing) {
    return calculateAmdGpuValuation(input);
  }
  if (input.category === 'gpu') {
    const nvidiaResult = calculateNvidiaGpuValuation(input);
    if (nvidiaResult) return nvidiaResult;
    throw new TypeError(UNSUPPORTED_MODEL_MESSAGE);
  }
  if (input.category === 'ram') {
    return calculateRamValuation(input);
  }
  return calculateTestValuation(input);
}

module.exports = {
  TEST_WARNING,
  UNSUPPORTED_MODEL_MESSAGE,
  calculateValuation,
  calculateTestValuation,
  calculateCpuAndMotherboardValuation,
  calculateIntelCpuValuation,
  isLegacyIntelCoreCpuModel,
  getIntelCpuPricingProfile,
  calculateAmdGpuValuation,
  calculateNvidiaGpuValuation,
  getNvidiaGpuPricingProfile,
  isNvidiaGpuModel,
  calculateRamValuation,
  calculatePeripheralValuation,
  getPeripheralBrandTier
};
