const COOLPC_SOURCE = 'https://troywhitetw.github.io/coolpc-crawler/c/cpu.html';
const SINYA_SOURCE = 'https://www.sinya.com.tw/search/1_1?keyword=INTEL&page=2';
const PCHOME_14700F_SOURCE = 'https://24h.pchome.com.tw/prod/DRAI63-1900K0JUT';
const PCHOME_245KF_SOURCE = 'https://24h.pchome.com.tw/prod/DRAI79-A900JGY39';

const intelCpuPricingModels = [
  ['Core i5-12400', 6100, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core i5-12400F', 5600, '欣亞數位', SINYA_SOURCE, '2026-09-04'],
  ['Core i3-14100', 4800, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core i5-14400F', 6250, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core i5-14400', 7250, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core i7-14700', 11800, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core i7-14700F', 11490, 'PChome 24h', PCHOME_14700F_SOURCE, '2026-09-09'],
  ['Core Ultra 5 225F', 4880, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core Ultra 5 225', 5280, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core Ultra 5 245K', 6990, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core Ultra 5 245KF', 6490, 'PChome 24h', PCHOME_245KF_SOURCE, '2026-09-09'],
  ['Core Ultra 5 250K Plus', 8500, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core Ultra 7 265KF', 9380, '欣亞數位', SINYA_SOURCE, '2026-09-04'],
  ['Core Ultra 7 265K', 10300, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core Ultra 7 270K Plus', 12500, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06'],
  ['Core Ultra 9 285K', 19500, 'CoolPC Price Tracker', COOLPC_SOURCE, '2026-09-06']
].map(([canonicalModel, referencePriceNtd, sourceName, sourceUrl, sourceCheckedAt]) => ({
  canonicalModel,
  referencePriceNtd,
  sourceName,
  sourceUrl,
  sourceCheckedAt
}));

module.exports = { intelCpuPricingModels };
