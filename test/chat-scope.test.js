const test = require('node:test');
const assert = require('node:assert/strict');
const { getScopeReply, matchesMarketProduct, pruneHardwareHistory } = require('../src/services/chat-scope');
const { answerMarketQuery } = require('../public/AiService');

test('chat market answers never replace RTX3060 with RTX5060 or RTX3060 Ti', async () => {
  const result = await answerMarketQuery('RTX3060', 'RTX3060', {
    searchProducts: async () => [
      { name: 'RTX 5060 顯示卡', price: '29900' },
      { name: 'RTX 3060 Ti 顯示卡', price: '9500' },
      { name: 'RTX 3060 顯示卡', price: '7000' }
    ]
  });
  assert.equal(result.products.length, 1);
  assert.match(result.answer, /7000/);
  assert.doesNotMatch(result.answer, /29900|9500|RTX 5060|RTX 3060 Ti/);
  assert.equal(matchesMarketProduct({ name: '其他主板 i5-14400F' }, 'i5-14400'), false);
});

test('unrelated history is dropped and short hardware followups still work', () => {
  const messages = [
    { role: 'user', content: '我是不是秦始皇' },
    { role: 'assistant', content: '無關歷史回答' },
    { role: 'user', content: '預算一萬元，想配電腦' },
    { role: 'assistant', content: '主要用途是什麼？' },
    { role: 'user', content: '遊戲' }
  ];
  assert.deepEqual(pruneHardwareHistory(messages), messages.slice(2));
  assert.ok(getScopeReply('你看我是不是秦始皇', messages));
  assert.ok(getScopeReply('電腦'.repeat(1100)));
});

test('condition answers retain valuation/recommendation context without admitting unrelated products', () => {
  const history = [
    { role: 'user', content: '您好我要估價' },
    { role: 'assistant', content: '你要的是二手估價還是全新估價？' }
  ];
  for (const answer of ['二手', '全新', '中古', '全新品', '我要二手', '二手就好', '我選全新！']) {
    assert.equal(getScopeReply(answer, history), null);
    assert.deepEqual(pruneHardwareHistory([...history, { role: 'user', content: answer }]), [...history, { role: 'user', content: answer }]);
  }
  assert.ok(getScopeReply('二手'));
  assert.ok(getScopeReply('二手書', history));
  assert.ok(getScopeReply('全新汽車', history));
  assert.ok(getScopeReply('二手', [{ role: 'user', content: '秦始皇是誰' }]));
});
function isolatedService(request) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const localRequire = require('node:module').createRequire(path.resolve('public/AiService.js'));
  const context = {
    require: name => name === '../src/services/ollama-client'
      ? { createOllamaClient: () => ({ request, serviceMode: 'local' }) }
      : name === 'fs' ? { existsSync: () => true, appendFile: () => {} } : localRequire(name),
    module: { exports: {} }, __dirname: path.resolve('public'), process: { env: {} },
    console, URL, AbortController, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync('public/AiService.js', 'utf8'), context);
  return async (messages = [{ role: 'user', content: '電腦升級有什麼要注意？' }]) => {
    let status, payload;
    await context.module.exports.handle(require('node:stream').Readable.from([
      JSON.stringify({ messages })
    ]), { writeHead: value => { status = value; }, end: body => { payload = JSON.parse(body); } });
    return { status, payload };
  };
}

test('valuation condition followup reaches Llama with the preceding question intact', async () => {
  let forwarded;
  const ask = isolatedService(async (_route, options) => {
    forwarded = JSON.parse(options.body).messages;
    return { ok: true, json: async () => ({ message: { content: '想估哪個電腦零件？請提供完整型號。' } }) };
  });
  const conversation = [
    { role: 'user', content: '您好我要估價' },
    { role: 'assistant', content: '你要的是二手估價還是全新估價？' },
    { role: 'user', content: '二手' }
  ];
  const reply = await ask(conversation);
  assert.equal(reply.payload.provider, 'ollama');
  assert.match(reply.payload.answer, /完整型號/);
  assert.deepEqual(forwarded.slice(1), conversation);
});

test('AI request capacity rejects the third request and releases completed slots', async () => {
  const pending = [];
  const ask = isolatedService(async () => new Promise(resolve => pending.push(resolve)));
  const first = ask(), second = ask();
  while (pending.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
  const third = await ask();
  assert.equal(third.status, 429);
  pending.splice(0).forEach(resolve => resolve({ ok: true, json: async () => ({ message: { content: '先確認主機板相容性。' } }) }));
  await Promise.all([first, second]);
  const next = ask();
  while (!pending.length) await new Promise(resolve => setTimeout(resolve, 1));
  pending.pop()({ ok: true, json: async () => ({ message: { content: '確認電源容量。' } }) });
  assert.equal((await next).status, 200);
});

test('repeated tool calls stop without letting the model loop indefinitely', async () => {
  let calls = 0;
  const ask = isolatedService(async () => {
    calls++;
    return { ok: true, json: async () => ({ message: { tool_calls: [
      { function: { name: 'unsupported_tool', arguments: {} } }
    ] } }) };
  });
  const reply = await ask();
  assert.equal(calls, 2);
  assert.equal(reply.payload.provider, 'fallback');
});
