const test = require('node:test');
const assert = require('node:assert/strict');
const { withStageBudget } = require('../src/services/stage-budget');
const { withCpuBudget } = require('../src/services/cpu-vision');

test('timeout cause wins over a worker reporting offline on abort', async () => {
  await assert.rejects(withCpuBudget(signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('CPU 模型暫時無法回應。')));
  }), undefined, 10), /文字核對逾時/);
});

test('caller cancellation terminates a stuck stage and prevents starting cancelled work', async () => {
  const controller = new AbortController();
  let stageSignal;
  const pending = withStageBudget(signal => { stageSignal = signal; return new Promise(() => {}); }, controller.signal, 1000, 'timeout');
  await Promise.resolve();
  controller.abort(new Error('client disconnected'));
  await assert.rejects(pending, /client disconnected/);
  assert.equal(stageSignal.aborted, true);
  let called = false;
  await assert.rejects(withStageBudget(() => { called = true; }, controller.signal, 1000, 'timeout'), /client disconnected/);
  assert.equal(called, false);
});
