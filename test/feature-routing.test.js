const test = require('node:test');
const assert = require('node:assert/strict');
const context = require('../public/hardware-context');
const { rankRecommendations } = require('../src/services/recommendation');
const { imageIdentity } = require('../src/services/image-diagnostics');

test('product plus feature commands preserve suffixes, variants and requested order', () => {
  for (const [text, features] of [
    ['幫我查 i7-12700 的市價', ['market']],
    ['i7-12700K 幫我估價', ['valuation']],
    ['以這顆 CPU 幫我推薦配置，預算三萬', ['recommendation']],
    ['i7-12700 配 RTX 4060 幫我算瓦數', ['power']],
    ['查市價並估二手價', ['market', 'valuation']],
    ['先估價，然後查市價', ['valuation', 'market']],
    ['不要估價，幫我查市價', ['market']],
    ['不要估價幫我查市價', ['market']]
  ]) assert.deepEqual(context.parseFeatureRequest(text)?.features, features, text);
  assert.deepEqual(context.extractProducts('ASUS DUAL RTX 4060 EVO-WHITE 8GB 幫我查市價'), [{ category: 'gpu', model: 'ASUS DUAL RTX 4060 EVO-WHITE 8GB' }]);
  assert.deepEqual(context.extractProducts('i7-12700KF 配 RTX 4060 Ti 16GB 算瓦數').map(item => item.model), ['i7-12700KF', 'RTX 4060 Ti 16GB']);
  assert.deepEqual(context.extractProducts('i7-12700 + RTX 4060 幫我算瓦數').map(item => item.model), ['i7-12700', 'RTX 4060']);
  assert.deepEqual(context.extractProducts('RTX 4060 / i7-12700 幫我算瓦數').map(item => item.model), ['RTX 4060', 'i7-12700']);
  assert.match(context.extractProducts('ASUS DUAL RTX 4060 白色 幫我查價')[0].model, /白色/);
  for (const text of ['不要估價', '我不想估價', '估價是什麼', '介紹市價查詢', '如何計算瓦數', '市價和估價有什麼差別', '智慧推薦功能是什麼', '手機幫我估價']) assert.equal(context.parseFeatureRequest(text), null, text);
});

test('literal product context persists as user input without creating a photo or leaking other-model conditions', () => {
  const history = [{ id: 'text-1', role: 'user', content: 'i7-12700 配 RTX 4060 算瓦數', hardwareInputs: context.extractProducts('i7-12700 配 RTX 4060'),
    valuationConditions: { model: 'i7-12700', elapsedMonths: 12 } }];
  const records = context.records(history);
  assert.equal(records.length, 2); assert.equal(records[0].status, 'confirmed');
  assert.deepEqual(records[0].photoNumbers, []);
  assert.equal(records[0].conditions.elapsedMonths, 12); assert.deepEqual(records[1].conditions, {});
  assert.equal(context.select(records, '這顆 CPU 查市價')[0].model, 'i7-12700');
  history[0].contextInvalidated = true;
  assert.deepEqual(context.records(history), []);
});

test('LLM routing cannot supply a fabricated product, unknown feature or override a literal command', () => {
  const action = { features: ['market'], targetText: 'i9-14900K', products: [{ model: 'i9-14900K', status: 'verified' }] };
  assert.deepEqual(context.validateFeatureRequest(action, '找找這個零件哪裡買划算').products, []);
  assert.equal(context.validateFeatureRequest({ features: ['shell'] }, '這顆幫我處理'), null);
  assert.equal(context.validateFeatureRequest(action, '市價查詢是什麼'), null);
  assert.deepEqual(context.validateFeatureRequest(action, '幫我估價').features, ['valuation']);
});

test('required hardware recommendations exclude neighbouring CPU suffixes', () => {
  const products = ['i7-12700', 'i7-12700K', 'i7-12700F'].map((cpu, index) => ({
    name: `全新桌機 ${cpu} / RTX 4060 / 16GB`, price: 25000,
    platform: ['PChome', 'Momo', 'Yahoo購物'][index],
    url: ['https://24h.pchome.com.tw/prod/A', 'https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=2', 'https://tw.buy.yahoo.com/gdsale/c.html'][index]
  }));
  const result = rankRecommendations({ budget: 30000, usage: 'gaming', productType: 'desktop', condition: 'new', requiredHardware: [{ category: 'cpu', model: 'Intel Core i7-12700' }] }, products);
  assert.equal(result.recommendations.length, 1);
  assert.match(result.recommendations[0].title, /i7-12700 \/ /);
});

test('image identity hashes decoded bytes and reads uploaded PNG dimensions', () => {
  const image = Buffer.alloc(24); image.write('\x89PNG', 0, 'latin1'); image.writeUInt32BE(800, 16); image.writeUInt32BE(400, 20);
  const result = imageIdentity(image.toString('base64'));
  assert.equal(result.width, 800); assert.equal(result.height, 400); assert.equal(result.imageHash.length, 64);
  assert.equal(imageIdentity(image.toString('base64') + '\n').imageHash, result.imageHash);
  assert.equal(imageIdentity('aGVsbG8=').width, null);
});
