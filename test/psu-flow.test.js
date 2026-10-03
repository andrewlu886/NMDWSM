const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveModel, estimate, calculatorUrl } = require('../public/psu-flow');
const cpu = [
  { CPU型號: 'Intel Core i5-14600', 最大銳頻功耗: '154W' },
  { CPU型號: 'Intel Core i5-14600K', 最大銳頻功耗: '181W' },
  { CPU型號: 'AMD Ryzen 5 5600X', PPT: '88W' }
];
const gpu = [
  { 顯示卡型號: 'NVIDIA GeForce RTX 4070', TDP: '200W', 官方建議瓦數: '650W' },
  { 顯示卡型號: 'NVIDIA GeForce RTX 4070 Ti', TGP: '285W', 官方建議瓦數: '700W' }
];
test('exact models take precedence over similar suffixes and abbreviations remain usable', () => {
  assert.equal(resolveModel(cpu, 'cpu', '我的 CPU 是 i5-14600').model, 'Intel Core i5-14600');
  assert.equal(resolveModel(cpu, 'cpu', 'i5-14600K').watts, 181);
  assert.equal(resolveModel(cpu, 'cpu', '5600X').watts, 88);
  assert.equal(resolveModel(gpu, 'gpu', 'RTX 4070 Ti').watts, 285);
  assert.equal(resolveModel(gpu, 'gpu', 'RTX 4070').watts, 200);
  assert.equal(resolveModel(gpu, 'gpu', 'RTX 4070 T').status, 'unknown');
});
test('unknown, ambiguous and missing power data cannot become an automatic estimate', () => {
  assert.equal(resolveModel(cpu, 'cpu', 'i5-99999').status, 'unknown');
  assert.equal(resolveModel(gpu, 'gpu', '407').status, 'unknown');
  assert.equal(resolveModel([{ CPU型號: 'i5-14600K' }], 'cpu', 'i5-14600K').status, 'missing-power');
  assert.equal(resolveModel([{ CPU型號: 'Intel Core i5-14600K' }, { CPU型號: 'i5-14600K' }], 'cpu', 'i5-14600K').status, 'ambiguous');
  assert.throws(() => estimate({ cpuWatts: null, gpuWatts: 200 }));
});
test('selected overhead, safety margin and the GPU manufacturer minimum determine PSU size', () => {
  assert.deepEqual(estimate({ cpuWatts: 181, gpuWatts: 200, motherboardWatts: 40, coolingWatts: 45, gpuRecommendedPsu: 650 }), { totalWatts: 476, recommendedWatts: 650 });
  assert.deepEqual(estimate({ cpuWatts: 250, gpuWatts: 450, motherboardWatts: 40, coolingWatts: 45 }), { totalWatts: 795, recommendedWatts: 1050 });
  assert.deepEqual(estimate({ cpuWatts: 65, gpuWatts: 0 }), { totalWatts: 115, recommendedWatts: 300 });
  assert.equal(resolveModel([], 'gpu', '內顯').watts, 0);
});
test('fallback URLs preserve known and unknown models plus selected components safely', () => {
  const url = new URL(calculatorUrl({ cpuModel: 'Intel Core i5-14600K', gpuModel: '未知卡 & #', motherboardWatts: 40, coolingWatts: 45 }), 'http://localhost');
  assert.equal(url.searchParams.get('cpu'), 'Intel Core i5-14600K');
  assert.equal(url.searchParams.get('gpu'), '未知卡 & #');
  assert.equal(url.searchParams.get('motherboard'), '40');
  assert.equal(url.searchParams.get('cooling'), '45');
});

test('actual database column labels include whitespace and units', () => {
  const cpu = resolveModel([{ 'CPU 型號': 'Core i5-14600K', '最大銳頻功耗 PL2/PPT (W)': '181 W', '標稱 TDP (W)': '125 W' }], 'cpu', 'i5-14600K');
  const gpu = resolveModel([{ 顯示卡型號: 'RTX 4070', '官方功耗 TDP/TGP (W)': '200 W', '官方建議 PSU 瓦數 (W)': '650 W' }], 'gpu', 'RTX 4070');
  assert.equal(cpu.status, 'matched');
  assert.equal(cpu.watts, 181);
  assert.equal(gpu.status, 'matched');
  assert.equal(gpu.watts, 200);
  assert.equal(gpu.recommendedPsu, 650);
});

test('memory variants can be clarified instead of selecting the wrong GPU', () => {
  const rows = [
    { 顯示卡型號: 'RTX 3080 10GB', TDP: '320W' },
    { 顯示卡型號: 'RTX 3080 12GB', TDP: '350W' }
  ];
  assert.equal(resolveModel(rows, 'gpu', 'RTX 3080').status, 'ambiguous');
  assert.equal(resolveModel(rows, 'gpu', 'RTX 3080 12GB').watts, 350);
});
