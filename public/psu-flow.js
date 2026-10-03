/* Shared database matching and PSU estimates for chat and the calculator. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PsuFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const motherboardOptions = [
    ['25', '標準主機板 (M-ATX / ATX) - 約 25W'],
    ['40', '高階主機板 (E-ATX / 旗艦供電) - 約 40W'],
    ['15', 'ITX 迷你主機板 - 約 15W']
  ];
  const coolingOptions = [
    ['15', '基本風冷 (CPU風扇 + 少量系統風扇) - 約 15W'],
    ['30', '高階風冷 (塔散 + 多顆系統風扇) - 約 30W'],
    ['45', '一體式水冷 (水泵 + ARGB 風扇群) - 約 45W']
  ];
  function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/\b(nvidia|geforce|amd|radeon|intel|core|ryzen|processor|graphics|cpu|gpu|asus|gigabyte|msi)\b/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }
  function field(row, names) {
    for (const name of names) {
      const clean = key => key.replace(/\s/g, '').toLowerCase();
      const entries = Object.entries(row);
      const entry = entries.find(([key]) => clean(key) === name.toLowerCase()) || entries.find(([key]) => clean(key).includes(name.toLowerCase()));
      if (entry && entry[1] !== '' && entry[1] != null) return entry[1];
    }
    return null;
  }
  function number(value) {
    const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }
  function integrated(model) { return /^(?:內顯|無獨顯|沒有顯卡|無獨立顯卡|沒有獨立顯卡|無獨立顯卡 \(內顯\) - 0W)$/i.test(String(model).trim()); }
  function resolveModel(rows, category, requested) {
    if (category === 'gpu' && integrated(requested)) return { status: 'matched', model: '內顯', watts: 0, recommendedPsu: 0 };
    const query = normalize(requested);
    if (!query || query.length < 4) return { status: 'unknown' };
    const key = category === 'cpu' ? ['CPU型號'] : ['顯示卡型號'];
    const records = rows.map(row => ({ row, model: String(field(row, key) || '') })).filter(item => item.model);
    let matches = records.filter(item => normalize(item.model) === query);
    if (!matches.length) matches = records.filter(item => {
      const name = normalize(item.model.replace(/\b\d+\s*gb\b/gi, ''));
      const familyQuery = normalize(String(requested).replace(/\b\d+\s*gb\b/gi, ''));
      return name.endsWith(familyQuery) || familyQuery.endsWith(name);
    });
    if (!matches.length) return { status: 'unknown' };
    if (matches.length > 1) return { status: 'ambiguous', candidates: [...new Set(matches.map(item => item.model))] };
    const { row, model } = matches[0];
    const watts = number(field(row, category === 'cpu' ? ['最大銳頻功耗', 'PL2', 'PPT', '標稱TDP', 'TDP'] : ['TDP', 'TGP', '官方功耗']));
    if (watts === null || watts < 0 || (category === 'cpu' && watts === 0)) return { status: 'missing-power', model, row };
    return { status: 'matched', model, row, watts, recommendedPsu: category === 'gpu' ? number(field(row, ['官方建議瓦數', '官方建議PSU', '建議瓦數', '建議電源', 'PSU'])) || 0 : 0 };
  }
  function estimate({ cpuWatts, gpuWatts, motherboardWatts = 25, coolingWatts = 15, driveCount = 1, gpuRecommendedPsu = 0 }) {
    const values = { cpuWatts, gpuWatts, motherboardWatts, coolingWatts, driveCount, gpuRecommendedPsu };
    for (const value of Object.values(values)) {
      if (value === null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('功耗資料不完整，請確認型號後再計算。');
    }
    const totalWatts = Number(cpuWatts) + Number(gpuWatts) + Number(motherboardWatts) + Number(coolingWatts) + Number(driveCount) * 10;
    const recommendedWatts = Math.max(300, Math.ceil(totalWatts * 1.3 / 50) * 50, Number(gpuRecommendedPsu));
    return { totalWatts, recommendedWatts };
  }
  function calculatorUrl(flow) {
    const params = new URLSearchParams();
    for (const [key, value] of [['cpu', flow.cpuModel], ['gpu', flow.gpuModel], ['motherboard', flow.motherboardWatts], ['cooling', flow.coolingWatts]]) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    return '/tools?' + params.toString();
  }
  return { motherboardOptions, coolingOptions, normalize, resolveModel, integrated, estimate, calculatorUrl };
});
