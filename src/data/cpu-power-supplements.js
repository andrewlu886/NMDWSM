// Exact-model additions verified against manufacturer specifications.
const supplements = [{
  'CPU 型號': 'Core i7-14700',
  '標稱 TDP (W)': '65 W',
  '最大銳頻功耗 PL2/PPT (W)': '219 W',
  source: 'https://www.intel.com/content/www/us/en/products/sku/236781/intel-core-i7-processor-14700-33m-cache-up-to-5-40-ghz/specifications.html',
  checkedAt: '2026-11-15'
}];
function supplementCpuPower(rows) {
  const { normalize } = require('../../public/psu-flow');
  return [...rows, ...supplements.filter(extra => !rows.some(row =>
    normalize(row['CPU 型號'] || row['CPU型號']) === normalize(extra['CPU 型號'])))];
}
module.exports = { supplementCpuPower };
