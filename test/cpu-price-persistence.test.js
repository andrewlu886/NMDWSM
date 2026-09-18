const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

test('CPU 改價與來源跨重啟保留，API 採用資料庫價格並補回缺少報價', { timeout: 30000 }, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdwsm-cpu-prices-'));
  const dbPath = path.join(tempRoot, 'prices.db');
  const projectRoot = path.resolve(__dirname, '..');
  let server;
  let baseUrl;

  async function withDatabase(callback) {
    const connection = new sqlite3.Database(dbPath);
    const query = (sql, params = []) => new Promise((resolve, reject) => {
      connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
    try {
      return await callback(query);
    } finally {
      await new Promise((resolve, reject) => connection.close(error => error ? reject(error) : resolve()));
    }
  }

  async function request(url, options = {}) {
    return fetch(`${baseUrl}${url}`, { ...options, signal: AbortSignal.timeout(2000) });
  }

  async function lookup(model) {
    const response = await request(`/api/valuation/models?category=cpu&q=${encodeURIComponent(model)}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    const item = result.data.find(row => row.canonicalModel === model);
    assert.ok(item, model);
    return item;
  }

  async function estimate(model, originalPrice) {
    const response = await request('/api/valuation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'cpu', model, originalPrice, elapsedMonths: 12, totalWarrantyMonths: 36 })
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  async function start() {
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    baseUrl = `http://127.0.0.1:${port}`;
    let serverError = '';
    let serverOutput = '';
    server = spawn(process.execPath, ['public/server.js'], {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, VALUATION_API_URL: '', VALUATION_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    server.on('error', error => { serverError += error.message; });
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', chunk => { serverOutput += chunk; });
    server.stderr.on('data', chunk => { serverError += chunk; });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Server exited: ${serverError}`);
      try {
        if (serverOutput.includes('資料庫已連接')) {
          await lookup('Core i5-12400');
          return;
        }
      } catch {
        // 等待資料庫初始化及 HTTP 服務都可使用。
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become ready: ${serverError}`);
  }

  async function stop() {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  }

  async function counts() {
    return withDatabase(query => query(`
      SELECT 'intel' AS kind, COUNT(*) AS count FROM hardware_cpu_pricing_models
      UNION ALL
      SELECT offer_type AS kind, COUNT(*) AS count FROM hardware_reference_prices
      WHERE category = 'cpu' GROUP BY offer_type ORDER BY kind
    `));
  }

  try {
    await start();
    assert.equal((await lookup('Core i5-12400')).cpuPricing.referencePriceNtd, 6250);
    assert.equal((await lookup('Ryzen 7 9800X3D')).referencePrice.priceNtd, 15900);
    await stop();
    const originalCounts = await counts();
    assert.deepEqual(originalCounts, [
      { kind: 'intel', count: 55 },
      { kind: 'motherboard_bundle', count: 6 },
      { kind: 'standalone', count: 15 }
    ]);

    await withDatabase(async query => {
      await query(`UPDATE hardware_cpu_pricing_models SET reference_price_ntd = 8765,
        source_name = '手動更新', source_url = 'https://example.com/cpu', source_checked_at = '2026-09-17'
        WHERE hardware_model_id = (SELECT id FROM hardware_models WHERE canonical_model = 'Core i5-12400')`);
      // 刻意使用比初始清單更舊的日期：不能因新來源/日期而重新匯入舊報價。
      await query(`UPDATE hardware_reference_prices SET price_ntd = CASE offer_type
          WHEN 'standalone' THEN 16666 ELSE 11111 END,
        source_file = '手動報價.csv', imported_at = '2026-01-01', notes = '自行確認的價格'
        WHERE category = 'cpu' AND brand = 'AMD' AND model = 'Ryzen 7 9800X3D'`);
      await query(`UPDATE hardware_reference_prices SET price_ntd = 12345, notes = '保留原來源的改價'
        WHERE category = 'cpu' AND brand = 'AMD' AND model = 'Ryzen 7 9700X' AND offer_type = 'standalone'`);
      await query(`DELETE FROM hardware_cpu_pricing_models WHERE hardware_model_id =
        (SELECT id FROM hardware_models WHERE canonical_model = 'Core i3-12100')`);
      await query(`DELETE FROM hardware_reference_prices
        WHERE category = 'cpu' AND brand = 'AMD' AND model = 'Ryzen 5 8400F'`);
    });

    let previousPrices;
    for (let restart = 0; restart < 2; restart += 1) {
      await start();
      assert.deepEqual((await lookup('Core i5-12400')).cpuPricing, {
        referencePriceNtd: 8765, sourceName: '手動更新',
        sourceUrl: 'https://example.com/cpu', sourceCheckedAt: '2026-09-17'
      });
      assert.deepEqual((await lookup('Ryzen 7 9800X3D')).referencePrice, {
        priceNtd: 16666, basis: 'reference', source: '手動報價.csv', notes: '自行確認的價格'
      });
      assert.equal((await lookup('Core i3-12100')).cpuPricing.referencePriceNtd, 4350);
      assert.equal((await lookup('Ryzen 5 8400F')).referencePrice.priceNtd, 4950);
      assert.equal((await lookup('Ryzen 7 9700X')).referencePrice.priceNtd, 12345);

      const prices = [];
      for (const [model, storedPrice] of [['Core i5-12400', 8765], ['Ryzen 7 9800X3D', 16666]]) {
        const stored = await estimate(model);
        assert.equal(stored.formulaInput.originalPrice, storedPrice);
        assert.ok(stored.price > 0);
        const edited = await estimate(model, storedPrice * 2);
        assert.equal(edited.formulaInput.originalPrice, storedPrice * 2);
        assert.ok(edited.price > stored.price);
        assert.equal((await estimate(model)).price, stored.price, '表單改價不會寫回資料庫');
        prices.push(stored.price);
      }
      if (previousPrices) assert.deepEqual(prices, previousPrices);
      previousPrices = prices;
      await stop();
      assert.deepEqual(await counts(), originalCounts, '重啟補回缺少報價，且不重複匯入');
      await withDatabase(async query => {
        assert.deepEqual(await query(`SELECT price_ntd, source_file, imported_at, notes
          FROM hardware_reference_prices WHERE category = 'cpu' AND brand = 'AMD'
          AND model = 'Ryzen 7 9800X3D' AND offer_type = 'motherboard_bundle'`), [{
          price_ntd: 11111, source_file: '手動報價.csv', imported_at: '2026-01-01', notes: '自行確認的價格'
        }]);
      });
    }
  } finally {
    await stop();
    assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempRoot).startsWith('nmdwsm-cpu-prices-'));
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
