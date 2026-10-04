const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createPredictor } = require('./classifier-core');

let predictor;
const cache = new Map();
function classifyProduct(title) {
  if (predictor === undefined) {
    try {
      const file = path.join(__dirname, '../../models/market-classifier.json.gz');
      predictor = createPredictor(JSON.parse(zlib.gunzipSync(fs.readFileSync(file))));
    } catch (error) {
      predictor = null;
      console.warn(`[商品分類] 模型無法載入，使用保守規則：${error.message}`);
    }
  }
  if (!predictor) return null;
  const text = String(title || '').slice(0, 1000);
  if (cache.has(text)) return cache.get(text);
  const result = predictor(text);
  if (cache.size >= 5000) cache.clear();
  cache.set(text, result);
  return result;
}

module.exports = { classifyProduct };
