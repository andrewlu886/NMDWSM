const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const catalog = require('../public/db');
const { seedImportedReferencePrices } = require('../src/data/imported-reference-prices');
const rtx3080Prices = require('../src/data/rtx3080-reference-prices');

test('匯入報價能查型號、取得正確價格，重跑不重複且不混用優惠', async () => {
  const connection = await catalog.initDatabase();
  try {
    const counts = () => catalog.runQuery('SELECT category,offer_type,COUNT(*) AS n FROM hardware_reference_prices GROUP BY category,offer_type');
    const before = await counts();
    await seedImportedReferencePrices(catalog.runUpdate);
    assert.deepEqual(await counts(), before);
    for (const { brand, model, price } of rtx3080Prices) {
      const canonical = `${brand} ${model}`;
      const items = await catalog.HardwareCatalog.searchModels({ category: 'gpu', query: canonical });
      const item = items.find(i => i.canonicalModel === canonical);
      assert.ok(item, canonical);
      assert.equal(item.referencePrice.priceNtd, price, canonical);
      const resolved = await catalog.HardwareCatalog.resolveValuationInput({ category: 'gpu', model: canonical, modelId: item.id });
      assert.equal(resolved.referencePrice.priceNtd, price);
    }
    for (const [category, query, price] of [
      ['gpu', 'GIGABYTE RTX3090Ti GAMING OC 24G', 39990],
      ['cpu', 'Ryzen 7 9800X3D', 15900],
      ['motherboard', 'AMD AM5 B650', 2400]
    ]) {
      const items = await catalog.HardwareCatalog.searchModels({ category, query });
      const item = items.find(i => i.canonicalModel === query);
      assert.equal(item.referencePrice.priceNtd, price, query);
      if (category === 'motherboard') assert.equal(item.referencePrice.basis, 'chipset_base');
    }
    const chinese = await catalog.HardwareCatalog.searchModels({ category: 'gpu', query: '微星 RTX3090Ti SUPRIM' });
    assert.ok(chinese.some(i => i.referencePrice?.priceNtd === 47990));
    const missing = await catalog.HardwareCatalog.searchModels({ category: 'gpu', query: '不存在的型號xyz123' });
    assert.deepEqual(missing, []);
    assert.equal((await catalog.runQueryOne("SELECT COUNT(*) AS n FROM hardware_reference_prices WHERE category='gpu'")).n, 92);
  } finally {
    await new Promise((resolve, reject) => connection.close(e => e ? reject(e) : resolve()));
  }
});
