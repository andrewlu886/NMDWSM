// 估價規則的初始資料。啟動資料庫時會寫入 valuation_formula_rules，
// 執行中的公式會優先讀取資料庫版本，這裡只作為首次建庫與測試的預設值。
const valuationFormulaRules = {
  conditionFactors: {
    like_new: 0.92,
    good: 0.82,
    fair: 0.68,
    poor: 0.45
  },
  peripheralBrandTiers: {
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
  },
  motherboard: { monthlyDecayRate: 0.02 },
  intelProfiles: {
    i3_12_14: { k: 0.223, warrantyRate: 0.013, warrantyDecay: 'linear', marketRate: 0.001, postWarrantyRate: 0.021 },
    i5_12_13: { k: 0.139, warrantyRate: 0.005, extendedWarrantyRate: 0.003, warrantyDecay: 'linear', marketRate: 0.003, postWarrantyRate: 0.021 },
    i5_14_ultra: { k: 0.139, warrantyRate: 0.024, extendedWarrantyRate: 0.021, warrantyDecay: 'harmonic', marketRate: 0.003, postWarrantyRate: 0.021 },
    i7_12_ultra: { k: 0.108, warrantyRate: 0.022, extendedWarrantyRate: 0.0196, warrantyDecay: 'harmonic', marketRate: 0.004, postWarrantyRate: 0.0016 },
    i9_12_ultra: { k: 0.09, warrantyRate: 0.013, extendedWarrantyRate: 0.0078, warrantyDecay: 'linear', marketRate: 0.001, postWarrantyRate: 0.004 }
  },
  amdGpu: { baseMonthlyDecayRate: 0.020, generationFactor: 0.002, vramFactor: -0.0006 },
  // 使用者提供的 RTX 50 估價公式圖；5090 的四年係數由三、五年線性插值。
  nvidiaGpu: {
    '5050': { k: 0.196, warrantyRates: { 36: 0.031, 48: 0.023, 60: 0.018 } },
    '5060': { k: 0.096, warrantyRates: { 36: 0.031, 48: 0.023, 60: 0.018 } },
    '5060Ti': { k: 0.124, warrantyRates: { 36: 0.024, 48: 0.018, 60: 0.014 } },
    '5070': { k: 0.160, warrantyRates: { 36: 0.009, 48: 0.007, 60: 0.006 } },
    '5070Ti': { k: 0.118, warrantyRates: { 36: 0.009, 48: 0.007, 60: 0.006 } },
    '5080': { k: 0.110, warrantyRates: { 36: 0.023, 48: 0.018, 60: 0.014 } },
    '5090': { k: 0.035, warrantyRates: { 36: 0.030, 48: 0.024, 60: 0.018 }, estimatedWarrantyMonths: [48] }
  },
  ram: {
    // 輸入的原價就是圖中整個 (P0 × e^K)，不再另乘市場修正係數。
    formula: 'originalPrice × exp(Σ[t=1..elapsedMonths](-0.11/t))',
    monthlyDecayRate: -0.11
  },
  generic: { maxMonths: 120, monthlyAgeRate: 0.008, minimumAgeFactor: 0.2 }
};

module.exports = { valuationFormulaRules };
