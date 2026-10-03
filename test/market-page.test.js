/* global document, getComputedStyle */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const puppeteer = require('puppeteer');
const publicDir = path.resolve(__dirname, '../public');
const html = fs.readFileSync(path.join(publicDir, 'scrape.html'), 'utf8');

test('market page inline scripts compile before browser interaction', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new vm.Script(match[1], { filename: 'scrape.html' });
  }
});

test('market page button, Enter, URL keyword, results, history and failures work in a browser', async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000 });
  try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    let status = 200;
    let result = { success: true, data: [{
      name: 'RTX 5080 顯示卡', platform: 'PChome', price: '40,000',
      url: 'https://24h.pchome.com.tw/prod/TEST'
    }], meta: { updatedAt: 1800000000000 } };
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      let contentType = 'text/plain';
      let body = '';
      let responseStatus = 200;
      if (url.pathname === '/api/scrape') {
        requests.push(url);
        contentType = 'application/json';
        body = JSON.stringify(result);
        responseStatus = status;
      } else if (url.pathname === '/scrape') {
        contentType = 'text/html';
        body = html;
      } else if (url.hostname === 'localhost' && /^\/(?:history-store\.js|style\.css|site-theme\.css|history\.css|market-page\.css)$/.test(url.pathname)) {
        contentType = url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css';
        body = fs.readFileSync(path.join(publicDir, url.pathname.slice(1)), 'utf8');
      }
      request.respond({ status: responseStatus, contentType, body }).catch(() => {});
    });
    await page.goto('http://localhost:3999/scrape');
    assert.equal(await page.$('.market-mode-tabs'), null);
    assert.equal(await page.$('input[value="facebook"]'), null);
    assert.equal(await page.$$eval('input[type="checkbox"][value="ruten"]', nodes => nodes.length), 1);
    assert.equal(await page.$eval('#platform-checkboxes input[value="ptt"]', node => getComputedStyle(node).accentColor), 'rgb(47, 159, 224)');
    await page.type('#keyword-input', 'rtx 5080');
    await page.click('.btn-search');
    await page.waitForSelector('.result-card');
    assert.equal(requests[0].searchParams.get('keyword'), 'rtx 5080');
    assert.equal(requests[0].searchParams.has('mode'), false);
    assert.equal(requests[0].searchParams.get('platform').split(',').length, 9);
    assert.match(await page.$eval('.result-card', node => node.textContent), /RTX 5080.*NT\$ 40,000/);
    await page.waitForSelector('.history-entry');
    // Enter also submits, with precision exclusions carried to the backend.
    await page.click('#precision-toggle');
    await page.focus('#keyword-input');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.market-data-freshness'));
    assert.equal(requests.length, 2);
    assert.match(requests[1].searchParams.get('exclude'), /筆電/);
    // Agent links automatically fill the keyword and initiate a search.
    await page.goto('http://localhost:3999/scrape?keyword=RTX%205080');
    await page.waitForSelector('.result-card');
    assert.equal(await page.$eval('#keyword-input', node => node.value), 'RTX 5080');
    assert.equal(requests.length, 3);
    result = { success: true, data: [] };
    await page.click('.btn-search');
    await page.waitForSelector('.history-no-results');
    assert.match(await page.$eval('#results-container', node => node.textContent), /沒有找到相關結果/);
    status = 429;
    result = { success: false, message: '查詢過於頻繁，請稍後再試。' };
    await page.click('.btn-search');
    await page.waitForSelector('.history-search-error');
    assert.match(await page.$eval('.history-search-error', node => node.textContent), /查詢過於頻繁/);
    assert.equal(await page.$eval('#loading', node => getComputedStyle(node).display), 'none');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
