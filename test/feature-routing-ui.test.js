const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const hardware = require('../public/hardware-context');

test('product/feature routing handles images, queues, confirmation, recovery and all four tools', { timeout: 90000 }, async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000, args: ['--disable-gpu'] });
  const page = await browser.newPage();
  const requests = [], errors = [];
  let model = 'i7-14700', category = 'cpu', verified = true, failMarket = false, failImage = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    let body = '', contentType = 'text/plain';
    if (url.pathname === '/chat') {
      contentType = 'text/html'; body = '<html><meta charset="UTF-8"><body><script src="/chat-widget.js"></script></body></html>';
    } else if (['/chat-widget.js', '/hardware-context.js', '/psu-flow.js'].includes(url.pathname)) {
      contentType = 'application/javascript'; body = fs.readFileSync(path.join(__dirname, '../public', url.pathname.slice(1)), 'utf8');
    } else if (url.pathname.startsWith('/api/')) {
      const payload = JSON.parse(request.postData() || '{}');
      requests.push({ path: url.pathname, payload });
      contentType = 'application/json';
      let value = { success: true, data: [] };
      if (url.pathname === '/api/chat/status') value = { available: true };
      else if (url.pathname === '/api/chat') {
        if (payload.resolveFeatureOnly) value = { success: true, featureAction: { features: ['market'], targetText: payload.messages.at(-1).content } };
        else if (payload.messages.at(-1).images) {
          const analysis = `Category: ${category === 'cpu' ? 'CPU' : 'graphics card'}\nModel: ${model}\nConfidence: high`;
          const cpu = category === 'cpu' ? { status: verified ? 'verified' : 'candidate', model: verified ? model : null, candidates: [model], requiresConfirmation: !verified } : null;
          value = failImage ? { success: false, message: '圖片暫時失敗' } : { success: true, answer: '辨識完成', imageAnalysis: analysis, cpuRecognition: cpu, hardwareRecognition: hardware.observation(analysis, cpu) };
        } else value = failMarket ? { success: false, message: '市價暫時失敗' } : { success: true, answer: `市價結果：${payload.messages.at(-1).content}` };
      } else if (url.pathname === '/api/valuation/model-options' || url.pathname === '/api/valuation/models') {
        value.data = ['i7-14700', 'i7-12700', 'i7-12700K', 'i7-12700F', 'RTX 4060'].map((name, index) => ({ id: index + 1, canonicalModel: name, manufacturer: /i7/.test(name) ? 'Intel' : 'NVIDIA', referencePrice: 10000 }));
      } else if (url.pathname === '/api/valuation') value = { success: true, price: 4321, range: { min: 4000, max: 4600 }, hardware: { canonicalModel: payload.model } };
      else if (url.pathname === '/api/cpu-data') value = require('../src/data/cpu-power-supplements').supplementCpuPower([{ CPU型號: 'i7-12700', 最大銳頻功耗: 180 }]);
      else if (url.pathname === '/api/gpu-data') value = [{ 顯示卡型號: 'RTX 4060', TDP: 115, 官方建議瓦數: 550 }];
      else if (url.pathname === '/api/recommend') value = { recommendations: [] };
      body = JSON.stringify(value);
    }
    request.respond({ status: 200, contentType, body }).catch(() => {});
  });
  const idle = () => page.waitForFunction(() => !document.querySelector('#ai-chat-input').disabled);
  const send = async text => {
    await idle();
    await page.evaluate(value => { const field = document.querySelector('#ai-chat-input'); field.value = value; field.form.requestSubmit(); }, text);
    await idle();
  };
  const reply = () => page.$eval('.ai-chat-message.assistant:last-child', node => node.textContent);
  const allReplies = () => page.$eval('.ai-chat-messages', node => node.textContent);
  const click = async label => {
    await idle();
    await page.evaluate(value => {
      const button = [...document.querySelectorAll('button')].reverse().find(node => node.textContent === value);
      if (!button) throw Error('Missing button ' + value); button.click();
    }, label);
    await idle();
  };
  const clear = () => page.click('.ai-chat-clear');
  const photo = async text => {
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'photo.png', { type: 'image/png' }));
      const field = document.querySelector('#ai-chat-image'); field.files = transfer.files; field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('.ai-chat-preview img'); await send(text);
  };
  const markets = () => requests.filter(request => request.path === '/api/chat' && request.payload.executeFeature);
  try {
    await page.goto('http://localhost:3999/chat'); await page.click('.ai-chat-launcher');
    await send('幫我查 i7-12700 的市價');
    assert.match(await reply(), /市價結果：i7-12700/);
    assert.equal(markets().at(-1).payload.messages.at(-1).content, 'i7-12700');

    // Explicit image request must displace a legacy/incomplete valuation.
    await send('幫我估價');
    await send('幫我找找這顆哪裡買划算');
    assert.equal(markets().at(-1).payload.messages.at(-1).content, 'i7-12700');
    await send('幫我估價');
    model = 'i7-12700K'; verified = false;
    const before = markets().length;
    await photo('這是我的 CPU，幫我做市價查詢');
    assert.match(await reply(), /確認後繼續市價查詢/);
    assert.doesNotMatch(await reply(), /繼續估價/);
    assert.equal(markets().length, before);
    await page.reload(); await page.click('.ai-chat-launcher');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === '確認 i7-12700K'));
    await send('不是，是 i7-12700');
    assert.equal(markets().at(-1).payload.messages.at(-1).content, 'i7-12700');
    assert.match(await reply(), /市價結果/);

    await clear(); verified = true; model = 'i7-14700';
    await photo('這是什麼 CPU');
    await send('查市價並估二手價');
    assert.match(await allReplies(), /市價結果：i7-14700/);
    assert.match(await reply(), /保固/);
    await click('3 年（一般保固）');
    await send('幫我估價'); assert.match(await reply(), /使用多久/);
    await send('1年'); assert.match(await reply(), /4,321/);
    const estimate = requests.filter(request => request.path === '/api/valuation').at(-1).payload;
    assert.equal(estimate.model, 'i7-14700'); assert.equal(estimate.elapsedMonths, 12); assert.equal(estimate.totalWarrantyMonths, 36);

    await clear();
    await send('i7-12700 配 RTX 4060 幫我算瓦數');
    assert.ok(await page.$('.ai-power-options'));
    assert.doesNotMatch(await allReplies(), /使用的CPU嗎|你的GPU型號嗎/);
    assert.match(await allReplies(), /i7-12700|RTX 4060/);

    await clear(); await photo('這是我的 CPU');
    await send('以這顆 CPU 幫我推薦配置，預算三萬，玩3A遊戲，要全新');
    const recommendation = requests.filter(request => request.path === '/api/recommend').at(-1).payload;
    assert.equal(recommendation.budget, 30000); assert.equal(recommendation.usage, 'gaming');
    assert.equal(recommendation.productType, 'desktop');
    assert.equal(recommendation.requiredHardware[0].model, 'i7-14700');
    await send('如果是二手呢');
    const comparedHardware = requests.filter(request => request.path === '/api/recommend').at(-1).payload;
    assert.equal(comparedHardware.condition, 'used');
    assert.equal(comparedHardware.requiredHardware[0].model, 'i7-14700');

    // Match the condition comparison from the reported screenshot, including
    // button-only entry, reload, and no repeated budget/usage questions.
    await clear(); await click('智慧推薦');
    await send('20000，文書');
    assert.match(await reply(), /二手.*全新品/);
    await send('二手');
    const recommendations = () => requests.filter(request => request.path === '/api/recommend');
    const usedCount = recommendations().length;
    const beforeComparison = requests.length;
    await send('如果是全新呢');
    assert.equal(recommendations().length, usedCount + 2);
    for (const request of recommendations().slice(-2)) {
      assert.equal(request.payload.budget, 20000);
      assert.equal(request.payload.usage, 'office');
      assert.equal(request.payload.condition, 'new');
    }
    assert.deepEqual(recommendations().slice(-2).map(request => request.payload.productType), ['desktop', 'laptop']);
    assert.equal(requests.slice(beforeComparison).some(request => request.path === '/api/chat'), false);
    await page.reload(); await page.click('.ai-chat-launcher');
    await send('那二手呢');
    assert.ok(recommendations().slice(-2).every(request => request.payload.condition === 'used' && request.payload.budget === 20000));
    let comparisonCount = recommendations().length;
    await send('全新手機呢');
    assert.equal(recommendations().length, comparisonCount);
    await clear(); await send('如果是全新呢');
    assert.equal(recommendations().length, comparisonCount);

    await clear(); category = 'cpu'; model = 'i7-14700'; verified = true;
    await send('我要進行瓦數計算'); await photo('');
    assert.match(await reply(), /GPU型號/);
    const powerState = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('nmdwsm-ai-chat-interface')).powerFlow);
    assert.equal((await powerState()).cpuWatts, 219);
    assert.equal(requests.filter(r => r.path === '/api/chat' && r.payload.messages?.at(-1).images).at(-1).payload.messages.at(-1).content, '');
    category = 'gpu'; model = 'RTX 4060'; await photo('');
    assert.equal((await powerState()).cpuWatts, 219);
    assert.equal((await powerState()).gpuWatts, 115);
    assert.equal((await powerState()).stage, 'components');
    await clear(); category = 'cpu'; model = 'unknown'; verified = false;
    await send('瓦數計算'); await photo('');
    assert.match(await reply(), /在對話框輸入CPU完整型號/);
    await send('i7-14700'); assert.match(await reply(), /GPU型號/);
    category = 'gpu'; await photo('');
    assert.match(await reply(), /在對話框輸入顯卡完整型號/);
    await page.reload(); await page.click('.ai-chat-launcher');
    assert.doesNotMatch(await allReplies(), /請辨識這張硬體圖片|圖片辨識結果：/);
    await send('RTX 9999'); assert.match(await reply(), /進度已保留/);
    await send('RTX 4060');
    assert.equal((await powerState()).cpuWatts, 219);
    assert.equal((await powerState()).stage, 'components');
    verified = true; category = 'cpu'; model = 'i7-14700';

    await clear();
    failMarket = true; await send('i7-12700 幫我查市價並估二手價');
    assert.match(await reply(), /市價暫時失敗/);
    await page.reload(); await page.click('.ai-chat-launcher');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === '繼續'));
    failMarket = false; await click('繼續');
    assert.match(await reply(), /使用多久/);
    assert.match(await allReplies(), /市價結果：i7-12700/);

    // Multiple records never silently choose the most recent.
    await clear(); await photo('CPU');
    category = 'gpu'; model = 'RTX 4060'; await photo('顯卡');
    const beforeChoice = markets().length;
    await send('幫我查市價'); assert.match(await reply(), /哪個產品/);
    assert.equal(markets().length, beforeChoice);
    await send('第一張'); assert.equal(markets().at(-1).payload.messages.at(-1).content, 'i7-14700');

    await clear(); category = 'cpu'; model = 'i7-12700'; failImage = true;
    await photo('這顆幫我查市價'); assert.match(await reply(), /圖片暫時失敗/);
    failImage = false; await click('重試上傳'); assert.match(await reply(), /市價結果：i7-12700/);
    await clear(); await photo('幫我找找這顆哪裡買划算');
    assert.match(await reply(), /市價結果：i7-12700/);

    // Source edits invalidate a queued request instead of leaving a stale retry.
    await clear(); failMarket = true; await send('i7-12700 查市價並估二手價');
    await page.evaluate(() => document.querySelector('.ai-chat-edit').click());
    await page.$eval('.ai-chat-message-editor textarea', field => { field.value = '更正產品需求'; });
    await click('儲存');
    const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nmdwsm-ai-chat-interface')));
    assert.equal(state.featureFlow, null);
    await clear(); const count = requests.length;
    await send('不要估價，幫我查 i7-12700 市價');
    assert.ok(requests.length > count); assert.equal(markets().at(-1).payload.messages.at(-1).content, 'i7-12700');
    await clear(); await send('估價是什麼');
    assert.equal((await page.evaluate(() => JSON.parse(sessionStorage.getItem('nmdwsm-ai-chat-interface')))).featureFlow, null);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
