const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readRows } = require('../train');
const { matchesComputerSearch } = require('../src/services/computer-product');

function summarize(cases) {
  const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const row of cases) counts[row.expected ? (row.actual ? 'tp' : 'fn') : (row.actual ? 'fp' : 'tn')]++;
  const { tp, fp, tn, fn } = counts;
  const divide = (a, b) => b ? a / b : null;
  const precision = divide(tp, tp + fp), recall = divide(tp, tp + fn), specificity = divide(tn, tn + fp);
  return { samples: cases.length, ...counts, precision, recall, specificity,
    accuracy: divide(tp + tn, cases.length), balancedAccuracy: recall === null || specificity === null ? null : (recall + specificity) / 2,
    failures: cases.filter(row => row.expected !== row.actual) };
}

function evaluate(split) {
  if (!['test', 'validation'].includes(split)) throw new Error('Unknown split');
  const { rows, sourceHash } = readRows();
  const examples = rows.filter(row => row.split === split && !row.synthetic);
  const predict = (row, keyword, precise) => matchesComputerSearch({ name: row.text }, keyword, { precise });
  const general = summarize(examples.map(row => ({ line: row.line, title: row.text,
    expected: row.label !== 'not_pc', actual: predict(row, '電腦', false) })));
  const exactCases = [];
  for (const [category, keyword] of [['part_cpu', 'CPU'], ['part_gpu', '顯示卡']]) {
    for (const row of examples) exactCases.push({ keyword, line: row.line, title: row.text,
      expected: row.label === category, actual: predict(row, keyword, true) });
  }
  const exact = summarize(exactCases);
  const perCategory = Object.fromEntries(['CPU', '顯示卡'].map(keyword => [keyword, summarize(exactCases.filter(row => row.keyword === keyword))]));
  // Targets apply to accepted-result precision AND recall, not the softmax score or majority accuracy.
  const passed = general.precision >= 0.8 && general.recall >= 0.8 && general.specificity >= 0.8
    && exact.precision >= 0.9 && exact.recall >= 0.9
    && Object.values(perCategory).every(result => result.tp + result.fn >= 10 && result.precision >= 0.9 && result.recall >= 0.9);
  return { sourceHash, split, datasetRows: examples.length, general, exact, perCategory, passed,
    limits: 'Titles excluded from model-weight training. Filtering rules were iterated using diagnostic failures, so this is an offline development backtest, not a blind test of the complete pipeline. General=PC scope; exact=CPU/GPU standalone category. No live-market guarantee.' };
}

function evaluateMarketCases() {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/market-search-cases.json'), 'utf8'));
  return Object.fromEntries(['general', 'precise'].map(mode => [mode, summarize(fixture.cases.map(row => ({
    ...row, expected: row[mode], actual: matchesComputerSearch({ name: row.title }, row.keyword, { precise: mode === 'precise' })
  })))]));
}

function evaluateExternalHoldout() {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/market-search-holdout.json'), 'utf8'));
  const unchanged = Object.entries(fixture.pipelineFingerprints).every(([file, expected]) =>
    crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex') === expected);
  const results = Object.fromEntries(['general', 'precise'].map(mode => [mode, summarize(fixture.cases.map(row => ({
    ...row, expected: row[mode], actual: matchesComputerSearch({ name: row.title }, row.keyword, { precise: mode === 'precise' })
  })))]));
  return { pipelineUnchangedSinceLabelsFrozen: unchanged,
    evaluationStatus: unchanged ? 'blind holdout' : 'regression check after pipeline update',
    scope: fixture.purpose, ...results };
}

if (require.main === module) {
  const split = process.argv.includes('--validation') ? 'validation' : 'test';
  const report = evaluate(split);
  report.marketplaceDevelopmentValidation = evaluateMarketCases();
  report.externalHoldout = evaluateExternalHoldout();
  report.passed = report.passed && report.externalHoldout.general.precision >= 0.8 && report.externalHoldout.general.recall >= 0.8
    && report.externalHoldout.precise.precision >= 0.9 && report.externalHoldout.precise.recall >= 0.9;
  if (!report.externalHoldout.pipelineUnchangedSinceLabelsFrozen) {
    report.limits += ' The frozen marketplace holdout is now a regression check because the search policy changed after labels were frozen.';
  }
  fs.writeFileSync(path.join(__dirname, `../models/market-search-${split}-report.json`), JSON.stringify(report, null, 2) + '\n');
  const compact = ({ failures: _failures, ...rest }) => rest;
  console.log(JSON.stringify({ ...report, externalHoldout: { ...report.externalHoldout, general: compact(report.externalHoldout.general), precise: compact(report.externalHoldout.precise) }, marketplaceDevelopmentValidation: Object.fromEntries(Object.entries(report.marketplaceDevelopmentValidation).map(([k, v]) => [k, compact(v)])), general: compact(report.general), exact: compact(report.exact),
    perCategory: Object.fromEntries(Object.entries(report.perCategory).map(([k, v]) => [k, compact(v)])) }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
module.exports = { evaluate, summarize, evaluateMarketCases };
