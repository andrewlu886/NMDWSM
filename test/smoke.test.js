const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdwsm-smoke-'));
const port = 3210;
const baseUrl = `http://localhost:${port}`;
let server;
let serverError = '';

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
    ...options
  });
}

async function jsonRequest(method, pathname, body) {
  return request(pathname, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test.before(async () => {
  server = spawn(process.execPath, ['public/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tempRoot, 'smoke.db'),
      VALUATION_API_URL: '',
      VALUATION_API_KEY: ''
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  server.stderr.on('data', chunk => { serverError += chunk.toString(); });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early: ${serverError}`);
    try {
      const response = await request('/');
      if (response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${serverError}`);
});

test.after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
});

test('AI 聊天服務依賴宣告與備援載入應可被正確驗證', async () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(pkg.dependencies && pkg.dependencies['node-nlp'], 'node-nlp 應該被宣告為正式依賴');
  assert.doesNotThrow(() => require(path.join(projectRoot, 'public/AiService.js')), 'AiService 應該在缺少 node-nlp 時以備援方式載入');
});

test('保留的網站頁面可以開啟', async () => {
  for (const pathname of ['/', '/scrape', '/recommend.html', '/benchmark-instructions.html', '/tools', '/valuation.html', '/valuation']) {
    const response = await request(pathname);
    assert.equal(response.status, 200, pathname);
  }
});

test('零件推薦 API 要求明確的 CPU 或 GPU 類別', async () => {
  let response = await jsonRequest('POST', '/api/recommend', {
    budget: 30000,
    productType: 'component'
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /componentType/);

  response = await jsonRequest('POST', '/api/recommend', {
    budget: 30000,
    productType: 'component',
    componentType: 'ram'
  });
  assert.equal(response.status, 400);
});

test('跑分教學只從首頁內容進入，不出現在導覽列', () => {
  const pages = [
    'index.html', 'benchmark-instructions.html', 'recommend.html',
    'valuation.html', 'scrape.html', 'tools.html'
  ];
  for (const filename of pages) {
    const html = fs.readFileSync(path.join(projectRoot, 'public', filename), 'utf8');
    const navigation = html.match(/<nav[^>]*class="main-nav"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(navigation, `${filename} 應有主要導覽列`);
    assert.doesNotMatch(navigation[1], /benchmark-instructions|跑分教學/, filename);
  }

  const homepage = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  assert.match(homepage, /href="\/benchmark-instructions\.html"[^>]*>[^<]*查看跑分教學/);
});

test('估價辨識區只顯示辨識到的型號', () => {
  const valuationPage = fs.readFileSync(path.join(projectRoot, 'public', 'valuation.html'), 'utf8');
  const detectedSection = valuationPage.match(/<section id="detected-hardware"([\s\S]*?)<\/section>/);
  assert.ok(detectedSection);
  assert.match(detectedSection[1], /品牌與型號/);
  assert.doesNotMatch(detectedSection[1], /保固資訊|資料匹配狀態/);
  assert.doesNotMatch(valuationPage, /ram-special-condition|特殊規格或損耗/);
  assert.match(valuationPage, /id="total-warranty-months"/);
  assert.match(valuationPage, /id="cpu-warranty-months"[\s\S]*value="36"[\s\S]*value="60"/);
  assert.match(valuationPage, /id="elapsed-months"/);
  assert.doesNotMatch(valuationPage, /id="total-warranty-months"[^>]*value=/);
  assert.doesNotMatch(valuationPage, /data-category="(?:mouse|keyboard)"|>滑鼠<|>鍵盤</);
  assert.doesNotMatch(valuationPage, /id="brand-field"|id="peripheral-fields"/);
  assert.match(valuationPage, /id="condition-field" hidden/);
  const valuationScript = fs.readFileSync(path.join(projectRoot, 'public', 'valuation.js'), 'utf8');
  assert.match(valuationScript, /conditionField\.hidden = !isGpu/);
  assert.match(valuationScript, /generation === 13 \|\| generation === 14/);
  assert.match(valuationScript, /I\(\[579\]\)/);
});

test('估價採用使用者填寫的保固總月數與已使用月數', async () => {
  const response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu',
    brand: '',
    model: 'Intel Core Ultra 7 265K',
    originalPrice: 10200,
    totalWarrantyMonths: 48,
    elapsedMonths: 50,
    extensionRegistered: 'unknown',
    condition: 'good'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.warranty.totalMonths, 48);
  assert.equal(result.warranty.remainingMonths, 0);
  assert.equal(result.warranty.expiredByMonths, 2);
  assert.equal(result.warranty.matchLevel, 'user_input');
  assert.equal(result.formulaInput.totalWarrantyMonths, 48);
});

test('已移除頁面導回首頁', async () => {
  for (const pathname of [
    '/login', '/login.html', '/account', '/account.html', '/forum', '/forum.html',
    '/marketplace', '/seller', '/cart', '/checkout', '/transactions', '/products.html'
  ]) {
    const response = await request(pathname);
    assert.equal(response.status, 302, pathname);
    assert.equal(response.headers.get('location'), '/');
  }
});

test('已移除功能的 API 與商品圖片無法存取', async () => {
  for (const pathname of [
    '/api/login', '/api/register', '/api/account/name', '/api/account/stats',
    '/api/posts', '/api/posts/1', '/api/posts/1/replies',
    '/api/products', '/api/favorites', '/api/cart', '/api/transactions',
    '/uploads/products/57/example.webp'
  ]) {
    const response = await request(pathname);
    assert.equal(response.status, 404, pathname);
  }
  assert.equal((await request('/does-not-exist')).status, 404);
  assert.equal((await request('/api/scrape')).status, 400);
});

test('市價查詢忽略未知平台並保留回應格式', async () => {
  const response = await request('/api/scrape?keyword=RTX4060&platform=unknown');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: [] });
});

test('型號查詢涵蓋指定 CPU 與顯示卡世代', async () => {
  let response = await request('/api/valuation/models?category=cpu&q=265K&brand=Intel');
  assert.equal(response.status, 200);
  let result = await response.json();
  assert.ok(result.data.some((item) => item.canonicalModel === 'Core Ultra 7 265K'));

  for (const model of ['Core i7-12700F', 'Core i5-13600KF', 'Core i9-14900KS', 'Core Ultra 7 265KF']) {
    response = await request(`/api/valuation/models?category=cpu&q=${encodeURIComponent(model)}&brand=Intel`);
    assert.equal(response.status, 200);
    result = await response.json();
    assert.ok(result.data.some((item) => item.canonicalModel === model), model);
  }

  response = await request('/api/valuation/models?category=cpu&q=Core%20i5-12400&brand=Intel');
  assert.equal(response.status, 200);
  result = await response.json();
  const i5_12400 = result.data.find((item) => item.canonicalModel === 'Core i5-12400');
  assert.equal(i5_12400.cpuPricing.referencePriceNtd, 6250);
  assert.equal(i5_12400.cpuPricing.sourceName, '使用者提供的價格表');
  assert.equal(i5_12400.cpuPricing.sourceCheckedAt, '2026-09-09');

  response = await request('/api/valuation/models?category=cpu&q=Core%20i9-13900KS&brand=Intel');
  assert.equal(response.status, 200);
  result = await response.json();
  const i9_13900ks = result.data.find((item) => item.canonicalModel === 'Core i9-13900KS');
  assert.equal(i9_13900ks.cpuPricing.referencePriceNtd, 24900);

  for (const [model, expectedPrice] of [
    ['Core i3-12100', 4350],
    ['Core i5-12400F', 5450],
    ['Core i5-12600KF', 9150],
    ['Core i7-12700F', 9990],
    ['Core i9-12900K', 18300],
    ['Core i3-13100', 4850],
    ['Core i5-13400F', 6990],
    ['Core i7-13700KF', 13500],
    ['Core i7-13700K', 14000],
    ['Core i9-13900K', 20400]
  ]) {
    response = await request(`/api/valuation/models?category=cpu&q=${encodeURIComponent(model)}&brand=Intel`);
    assert.equal(response.status, 200);
    result = await response.json();
    const item = result.data.find((candidate) => candidate.canonicalModel === model);
    assert.ok(item, model);
    assert.equal(item.cpuPricing.referencePriceNtd, expectedPrice, model);
  }

  response = await request('/api/valuation/models?category=cpu&q=Core%20i7-14700F&brand=Intel');
  assert.equal(response.status, 200);
  result = await response.json();
  const i7_14700f = result.data.find((item) => item.canonicalModel === 'Core i7-14700F');
  assert.equal(i7_14700f.cpuPricing.referencePriceNtd, 11490);
  assert.equal(i7_14700f.cpuPricing.sourceName, 'PChome 24h');

  response = await request('/api/valuation/models?category=cpu&q=Core%20i5-10400&brand=Intel');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.deepEqual(result.data, []);

  response = await request('/api/valuation/models?category=gpu&q=RTX%205070&brand=ZOTAC');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.ok(result.data.some((item) => item.canonicalModel === 'RTX 5070'));

  response = await request('/api/valuation/models?category=gpu&q=RX%209070&brand=PowerColor');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.ok(result.data.some((item) => item.canonicalModel === 'RX 9070 XT'));
  const rx9070 = result.data.find((item) => item.canonicalModel === 'RX 9070');
  assert.equal(rx9070.gpuPricing.launchPriceNtd, 18990);

  response = await request('/api/valuation/models?category=gpu&q=ASUS%20TUF%20AMD%20Radeon%20RX%209070%20XT&brand=ASUS');
  assert.equal(response.status, 200);
  result = await response.json();
  const rx9070xt = result.data.find((item) => item.canonicalModel === 'RX 9070 XT');
  assert.equal(rx9070xt.gpuPricing.launchPriceNtd, 21990);

  response = await request('/api/valuation/models?category=gpu&q=RX%206950%20XT&brand=ASUS');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.ok(result.data.some((item) => item.canonicalModel === 'RX 6950 XT'));
});

test('同學的 AMD 顯示卡動態定價公式可由 API 使用', async () => {
  const response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu',
    brand: '',
    model: 'AMD Radeon RX 9070 XT',
    elapsedMonths: 12,
    extensionRegistered: 'unknown',
    condition: 'good'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pricingFormula, 'amd_dynamic_v9');
  assert.equal(result.price, 17605);
  assert.equal(result.hardware.canonicalModel, 'RX 9070 XT');
  assert.equal(result.calculation.originalPrice, 21990);
  assert.equal(result.calculation.floorPrice, 9500);
});

test('估價 API 不再接受滑鼠與鍵盤分類', async () => {
  for (const category of ['mouse', 'keyboard']) {
    const response = await jsonRequest('POST', '/api/valuation', {
      category,
      brand: '',
      model: '未支援的周邊型號',
      originalPrice: 4990,
      elapsedMonths: 6,
      extensionRegistered: 'unknown',
      condition: 'good'
    });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.message, '不支援這個硬體分類。');
  }
});

test('同學的 CPU 與 RAM 公式可由 API 使用', async () => {
  let response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu', brand: 'Intel', model: 'Core Ultra 7 265K', originalPrice: 10000,
    elapsedMonths: 12, extensionRegistered: 'unknown', condition: 'good'
  });
  let result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.pricingFormula, 'intel_cpu_segment_decay');
  assert.equal(result.formulaInput.originalPrice, 10000);
  const warrantyDecay = Array.from({ length: 12 }, (_, index) => 0.022 / (index + 1))
    .reduce((sum, value) => sum + value, 0);
  assert.equal(result.price, Math.round(10000 * Math.exp(-0.108) * Math.exp(-warrantyDecay) * Math.exp(-0.004 * 12)));
  assert.equal(result.calculation.profile, 'i7_12_ultra');

  response = await jsonRequest('POST', '/api/valuation', {
    category: 'ram', brand: 'Kingston', model: 'Fury DDR5', originalPrice: 3000,
    elapsedMonths: 6, extensionRegistered: 'unknown', condition: 'good',
    details: { specialCondition: '散熱片刮傷' }
  });
  result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.pricingFormula, 'ram_sigma_decay');
  assert.equal(result.calculation.damageFactor, 0.8);
});

test('已收錄的 Intel CPU 會由後端採用新品參考價', async () => {
  const response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu', brand: 'Intel', model: 'Core i5-12400',
    elapsedMonths: 12, totalWarrantyMonths: 36,
    extensionRegistered: 'unknown', condition: 'good'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.formulaInput.originalPrice, 6250);
  assert.equal(result.hardware.cpuPricing.referencePriceNtd, 6250);
  assert.equal(result.pricingFormula, 'intel_cpu_segment_decay');
});

test('使用者修改自動填入的價格後會以修改值估價', async () => {
  let response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu', brand: 'Intel', model: 'Core i5-12400', originalPrice: 8000,
    elapsedMonths: 12, totalWarrantyMonths: 36,
    extensionRegistered: 'unknown', condition: 'good'
  });
  let result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.formulaInput.originalPrice, 8000);
  assert.equal(result.calculation.originalPrice, 8000);

  response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu', brand: '', model: 'AMD Radeon RX 9070 XT', originalPrice: 30000,
    elapsedMonths: 12, totalWarrantyMonths: 36,
    extensionRegistered: 'unknown', condition: 'good'
  });
  result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.formulaInput.originalPrice, 30000);
  assert.equal(result.formulaInput.gpuPricing.launchPriceNtd, 30000);
  assert.equal(result.calculation.originalPrice, 30000);
  assert.notEqual(result.price, 17605);
});

test('測試估價使用已過月份並回傳保固狀態', async () => {
  const response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu',
    brand: 'Intel',
    model: 'Intel Core Ultra 7 265K',
    originalPrice: 10200,
    elapsedMonths: 50,
    extensionRegistered: 'unknown',
    condition: 'good'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pricingMode, 'test');
  assert.equal(result.hardware.canonicalModel, 'Core Ultra 7 265K');
  assert.equal(result.warranty.totalMonths, 36);
  assert.equal(result.warranty.remainingMonths, 0);
  assert.equal(result.warranty.expiredByMonths, 14);
  assert.equal(result.formulaInput.elapsedMonths, 50);
  assert.match(result.warning, /測試公式/);
});

test('未知型號使用分類預設保固', async () => {
  const response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu', brand: 'Intel', model: '未知處理器', originalPrice: 5000,
    elapsedMonths: 3, extensionRegistered: 'unknown', condition: 'good'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.hardware.matched, false);
  assert.equal(result.warranty.matchLevel, 'category_default');
  assert.equal(result.warranty.totalMonths, 36);
});

test('板卡品牌與延保登錄會套用不同保固規則', async () => {
  let response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu', brand: 'ZOTAC', model: 'RTX 4070 Super', originalPrice: 20000,
    elapsedMonths: 12, extensionRegistered: 'no', condition: 'good'
  });
  let result = await response.json();
  assert.equal(result.warranty.totalMonths, 36);

  response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu', brand: 'ZOTAC', model: 'RTX 4070 Super', originalPrice: 20000,
    elapsedMonths: 12, extensionRegistered: 'yes', condition: 'good'
  });
  result = await response.json();
  assert.equal(result.warranty.totalMonths, 60);
  assert.equal(result.warranty.registrationApplied, true);

  response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu', brand: 'ASUS', model: 'RTX 4070 Super', originalPrice: 20000,
    elapsedMonths: 12, extensionRegistered: 'yes', condition: 'good'
  });
  result = await response.json();
  assert.equal(result.warranty.totalMonths, 36);
  assert.equal(result.warranty.registrationApplied, false);
});
