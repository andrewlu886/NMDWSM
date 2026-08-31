const test = require('node:test');
const assert = require('node:assert/strict');
const { TEST_WARNING, calculateTestValuation } = require('../src/services/valuation');

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
