const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TEST_WARNING,
  calculateTestValuation,
  getPeripheralBrandTier
} = require('../src/services/valuation');

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
