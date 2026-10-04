/* eslint-env browser */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

test('recommendation PSU calculation stays in the page, shares power data and requires known models', async () => {
    const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000 });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 1000 });
        const requests = [];
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => {
            const pathname = new URL(request.url()).pathname;
            let body = '', contentType = 'application/json';
            if (pathname === '/recommend') {
                contentType = 'text/html';
                body = fs.readFileSync(path.resolve('public/recommend.html'), 'utf8');
            } else if (['/recommend.js', '/psu-flow.js'].includes(pathname)) {
                contentType = 'application/javascript'; body = fs.readFileSync(path.resolve('public', pathname.slice(1)), 'utf8');
            } else if (pathname.endsWith('.css')) {
                contentType = 'text/css'; body = fs.readFileSync(path.resolve('public', pathname.slice(1)), 'utf8');
            } else if (pathname === '/api/recommend') {
                body = JSON.stringify({ recommendations: [
                    { title: '測試桌機', cpu: 'i5-14400F', gpu: 'RTX5060Ti', price: 30000 },
                    { title: '未知 CPU 桌機', cpu: 'UNKNOWN', gpu: 'RTX5060Ti', price: 25000 }
                ] });
            } else if (pathname === '/api/cpu-data') {
                requests.push(pathname); body = JSON.stringify([{ 'CPU 型號': 'Intel Core i5-14400F', '最大銳頻功耗 PL2/PPT (W)': 148 }]);
            } else if (pathname === '/api/gpu-data') {
                requests.push(pathname); body = JSON.stringify([{ 顯示卡型號: 'NVIDIA GeForce RTX 5060 Ti', TDP: 180, 官方建議瓦數: 600 }]);
            }
            request.respond({ status: 200, contentType, body });
        });
        await page.goto('http://fixture.test/recommend');
        await page.type('#budget', '50000');
        await page.click('#recommend-submit');
        await page.waitForSelector('.recommend-tools-link');
        await page.locator('.recommend-tools-link').click();
        await page.waitForFunction(() => document.querySelector('.recommend-psu-result').textContent.includes('建議電源：600 W'), { timeout: 5000 }).catch(async error => {
            await page.screenshot({ path: '.cache/recommend-psu-debug.png', fullPage: true });
            throw new Error(error.message + ' ' + JSON.stringify({ errors, requests, expanded: await page.$eval('.recommend-tools-link', el => el.getAttribute('aria-expanded')), text: await page.$eval('.recommend-psu-result', el => el.textContent) }));
        });
        assert.equal(page.url(), 'http://fixture.test/recommend');
        assert.equal((await browser.pages()).length, 2); // Initial blank page plus this page; no popup.
        assert.equal(await page.$eval('.recommend-tools-link', el => el.tagName), 'BUTTON');
        assert.match(await page.$eval('.recommend-psu-result', el => el.textContent), /功耗：378 W/);
        await page.$eval('#recommend-psu-0 input[type=number]', el => { el.value = '3'; el.dispatchEvent(new Event('change')); });
        await page.waitForFunction(() => document.querySelector('.recommend-psu-result').textContent.includes('功耗：398 W'));
        await page.locator('.recommend-tools-link').click();
        assert.equal(await page.$eval('#recommend-psu-0', el => el.hidden), true);
        await page.$eval('[aria-controls="recommend-psu-1"]', el => el.click());
        await page.waitForFunction(() => document.querySelector('#recommend-psu-1 .recommend-psu-result').textContent.includes('CPU 型號或功耗資料不完整'));
        assert.doesNotMatch(await page.$eval('#recommend-psu-1 .recommend-psu-result', el => el.textContent), /建議電源/);
        await page.$eval('#recommend-psu-1 input[type=text]', el => { el.value = 'i5-14400F'; el.dispatchEvent(new Event('change')); });
        await page.waitForFunction(() => document.querySelector('#recommend-psu-1 .recommend-psu-result').textContent.includes('建議電源：600 W'));
        assert.deepEqual(requests.sort(), ['/api/cpu-data', '/api/gpu-data']);
        assert.deepEqual(errors, []);
        await page.setViewport({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    } finally { await browser.close(); }
});
