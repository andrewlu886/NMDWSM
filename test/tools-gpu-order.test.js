const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const puppeteer = require('puppeteer');
const publicDir = path.resolve(__dirname, '../public');
const html = fs.readFileSync(path.join(publicDir, 'tools.html'), 'utf8');
function pageFunction(name) {
  const start = html.indexOf(`    function ${name}(`);
  const end = html.indexOf('\n    function ', start + 10);
  return new Function('getCleanVal', `${html.slice(start, end)}; return ${name};`)((row, keys) => {
    for (const key of Object.keys(row)) if (keys.some(word => key.includes(word))) return row[key];
    return '';
  });
}
const classify = pageFunction('classifyGpuRow');
const compare = pageFunction('compareGpuRows');
const row = (model, series = '', brand = 'NVIDIA') => ({ 品牌: brand, '架構 / 系列': series, 顯示卡型號: model });
const names40 = ['RTX 4060', 'RTX 4060 Ti', 'RTX 4070', 'RTX 4070 Super', 'RTX 4070 Ti', 'RTX 4070 Ti Super', 'RTX 4080', 'RTX 4080 Super', 'RTX 4090'];

function gpuData() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(publicDir, 'nmdwsm.db'), sqlite3.OPEN_READONLY);
    db.all('SELECT * FROM "GPU_Power_Supply_Data_2010_TO_2026"', (error, rows) => {
      db.close(); if (error) reject(error); else resolve(rows);
    });
  });
}

test('NVIDIA models override conflicting series labels and merge Super into their generation', () => {
  for (const [model, expected] of [['GTX 1050', 'GTX 10'], ['GTX 1650', 'GTX 16'], ['GTX 1660 Ti', 'GTX 16'], ['RTX 2060', 'RTX 20'], ['RTX 2070 Super', 'RTX 20'], ['RTX 3050', 'RTX 30'], ['RTX 3090 Ti', 'RTX 30'], ['RTX 4070 Ti Super', 'RTX 40'], ['RTX 5090', 'RTX 50']]) {
    assert.equal(classify(row(model, 'GeForce GTX 10/16/RTX 20')).seriesLabel, `${expected} Series`);
  }
  const shuffled = [...names40].reverse().map((modelName, index) => ({ modelName, index, ...classify(row(modelName, 'GeForce RTX 40 Super')) }));
  assert.deepEqual(shuffled.sort(compare).map(r => r.modelName), names40);
  assert.equal(new Set(shuffled.map(r => r.groupKey)).size, 1);
  const capacities = ['GTX 1060 6GB', 'GTX 1060 3GB'].map((modelName, index) => ({ modelName, index, ...classify(row(modelName)) }));
  assert.deepEqual(capacities.sort(compare).map(r => r.modelName), ['GTX 1060 3GB', 'GTX 1060 6GB']);
});

test('every NVIDIA row in the actual database belongs to its model generation', async () => {
  const rows = (await gpuData()).filter(r => /nvidia/i.test(r.品牌));
  assert.ok(rows.length > 30);
  for (const r of rows) {
    const name = r.顯示卡型號;
    const match = name.match(/(GTX|RTX)\s*(\d{3,4})/i);
    if (!match) continue;
    const family = match[2].length === 4 ? match[2].slice(0, 2) : `${match[2][0]}00`;
    assert.equal(classify(r).seriesLabel, `${match[1]} ${family} Series`, name);
  }
});

test('calculator browser renders ordered GPU groups and retains power values on selection', { skip: !fs.existsSync(puppeteer.executablePath()) }, async () => {
  const rows = await gpuData();
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000 });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      let contentType = 'text/plain', body = '';
      if (url.pathname.startsWith('/api/')) {
        contentType = 'application/json';
        body = JSON.stringify(url.pathname === '/api/gpu-data' ? rows : url.pathname === '/api/chat/status' ? { available: false } : []);
      } else if (url.pathname === '/tools') { contentType = 'text/html'; body = html; }
      else if (url.hostname === 'localhost') {
        const file = path.resolve(publicDir, `.${url.pathname}`);
        if (file.startsWith(publicDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
          body = fs.readFileSync(file);
        }
      }
      request.respond({ status: 200, contentType, body }).catch(() => {});
    });
    await page.goto('http://localhost:3998/tools');
    await page.waitForFunction(() => document.querySelectorAll('#gpu-power optgroup').length > 5);
    const groups = await page.$$eval('#gpu-power optgroup', groups => groups.map(g => ({ label: g.label, names: [...g.children].map(o => o.value) })));
    const nvidia = groups.filter(g => /^(GTX|RTX)/.test(g.label));
    assert.deepEqual(nvidia.map(g => g.label), ['GTX 400', 'GTX 500', 'GTX 600', 'GTX 700', 'GTX 900', 'GTX 10', 'GTX 16', 'RTX 20', 'RTX 30', 'RTX 40', 'RTX 50'].map(s => `${s} Series`));
    assert.ok(groups.find(g => g.label === 'GTX 10 Series').names.every(name => /^GTX 10/.test(name)));
    assert.ok(groups.find(g => g.label === 'GTX 16 Series').names.every(name => /^GTX 16/.test(name)));
    assert.ok(groups.find(g => g.label === 'RTX 20 Series').names.every(name => /^RTX 20/.test(name)));
    assert.deepEqual(groups.find(g => g.label === 'RTX 40 Series').names, names40);
    assert.equal(await page.$$eval('#gpu-power option', options => options.filter(o => o.value).length), rows.length + 1);
    for (const model of ['GTX 1660 Super', 'RTX 2060', 'RTX 4070 Super', 'RTX 4070 Ti Super']) {
      await page.select('#gpu-power', model);
      assert.equal(await page.$eval('#ex-model', el => el.textContent), model);
      const expected = rows.find(r => r.顯示卡型號 === model)['官方功耗 TDP/TGP (W)'];
      assert.equal(await page.$eval('#ex-tdp', el => el.textContent), expected);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
