// Portable supervised character/word n-gram classifier. Scores are not calibrated accuracy.
const FEATURE_COUNT = 8192;

function normalizeTitle(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/【[^】]*(?:加購價|加價購|加購優惠)[^】]*】|\[[^\]]*(?:加購價|加價購|加購優惠)[^\]]*\]/g, ' ');
}

function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function features(title) {
  const counts = new Map();
  const add = token => {
    const id = hash(token) % FEATURE_COUNT;
    counts.set(id, (counts.get(id) || 0) + 1);
  };
  const text = normalizeTitle(title).slice(0, 1000);
  for (const token of text.match(/[a-z]+|\d+|[\u3400-\u9fff]+/g) || []) {
    add(`w:${token}`);
    if (/[\u3400-\u9fff]/.test(token)) {
      for (let n = 1; n <= 3; n++) {
        for (let i = 0; i <= token.length - n; i++) add(`c:${token.slice(i, i + n)}`);
      }
    }
  }
  return [...counts].map(([id, count]) => [id, 1 + Math.log(count)]);
}

function vectorize(title, idf) {
  const vector = features(title).map(([id, count]) => [id, count * idf[id]]);
  const norm = Math.sqrt(vector.reduce((sum, [, v]) => sum + v * v, 0)) || 1;
  return vector.map(([id, value]) => [id, value / norm]);
}

function probabilities(vector, weights, labelCount) {
  const scores = new Float64Array(labelCount);
  for (let c = 0; c < labelCount; c++) {
    for (const [id, value] of vector) scores[c] += weights[c * FEATURE_COUNT + id] * value;
  }
  const maximum = Math.max(...scores);
  let total = 0;
  for (let c = 0; c < labelCount; c++) { scores[c] = Math.exp(scores[c] - maximum); total += scores[c]; }
  return Array.from(scores, score => score / total);
}

function createPredictor(model) {
  if (model.schema !== 1 || model.featureCount !== FEATURE_COUNT) throw new Error('Unsupported classifier schema');
  const decode = value => {
    const bytes = Buffer.from(value, 'base64');
    const result = new Float32Array(bytes.length / 4);
    for (let i = 0; i < result.length; i++) result[i] = bytes.readFloatLE(i * 4);
    return result;
  };
  const idf = decode(model.idf), weights = decode(model.weights);
  if (idf.length !== FEATURE_COUNT || weights.length !== FEATURE_COUNT * model.labels.length) throw new Error('Invalid classifier dimensions');
  return title => {
    const scores = probabilities(vectorize(title, idf), weights, model.labels.length);
    const ranked = scores.map((score, i) => ({ label: model.labels[i], score })).sort((a, b) => b.score - a.score);
    return { ...ranked[0], margin: ranked[0].score - ranked[1].score };
  };
}

module.exports = { FEATURE_COUNT, normalizeTitle, hash, features, vectorize, probabilities, createPredictor };
