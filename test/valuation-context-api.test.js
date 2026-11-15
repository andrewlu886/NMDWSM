const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createRequire } = require('node:module');

function service(tool = 'start_valuation_flow') {
  const requests = [];
  const requireAi = createRequire(path.resolve('public/AiService.js'));
  const context = {
    require: name => name === '../src/services/ollama-client' ? {
      createOllamaClient: () => ({ serviceMode: 'local', request: async (route, options) => {
        const payload = JSON.parse(options?.body || '{}'); requests.push(payload);
        return { ok: true, json: async () => route === '/api/tags' ? { models: [{ name: 'gemma3:4b' }] }
          : payload.images || payload.messages?.some(message => message.images)
            ? { message: { content: 'Category: GPU\nModel: ASUS DUAL RTX 4060 EVO-WHITE 8GB\nConfidence: high' } }
            : { message: { tool_calls: [{ function: { name: tool, arguments: { target: '模型憑空指定的 CPU', model: 'i9-14900', category: 'cpu', elapsedMonths: 10, condition: 'good' } } }] } } };
      } })
    } : name === '../src/services/search' ? { searchProductsWithMeta: async () => ({ data: [], meta: {} }) }
      : name === 'fs' ? { existsSync: () => true, appendFile: () => {} } : requireAi(name),
    module: { exports: {} }, __dirname: path.resolve('public'), process: { env: {} },
    console, URL, AbortController, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync('public/AiService.js', 'utf8'), context);
  return { requests, ask: async body => {
    let answer;
    await context.module.exports.handle(Readable.from([JSON.stringify(body)]), {
      writeHead: status => assert.equal(status, 200), end: text => { answer = JSON.parse(text); }
    });
    return answer;
  } };
}

test('LLM routes free-form valuation to the existing wizard without choosing a fabricated hardware model', async () => {
  const { ask, requests } = service();
  const result = await ask({ valuationContext: true, messages: [{ role: 'user', content: '這個電腦零件賣掉能拿回多少？' }] });
  assert.deepEqual(result.chatAction, { type: 'valuation', target: '' });
  assert.ok(requests.at(-1).tools.some(tool => tool.function.name === 'start_valuation_flow'));
  assert.ok(!requests.at(-1).tools.some(tool => tool.function.name === 'estimate_used_value'));
  assert.equal(result.price, undefined);
});

test('even an unexpected direct valuation tool call cannot bypass photo-context confirmation', async () => {
  const { ask } = service('estimate_used_value');
  const result = await ask({ valuationContext: true, messages: [{ role: 'user', content: '幫這個電腦零件估個二手價' }] });
  assert.equal(result.chatAction.type, 'valuation');
  assert.equal(result.price, undefined);
});

test('image responses expose common recognition while retaining original vision fields', async () => {
  const { ask } = service();
  const result = await ask({ messages: [{ role: 'user', content: '請辨識這張硬體圖片', images: ['aGVsbG8='] }] });
  assert.equal(result.hardwareRecognition.category, 'gpu');
  assert.equal(result.hardwareRecognition.model, 'ASUS DUAL RTX 4060 EVO-WHITE 8GB');
  assert.equal(result.hardwareRecognition.requiresConfirmation, false);
  assert.match(result.imageAnalysis, /EVO-WHITE/);
});
