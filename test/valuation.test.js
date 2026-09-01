const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TEST_WARNING,
  calculateValuation,
  calculateCpuAndMotherboardValuation,
  calculateAmdGpuValuation,
  calculateRamValuation,
  calculateTestValuation,
  getPeripheralBrandTier
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
