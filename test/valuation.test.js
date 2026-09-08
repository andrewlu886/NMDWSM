const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TEST_WARNING,
  calculateValuation,
  calculateCpuAndMotherboardValuation,
  calculateIntelCpuValuation,
  calculateAmdGpuValuation,
  calculateRamValuation,
  calculateTestValuation,
  getPeripheralBrandTier,
  getIntelCpuPricingProfile
} = require('../src/services/valuation');
const { amdGpuPricingModels } = require('../src/data/amd-gpu-pricing');

test('測試估價固定標示測試模式', () => {
  const result = calculateTestValuation({
    originalPrice: 10000,
    elapsedMonths: 12,
    condition: 'good'
  });
  assert.equal(result.pricingMode, 'test');
  assert.equal(result.warning, TEST_WARNING);
  assert.ok(result.price > 0);
  assert.ok(result.range.min < result.price);
  assert.ok(result.range.max > result.price);
});

test('測試估價直接使用已過月份', () => {
  const newer = calculateTestValuation({ originalPrice: 10000, elapsedMonths: 12, condition: 'good' });
  const older = calculateTestValuation({ originalPrice: 10000, elapsedMonths: 50, condition: 'good' });
  assert.ok(older.price < newer.price);
});

test('新品參考價無效時拒絕計算', () => {
  assert.throws(
    () => calculateTestValuation({ originalPrice: 0, elapsedMonths: 0, condition: 'good' }),
    /新品參考價/
  );
});

test('滑鼠與鍵盤使用原本的品牌分級漸近線公式', () => {
  const input = {
    category: 'mouse',
    brand: 'Logitech',
    originalPrice: 10000,
    elapsedMonths: 12,
    condition: 'good',
    details: { usageCondition: 'good', appearanceCondition: 'good' }
  };
  const result = calculateTestValuation(input);
  const expected = Math.round(10000 * (0.4 + (0.9 - 0.4) * Math.exp(-0.06 * 12)));
  assert.equal(getPeripheralBrandTier('Logitech'), 'A');
  assert.equal(result.pricingFormula, 'peripheral_brand_tier');
  assert.equal(result.price, expected);

  const damaged = calculateTestValuation({
    ...input,
    details: { usageCondition: 'heavy', appearanceCondition: 'heavy' }
  });
  assert.ok(damaged.price < result.price);
});

test('CPU 與主機板恢復每月 2% 指數折舊公式', () => {
  const result = calculateCpuAndMotherboardValuation({ originalPrice: 10000, elapsedMonths: 12 });
  assert.equal(result.pricingFormula, 'cpu_motherboard_exponential');
  assert.equal(result.price, Math.round(10000 * Math.exp(-0.02 * 12)));
});

test('Intel CPU 依級距套用同學提供的係數', () => {
  const cases = [
    ['Core i3-12100F', 'i3_12_14', 0.223, 0.013, 0.001, 0.021],
    ['Core i5-13400F', 'i5_12_13', 0.139, 0.005, 0.003, 0.021],
    ['Core i5-14400F', 'i5_14_ultra', 0.139, 0.024, 0.003, 0.021],
    ['Core Ultra 7 265KF', 'i7_12_ultra', 0.108, 0.022, 0.004, 0.0016],
    ['Core i9-14900KS', 'i9_12_ultra', 0.09, 0.013, 0.001, 0.004]
  ];

  for (const [model, id, k, warrantyRate, marketRate, postWarrantyRate] of cases) {
    const profile = getIntelCpuPricingProfile(model);
    assert.equal(profile.id, id);
    assert.deepEqual(
      [profile.k, profile.warrantyRate, profile.marketRate, profile.postWarrantyRate],
      [k, warrantyRate, marketRate, postWarrantyRate]
    );
  }
});

test('Intel CPU 定價區分保固內與過保月份', () => {
  const input = {
    category: 'cpu',
    model: 'Core Ultra 7 265K',
    originalPrice: 20000,
    totalWarrantyMonths: 36,
    elapsedMonths: 50
  };
  const result = calculateIntelCpuValuation(input);
  const expected = 20000
    * Math.exp(-0.108)
    * Math.exp(-0.022 * 36)
    * Math.exp(-0.004 * 50)
    * Math.exp(-0.0016 * 14);

  assert.equal(result.pricingFormula, 'intel_cpu_segment_decay');
  assert.equal(result.price, Math.round(expected));
  assert.equal(result.calculation.inWarrantyMonths, 36);
  assert.equal(result.calculation.postWarrantyMonths, 14);
});

test('未提供係數的 CPU 沿用既有公式', () => {
  const result = calculateValuation({
    category: 'cpu', model: 'Ryzen 7 9700X', originalPrice: 10000, elapsedMonths: 12
  });
  assert.equal(result.pricingFormula, 'cpu_motherboard_exponential');
});

test('AMD 顯示卡恢復第九代動態世代與顯存公式', () => {
  const gpuPricing = amdGpuPricingModels.find(item => item.canonicalModel === 'RX 9070 XT');
  const result = calculateAmdGpuValuation({ elapsedMonths: 12, gpuPricing });
  assert.equal(result.pricingFormula, 'amd_dynamic_v9');
  assert.equal(result.price, 17605);
  assert.equal(Number(result.calculation.monthlyDecayRate.toFixed(4)), 0.0152);
  assert.equal(result.calculation.floorPrice, 9500);

  const oldCard = amdGpuPricingModels.find(item => item.canonicalModel === 'RX 580');
  const floorResult = calculateValuation({ category: 'gpu', elapsedMonths: 120, gpuPricing: oldCard });
  assert.equal(floorResult.price, 1400);
});

test('RAM 恢復 Sigma 衰減並套用特殊損耗八折', () => {
  const normal = calculateRamValuation({ originalPrice: 3000, elapsedMonths: 6, details: {} });
  const damaged = calculateRamValuation({
    originalPrice: 3000,
    elapsedMonths: 6,
    details: { specialCondition: '散熱片刮傷' }
  });
  assert.equal(normal.pricingFormula, 'ram_sigma_decay');
  assert.equal(damaged.price, Math.round(normal.price * 0.8));
});
