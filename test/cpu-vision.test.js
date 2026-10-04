const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mergeCpuAnalysis, isCpuAnalysis, createCpuVisionClient, collaborateCpuAnalysis, cpuConfirmationReply } = require('../src/services/cpu-vision');
const { createAiGateway } = require('../scripts/ai-gateway');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createRequire } = require('node:module');

test('CPU evidence retains Gemma candidates and both conflicting suffixes', () => {
  const original = 'Category: CPU\nModel: unknown\nConfidence: low';
  const accepted = { accepted: true, model: 'i5-12400F', evidence: ['intel CORE i5-12400F'] };
  assert.match(mergeCpuAnalysis(original, accepted), /Model: i5-12400F/);
  assert.match(mergeCpuAnalysis(original, accepted), /Confidence: medium/);
  assert.match(mergeCpuAnalysis('Category: CPU\nModel: Intel® Core™ i5-12400F', accepted), /Model: i5-12400F/);
  assert.match(mergeCpuAnalysis('Category: CPU\nModel: i5-12400\nConfidence: high', accepted), /Model: unknown/);
  assert.match(mergeCpuAnalysis('Category: CPU\nModel: i5-12400\nConfidence: high', accepted), /Candidate: i5-12400 \/ i5-12400F/);
  assert.match(mergeCpuAnalysis('Category: CPU\nModel: i5-14400\nEvidence: I5-14400', { accepted: false, candidates: [{ model: 'i5-13400', score: 0.12 }], evidence: ['192044849'] }), /Candidate: i5-14400\nReview: candidate/);
  assert.match(mergeCpuAnalysis(original, { ...accepted, accepted: false }), /Confidence: low/);
  assert.match(mergeCpuAnalysis(original, { ...accepted, evidence: [] }), /Model: unknown/);
  assert.equal(mergeCpuAnalysis(original, null), original);
});

test('CPU model cannot replace GPU observations', () => {
  const gpu = 'Category: graphics card\nModel: RTX 4060';
  assert.equal(isCpuAnalysis(gpu), false);
  assert.equal(mergeCpuAnalysis(gpu, { accepted: true, model: 'i5-12400', evidence: ['i5-12400'] }), gpu);
});

test('remote CPU recognition uses the authenticated Ollama client and tolerates an older gateway', async () => {
  const calls = [];
  const client = createCpuVisionClient({ serviceMode: 'shared', request: async (...args) => {
    calls.push(args); return { ok: true, json: async () => ({ accepted: false }) };
  } });
  assert.deepEqual(await client.recognize('aGVsbG8='), { accepted: false });
  assert.equal(calls[0][0], '/api/cpu/recognize');
  assert.deepEqual(JSON.parse(calls[0][1].body), { image: 'aGVsbG8=' });
  await client.recognize('aGVsbG8=', undefined, 'Model: i5-14400');
  assert.equal(JSON.parse(calls[1][1].body).gemmaObservation, 'Model: i5-14400');
  assert.equal(await createCpuVisionClient({ serviceMode: 'shared', request: async () => ({ ok: false }) }).recognize('aGVsbG8='), null);
});

test('Gemma updated reading is fed back into CPU and physical evidence reaches the final reviewer', async () => {
  const observations = [];
  let calls = 0;
  const analysis = await collaborateCpuAnalysis('Category: CPU\nModel: unknown', { accepted: false, evidence: [] },
    async (_route, options) => {
      const body = JSON.parse(options.body); observations.push(body);
      return { ok: true, json: async () => ({ message: { content: ++calls === 1
        ? '{"choice":"unreadable","question":"model_label"}' : calls === 2
          ? 'Category: CPU\nModel: i5-14400\nEvidence: I5-14400' : '{"choice":"agreement","question":"none"}' } }) };
    }, { image: 'aGVsbG8=', recheckCpu: async observation => {
      assert.match(observation, /Model: i5-14400/);
      return { accepted: true, model: 'i5-14400', evidence: ['Intel Core i5-14400'], guided: { focusedOcr: true } };
    } });
  const finalEvidence = JSON.parse(observations[2].messages[1].content);
  assert.equal(finalEvidence.cpu.guided.focusedOcr, true);
  assert.equal(finalEvidence.cpu.model, 'i5-14400');
  assert.match(analysis, /Model: i5-14400/);
  assert.match(analysis, /Review: corroborated/);
});

test('gateway CPU route requires authentication, bounds images and rejects arbitrary paths', async () => {
  const calls = [];
  const token = 'a'.repeat(64);
  const server = createAiGateway({ token, cpuRecognize: async image => {
    calls.push(image); return { accepted: false, reason: 'unreadable_or_conflicting' };
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/cpu/recognize`;
  const request = (body, auth = true) => fetch(url, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {})
  }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    assert.equal((await request({ image: 'aGVsbG8=' }, false)).status, 401);
    for (const body of ['bad json', { image: '' }, { image: '../secret' }, { image: 'aGVsbG8=', path: 'C:/secret' }]) {
      assert.equal((await request(body)).status, 400);
    }
    assert.equal((await request({ image: 'x'.repeat(2500101) })).status, 413);
    const response = await request({ image: 'aGVsbG8=' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accepted, false);
    assert.deepEqual(calls, ['aGVsbG8=']);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

function imageService(vision, result, checked = false) {
  const calls = { cpu: 0, searches: [], reviews: 0 };
  const requireAi = createRequire(path.resolve('public/AiService.js'));
  const context = {
    require: name => name === '../src/services/cpu-vision'
      ? { isCpuAnalysis, collaborateCpuAnalysis, cpuConfirmationReply, createCpuVisionClient: () => ({ recognize: async () => { calls.cpu++; return result; } }) }
      : name === '../src/services/ollama-client'
        ? { createOllamaClient: () => ({ serviceMode: 'local', request: async (route, options) => {
          const review = options?.body && Boolean(JSON.parse(options.body).format);
          if (review) calls.reviews++;
          return { ok: true, json: async () => route === '/api/tags' ? { models: [{ name: 'gemma3:4b' }] } : { message: { content: review ? '{"choice":"cpu"}' : vision }, cpuVisionChecked: checked } };
        } }) }
        : name === '../src/services/search'
          ? { searchProductsWithMeta: async options => { calls.searches.push(options.keyword); return { data: [], meta: null }; } }
          : name === 'fs' ? { existsSync: () => true, appendFile: () => {} } : requireAi(name),
    module: { exports: {} }, __dirname: path.resolve('public'), process: { env: {} }, console,
    URL, AbortController, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync('public/AiService.js', 'utf8'), context);
  return { calls, api: context.module.exports };
}

async function askPhoto(service, content = '請查詢照片中產品的資訊與市價') {
  let result;
  await service.api.handle(Readable.from([JSON.stringify({ intent: 'market', messages: [{ role: 'user', content, images: ['aGVsbG8='] }] })]), {
    writeHead: status => assert.equal(status, 200), end: body => { result = JSON.parse(body); }
  });
  return result;
}

test('chat photo asks confirmation before tools for corroborated and unverified CPU candidates', async () => {
  const positive = imageService('Category: CPU\nModel: unknown\nConfidence: low', { accepted: true, model: 'i5-12400F', evidence: ['i5-12400F'] });
  const answer = await askPhoto(positive);
  assert.match(answer.imageAnalysis, /Model: i5-12400F/);
  assert.match(answer.answer, /請確認/);
  assert.equal(positive.calls.reviews, 1);
  assert.deepEqual(positive.calls.searches, []);
  const unreadable = imageService('Category: CPU\nModel: i5-12400\nConfidence: high', { accepted: false, evidence: [] });
  assert.match((await askPhoto(unreadable)).imageAnalysis, /Model: unknown/);
  assert.deepEqual(unreadable.calls.searches, []);
  const weak = imageService('Category: CPU\nModel: Intel Core i5-14400\nEvidence: I5-14400', { accepted: false, candidates: [{ model: 'i5-13400', score: 0.12 }], evidence: [] });
  const candidate = await askPhoto(weak);
  assert.match(candidate.answer, /初步辨識為「i5-14400」/);
  assert.doesNotMatch(candidate.answer, /補拍/);
  assert.deepEqual(weak.calls.searches, []);
});

test('chat keeps CPU training away from GPU photos and receipts', async () => {
  const gpu = imageService('Category: graphics card\nModel: RTX 4060\nConfidence: high', null);
  await askPhoto(gpu);
  assert.equal(gpu.calls.cpu, 0);
  const receipt = imageService('Category: CPU\nModel: i5-12400F\nConfidence: high', null);
  await askPhoto(receipt, '請查詢發票產品市價');
  assert.equal(receipt.calls.cpu, 0);
});

test('a gateway-corroborated photo is not sent to the CPU model twice', async () => {
  const checked = imageService('Category: CPU\nModel: i5-12400F\nConfidence: medium', null, true);
  await askPhoto(checked);
  assert.equal(checked.calls.cpu, 0);
  assert.deepEqual(checked.calls.searches, ['i5-12400F']);
});

test('gateway corroborates CPU vision for existing Render clients without changing receipt processing', async () => {
  const token = 'a'.repeat(64);
  let calls = 0;
  const server = createAiGateway({ token,
    fetchImpl: async (_url, options) => ({ ok: true, json: async () => ({ message: { content: JSON.parse(options.body).format ? '{"choice":"cpu"}' : 'Category: CPU\nModel: unknown\nConfidence: low' } }) }),
    cpuRecognize: async () => { calls++; return { accepted: true, model: 'i5-12400F', evidence: ['i5-12400F'], version: 'test' }; }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    for (const receipt of [false, true]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemma3:4b', messages: [{ role: 'user', content: receipt ? 'Read this purchase invoice or receipt.' : 'Inspect this computer hardware photo.', images: ['aGVsbG8='] }] })
      });
      assert.equal(response.status, 200);
      const data = await response.json();
      if (receipt) assert.equal(data.cpuVisionChecked, undefined);
      else { assert.equal(data.cpuVisionChecked, true); assert.match(data.message.content, /Model: i5-12400F/); assert.match(data.message.content, /Llama review: cpu/); }
    }
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('Llama receives both evidence sources, cannot invent a SKU, and reviewer failure retains candidates', async () => {
  const gemma = 'Category: CPU\nModel: Intel Core i5-14400\nEvidence: I5-14400';
  const cpu = { accepted: false, evidence: ['192044849'], candidates: [{ model: 'i5-13400', score: 0.12 }] };
  let payload;
  const request = async (route, options) => {
    assert.equal(route, '/api/chat'); payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: '{"choice":"gemma","model":"i9-14900K"}' } }) };
  };
  const analysis = await collaborateCpuAnalysis(gemma, cpu, request);
  const observations = JSON.parse(payload.messages[1].content);
  assert.equal(observations.gemma.model, 'i5-14400');
  assert.equal(observations.cpu.textVerified, false);
  assert.equal(observations.cpu.appearanceCandidates[0].model, 'i5-13400');
  assert.match(analysis, /Llama review: gemma/);
  assert.match(analysis, /Candidate: i5-14400/);
  assert.doesNotMatch(analysis, /i9-14900K/);
  assert.match(cpuConfirmationReply(analysis), /請確認/);
  const offline = await collaborateCpuAnalysis(gemma, cpu, async () => { throw Error('offline'); });
  assert.match(offline, /Candidate: i5-14400/);
  const hallucinated = await collaborateCpuAnalysis(gemma, cpu, async () => ({ ok: true, json: async () => ({ message: { content: '{"choice":"agreement"}' } }) }));
  assert.match(hallucinated, /Review: candidate/);
  assert.match(hallucinated, /Llama review: unavailable/);
  const conflict = await collaborateCpuAnalysis(gemma, { accepted: true, model: 'i5-14400F', evidence: ['i5-14400F'] }, request);
  assert.match(conflict, /Review: conflict/);
  assert.match(conflict, /Candidate: i5-14400 \/ i5-14400F/);
  assert.match(cpuConfirmationReply(conflict), /兩個來源.*分歧/);
  const noText = await collaborateCpuAnalysis('Category: CPU\nModel: unknown', cpu, request);
  assert.match(noText, /Candidate: unknown/);
  assert.match(cpuConfirmationReply(noText), /補拍/);
});

test('bounded dialogue lets Llama question Gemma on the same photo then review its answer', async () => {
  const calls = [];
  const analysis = await collaborateCpuAnalysis('Category: CPU\nModel: i5-14400\nEvidence: I5-14400',
    { accepted: false, evidence: ['192044849'], candidates: [{ model: 'i5-13400', score: 0.12 }] },
    async (_route, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      const content = calls.length === 1 ? '{"choice":"gemma","question":"model_label"}'
        : calls.length === 2 ? 'Category: CPU\nModel: Intel Core i5-14400\nEvidence: I5-14400 is printed'
          : '{"choice":"gemma","question":"none"}';
      return { ok: true, json: async () => ({ message: { content } }) };
    }, { image: 'aGVsbG8=' });
  assert.deepEqual(calls.map(call => call.model), ['llama3.1:8b', 'gemma3:4b', 'llama3.1:8b']);
  assert.deepEqual(calls[1].messages[0].images, ['aGVsbG8=']);
  assert.match(calls[1].messages[0].content, /complete model printed/);
  assert.equal(JSON.parse(calls[2].messages[1].content).gemmaRecheck.model, 'i5-14400');
  assert.match(analysis, /Candidate: i5-14400\nReview: candidate/);
  assert.match(analysis, /Llama question: model_label/);
  assert.match(analysis, /Gemma recheck:.*I5-14400 is printed/);
  // Repeating a guess is not independent corroboration.
  assert.match(analysis, /Model: unknown/);
});

test('Gemma recheck cannot erase its previous candidate or hide a suffix conflict', async () => {
  let calls = 0;
  const analysis = await collaborateCpuAnalysis('Category: CPU\nModel: i5-14400', { accepted: false, evidence: [] },
    async () => ({ ok: true, json: async () => ({ message: { content: ++calls === 1
      ? '{"choice":"gemma","question":"suffix"}' : calls === 2
        ? 'Category: CPU\nModel: i5-14400F\nEvidence: I5-14400F' : '{"choice":"conflict","question":"none"}' } }) }),
    { image: 'aGVsbG8=' });
  assert.equal(calls, 3);
  assert.match(analysis, /Candidate: i5-14400 \/ i5-14400F\nReview: conflict/);
  assert.match(analysis, /Model: unknown/);
});
