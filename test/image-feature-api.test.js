const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createRequire } = require('node:module');
const cpu = require('../src/services/cpu-vision');
const diagnostics = require('../src/services/image-diagnostics');

function service(mode = 'local', timing = null) {
  const requests = [], ocr = [], logs = [];
  let now = Date.now(), model = 'i7-12700', timeout = false, digest = 'gemma-digest-1';
  const timers = new Map();
  const setTimer = (callback, delay) => { const id = {}; timers.set(id, { callback, at: now + delay }); return id; };
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].callback();
    }
    now = end;
  };
  const budgetContext = { module: { exports: {} }, AbortController,
    setTimeout: setTimer, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync('src/services/stage-budget.js', 'utf8'), budgetContext);
  const requireAi = createRequire(path.resolve('public/AiService.js'));
  const observation = () => `Category: CPU\nModel: ${model}\nEvidence: Intel Core ${model}\nConfidence: high`;
  const worker = () => ({ accepted: true, textVerified: true, model, evidence: [model], readings: [{ text: model, confidence: .99 }], version: 'fixture-v1' });
  const context = {
    require: name => name === '../src/services/ollama-client' ? {
      createOllamaClient: () => ({ serviceMode: mode, request: async (route, options) => {
        const payload = JSON.parse(options?.body || '{}'); requests.push({ route, payload });
        if (timing && payload.messages?.some(message => message.images)) { advance(timing.vision); options.signal.throwIfAborted(); }
        return { ok: true, json: async () => route === '/api/tags' ? { models: [{ name: 'gemma3:4b', digest }] }
          : payload.messages?.some(message => message.images) ? {
            message: { content: observation() }, load_duration: 250000000,
            ...(mode === 'shared' ? { cpuVisionChecked: true, cpuRecognition: cpu.buildCpuRecognition(observation(), worker()), cpuCheckDiagnostics: { status: 'completed', version: 'fixture-v1', elapsedMs: 1 } } : {})
          } : payload.format ? { message: { content: '{"features":["market"]}' } }
            : { message: { tool_calls: [{ function: { name: 'start_feature_flow', arguments: { features: ['market', 'valuation'], targetText: 'i9-14900K', products: [{ model: 'i9-14900K' }] } } }] } } };
      } })
    } : name === '../src/services/cpu-vision' ? { ...cpu, createCpuVisionClient: () => ({ recognize: async (image, signal, analysis) => {
      if (timing) return budgetContext.module.exports.withStageBudget(async bounded => {
        ocr.push(analysis); advance(timing.ocr); bounded.throwIfAborted(); return worker();
      }, signal, 18000, 'CPU 文字核對逾時');
      ocr.push(analysis); if (timeout) throw new Error('CPU 文字核對逾時'); return worker();
    } }) }
      : name === '../src/services/stage-budget' && timing ? budgetContext.module.exports
      : name === '../src/services/image-diagnostics' ? { ...diagnostics, cpuVersion: () => ({ version: 'fixture-v1', fingerprint: 'cpu-hash' }), writeImageDiagnostic: record => logs.push(JSON.parse(JSON.stringify(record))) }
        : name === 'fs' ? { existsSync: () => true, appendFile: () => {} } : requireAi(name),
    module: { exports: {} }, __dirname: path.resolve('public'), process: { env: {} },
    Date: class extends Date { static now() { return now; } }, console, URL, AbortController,
    setTimeout: timing ? setTimer : setTimeout, clearTimeout: timing ? id => timers.delete(id) : clearTimeout
  };
  vm.runInNewContext(fs.readFileSync('public/AiService.js', 'utf8'), context);
  return { requests, ocr, logs, set: options => { now += options.advance || 0; model = options.model || model; timeout = options.timeout || false; digest = options.digest || digest; },
    ask: async body => {
      let response;
      await context.module.exports.handle(Readable.from([JSON.stringify(body)]), { writeHead: status => assert.equal(status, 200), end: text => { response = JSON.parse(text); } });
      if (timing) assert.equal(timers.size, 0, 'every stage and request timer must be cleaned up');
      return response;
    } };
}

test('slow first vision pass leaves a full OCR budget for both upload captions', async () => {
  for (const caption of ['', '請辨識這張硬體圖片', '這是什麼cpu']) {
    const api = service('local', { vision: 44060, ocr: 14347 });
    api.set({ model: 'i7-14700' });
    const result = await api.ask({ recognitionOnly: true, messages: [{ role: 'user', content: caption, images: ['aGVsbG8='] }] });
    assert.equal(result.cpuRecognition.status, 'verified');
    assert.equal(result.cpuRecognition.model, 'i7-14700');
    assert.equal(result.recognitionDiagnostics.totalMs, 58407);
    assert.equal(result.recognitionDiagnostics.cpuCheck.status, 'completed');
  }
});

test('OCR still has its own deadline and timeout never becomes verified or cached', async () => {
  const api = service('local', { vision: 44060, ocr: 18001 });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await api.ask({ recognitionOnly: true, messages: [{ role: 'user', content: '這是什麼cpu', images: ['aGVsbG8='] }] });
    assert.equal(result.cpuRecognition.requiresConfirmation, true);
    assert.equal(result.recognitionDiagnostics.cpuCheck.status, 'timeout');
    assert.equal(result.recognitionDiagnostics.cacheHit, false);
    assert.match(result.answer, /文字核對逾時/);
  }
  assert.equal(api.ocr.length, 2);
});

test('vision timeout is bounded before OCR starts', async () => {
  const api = service('local', { vision: 45001, ocr: 100 });
  const result = await api.ask({ recognitionOnly: true, messages: [{ role: 'user', content: '辨識圖片', images: ['aGVsbG8='] }] });
  assert.equal(result.success, false);
  assert.match(result.answer, /圖片辨識逾時/);
  assert.equal(api.ocr.length, 0);
});

test('identical image bytes use the same prompt, suffix evidence and cache across feature captions', async () => {
  const api = service();
  const ask = caption => api.ask({ recognitionOnly: true, routeFeatures: true, messages: [{ role: 'user', content: caption, images: ['aGVsbG8='] }] });
  const first = await ask('這是什麼 CPU');
  const market = await ask('這是我的 CPU，幫我做市價查詢');
  const valuation = await ask('幫我估價');
  for (const result of [first, market, valuation]) {
    assert.equal(result.cpuRecognition.model, 'i7-12700');
    assert.equal(result.cpuRecognition.status, 'verified');
    assert.equal(result.visionModel, 'gemma3:4b'); assert.equal(result.textModel, 'llama3.1:8b');
    assert.equal(result.recognitionDiagnostics.imageHash, first.recognitionDiagnostics.imageHash);
  }
  assert.equal(first.recognitionDiagnostics.cacheHit, false);
  assert.equal(first.recognitionDiagnostics.modelLoadMs, 250);
  assert.equal(market.recognitionDiagnostics.cacheHit, true);
  assert.notEqual(first.recognitionDiagnostics.requestId, market.recognitionDiagnostics.requestId);
  assert.deepEqual(market.featureAction.features, ['market']);
  assert.equal(api.ocr.length, 1);
  const firstPrompt = api.requests.find(request => request.payload.model === 'gemma3:4b').payload.messages[0].content;
  api.set({ advance: 301000 });
  await ask('幫我查市價');
  assert.equal(api.ocr.length, 2);
  assert.ok(api.requests.filter(request => request.payload.model === 'gemma3:4b').every(request => request.payload.messages[0].content === firstPrompt));
  api.set({ advance: 61000, digest: 'gemma-digest-2' });
  const replaced = await ask('幫我估價');
  assert.equal(replaced.recognitionDiagnostics.cacheHit, false, 'model digest changes invalidate an otherwise live cache');
  assert.equal(api.requests.filter(request => request.payload.model === 'llama3.1:8b').length, 0, 'recognition-only cannot execute a text tool or price search');
  assert.doesNotMatch(JSON.stringify(api.logs), /aGVsbG8|這是我的|Evidence|Intel Core/);
});

test('local and shared evidence preserves every 12700 suffix and never upgrades an OCR timeout', async () => {
  for (const mode of ['local', 'shared']) {
    const api = service(mode);
    for (const model of ['i7-12700', 'i7-12700K', 'i7-12700F', 'i7-12700KF', 'i5-14400', 'i5-14400F', 'i7-14700']) {
      api.set({ model });
      const result = await api.ask({ recognitionOnly: true, messages: [{ role: 'user', content: '幫我查市價', images: [Buffer.from(model).toString('base64')] }] });
      assert.equal(result.cpuRecognition.model, model); assert.equal(result.cpuRecognition.requiresConfirmation, false);
    }
  }
  const api = service(); api.set({ timeout: true });
  const result = await api.ask({ recognitionOnly: true, messages: [{ role: 'user', content: '幫我估價', images: ['aGVsbG8='] }] });
  assert.equal(result.cpuRecognition.requiresConfirmation, true);
  assert.equal(result.recognitionDiagnostics.cpuCheck.status, 'timeout');
  assert.equal(result.recognitionDiagnostics.cacheHit, false);
});

test('API routes literal and free-form features with no LLM-generated product', async () => {
  const api = service();
  const literal = await api.ask({ routeFeatures: true, messages: [{ role: 'user', content: '幫我查 i7-12700 市價並估二手價' }] });
  assert.deepEqual(literal.featureAction.features, ['market', 'valuation']);
  assert.deepEqual(literal.featureAction.products, [{ category: 'cpu', model: 'i7-12700' }]);
  assert.equal(api.requests.length, 0);
  const free = await api.ask({ routeFeatures: true, messages: [{ role: 'user', content: '這個零件找找哪裡買划算，再看看賣掉能拿回幾成' }] });
  assert.deepEqual(free.featureAction.features, ['market', 'valuation']);
  assert.deepEqual(free.featureAction.products, []);
  assert.equal(free.price, undefined);
  const only = await api.ask({ routeFeatures: true, resolveFeatureOnly: true, messages: [{ role: 'user', content: '找找這顆哪裡買划算' }] });
  assert.deepEqual(only.featureAction.features, ['market']); assert.deepEqual(only.featureAction.products, []);
  assert.equal(api.requests.at(-1).payload.tools, undefined);
  assert.equal(only.price, undefined);
});
