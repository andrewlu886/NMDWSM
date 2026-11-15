const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../public/hardware-context');

test('shared observations preserve CPU trust and full variants without trusting answer text', () => {
  const analysis = 'Category: CPU\nModel: i7-14700\nConfidence: high';
  assert.equal(api.observation(analysis).requiresConfirmation, true);
  const cpu = { status: 'verified', requiresConfirmation: false, model: 'i7-14700F', candidates: ['i7-14700F'] };
  assert.equal(api.observation(analysis, cpu).model, 'i7-14700F');
  assert.equal(api.observation(analysis, { ...cpu, status: 'conflict', candidates: ['i7-14700', 'i7-14700F'] }).requiresConfirmation, true);
  for (const model of ['ASUS DUAL RTX 4060 EVO-WHITE 8GB', 'RTX 4070 Ti SUPER', 'DDR5 6000 32GB (16GBx2)']) {
    const value = api.observation(`Category: GPU\nModel: ${model}\nConfidence: high`);
    assert.equal(value.model, model);
    assert.equal(api.observation(`Category: GPU\nModel: ${model}\nConfidence: low`).requiresConfirmation, true);
  }
  assert.notEqual(api.modelKey('i7-14700', 'cpu'), api.modelKey('i7-14700F', 'cpu'));
  assert.equal(api.modelKey('Intel Core i7-14700', 'cpu'), api.modelKey('i7-14700', 'cpu'));
});

test('history records merge equivalent pictures, keep separate units, invalidate edits, and distrust legacy prose', () => {
  const hardwareRecognition = api.observation('Category: GPU\nModel: RTX 4060 WHITE\nConfidence: high');
  const item = { id: 'one', role: 'user', hardwareRecognition };
  const records = api.records([item, { ...item, id: 'two' }, { ...item, id: 'three', displayContent: '這是另一張顯卡' }]);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].sourceIds, ['one', 'two']);
  assert.deepEqual(records[0].photoNumbers, [1, 2]);
  assert.equal(api.records([{ ...item, contextInvalidated: true }])[0].requiresConfirmation, true);
  const legacy = { id: 'old', role: 'user', imageAnalysis: 'Category: GPU\nModel: RTX 4090\nConfidence: high' };
  assert.equal(api.records([legacy])[0].requiresConfirmation, true);
  assert.equal(api.records([{ ...legacy, hardwareConfirmation: { source: 'user', model: 'RTX 4090' } }])[0].requiresConfirmation, false);
  assert.deepEqual(api.records([{ role: 'assistant', content: '已成功辨識 RTX 4090' }]), []);
});

test('valuation intent and reference selection avoid negations, multiple-unit guessing and suffix collisions', () => {
  for (const text of ['幫我估價', '這顆二手值多少', '剛才的 CPU 能賣多少，幫我估價', '第一張顯卡估值']) assert.equal(api.valuationIntent(text), true, text);
  for (const text of ['不要估價', '估價是什麼', '如何估價', '幫我估價手機']) assert.equal(api.valuationIntent(text), false, text);
  const records = [
    { id: 'cpu', category: 'cpu', model: 'i7-14700', candidates: [], photoNumbers: [1] },
    { id: 'f', category: 'cpu', model: 'i7-14700F', candidates: [], photoNumbers: [2] },
    { id: 'gpu', category: 'gpu', model: 'RTX 4060 WHITE', candidates: [], photoNumbers: [3] }
  ];
  assert.equal(api.select(records, '幫我估價').length, 3);
  assert.deepEqual(api.select(records, 'i7-14700F 幫我估價').map(item => item.id), ['f']);
  assert.deepEqual(api.select(records, '第一張估價').map(item => item.id), ['cpu']);
  assert.equal(api.select(records, 'CPU 估價').length, 2);
  assert.deepEqual(api.select(records, '剛才的 CPU 估價').map(item => item.id), ['f']);
  assert.deepEqual(api.select(records, 'i7-14700KF 幫我估價'), []);
  assert.deepEqual(api.select(records, 'RTX 4070 幫我估價'), []);
  assert.deepEqual(api.select(records, 'RTX 4060 BLACK 幫我估價'), []);
  assert.deepEqual(api.select(records, 'RTX 4060 WHITE 16GB 幫我估價'), []);
});
