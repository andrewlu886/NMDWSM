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
      OLLAMA_BASE_URL: 'http://127.0.0.1:1',
      VALUATION_API_URL: '',
      VALUATION_API_KEY: ''
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  server.stderr.on('data', chunk => {
    serverError += chunk.toString();
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early: ${serverError}`);
    try {
      const response = await request('/');
      if (response.status === 200) return;
    } catch {
      // Retry while the server is still starting.
    }
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
  assert.equal(pkg.dependencies?.['node-nlp'], undefined, '本機 Llama agent 不應依賴舊 NLP 套件');
  assert.doesNotThrow(
    () => require(path.join(projectRoot, 'public/AiService.js')),
    'AiService 應可直接載入'
  );
  const aiService = require(path.join(projectRoot, 'public/AiService.js'));
  assert.deepEqual(
    aiService.TOOLS.map(tool => tool.function.name),
    ['estimate_used_value', 'search_market_prices', 'recommend_hardware', 'calculate_psu_wattage']
  );
  const power = await aiService.calculatePsu({ cpuWatts: 125, gpuWatts: 220, driveCount: 2 });
  assert.equal(power.totalWatts, 405);
  assert.equal(power.recommendedWatts, 550);
  assert.equal(aiService.extractHardwareKeyword('查一下 RTX 5070 的通路市價'), 'RTX 5070');
  assert.equal(
    aiService.extractHardwareKeyword('先前查 RTX 5070，請更正成 RTX 4070'),
    'RTX 4070'
  );
  const market = await aiService.answerMarketQuery('RTX 5070', '查一下 RTX 5070 市價', {
    searchProducts: async options => {
      assert.equal(options.keyword, 'RTX 5070');
      return [{ name: 'RTX 5070 測試顯卡', price: '25,000', platform: '測試通路' }];
    }
  });
  assert.match(market.answer, /NT\$ 25,000/);
  assert.match(market.answer, /\/scrape\?keyword=RTX%205070/);
});

test('瓦數問題可從 CPU/GPU 型號直接計算，不會錯問零件瓦數', async () => {
  const aiService = require(path.join(projectRoot, 'public/AiService.js'));
  const turns = [{
    role: 'user',
    content: '幫我算 i5-14600K 加 RTX 4070 要幾瓦電源'
  }];
  assert.deepEqual(aiService.extractWattageModels(turns), {
    cpuModel: 'i5-14600K',
    gpuModel: 'RTX 4070'
  });

  const result = await aiService.answerWattageQuery(turns, {
    fetchLocalJson: async pathname => pathname === '/api/cpu-data'
      ? [{ CPU型號: 'Intel Core i5-14600K', 最大銳頻功耗: '181W' }]
      : [{ 顯示卡型號: 'NVIDIA GeForce RTX 4070', TDP: '200W', 官方建議瓦數: '650W' }]
  });
  assert.match(result.answer, /CPU「i5-14600K」約 181W/);
  assert.match(result.answer, /顯示卡「RTX 4070」約 200W/);
  assert.match(result.answer, /至少 650W/);
  assert.doesNotMatch(result.answer, /請提供.*瓦數/);
});

test('聊天 API 收到完整 CPU/GPU 瓦數問題時優先使用確定性計算', async () => {
  const response = await jsonRequest('POST', '/api/chat', {
    messages: [{ role: 'user', content: '幫我算 i5-14600K 加 RTX 4070 要幾瓦電源' }]
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.provider, 'tools');
  assert.match(result.answer, /i5-14600K/);
  assert.match(result.answer, /RTX 4070/);
  assert.doesNotMatch(result.answer, /請提供.*瓦數/);
});

test('聊天 API 提供本機模型狀態與未啟動模型時的安全備援', async () => {
  const status = await request('/api/chat/status');
  assert.equal(status.status, 200);
  assert.equal(typeof (await status.json()).available, 'boolean');

  const response = await jsonRequest('POST', '/api/chat', {
    messages: [{ role: 'user', content: '幫我估二手顯示卡' }]
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.ok(result.answer.length > 0);
});

test('聊天歷史限於目前分頁，市價連結可帶入最近產品型號', () => {
  const widget = fs.readFileSync(path.join(projectRoot, 'public', 'chat-widget.js'), 'utf8');
  const styles = fs.readFileSync(path.join(projectRoot, 'public', 'style.css'), 'utf8');
  assert.match(widget, /sessionStorage\.getItem\(historyStorageKey\)/);
  assert.match(widget, /sessionStorage\.setItem\(historyStorageKey/);
  assert.match(widget, /function latestProductKeyword\(/);
  assert.match(widget, /params\.get\('keyword'\) \|\| latestProductKeyword\(answer\)/);
  assert.match(widget, /chatHistory\.forEach\(\(message, index\)/);
  assert.match(widget, /function showQuickActions\(\)/);
  assert.match(widget, /if \(isOpen\) \{\s*showQuickActions\(\)/);
  assert.match(widget, /function startValuationWizard\(\)/);
  assert.match(widget, /async function resolveValuationModel\(text\)/);
  assert.match(widget, /api\/valuation\/models\?\$\{params\}/);
  assert.match(widget, /const pricedMatch = candidates\.find\(item => catalogReferencePrice\(item\)\)/);
  assert.match(widget, /\.ai-chat-user-group \{ display: flex; width: 100%/);
  assert.match(styles, /\.ai-chat-message\.user\s*\{[^}]*width:\s*100%/);
  assert.match(widget, /if \(label === '二手估價'\)/);
  assert.match(widget, /valuation\/model-options\?category=/);
  assert.match(widget, /function chooseValuationCategory\(category/);
  assert.match(widget, /function handleValuationText\(text\)/);
  assert.match(widget, /function parsePurchaseDateMonths\(text\)/);
  assert.match(widget, /function requestWarrantyOrUsage\(\)/);
  assert.match(widget, /Intel 第 \$\{generation\} 代 CPU/);
  assert.match(widget, /selectValuationWarranty\(60, '5 年延長保固'\)/);
  assert.match(widget, /此 AMD CPU.*3 年（36 個月）/);
  assert.match(widget, /缺少新品參考價。你還記得當初買多少嗎/);
  assert.match(widget, /totalWarrantyMonths/);
  assert.match(widget, /calculate: '1'/);
  assert.match(widget, /fetch\('\/api\/valuation'/);
  assert.match(widget, /前往二手估價頁/);
  assert.match(widget, /您想估哪一種零件/);
  for (const label of ['CPU', '記憶體', '顯卡', '主機板']) assert.ok(widget.includes(`['${label === '記憶體' ? 'ram' : label === '顯卡' ? 'gpu' : label === '主機板' ? 'motherboard' : 'cpu'}', '${label}']`));
  assert.match(widget, /messages\.querySelectorAll\('\.ai-chat-reopen-suggestions'\)/);
  for (const label of ['二手估價', '市價查詢', '智慧推薦', '瓦數計算']) {
    assert.ok(widget.includes(`['${label}',`), `每次展開助手都要提供「${label}」快捷功能`);
  }
});

test('估價頁可接收 AI 助手帶入的估價欄位', () => {
  const valuationPage = fs.readFileSync(path.join(projectRoot, 'public', 'valuation.js'), 'utf8');
  const valuationStyles = fs.readFileSync(path.join(projectRoot, 'public', 'valuation.css'), 'utf8');
  assert.ok(fs.existsSync(path.join(projectRoot, 'public', 'assets', 'used-hardware-banner.jpg')));
  assert.match(valuationStyles, /url\('\.\/assets\/used-hardware-banner\.jpg'\) center 48% \/ cover no-repeat/);
  assert.match(valuationPage, /initialParams\.get\('category'\)/);
  assert.match(valuationPage, /initialParams\.get\('model'\)/);
  assert.match(valuationPage, /initialParams\.get\('elapsedMonths'\)/);
  assert.match(valuationPage, /initialParams\.get\('originalPrice'\)/);
  assert.match(valuationPage, /initialParams\.get\('calculate'\) === '1'/);
  assert.match(valuationPage, /if \(shouldAutoCalculate\) \{\s*updateCpuWarrantyControl\(initialModel\);\s*hideSuggestions\(\);/);
  assert.match(valuationPage, /if \(searchController\) searchController\.abort\(\);\s*hideSuggestions\(\);\s*form\.requestSubmit\(\)/);
  assert.match(valuationPage, /form\.requestSubmit\(\)/);
});

test('瓦數 CPU/GPU 型號使用可捲動分組清單並按世代排序', () => {
  const toolsPage = fs.readFileSync(path.join(projectRoot, 'public', 'tools.html'), 'utf8');
  assert.ok(fs.existsSync(path.join(projectRoot, 'public', 'assets', 'tools-banner.jpg')));
  assert.match(toolsPage, /url\('\.\/assets\/tools-banner\.jpg'\) center 58% \/ cover no-repeat/);
  assert.match(toolsPage, /<select id="cpu-power" class="model-picker"/);
  assert.match(toolsPage, /<select id="gpu-power" class="model-picker"/);
  assert.doesNotMatch(toolsPage, /class="model-picker"[^>]*size=/);
  assert.match(toolsPage, /id="cpu-custom-power" type="number"/);
  const customCpuOptionIndex = toolsPage.indexOf('modelList.appendChild(new Option(\'其他 / 輸入此 CPU 瓦數\'');
  const intelDividerIndex = toolsPage.indexOf('\'=======Intel=======\'');
  assert.ok(customCpuOptionIndex >= 0 && customCpuOptionIndex < intelDividerIndex, '未收錄 CPU 選項應位於 Intel 大分隔線上方');
  assert.doesNotMatch(toolsPage, /Intel 其他/);
  assert.doesNotMatch(toolsPage, /id="gpu-custom-power"|自訂 GPU 瓦數|customGroup\.label = '手動輸入'/);
  assert.match(toolsPage, /function classifyCpuRow\(row\)/);
  assert.match(toolsPage, /function makeFullWidthDivider\(label, select\)/);
  assert.match(toolsPage, /context\.measureText\(candidate\)\.width > availableWidth/);
  assert.match(toolsPage, /makeFullWidthDivider\(manufacturerLabel, modelList\)/);
  assert.match(toolsPage, /=======Intel=======/);
  assert.match(toolsPage, /=======AMD=======/);
  assert.match(toolsPage, /Intel Core 第\$\{generation \|\| '其他'\}代/);
  assert.match(toolsPage, /Intel Core Ultra/);
  assert.match(toolsPage, /AMD Phenom II/);
  assert.match(toolsPage, /AMD FX Series \(Vishera\)/);
  assert.match(toolsPage, /const amdOrder = \{ 1000: 3, 2000: 4, 3000: 5, 5000: 6, 7000: 7, 8000: 8, 9000: 9 \}/);
  assert.match(toolsPage, /localeCompare\(b\.modelName, 'en', \{ numeric: true/);
  assert.match(toolsPage, /function classifyGpuRow\(row, modelName\)/);
  assert.match(toolsPage, /=======\$\{group\.manufacturerLabel\}=======/);
  assert.match(toolsPage, /seriesGroup\.label = group\.seriesLabel/);
  assert.match(toolsPage, /manufacturerOrder: 0, manufacturerLabel: 'NVIDIA'/);
  assert.match(toolsPage, /manufacturerOrder: 1, manufacturerLabel: 'AMD'/);
  assert.match(toolsPage, /manufacturerLabel: 'Intel'/);

  const classifierStart = toolsPage.indexOf('    function classifyGpuRow(row, modelName)');
  const classifierEnd = toolsPage.indexOf('\n    function ', classifierStart + 10);
  const classifierSource = toolsPage.slice(classifierStart, classifierEnd);
  const classifyGpuRow = new Function('getCleanVal', `${classifierSource}; return classifyGpuRow;`)(
    (row, keys) => {
      for (const key of keys) if (row[key] !== undefined) return row[key];
      return '';
    }
  );
  const classify = (brand, series, model) => classifyGpuRow(
    { 品牌: brand, 架構: series, 顯示卡型號: model },
    model
  );
  assert.equal(classify('NVIDIA', 'GeForce GTX 700/900', 'GTX 750 Ti').seriesOrder, 30);
  assert.equal(classify('NVIDIA', 'GeForce RTX 50', 'RTX 5090').seriesOrder, 100);
  assert.equal(classify('AMD', 'Radeon RX 5000', 'RX 5700 XT').seriesOrder, 70);
  assert.equal(classify('AMD', 'Radeon RX 6000/7000', 'RX 6500 XT').seriesOrder, 80);
  assert.equal(classify('Intel', 'Arc Battlemage', 'Arc B580').manufacturerOrder, 2);
});

test('只在 NVIDIA 廠牌顯示資料庫顯卡選單並恢復原驅動網址', () => {
  const toolsPage = fs.readFileSync(path.join(projectRoot, 'public', 'tools.html'), 'utf8');
  assert.match(toolsPage, /id="nvidia-model-select" style="display:none"/);
  assert.match(toolsPage, /function populateDriverModelOptions\(\)/);
  assert.match(toolsPage, /gpuExcelData\s*\.filter\(row => String\(row\['品牌'\]/);
  assert.match(toolsPage, /includes\('nvidia'\)/);
  assert.match(toolsPage, /modelNumber >= 2000 && modelNumber <= 5090/);
  assert.match(toolsPage, /modelNumber >= 580/);
  assert.match(toolsPage, /series: Math\.floor\(modelNumber \/ 100\)/);
  assert.match(toolsPage, /tier: modelNumber % 100/);
  assert.match(toolsPage, /rightKey\.series - leftKey\.series/);
  assert.match(toolsPage, /rightKey\.tier - leftKey\.tier/);
  assert.match(toolsPage, /rightKey\.suffixRank - leftKey\.suffixRank/);
  assert.match(toolsPage, /option\.textContent = name\.replace\(\/\\s\+12GB\\b\/i, ''\)/);
  assert.match(toolsPage, /https:\/\/www\.nvidia\.com\/zh-tw\/geforce\/drivers\//);
  assert.match(toolsPage, /modelInput\.style\.display = isNvidia \? 'none' : ''/);
  assert.match(toolsPage, /modelSelect\.style\.display = isNvidia \? '' : 'none'/);
  assert.ok(
    toolsPage.indexOf('if (model && driverLinksData.length > 0)') < toolsPage.indexOf('https://www.nvidia.com/zh-tw/geforce/drivers/'),
    'NVIDIA 應先嘗試資料庫專屬網址，未配對時才回到原廠牌驅動頁'
  );
});

test('保留的網站頁面可以開啟', async () => {
  for (const pathname of [
    '/',
    '/scrape',
    '/recommend.html',
    '/benchmark-instructions.html',
    '/tools',
    '/valuation.html',
    '/valuation'
  ]) {
    const response = await request(pathname);
    assert.equal(response.status, 200, pathname);
  }
});

test('市價頁可由網址預填關鍵字並自動查詢', () => {
  const scrapePage = fs.readFileSync(path.join(projectRoot, 'public', 'scrape.html'), 'utf8');
  assert.ok(fs.existsSync(path.join(projectRoot, 'public', 'assets', 'market-banner.jpg')));
  assert.match(scrapePage, /url\('\.\/assets\/market-banner\.jpg'\) center 65% \/ cover no-repeat/);
  assert.match(scrapePage, /URLSearchParams\(window\.location\.search\)\.get\('keyword'\)/);
  assert.match(scrapePage, /keyword-input'\)\.value = keyword/);
  assert.match(scrapePage, /if \(keyword\)\s*\{[\s\S]*?fetchPrices\(\)/);
  const platformInputs = [...scrapePage.matchAll(/<input type="checkbox" value="[^"]+"( checked)?/g)];
  assert.ok(platformInputs.length > 0);
  assert.ok(platformInputs.every(([, checked]) => checked), '所有通路預設都要勾選');
  assert.doesNotMatch(scrapePage, /value="coolpc"|原價屋/);
  assert.match(scrapePage, /id="precision-toggle" type="checkbox" aria-label="開啟精確搜尋"/);
  assert.doesNotMatch(scrapePage, /id="precision-range"|type="range"/);
  assert.match(scrapePage, /precisionToggle\.addEventListener\('change', updatePrecisionExcludeKeywords\)/);
  assert.match(scrapePage, /excludeInput\.value = precisionToggle\.checked \? preciseExcludeKeywords : ''/);
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
    'index.html',
    'benchmark-instructions.html',
    'recommend.html',
    'valuation.html',
    'scrape.html',
    'tools.html'
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
  const detectedSection = valuationPage.match(
    /<section id="detected-hardware"([\s\S]*?)<\/section>/
  );
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
  assert.doesNotMatch(valuationPage, /id="condition-field"/);
  const valuationScript = fs.readFileSync(path.join(projectRoot, 'public', 'valuation.js'), 'utf8');
  assert.match(valuationScript, /condition: 'good'/);
  assert.match(valuationScript, /initialWarrantyMonths/);
  assert.match(valuationScript, /initialModelId/);
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
    '/login',
    '/login.html',
    '/account',
    '/account.html',
    '/forum',
    '/forum.html',
    '/marketplace',
    '/seller',
    '/cart',
    '/checkout',
    '/transactions',
    '/products.html'
  ]) {
    const response = await request(pathname);
    assert.equal(response.status, 302, pathname);
    assert.equal(response.headers.get('location'), '/');
  }
});

test('已移除功能的 API 與商品圖片無法存取', async () => {
  for (const pathname of [
    '/api/login',
    '/api/register',
    '/api/account/name',
    '/api/account/stats',
    '/api/posts',
    '/api/posts/1',
    '/api/posts/1/replies',
    '/api/products',
    '/api/favorites',
    '/api/cart',
    '/api/transactions',
    '/uploads/products/57/example.webp'
  ]) {
    const response = await request(pathname);
    assert.equal(response.status, 404, pathname);
  }
  assert.equal((await request('/does-not-exist')).status, 404);
  assert.equal((await request('/api/scrape')).status, 400);
});

test('智慧推薦看板使用指定的電競桌面圖片', () => {
  const recommendPage = fs.readFileSync(path.join(projectRoot, 'public', 'recommend.html'), 'utf8');
  const bannerImage = path.join(projectRoot, 'public', 'assets', 'smart-hardware-banner.jpg');
  assert.ok(fs.existsSync(bannerImage));
  assert.match(recommendPage, /url\('\.\/assets\/smart-hardware-banner\.jpg'\) center 48% \/ cover no-repeat/);
});

test('市價查詢忽略未知平台並保留回應格式', async () => {
  const response = await request('/api/scrape?keyword=RTX4060&platform=unknown');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.data, []);
  assert.equal(result.success, true);
  assert.equal(typeof result.meta.updatedAt, 'number');
  assert.equal(typeof result.meta.nextUpdateAt, 'number');
  assert.equal(typeof result.meta.cached, 'boolean');
  const page = fs.readFileSync(path.join(projectRoot, 'public', 'scrape.html'), 'utf8');
  assert.doesNotMatch(page, /請 AI 解讀查價結果/);
  assert.match(page, /market-data-freshness/);
  assert.match(page, /每日更新一次/);
});

test('智慧推薦結果提供 AI 解讀與條件調整入口', () => {
  const recommendScript = fs.readFileSync(path.join(projectRoot, 'public', 'recommend.js'), 'utf8');
  assert.match(recommendScript, /請 AI 解讀推薦/);
  assert.match(recommendScript, /和 AI 一起調整條件/);
  assert.match(recommendScript, /nmdwsm:agent-prompt/);
});

test('型號查詢涵蓋指定 CPU 與顯示卡世代', async () => {
  let response = await request('/api/valuation/models?category=cpu&q=265K&brand=Intel');
  assert.equal(response.status, 200);
  let result = await response.json();
  assert.ok(result.data.some(item => item.canonicalModel === 'Core Ultra 7 265K'));

  for (const model of [
    'Core i7-12700F',
    'Core i5-13600KF',
    'Core i9-14900KS',
    'Core Ultra 7 265KF'
  ]) {
    response = await request(
      `/api/valuation/models?category=cpu&q=${encodeURIComponent(model)}&brand=Intel`
    );
    assert.equal(response.status, 200);
    result = await response.json();
    assert.ok(
      result.data.some(item => item.canonicalModel === model),
      model
    );
  }

  response = await request('/api/valuation/models?category=cpu&q=Core%20i5-12400&brand=Intel');
  assert.equal(response.status, 200);
  result = await response.json();
  const i5_12400 = result.data.find(item => item.canonicalModel === 'Core i5-12400');
  assert.equal(i5_12400.cpuPricing.referencePriceNtd, 6250);
  assert.equal(i5_12400.cpuPricing.sourceName, '使用者提供的價格表');
  assert.equal(i5_12400.cpuPricing.sourceCheckedAt, '2026-09-09');

  response = await request('/api/valuation/models?category=cpu&q=Core%20i9-13900KS&brand=Intel');
  assert.equal(response.status, 200);
  result = await response.json();
  const i9_13900ks = result.data.find(item => item.canonicalModel === 'Core i9-13900KS');
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
    response = await request(
      `/api/valuation/models?category=cpu&q=${encodeURIComponent(model)}&brand=Intel`
    );
    assert.equal(response.status, 200);
    result = await response.json();
    const item = result.data.find(candidate => candidate.canonicalModel === model);
    assert.ok(item, model);
    assert.equal(item.cpuPricing.referencePriceNtd, expectedPrice, model);
  }

  response = await request('/api/valuation/models?category=cpu&q=Core%20i7-14700F&brand=Intel');
  assert.equal(response.status, 200);
  result = await response.json();
  const i7_14700f = result.data.find(item => item.canonicalModel === 'Core i7-14700F');
  assert.equal(i7_14700f.cpuPricing.referencePriceNtd, 11490);
  assert.equal(i7_14700f.cpuPricing.sourceName, 'PChome 24h');

  response = await request('/api/valuation/models?category=cpu&q=Core%20i5-10400&brand=Intel');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.deepEqual(result.data, []);

  response = await request('/api/valuation/models?category=gpu&q=RTX%205070&brand=ZOTAC');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.ok(result.data.some(item => item.canonicalModel === 'RTX 5070'));

  response = await request('/api/valuation/models?category=gpu&q=RX%209070&brand=PowerColor');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.ok(result.data.some(item => item.canonicalModel === 'RX 9070 XT'));
  const rx9070 = result.data.find(item => item.canonicalModel === 'RX 9070');
  assert.equal(rx9070.gpuPricing.launchPriceNtd, 18990);

  response = await request(
    '/api/valuation/models?category=gpu&q=ASUS%20TUF%20AMD%20Radeon%20RX%209070%20XT&brand=ASUS'
  );
  assert.equal(response.status, 200);
  result = await response.json();
  const rx9070xt = result.data.find(item => item.canonicalModel === 'RX 9070 XT');
  assert.equal(rx9070xt.gpuPricing.launchPriceNtd, 21990);

  response = await request('/api/valuation/models?category=gpu&q=RX%206950%20XT&brand=ASUS');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.ok(result.data.some(item => item.canonicalModel === 'RX 6950 XT'));
});

test('估價助手依分類提供資料庫型號清單', async () => {
  let response = await request('/api/valuation/model-options?category=cpu');
  assert.equal(response.status, 200);
  let result = await response.json();
  assert.ok(result.data.some(item => item.canonicalModel === 'Core i5-12400'));
  const pricedCpu = result.data.find(item => item.canonicalModel === 'Core i5-14400');
  assert.equal(pricedCpu.cpuPricing.referencePriceNtd, 7750);
  response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu',
    model: pricedCpu.canonicalModel,
    modelId: pricedCpu.id,
    elapsedMonths: 5,
    totalWarrantyMonths: 36,
    originalPrice: 0,
    condition: 'good'
  });
  assert.equal(response.status, 200);
  result = await response.json();
  assert.equal(result.formulaInput.originalPrice, 7750);

  response = await request('/api/valuation/model-options?category=gpu');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.ok(result.data.some(item => item.category === 'gpu'));

  response = await request('/api/valuation/model-options?category=motherboard');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.ok(result.data.some(item => item.category === 'motherboard'));

  response = await request('/api/valuation/model-options?category=ram');
  assert.equal(response.status, 200);
  result = await response.json();
  assert.deepEqual(result.data, []);

  response = await request('/api/valuation/model-options?category=unknown');
  assert.equal(response.status, 400);
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
    category: 'cpu',
    brand: 'Intel',
    model: 'Core Ultra 7 265K',
    originalPrice: 10000,
    elapsedMonths: 12,
    extensionRegistered: 'unknown',
    condition: 'good'
  });
  let result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.pricingFormula, 'intel_cpu_segment_decay');
  assert.equal(result.formulaInput.originalPrice, 10000);
  const warrantyDecay = Array.from({ length: 12 }, (_, index) => 0.022 / (index + 1)).reduce(
    (sum, value) => sum + value,
    0
  );
  assert.equal(
    result.price,
    Math.round(10000 * Math.exp(-0.108) * Math.exp(-warrantyDecay) * Math.exp(-0.004 * 12))
  );
  assert.equal(result.calculation.profile, 'i7_12_ultra');

  response = await jsonRequest('POST', '/api/valuation', {
    category: 'ram',
    brand: 'Kingston',
    model: 'Fury DDR5',
    originalPrice: 3000,
    elapsedMonths: 6,
    extensionRegistered: 'unknown',
    condition: 'good',
    details: { specialCondition: '散熱片刮傷' }
  });
  result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.pricingFormula, 'ram_sigma_decay');
  assert.equal(result.calculation.damageFactor, 0.8);
});

test('已收錄的 Intel CPU 會由後端採用新品參考價', async () => {
  const response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu',
    brand: 'Intel',
    model: 'Core i5-12400',
    elapsedMonths: 12,
    totalWarrantyMonths: 36,
    extensionRegistered: 'unknown',
    condition: 'good'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.formulaInput.originalPrice, 6250);
  assert.equal(result.hardware.cpuPricing.referencePriceNtd, 6250);
  assert.equal(result.pricingFormula, 'intel_cpu_segment_decay');
});

test('使用者修改自動填入的價格後會以修改值估價', async () => {
  let response = await jsonRequest('POST', '/api/valuation', {
    category: 'cpu',
    brand: 'Intel',
    model: 'Core i5-12400',
    originalPrice: 8000,
    elapsedMonths: 12,
    totalWarrantyMonths: 36,
    extensionRegistered: 'unknown',
    condition: 'good'
  });
  let result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.formulaInput.originalPrice, 8000);
  assert.equal(result.calculation.originalPrice, 8000);

  response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu',
    brand: '',
    model: 'AMD Radeon RX 9070 XT',
    originalPrice: 30000,
    elapsedMonths: 12,
    totalWarrantyMonths: 36,
    extensionRegistered: 'unknown',
    condition: 'good'
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
    category: 'cpu',
    brand: 'Intel',
    model: '未知處理器',
    originalPrice: 5000,
    elapsedMonths: 3,
    extensionRegistered: 'unknown',
    condition: 'good'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.hardware.matched, false);
  assert.equal(result.warranty.matchLevel, 'category_default');
  assert.equal(result.warranty.totalMonths, 36);
});

test('板卡品牌與延保登錄會套用不同保固規則', async () => {
  let response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu',
    brand: 'ZOTAC',
    model: 'RTX 4070 Super',
    originalPrice: 20000,
    elapsedMonths: 12,
    extensionRegistered: 'no',
    condition: 'good'
  });
  let result = await response.json();
  assert.equal(result.warranty.totalMonths, 36);

  response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu',
    brand: 'ZOTAC',
    model: 'RTX 4070 Super',
    originalPrice: 20000,
    elapsedMonths: 12,
    extensionRegistered: 'yes',
    condition: 'good'
  });
  result = await response.json();
  assert.equal(result.warranty.totalMonths, 60);
  assert.equal(result.warranty.registrationApplied, true);

  response = await jsonRequest('POST', '/api/valuation', {
    category: 'gpu',
    brand: 'ASUS',
    model: 'RTX 4070 Super',
    originalPrice: 20000,
    elapsedMonths: 12,
    extensionRegistered: 'yes',
    condition: 'good'
  });
  result = await response.json();
  assert.equal(result.warranty.totalMonths, 36);
  assert.equal(result.warranty.registrationApplied, false);
});
