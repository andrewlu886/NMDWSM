/* global calculatePower, currentCpuTdp */
/* eslint-env browser */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const puppeteer = require('puppeteer');
const publicDir = path.resolve(__dirname, '../public');
const cpu = [{ CPU型號: 'Intel Core i5-14600K', 最大銳頻功耗: '181W', 品牌: 'Intel' }];
const gpu = [{ 顯示卡型號: 'NVIDIA GeForce RTX 4070', TDP: '200W', 官方建議瓦數: '650W', 品牌: 'NVIDIA' }];
test('chat PSU wizard and calculator handoff in a browser', { skip: !fs.existsSync(puppeteer.executablePath()) }, async t => {
  let failCpu = false;
  let chatCalls = 0;
  const chatRequests = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (pathname === '/api/cpu-data' && failCpu) { failCpu = false; res.writeHead(503); res.end('{}'); return; }
      if (pathname === '/api/chat') {
        chatCalls++;
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          chatRequests.push(JSON.parse(body));
          res.end(JSON.stringify({ success: true, answer: '姐姐在這裡。', provider: 'conversation' }));
        });
        return;
      }
      res.end(JSON.stringify(pathname === '/api/cpu-data' ? cpu : pathname === '/api/gpu-data' ? gpu : pathname === '/api/chat/status' ? { available: false } : []));
      return;
    }
    if (pathname === '/' || pathname === '/other') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><script src="/chat-widget.js"></script></body></html>');
      return;
    }
    const file = path.join(publicDir, pathname === '/tools' ? 'tools.html' : pathname);
    if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(file);
    res.setHeader('Content-Type', ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const createPage = async () => {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 420, height: 900 });
      await page.setRequestInterception(true);
      page.on('request', request => request.url().startsWith(base) || request.url().startsWith('data:') ? request.continue() : request.abort());
      await page.goto(base);
      await page.click('.ai-chat-launcher');
      return { page, context };
    };
    const start = async page => {
      await page.evaluate(() => [...document.querySelectorAll('.ai-chat-reopen-suggestions button')].find(button => button.textContent === '瓦數計算').click());
      await page.waitForFunction(() => document.querySelector('.ai-chat-messages').textContent.includes('可以先告訴我你使用的CPU嗎'));
    };
    const send = async (page, text) => {
      await page.waitForFunction(() => !document.querySelector('#ai-chat-input').disabled);
      await page.type('#ai-chat-input', text);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('#ai-chat-input').disabled && document.querySelector('#ai-chat-input').value === '');
    };
    await t.test('CPU then GPU then required menus, computing within chat without a model server', async () => {
      const { page, context } = await createPage();
      try {
        await start(page);
        assert.equal(await page.$('.ai-power-options'), null);
        await send(page, 'i5-14600K');
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /好極了，那可以再告訴我你的GPU型號嗎/);
        assert.equal(await page.$('.ai-power-options'), null);
        await send(page, 'RTX 4070');
        await page.waitForSelector('.ai-power-options');
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /那最後，選擇你用的主板與散熱系統吧/);
        assert.equal(await page.$eval('.ai-power-options select', el => el.value), '');
        await page.select('select[aria-label="主機板"]', '40');
        await page.select('select[aria-label="散熱系統"]', '45');
        await page.click('.ai-power-options button');
        await page.waitForFunction(() => document.querySelector('.ai-chat-messages').textContent.includes('整機滿載預估約 476W'));
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /至少 650W/);
        assert.equal(chatCalls, 0);
        const button = await page.$('.ai-chat-message.assistant:last-child a.ai-valuation-btn');
        assert.equal(await button.evaluate(el => el.textContent), '瓦數計算');
        const target = new URL(await button.evaluate(el => el.href));
        assert.equal(target.searchParams.get('cpu'), 'Intel Core i5-14600K');
        assert.equal(target.searchParams.get('gpu'), 'NVIDIA GeForce RTX 4070');
        assert.equal(target.searchParams.get('motherboard'), '40');
        assert.equal(target.searchParams.get('cooling'), '45');
        await Promise.all([page.waitForNavigation(), button.click()]);
        await page.waitForFunction(() => document.querySelector('#total-watt').textContent === '476');
        assert.equal(await page.$eval('#recommend-watt', el => el.textContent), '650');
        assert.equal(await page.$eval('#power-result', el => getComputedStyle(el).display), 'block');

      } finally { await context.close(); }
    });
    await t.test('a social reply during the PSU wizard keeps the CPU step active', async () => {
      const { page, context } = await createPage();
      try {
        await start(page);
        const before = chatCalls;
        await send(page, '謝謝');
        await page.waitForFunction(() => document.querySelector('.ai-chat-messages').textContent.includes('姐姐在這裡'));
        assert.equal(chatCalls, before + 1);
        await send(page, 'i5-14600K');
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /好極了，那可以再告訴我你的GPU型號嗎/);
      } finally { await context.close(); }
    });
    await t.test('market mode treats thanks as conversation and keeps the next product query in market mode', async () => {
      const { page, context } = await createPage();
      try {
        await page.evaluate(() => [...document.querySelectorAll('.ai-chat-reopen-suggestions button')].find(button => button.textContent === '市價查詢').click());
        await send(page, '謝謝');
        await page.waitForFunction(() => document.querySelector('.ai-chat-messages').textContent.includes('姐姐在這裡'));
        assert.equal(chatRequests.at(-1).intent, undefined);
        await send(page, 'RTX 5060');
        assert.equal(chatRequests.at(-1).intent, 'market');
      } finally { await context.close(); }
    });
    await t.test('unknown GPU links to tools with the recognized CPU and unknown GPU intact', async () => {
      const { page, context } = await createPage();
      try {
        await start(page);
        await send(page, 'i5-14600K');
        await send(page, 'RTX 9999');
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /這個型號人家貌似不太知道餒，要不我們去頁面看看/);
        const href = await page.$eval('.ai-chat-response a', el => el.href);
        assert.equal(new URL(href).searchParams.get('cpu'), 'Intel Core i5-14600K');
        assert.equal(new URL(href).searchParams.get('gpu'), 'RTX 9999');
        await page.goto(href);
        await page.waitForFunction(() => document.querySelector('#gpu-power').value === 'RTX 9999');
        assert.equal(await page.$eval('#cpu-power', el => el.value), 'Intel Core i5-14600K');
        assert.equal(await page.$eval('#power-result', el => getComputedStyle(el).display), 'none');
        assert.match(await page.$eval('#power-model-warning', el => el.textContent), /RTX 9999/);
        await page.select('#gpu-power', 'NVIDIA GeForce RTX 4070');
        await page.evaluate(() => calculatePower());
        assert.equal(await page.$eval('#recommend-watt', el => el.textContent), '650');
      } finally { await context.close(); }
    });
    await t.test('unknown CPU is preserved without guessing a CPU power tier', async () => {
      const { page, context } = await createPage();
      try {
        await start(page);
        await send(page, 'i9-99999K');
        const href = await page.$eval('.ai-chat-response a', el => el.href);
        await page.goto(href);
        await page.waitForFunction(() => document.querySelector('#cpu-power').value === 'i9-99999K');
        assert.equal(await page.evaluate(() => currentCpuTdp), 0);
        assert.equal(await page.$eval('#power-result', el => getComputedStyle(el).display), 'none');
        await page.select('#cpu-power', 'Intel Core i5-14600K');
        assert.equal(await page.$('#cpu-power option[data-unmatched="true"]'), null);
        assert.doesNotMatch(await page.$eval('#cpu-power', el => el.textContent), /i9-99999K/);
        assert.equal(new URL(page.url()).searchParams.get('cpu'), 'Intel Core i5-14600K');
        assert.equal(await page.evaluate(() => currentCpuTdp), 181);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#cpu-power').value === 'Intel Core i5-14600K');
        assert.equal(await page.$('#cpu-power option[data-unmatched="true"]'), null);

      } finally { await context.close(); }
    });
    await t.test('database failure allows retry at the same CPU step', async () => {
      const { page, context } = await createPage();
      try {
        await start(page);
        failCpu = true;
        await send(page, 'i5-14600K');
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /功耗資料庫暫時無法連線/);
        assert.equal(await page.$('.ai-chat-response a'), null);
        await send(page, 'i5-14600K');
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /好極了/);
      } finally { await context.close(); }
    });
    await t.test('integrated GPU works and selected menus survive navigation', async () => {
      const { page, context } = await createPage();
      try {
        await start(page);
        await send(page, 'i5-14600K');
        await send(page, '內顯');
        await page.select('select[aria-label="主機板"]', '15');
        await page.select('select[aria-label="散熱系統"]', '30');
        await page.goto(base + '/other');
        await page.waitForSelector('.ai-power-options');
        assert.equal(await page.$eval('select[aria-label="主機板"]', el => el.value), '15');
        assert.equal(await page.$eval('select[aria-label="散熱系統"]', el => el.value), '30');
        await page.evaluate(() => document.querySelector('.ai-power-options').requestSubmit());
        await page.waitForFunction(() => document.querySelector('.ai-chat-messages').textContent.includes('整機滿載預估約 236W'));
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /至少 350W/);
      } finally { await context.close(); }
    });
    await t.test('image wattage action starts with CPU confirmation rather than navigating', async () => {
      const { page, context } = await createPage();
      try {
        await page.evaluate(() => {
          sessionStorage.setItem('nmdwsm-ai-chat-history', JSON.stringify([
            {role:'user',content:'這是什麼型號',imageAnalysis:'Category: GPU\nModel: RTX 4070\nConfidence: high'},
            {role:'assistant',content:'照片可能是 RTX 4070，請確認型號。'}
          ]));
        });
        await page.goto(base + '/other');
        await page.waitForSelector('.ai-image-actions button');
        await page.evaluate(() => document.querySelector('.ai-image-actions button').click());
        assert.equal(new URL(page.url()).pathname, '/other');
        assert.match(await page.$eval('.ai-chat-messages', el => el.textContent), /可以先告訴我你使用的CPU嗎/);
        assert.equal(await page.$('.ai-power-options'), null);
      } finally { await context.close(); }
    });
    await t.test('tools receive both models and motherboard/cooling selections', async () => {
      const { page, context } = await createPage();
      try {
        await page.goto(base + '/tools?cpu=i5-14600K&gpu=RTX%204070&motherboard=40&cooling=45');
        await page.waitForFunction(() => document.querySelector('#total-watt').textContent === '476');
        assert.equal(await page.$eval('#cpu-power', el => el.value), 'Intel Core i5-14600K');
        assert.equal(await page.$eval('#gpu-power', el => el.value), 'NVIDIA GeForce RTX 4070');
        assert.equal(await page.$eval('#recommend-watt', el => el.textContent), '650');
      } finally { await context.close(); }
    });
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
