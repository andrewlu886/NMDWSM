const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { FEATURE_COUNT, hash, features, vectorize, probabilities, createPredictor } = require('./src/services/classifier-core');
const { models } = require('./public/market-search-policy');

function groupKey(text) {
  const found = models(text);
  const gpu = found.find(m => m.category === 'part_gpu');
  if (gpu) return gpu.family;
  if (found.length) return found[0].family;
  const normalized = text.normalize('NFKC').toLowerCase();
  const sku = normalized.match(/[a-z][a-z0-9-]*\d[a-z0-9-]*/);
  if (sku) return sku[0].replace(/-(?:black|white|bk|wh)$/, '');
  return normalized.split(/[/【〈(]/)[0].replace(/黑色|白色|灰色|銀色|藍色|紅色|\s|[\p{P}\p{S}]|\d+/gu, '').slice(0, 16);
}

function readRows() {
  const source = fs.readFileSync(path.join(__dirname, 'data/train_keyword3.csv'), 'utf8');
  const provenance = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/market-training-provenance.json'), 'utf8'));
  const synthetic = new Set(provenance.syntheticOrUserExamples);
  const seen = new Set();
  const rows = source.trim().split(/\r?\n/).map((line, i) => {
    const match = line.match(/^__label__(\S+)\s+(.+)$/);
    if (!match) throw new Error(`Invalid training row ${i + 1}`);
    const [, label, text] = match;
    const identity = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    if (seen.has(identity)) throw new Error(`Duplicate/conflicting title: ${i + 1}`);
    seen.add(identity);
    const group = groupKey(text);
    return { label, text, group, synthetic: synthetic.has(text), line: i + 1 };
  });
  const groups = new Map(), totals = {};
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
    totals[row.label] = (totals[row.label] || 0) + 1;
  }
  const proportions = { train: 0.6, validation: 0.2, test: 0.2 };
  const allocated = { train: {}, validation: {}, test: {} };
  // Stratify by class while keeping a whole product family together; split decisions use no predictions.
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || hash(a[0]) - hash(b[0]));
  for (const [, groupRows] of ordered) {
    const counts = {};
    for (const row of groupRows) counts[row.label] = (counts[row.label] || 0) + 1;
    const cost = split => Object.entries(counts).reduce((sum, [label, n]) => {
      const before = (allocated[split][label] || 0) - totals[label] * proportions[split];
      return sum + ((before + n) ** 2 - before ** 2) / (totals[label] ** 2);
    }, 0);
    const split = Object.keys(proportions).sort((a, b) => cost(a) - cost(b))[0];
    for (const row of groupRows) row.split = split;
    for (const [label, n] of Object.entries(counts)) allocated[split][label] = (allocated[split][label] || 0) + n;
  }
  return { rows, sourceHash: crypto.createHash('sha256').update(source).digest('hex') };
}

function train(rows, epochs = 24) {
  const labels = [...new Set(rows.map(r => r.label))].sort();
  const idf = new Float32Array(FEATURE_COUNT);
  for (const row of rows) for (const [id] of features(row.text)) idf[id]++;
  for (let i = 0; i < FEATURE_COUNT; i++) idf[i] = Math.log((1 + rows.length) / (1 + idf[i])) + 1;
  const samples = rows.map(row => ({ vector: vectorize(row.text, idf), target: labels.indexOf(row.label) }));
  const counts = labels.map(label => rows.filter(r => r.label === label).length);
  const weights = new Float32Array(FEATURE_COUNT * labels.length);
  let seed = 1763;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = samples.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [samples[i], samples[j]] = [samples[j], samples[i]];
    }
    const rate = 0.65 / (1 + epoch * 0.08);
    for (const { vector, target } of samples) {
      const scores = probabilities(vector, weights, labels.length);
      const balance = Math.min(3, Math.sqrt(rows.length / (labels.length * counts[target])));
      for (let c = 0; c < labels.length; c++) {
        const delta = rate * balance * ((c === target ? 1 : 0) - scores[c]);
        for (const [id, value] of vector) weights[c * FEATURE_COUNT + id] += delta * value;
      }
    }
    if ((epoch + 1) % 6 === 0) console.log(`Training epoch ${epoch + 1}/${epochs}`);
  }
  const encode = array => {
    const bytes = Buffer.alloc(array.length * 4);
    array.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
    return bytes.toString('base64');
  };
  return { schema: 1, algorithm: 'hashed-ngram-softmax', featureCount: FEATURE_COUNT, labels, idf: encode(idf), weights: encode(weights) };
}

function classificationMetrics(rows, predict) {
  const confusion = {}, failures = [];
  let correct = 0;
  for (const row of rows) {
    const prediction = predict(row.text);
    (confusion[row.label] ||= {})[prediction.label] = (confusion[row.label][prediction.label] || 0) + 1;
    if (prediction.label === row.label) correct++;
    else failures.push({ line: row.line, expected: row.label, predicted: prediction.label, score: prediction.score, title: row.text });
  }
  return { samples: rows.length, correct, accuracy: rows.length ? correct / rows.length : null, confusion, failures };
}

function main() {
  const { rows, sourceHash } = readRows();
  // Synthetic examples in held-out groups are withheld, never moved into training.
  const training = rows.filter(r => r.split === 'train');
  const validation = rows.filter(r => r.split === 'validation' && !r.synthetic);
  const test = rows.filter(r => r.split === 'test' && !r.synthetic);
  const model = train(training);
  model.sourceHash = sourceHash;
  model.trainingRows = training.length;
  const predict = createPredictor(model);
  const report = {
    schema: 1, sourceHash, splitMethod: 'deterministic group-stratified 60/20/20; synthetic held-out rows excluded',
    trainingRows: training.length, validation: classificationMetrics(validation, predict), test: classificationMetrics(test, predict),
    limits: 'Offline labeled-title classification. No live marketplace accuracy claim. Scores are uncalibrated.'
  };
  fs.mkdirSync(path.join(__dirname, 'models'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'models/market-classifier.json.gz'), zlib.gzipSync(JSON.stringify(model), { level: 9 }));
  fs.writeFileSync(path.join(__dirname, 'models/market-classifier-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'data/market-classifier-split.json'), JSON.stringify(rows.map(row => ({ label: row.label, group: row.group, split: row.split, synthetic: row.synthetic, line: row.line })), null, 2) + '\n');
  console.log(JSON.stringify({ training: training.length, validation: report.validation.accuracy, test: report.test.accuracy, testRows: test.length }));
}

if (require.main === module) main();
module.exports = { groupKey, readRows, train, classificationMetrics };
