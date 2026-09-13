const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadProductPage } = require('../src/scrapers/browser-page');

function fakePage({ timeout = false, status = 200, products = true } = {}) {
  const handlers = {};
  const frame = {};
  return {
    setRequestInterception: async () => {},
    on: (name, handler) => { handlers[name] = handler; },
    mainFrame: () => frame,
    goto: async () => {
      handlers.response({
        request: () => ({ isNavigationRequest: () => true }),
        frame: () => frame,
        status: () => status
      });
      if (timeout) throw Object.assign(new Error('navigation timeout'), { name: 'TimeoutError' });
    },
    waitForSelector: async () => {
      if (!products) throw Object.assign(new Error('selector timeout'), { name: 'TimeoutError' });
    },
    title: async () => 'Verify your browser'
  };
}

test('導覽逾時但商品已載入時仍可解析', async () => {
  await loadProductPage(fakePage({ timeout: true }), 'https://example.com', '.item', 'test');
});

test('商城拒絕存取時保留 HTTP 狀態', async () => {
  await assert.rejects(
    loadProductPage(fakePage({ status: 403 }), 'https://example.com', '.item', 'test'),
    /HTTP 403/
  );
});

test('商品未載入時附上頁面標題以診斷驗證頁', async () => {
  await assert.rejects(
    loadProductPage(fakePage({ products: false }), 'https://example.com', '.item', 'test'),
    /商品未載入；HTTP 200；頁面標題: Verify your browser/
  );
});
