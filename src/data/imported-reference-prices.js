// 使用者提供的報價截圖；日期為匯入日期，不代表已查核目前庫存或市價。
const rtx3080Prices = require('./rtx3080-reference-prices');
const gpuRows = [
  ['ASUS', 'TUF-RTX3090-24G-GAMING', 52990],
  ['ASUS', 'TUF-RTX3090-O24G-GAMING', 55990],
  ['ASUS', 'ROG-STRIX-RTX3090-24G-GAMING', 54990],
  ['ASUS', 'ROG-STRIX-RTX3090-O24G-GAMING', 60990],
  ['ASUS', 'ROG-STRIX-RTX3090-24G-WHITE', 59990],
  ['ASUS', 'ROG-STRIX-RTX3090-O24G-WHITE', 63990],
  ['ASUS', 'RTX3090-24G-EK', 62990],
  ['GIGABYTE', 'RTX3090 EAGLE 24G', 52990],
  ['GIGABYTE', 'RTX3090 EAGLE OC 24G', 55990],
  ['GIGABYTE', 'RTX3090 GAMING OC 24G', 57990],
  ['GIGABYTE', 'RTX3090 VISION OC 24G', 58990],
  ['GIGABYTE', 'AORUS RTX3090 MASTER 24G', 61990],
  ['GIGABYTE', 'AORUS RTX3090 MASTER 24G (rev2.0)', 61990],
  ['GIGABYTE', 'AORUS RTX3090 XTREME 24G', 63990],
  ['GIGABYTE', 'AORUS RTX3090 XTREME WATERFORCE WB 24G', 62990],
  ['GIGABYTE', 'AORUS RTX3090 XTREME WATERFORCE 24G', 63490],
  ['EVGA', 'RTX3090 XC3 ULTRA HYBRID GAMING', 50990],
  ['EVGA', 'RTX3090 FTW3 ULTRA', 56490],
  ['EVGA', 'RTX3090 FTW3 ULTRA HYBRID GAMING', 56490],
  ['EVGA', 'RTX3090 FTW3 ULTRA HYDRO COPPER GAMING', 58190],
  ['EVGA', 'RTX3090 KINGPIN HYBRID GAMING', 62890],
  ['EVGA', 'RTX3090 KINGPIN HYBRID COPPER GAMING', 68990],
  ['ZOTAC', 'RTX3090 Trinity', 61900],
  ['ZOTAC', 'RTX3090 AMP Core Holo', 62900],
  ['ZOTAC', 'RTX3090 AMP Extreme Holo', 63900],
  ['ZOTAC', 'RTX3090 ArcticStorm', 62900],
  ['INNO3D', 'RTX3090 X3', 56888],
  ['INNO3D', 'RTX3090 GAMING X3', 62888],
  ['INNO3D', 'RTX3090 iChill X3 24G', 63888],
  ['INNO3D', 'RTX3090 iChill X4 24G', 64888]
];
const gpuTiRows = [
  ['GIGABYTE', 'RTX3090Ti GAMING OC 24G', 39990],
  ['MSI', 'RTX3090Ti GAMING X TRIO 24G', 45990],
  ['MSI', 'RTX3090Ti SUPRIM X 24G', 47990],
  ['ZOTAC', 'RTX3090Ti AMP Extreme Holo', 46890],
  ['INNO3D', 'RTX3090Ti X3 OC', 36888]
];
const cpuRows = [
  ['Ryzen 5 7500F', 4790, 4490, 'MPK，含風扇，代理商三年保', '214435'],
  ['Ryzen 7 7700', 7190, 6740, 'MPK，代理含風扇，代理商三年保', '214435'],
  ['Ryzen 7 7800X3D', 9990, null, 'Tray 盤，截圖標示三年保', '214435'],
  ['Ryzen 5 8400F', 4950, 4450, '盒裝', '214435'],
  ['Ryzen 5 8500G', 5090, null, '盒裝', '214435'],
  ['Ryzen 5 8600G', 6450, null, '盒裝', '214435'],
  ['Ryzen 5 9600X', 7950, 7350, '代理盒裝', '214500'],
  ['Ryzen 7 9700X', 11450, 10550, '代理盒裝', '214500'],
  ['Ryzen 9 9900X', 13900, null, '代理盒裝', '214500'],
  ['Ryzen 9 9950X', 19500, null, '代理盒裝', '214500'],
  ['Ryzen 7 9800X3D', 15900, 15000, '代理盒裝', '214500'],
  ['Ryzen 7 9850X3D', 16000, null, '代理盒裝；型號依截圖原文收錄', '214500'],
  ['Ryzen 9 9900X3D', 19750, null, '代理盒裝', '214500'],
  ['Ryzen 9 9950X3D', 22200, null, '代理盒裝', '214500'],
  ['Ryzen 9 9950X3D2', 31000, null, '型號依截圖原文收錄', '214500']
];
const motherboardRows = [
  ['AMD AM5', 'X670E / X870E', 4200, 6],
  ['AMD AM5', 'B650E / X670 / X870', 3200, 7],
  ['AMD AM5', 'B650 / B850', 2400, 8],
  ['AMD AM5', 'A620', 1300, 9],
  ['AMD AM4', 'X570', 2200, 10],
  ['AMD AM4', 'B550', 1700, 11],
  ['AMD AM4', 'A520 / B450', 1100, 12],
  ['Intel LGA1700', 'Z790', 3200, 13],
  ['Intel LGA1700', 'Z690', 2500, 14],
  ['Intel LGA1700', 'B760', 2000, 15],
  ['Intel LGA1700', 'H610', 1200, 16]
];

async function seedImportedReferencePrices(runUpdate) {
  await runUpdate(`CREATE TABLE IF NOT EXISTS hardware_reference_prices (
    category TEXT NOT NULL, brand TEXT NOT NULL, model TEXT NOT NULL,
    price_ntd INTEGER NOT NULL CHECK(price_ntd > 0),
    offer_type TEXT NOT NULL CHECK(offer_type IN ('standalone', 'motherboard_bundle')),
    notes TEXT NOT NULL, source_file TEXT NOT NULL, imported_at TEXT NOT NULL,
    PRIMARY KEY(category, brand, model, offer_type, source_file)
  )`);
  await runUpdate(`CREATE TABLE IF NOT EXISTS hardware_motherboard_base_prices (
    platform TEXT NOT NULL, chipset TEXT NOT NULL,
    base_price_ntd INTEGER NOT NULL CHECK(base_price_ntd > 0),
    price_basis TEXT NOT NULL, source_file TEXT NOT NULL, source_sheet TEXT NOT NULL,
    source_row INTEGER NOT NULL, imported_at TEXT NOT NULL,
    PRIMARY KEY(platform, chipset, source_file)
  )`);
  const put = async (category, brand, model, price, type, notes, source) => {
    if (category === 'cpu') {
      // 來源可由使用者修改；以型號與報價種類判斷是否已有價格，避免重建舊來源。
      return runUpdate(
        `INSERT INTO hardware_reference_prices
         (category, brand, model, price_ntd, offer_type, notes, source_file, imported_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM hardware_reference_prices
           WHERE category = ? AND brand = ? AND model = ? AND offer_type = ?
         )`,
        [category, brand, model, price, type, notes, source, '2026-09-10',
          category, brand, model, type]
      );
    }
    return runUpdate(
      `INSERT INTO hardware_reference_prices VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(category, brand, model, offer_type, source_file) DO UPDATE SET
         price_ntd=excluded.price_ntd, notes=excluded.notes`,
      [category, brand, model, price, type, notes, source, '2026-09-10']);
  };
  for (const [index, [brand, model, price]] of gpuRows.entries()) {
    await put('gpu', brand, model, price, 'standalone',
      '截圖參考價，未查核現貨；型號依原文保留',
      `2026-09-10_${index < 16 ? '220329' : '220414'}.png`);
  }
  for (const [model, price, bundle, notes, time] of cpuRows) {
    const source = `2026-09-10_${time}.png`;
    await put('cpu', 'AMD', model, price, 'standalone', notes, source);
    if (bundle) await put('cpu', 'AMD', model, bundle, 'motherboard_bundle',
      `${notes}；須搭購主機板，非單買價格`, source);
  }
  for (const [brand, model, price] of gpuTiRows) {
    await put('gpu', brand, model, price, 'standalone', '截圖報價，未查核現貨',
      'codex-clipboard-f144abf7-9c22-4d11-a1fd-d7df775fceeb.png');
  }
  for (const { brand, model, price, notes, source } of rtx3080Prices) {
    await put('gpu', brand, model, price, 'standalone',
      `截圖報價，未查核現貨。${notes}`, source);
  }
  for (const [platform, group, price, row] of motherboardRows) {
    for (const chipset of group.split(' / ')) {
      await runUpdate(`INSERT INTO hardware_motherboard_base_prices VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, chipset, source_file) DO UPDATE SET
          base_price_ntd=excluded.base_price_ntd, source_row=excluded.source_row`,
      [platform, chipset, price, '二手估價晶片組基準底價 P_base，非新品售價',
        '主機板估價(6).xlsx', '主機板演算法引數規格表', row, '2026-09-10']);
    }
  }
  const models = [
    ...[...gpuRows, ...gpuTiRows].map(([brand, model]) => ['gpu', brand, `${brand} ${model}`, 'GeForce RTX 30']),
    ...rtx3080Prices.map(({ brand, model }) => ['gpu', brand, `${brand} ${model}`, 'GeForce RTX 30']),
    ...cpuRows.map(([model]) => ['cpu', 'AMD', model, 'Ryzen']),
    ...motherboardRows.flatMap(([platform, group]) => group.split(' / ').map(chipset =>
      ['motherboard', platform.split(' ')[0], `${platform} ${chipset}`, '晶片組估價基準']))
  ];
  for (const [category, brand, model, series] of models) {
    const normalized = model.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
    await runUpdate(`INSERT INTO hardware_models
      (category,manufacturer,canonical_model,normalized_model,series)
      VALUES (?,?,?,?,?) ON CONFLICT(category,normalized_model) DO NOTHING`,
    [category, brand, model, normalized, series]);
    const localBrand = { ASUS: '華碩', GIGABYTE: '技嘉', MSI: '微星', ZOTAC: '索泰' }[brand];
    const aliases = category === 'gpu' ? [model.replace(brand, localBrand || brand)]
      : category === 'cpu' ? [`AMD ${model}`, model.replace('Ryzen ', 'R')] : [];
    for (const alias of aliases) {
      await runUpdate(`INSERT OR IGNORE INTO hardware_model_aliases
        (hardware_model_id,alias,normalized_alias)
        SELECT id,?,? FROM hardware_models WHERE category=? AND normalized_model=?`,
      [alias, alias.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, ''), category, normalized]);
    }
  }
}
module.exports = { seedImportedReferencePrices };
