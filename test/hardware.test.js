const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractCPU,
  extractGPU,
  extractRAM,
  extractOS,
  getDynamicCPUScore,
  getDynamicGPUScore,
  getRamBonusScore,
  getOsBonusScore
} = require('../src/services/hardware');

test('extractCPU 支援常見 Intel、AMD 與工作站型號', () => {
  assert.equal(extractCPU('Intel i7-13700K 電競主機'), 'I7-13700K');
  assert.equal(extractCPU('Intel Core Ultra 7 265K 桌機'), 'ULTRA7265K');
  assert.equal(extractCPU('AMD Ryzen 7 7800X3D 主機'), 'RYZEN77800X3D');
  assert.equal(extractCPU('TR PRO 7995WX 工作站'), 'TRPRO7995WX');
  assert.equal(extractCPU('未標示處理器'), 'UNKNOWN');
});

test('extractGPU 保留 NVIDIA 與 AMD 後綴', () => {
  assert.equal(extractGPU('GeForce RTX 4070 Ti 顯示卡'), 'RTX4070TI');
  assert.equal(extractGPU('RTX 4080 SUPER'), 'RTX4080SUPER');
  assert.equal(extractGPU('Radeon RX 7900 XTX'), 'RX7900XTX');
  assert.equal(extractGPU('Radeon RX 7900 GRE'), 'RX7900GRE');
  assert.equal(extractGPU('內建顯示晶片'), 'UNKNOWN');
});

test('硬體分數與附加資訊維持既有規則', () => {
  assert.ok(getDynamicGPUScore('RTX4070TI') > getDynamicGPUScore('RTX4070'));
  assert.ok(getDynamicCPUScore('I7-13700K') > getDynamicCPUScore('I5-12400F'));
  assert.equal(getDynamicGPUScore('UNKNOWN'), 1000);
  assert.equal(getDynamicCPUScore('UNKNOWN'), 2000);
  assert.equal(extractRAM('記憶體 32GB DDR5'), '32GB');
  assert.equal(extractOS('Windows 11專業版'), 'WIN11 Pro');
  assert.equal(getRamBonusScore('32GB'), 3500);
  assert.equal(getOsBonusScore('WIN11 Pro'), 2000);
});
