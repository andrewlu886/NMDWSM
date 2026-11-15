const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const catalog = require('../public/db');

test('chat exact matching accepts full models and registered aliases but never borrows base-model prices', async () => {
  const connection = await catalog.initDatabase();
  try {
    const exact = await catalog.HardwareCatalog.resolveValuationInput({ category: 'cpu', model: 'Core i7-14700', strictModelMatch: true });
    assert.ok(exact.model);
    await catalog.runUpdate('INSERT INTO hardware_model_aliases (hardware_model_id, alias, normalized_alias) VALUES (?, ?, ?)',
      [exact.model.id, '測試14700完整別名', '測試14700完整別名']);
    const alias = await catalog.HardwareCatalog.resolveValuationInput({ category: 'cpu', model: '測試14700完整別名', strictModelMatch: true });
    assert.equal(alias.model.id, exact.model.id);
    for (const model of ['Core i7-14700FAKE', 'Core i7-14700F-WHITE']) {
      const result = await catalog.HardwareCatalog.resolveValuationInput({ category: 'cpu', model, strictModelMatch: true });
      assert.equal(result.model, null);
      assert.equal(result.cpuPricing, null);
      assert.equal(result.referencePrice, null);
    }
    const compatible = await catalog.HardwareCatalog.resolveValuationInput({ category: 'cpu', model: 'Core i7-14700FAKE' });
    assert.ok(compatible.model, 'existing callers retain their previous lookup policy');
  } finally {
    await new Promise((resolve, reject) => connection.close(error => error ? reject(error) : resolve()));
  }
});
