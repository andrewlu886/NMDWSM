const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

test('typed features and valuation categories use the same wizard as buttons', { timeout: 60000 }, async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000, args: ['--disable-gpu'] });
  const open = async () => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const requests = [], errors = [], photoBodies = [];
    let imageAnalysis = '';
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      let contentType = 'text/plain', body = '';
      if (url.pathname === '/chat') { contentType = 'text/html'; body = '<html><head><meta charset="UTF-8"></head><body><script src="/chat-widget.js"></script></body></html>'; }
      else if (['/chat-widget.js', '/psu-flow.js'].includes(url.pathname)) {
        contentType = 'application/javascript'; body = fs.readFileSync(path.join(__dirname, '../public', url.pathname.slice(1)), 'utf8');
      } else if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/chat' && request.postData()) photoBodies.push(JSON.parse(request.postData()));
        requests.push(url.pathname + url.search); contentType = 'application/json';
        body = JSON.stringify(url.pathname === '/api/chat/status' ? { available: true } : { success: true, data: [], answer: '測試回覆', ...(url.pathname === '/api/chat' ? { imageAnalysis } : {}) });
      }
      request.respond({ status: 200, contentType, body }).catch(() => {});
    });
    await page.goto('http://localhost:3999/chat');
    await page.waitForSelector('.ai-chat-launcher');
    await page.evaluate(() => document.querySelector('.ai-chat-launcher').click());
    await page.waitForSelector('.ai-chat-reopen-suggestions button');
    return { page, context, requests, errors, photoBodies, setAnalysis: value => { imageAnalysis = value; } };
  };
  const send = (page, text) => page.evaluate(value => {
    const input = document.querySelector('#ai-chat-input'); input.value = value; input.form.requestSubmit();
  }, text);
  const reply = page => page.$eval('.ai-chat-message.assistant:last-child', node => node.textContent);
  try {
    for (const [label, command] of [['二手估價', '我要二手估價'], ['市價查詢', '我要市價查詢'], ['智慧推薦', '我想要智慧推薦'], ['瓦數計算', '我要算瓦數']]) {
      const a = await open(), b = await open();
      try {
        await a.page.evaluate(value => {
          const buttons = [...document.querySelectorAll('.ai-chat-reopen-suggestions button')];
          const selected = buttons.find(button => button.textContent === value);
          if (!selected) throw Error(JSON.stringify({ value, labels: buttons.map(button => button.textContent) }));
          selected.click();
        }, label);
        await send(b.page, command);
        assert.equal(await reply(a.page), await reply(b.page), command);
        assert.ok(!b.requests.includes('/api/chat'), 'feature selection must not invoke Llama on stale history');
        assert.deepEqual(b.errors, []);
      } finally { await a.context.close(); await b.context.close(); }
    }
    const app = await open();
    try {
      for (const [text, category, label] of [['cpu', 'cpu', 'CPU'], ['我要估處理器', 'cpu', 'CPU'], ['顯示卡', 'gpu', '顯卡'], ['gpu', 'gpu', '顯卡'], ['記憶體', 'ram', '記憶體'], ['motherboard', 'motherboard', '主機板']]) {
        await send(app.page, '我要二手估價');
        await send(app.page, text);
        try {
          await app.page.waitForFunction(value => document.querySelector('.ai-chat-message.assistant:last-child')?.textContent.includes(`輸入${value}型號`), { timeout: 3000 }, label);
        } catch {
          throw Error(JSON.stringify({ text, label, requests: app.requests, errors: app.errors, content: await app.page.$eval('.ai-chat-messages', node => node.textContent) }));
        }
        assert.ok(app.requests.includes('/api/valuation/model-options?category=' + category));
      }
      await send(app.page, '我要二手估價'); await send(app.page, 'cpu 和顯卡');
      assert.match(await reply(app.page), /請先選一種/);
      await send(app.page, '手機'); assert.match(await reply(app.page), /CPU.*記憶體.*顯卡.*主機板/);
      await send(app.page, '我要市價查詢'); assert.match(await reply(app.page), /資訊與市價/);
      assert.ok(!app.requests.includes('/api/chat'));
      assert.deepEqual(app.errors, []);
    } finally { await app.context.close(); }
    const photo = await open();
    const upload = async analysis => {
      photo.setAnalysis(analysis);
      await send(photo.page, '我要二手估價'); await send(photo.page, 'cpu');
      await photo.page.waitForFunction(() => document.querySelector('.ai-chat-message.assistant:last-child')?.textContent.includes('輸入CPU型號'));
      await photo.page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1000;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
        window.testOriginalImage = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(blob); });
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'test.jpg', { type: 'image/jpeg' }));
        const field = document.querySelector('#ai-chat-image'); field.files = transfer.files; field.dispatchEvent(new Event('change'));
      });
      await photo.page.waitForSelector('.ai-chat-preview img');
      await photo.page.click('.ai-chat-preview img');
      await photo.page.waitForSelector('dialog[open] img');
      assert.match(await photo.page.$eval('dialog img', img => img.src), /^blob:/);
      await photo.page.keyboard.press('Escape');
      await send(photo.page, '');
      await photo.page.waitForFunction(() => !document.querySelector('#ai-chat-input').disabled);
      const sentImage = photo.photoBodies.at(-1).messages.at(-1).images[0];
      assert.equal(sentImage, await photo.page.evaluate(() => window.testOriginalImage), 'preserve original bytes above 1024px');
      await photo.page.evaluate(() => [...document.querySelectorAll('.ai-chat-message.user img')].at(-1).click());
      await photo.page.waitForSelector('dialog[open] img');
      assert.match(await photo.page.$eval('dialog img', img => img.src), /^blob:/);
      await photo.page.keyboard.press('Escape');
    };
    try {
      await upload('Category: CPU\nModel: unknown\nCandidate: i7-14700\nReview: candidate\nConfidence: low\nCPU model observation: {"appearanceCandidates":[{"model":"i5-13400"}]}');
      assert.match(await reply(photo.page), /照片初步辨識為CPU「i7-14700」/);
      assert.doesNotMatch(await reply(photo.page), /無法從圖片|i5-13400/);
      const beforeConfirm = photo.requests.length;
      await send(photo.page, '是');
      await photo.page.waitForFunction(() => document.querySelector('.ai-chat-message.assistant:last-child')?.textContent.includes('保固'));
      assert.ok(photo.requests.slice(beforeConfirm).some(url => url.includes('/api/valuation/models?')));
      await upload('Category: CPU\nModel: unknown\nCandidate: i7-14700\nReview: candidate\nConfidence: low\nGemma observation: {"model":"i7-14700","observation":"Category: CPU\\nModel: i7-14700\\nEvidence: I7-14700 is visible\\nConfidence: high"}\nGemma recheck: {"model":"i7-14700","observation":"Model: i7-14700\\nConfidence: high"}');
      assert.match(await reply(photo.page), /保固/);
      assert.match(await photo.page.$eval('.ai-chat-messages', node => node.textContent), /已辨識型號「i7-14700」/);
      await upload('Category: CPU\nModel: i7-14700\nCandidate: i7-14700\nReview: corroborated\nConfidence: medium');
      assert.match(await reply(photo.page), /保固/);
      await upload('Category: CPU\nModel: unknown\nCandidate: i7-14700\nReview: candidate\nConfidence: low\nGemma observation: {"model":"i7-14700","observation":"Model: i7-14700\\nEvidence: I7-14700 is printed\\nConfidence: low"}\nGemma recheck: {"model":null,"observation":"Category: CPU, Model: Intel Core i7-14700, Evidence: I7-14700"}');
      assert.match(await reply(photo.page), /保固/);
      await upload('Category: CPU\nModel: unknown\nCandidate: i7-14700\nReview: candidate\nConfidence: low\nGemma observation: {"model":"i7-14700","observation":"Model: i7-14700\\nEvidence: I7-14700 is not legible\\nConfidence: low"}');
      assert.match(await reply(photo.page), /若正確可回覆/);
      await upload('Category: CPU\nModel: unknown\nCandidate: i7-14700\nReview: candidate\nConfidence: low\nGemma observation: {"model":"i7-14700","observation":"Model: i7-14700\\nConfidence: low"}');
      assert.match(await reply(photo.page), /若正確可回覆/);
      await upload('Category: CPU\nModel: unknown\nCandidate: i7-14700 / i7-14700F\nReview: conflict\nConfidence: low');
      assert.match(await reply(photo.page), /i7-14700」或「i7-14700F/);
      await send(photo.page, '是'); assert.match(await reply(photo.page), /多個候選/);
      await photo.page.evaluate(() => [...document.querySelectorAll('.ai-valuation-btn')].find(button => button.textContent === '確認 i7-14700F').click());
      await photo.page.waitForFunction(() => document.querySelector('.ai-chat-message.assistant:last-child')?.textContent.includes('保固'));
      await upload('Category: CPU\nModel: unknown\nCandidate: unknown\nReview: unreadable\nConfidence: low');
      assert.match(await reply(photo.page), /無法從圖片/);
      assert.deepEqual(photo.errors, []);
    } finally { await photo.context.close(); }
  } finally { await browser.close(); }
});
