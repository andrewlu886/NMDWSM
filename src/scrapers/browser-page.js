async function loadProductPage(page, url, selector, platform) {
  // Keep scripts and API requests: product lists may be rendered dynamically.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const action = ['image', 'media', 'font'].includes(request.resourceType())
      ? request.abort()
      : request.continue();
    action.catch(() => {});
  });

  let status;
  page.on('response', (response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      status = response.status();
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    console.warn(`[${platform}] 導覽逾時，檢查已載入的商品內容`);
  }

  if (status >= 400) {
    throw new Error(`商城回應 HTTP ${status}`);
  }
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    const title = await page.title().catch(() => '無法取得標題');
    throw new Error(`商品未載入；HTTP ${status || '未收到回應'}；頁面標題: ${title.slice(0, 160)}`);
  }
}

module.exports = { loadProductPage };
