/* eslint-env browser */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const hardwareContext = require('../public/hardware-context');

test('photo context continues existing valuation, selects units, restores state and respects corrections', { timeout: 90000 }, async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000, args: ['--disable-gpu'] });
  try {
    const page = await browser.newPage();
    const errors = [], estimates = [], chats = [], queries = [];
    let analysis = 'Category: CPU\nModel: i7-14700\nConfidence: high';
    let cpu = { status: 'verified', requiresConfirmation: false, model: 'i7-14700', candidates: ['i7-14700'] };
    let failEstimate = false;
    const rows = [
      { id: 'cpu-base', canonicalModel: 'Core i7-14700', manufacturer: 'Intel', cpuPricing: { referencePriceNtd: 10000 } },
      { id: 'cpu-f', canonicalModel: 'Core i7-14700F', manufacturer: 'Intel', cpuPricing: { referencePriceNtd: 9000 } },
      { id: 'gpu-white', canonicalModel: 'ASUS DUAL RTX 4060 EVO-WHITE 8GB', manufacturer: 'ASUS', referencePrice: { priceNtd: 8000 } }
    ];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      let contentType = 'text/plain', body = '';
      if (url.pathname === '/chat') {
        contentType = 'text/html';
        body = '<html><head><meta charset="UTF-8"></head><body><script src="/chat-widget.js"></script></body></html>';
      } else if (['/chat-widget.js', '/psu-flow.js', '/hardware-context.js'].includes(url.pathname)) {
        contentType = 'application/javascript';
        body = fs.readFileSync(path.join(__dirname, '../public', url.pathname.slice(1)), 'utf8');
      } else if (url.pathname.startsWith('/api/')) {
        contentType = 'application/json';
        let value = { success: true, data: [] };
        if (url.pathname === '/api/chat/status') value = { available: true };
        if (url.pathname === '/api/chat') {
          const payload = JSON.parse(request.postData()); chats.push(payload);
          value = { success: true, answer: '辨識回覆', imageAnalysis: analysis, cpuRecognition: cpu, hardwareRecognition: hardwareContext.observation(analysis, cpu) };
          if (!payload.messages.at(-1).images) value = { success: true, answer: '一般回覆' };
        }
        if (url.pathname === '/api/valuation/model-options' || url.pathname === '/api/valuation/models') {
          queries.push(url.search);
          value.data = rows; // Deliberately includes near matches; client must choose exact SKU.
        }
        if (url.pathname === '/api/valuation') {
          const payload = JSON.parse(request.postData()); estimates.push(payload);
          value = failEstimate ? { success: false, message: '暫時無法估價' }
            : { success: true, price: 5432, range: { min: 5000, max: 5800 }, hardware: { canonicalModel: payload.model }, warning: '測試估價' };
        }
        body = JSON.stringify(value);
      }
      request.respond({ status: 200, contentType, body }).catch(() => {});
    });
    const idle = () => page.waitForFunction(() => !document.querySelector('#ai-chat-input').disabled);
    const send = async text => {
      await idle();
      await page.evaluate(value => { const field = document.querySelector('#ai-chat-input'); field.value = value; field.form.requestSubmit(); }, text);
      // A submit first awaits the module, then locks input. Wait a turn before polling completion.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
      await idle();
    };
    const reply = () => page.$eval('.ai-chat-message.assistant:last-child', node => node.textContent);
    const click = async label => {
      await page.evaluate(value => {
        const button = [...document.querySelectorAll('.ai-chat-message.assistant button')].reverse().find(node => node.textContent === value);
        if (!button) throw Error('Missing button: ' + value);
        button.click();
      }, label);
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30))); await idle();
    };
    const upload = async (caption = '') => {
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'hardware.jpg', { type: 'image/jpeg' }));
        const field = document.querySelector('#ai-chat-image'); field.files = transfer.files; field.dispatchEvent(new Event('change'));
      });
      await page.waitForSelector('.ai-chat-preview img');
      await send(caption);
    };
    const clear = async () => { await page.click('.ai-chat-clear'); };
    await page.goto('http://localhost:3999/chat'); await page.click('.ai-chat-launcher');
    await upload('這是什麼 CPU');
    await send('幫我估價');
    assert.match(await reply(), /3 年.*5 年/);
    assert.equal(chats.length, 1, 'valuation reuses photo without another LLM/image request');
    await click('5 年（含延長保固）');
    await send('幫我估價'); assert.match(await reply(), /已使用多久/);
    await send('18個月');
    assert.deepEqual({ model: estimates.at(-1).model, id: estimates.at(-1).modelId, warranty: estimates.at(-1).totalWarrantyMonths, usage: estimates.at(-1).elapsedMonths },
      { model: 'Core i7-14700', id: 'cpu-base', warranty: 60, usage: 18 });
    assert.match(await reply(), /5,432/);
    await page.reload(); await page.click('.ai-chat-launcher');
    await send('幫我估價'); assert.match(await reply(), /5,432/);

    await send('更正，是 i7-14700F');
    assert.match(await reply(), /3 年.*5 年/);
    await click('3 年（一般保固）'); await send('6個月');
    assert.equal(estimates.at(-1).modelId, 'cpu-f');
    assert.equal(estimates.at(-1).originalPrice, 9000);
    assert.equal(estimates.at(-1).elapsedMonths, 6);

    // New photo, different category; generic valuation requires choosing a unit.
    await send('我要市價查詢');
    analysis = 'Category: GPU\nModel: ASUS DUAL RTX 4060 EVO-WHITE 8GB\nConfidence: high'; cpu = null;
    await upload(); await send('幫我估價'); assert.match(await reply(), /想估哪一個零件/);
    await send('顯卡'); assert.match(await reply(), /保固期間/);
    await send('3年'); await send('1年');
    assert.equal(estimates.at(-1).model, 'ASUS DUAL RTX 4060 EVO-WHITE 8GB');
    assert.equal(estimates.at(-1).elapsedMonths, 12);
    assert.equal(estimates.at(-1).totalWarrantyMonths, 36);

    // A conflicting new photo must never silently pick the old verified CPU.
    analysis = 'Category: CPU\nModel: unknown\nCandidate: i7-14700 / i7-14700F\nConfidence: low';
    cpu = { status: 'conflict', requiresConfirmation: true, model: null, candidates: ['i7-14700', 'i7-14700F'] };
    await upload('這顆二手值多少'); assert.match(await reply(), /判讀有分歧/);
    const before = estimates.length;
    await send('是'); assert.match(await reply(), /多個候選/); assert.equal(estimates.length, before);
    await click('確認 i7-14700F'); assert.match(await reply(), /保固/);
    await page.reload(); await page.click('.ai-chat-launcher');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '5 年（含延長保固）'));
    await click('3 年（一般保固）');
    failEstimate = true; await send('8個月'); assert.match(await reply(), /暫時無法估價/);
    failEstimate = false; await send('幫我估價'); assert.match(await reply(), /5,432/);
    assert.equal(estimates.at(-1).elapsedMonths, 8);

    // Editing a source invalidates its trust and active valuation state.
    await page.evaluate(() => [...document.querySelectorAll('.ai-chat-edit')].find(button => button.parentElement.textContent.includes('這顆二手值多少')).click());
    await page.$eval('.ai-chat-message-editor textarea', field => { field.value = '型號需要重新核對'; });
    await page.evaluate(() => [...document.querySelectorAll('.ai-chat-edit-actions button')].find(button => button.textContent === '儲存').click());
    await send('第三張估價'); assert.match(await reply(), /若正確|判讀有分歧/);

    // Clearing removes observations; all remaining categories use the same API.
    for (const [category, model] of [['motherboard', 'ASUS PRIME B760M-A WIFI D4'], ['RAM', 'Kingston DDR5 6000 32GB (16GBx2)']]) {
      await clear(); analysis = `Category: ${category}\nModel: ${model}\nConfidence: high`; cpu = null;
      await upload('幫我估價'); assert.match(await reply(), /保固期間/);
      await send('3年'); await send('2年');
      assert.equal(estimates.at(-1).model, model);
      assert.equal(estimates.at(-1).modelId, null, 'unknown SKU cannot match nearby catalog entries');
    }
    await clear();
    analysis = 'Category: GPU\nModel: ASUS DUAL RTX 4060 EVO-WHITE 8GB\nConfidence: high';
    await upload('這張顯卡幫我估價，保固3年，使用1年，當初買8000元');
    assert.match(await reply(), /5,432/);
    assert.equal(estimates.at(-1).originalPrice, 8000);
    assert.equal(estimates.at(-1).elapsedMonths, 12);
    assert.equal(estimates.at(-1).strictModelMatch, true);
    await clear();
    analysis = 'Category: CPU\nModel: i7-14700F\nConfidence: low';
    cpu = { status: 'candidate', requiresConfirmation: true, model: null, candidates: ['i7-14700F'] };
    await upload(); await send('是');
    await send('使用了10個月，保固3年');
    await send('幫我估價');
    assert.match(await reply(), /5,432/);
    assert.equal(estimates.at(-1).elapsedMonths, 10);
    await clear(); await send('不要估價'); assert.equal(await reply(), '一般回覆');
    await send('估價是什麼'); assert.equal(await reply(), '一般回覆');
    await send('幫我估價'); assert.match(await reply(), /您想估哪一種零件/);
    assert.deepEqual(errors, []);
    assert.ok(queries.length > 0);
  } finally { await browser.close(); }
});
