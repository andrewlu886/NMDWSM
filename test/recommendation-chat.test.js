/* eslint-env browser */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { executeTool, TOOLS } = require('../public/AiService');
const publicDir = path.resolve(__dirname, '../public');

test('AI recommendation tool requires an explicit new or used choice before searching', async () => {
  const tool = TOOLS.find(item => item.function.name === 'recommend_hardware');
  assert.ok(tool.function.parameters.required.includes('condition'));
  for (const condition of [undefined, 'cheap']) {
    await assert.rejects(executeTool('recommend_hardware', {
      budget: 50000, productType: 'desktop', usage: 'gaming', condition
    }), /二手.*全新品/);
  }
});

test('chat recommendations wait for a product condition and send the selected condition', async t => {
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000 });
  try {
    const open = async () => {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const requests = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = new URL(request.url());
        let contentType = 'text/plain', body = '';
        if (url.pathname === '/chat') {
          contentType = 'text/html';
          body = '<html><head><meta charset="UTF-8"><link rel="stylesheet" href="/style.css"></head><body><script src="/chat-widget.js"></script></body></html>';
        } else if (url.pathname === '/api/recommend') {
          const options = JSON.parse(request.postData());
          requests.push(options);
          contentType = 'application/json';
          body = JSON.stringify({ recommendations: [{
            title: `${options.condition === 'used' ? '二手' : '全新'}桌機 i5-14400 RTX4060`,
            price: 20000, url: 'https://example.com/pc', platform: '測試'
          }] });
        } else if (url.pathname === '/api/chat/status') {
          contentType = 'application/json';
          body = JSON.stringify({ available: false });
        } else if (['/chat-widget.js', '/psu-flow.js'].includes(url.pathname)) {
          contentType = 'application/javascript';
          body = fs.readFileSync(path.join(publicDir, url.pathname.slice(1)), 'utf8');
        } else if (url.pathname === '/style.css') {
          contentType = 'text/css';
          body = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8');
        }
        request.respond({ status: 200, contentType, body }).catch(() => {});
      });
      await page.goto('http://localhost:3999/chat');
      await page.click('.ai-chat-launcher');
      await page.waitForSelector('.ai-chat-reopen-suggestions button');
      await page.$$eval('.ai-chat-reopen-suggestions button', buttons =>
        buttons.find(button => button.textContent === '智慧推薦').click());
      return { page, context, requests, errors };
    };
    const send = async (page, text) => {
      await page.type('#ai-chat-input', text);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('#ai-chat-input').disabled
        && document.querySelector('#ai-chat-input').value === '');
    };
    await t.test('budget then usage prompts for condition; cheap alone does not select used', async () => {
      const { page, context, requests, errors } = await open();
      try {
        await send(page, '50000');
        await send(page, '3a');
        assert.match(await page.$eval('.ai-chat-messages', node => node.textContent), /二手.*全新品/);
        assert.deepEqual(requests, []);
        await send(page, '便宜一點');
        assert.deepEqual(requests, []);
        await send(page, '二手和全新都可以');
        assert.deepEqual(requests, []);
        await send(page, '二手');
        assert.deepEqual(requests, [{ budget: 50000, usage: 'gaming', productType: 'desktop', condition: 'used' }]);
        assert.match(await page.$eval('.ai-chat-message.assistant:last-child', node => node.textContent), /商品狀況「二手」/);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
    await t.test('explicit new choice is respected without repeating the condition question', async () => {
      const { page, context, requests, errors } = await open();
      try {
        await send(page, '預算50000，玩3a，想要全新品桌機');
        assert.deepEqual(requests, [{ budget: 50000, usage: 'gaming', productType: 'desktop', condition: 'new' }]);
        const answer = await page.$eval('.ai-chat-message.assistant:last-child', node => node.textContent);
        assert.match(answer, /商品狀況「全新品」/);
        assert.doesNotMatch(answer, /回覆「二手」/);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
    await t.test('rejecting used products selects new products', async () => {
      const { page, context, requests } = await open();
      try {
        await send(page, '預算30000，文書主機，不要二手');
        assert.deepEqual(requests, [{ budget: 30000, usage: 'office', productType: 'desktop', condition: 'new' }]);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
