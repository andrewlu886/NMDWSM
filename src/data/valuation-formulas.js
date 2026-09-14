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
  ram: {
    marketCorrection: [
      { minMonths: 1, maxMonths: 5, value: 0.241 },
      { minMonths: 6, maxMonths: 8, value: 0.465 },
      { minMonths: 9, maxMonths: 9, value: 0.772 },
      { minMonths: 10, maxMonths: null, value: 1.57 }
    ],
    monthlyDecayRate: -0.11,
    specialDamageFactor: 0.8
  },
  generic: { maxMonths: 120, monthlyAgeRate: 0.008, minimumAgeFactor: 0.2 }
};

module.exports = { valuationFormulaRules };
