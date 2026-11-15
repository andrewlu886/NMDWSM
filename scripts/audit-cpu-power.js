// Read-only CPU inventory audit. Never infer watts from a neighbouring SKU.
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('sqlite3');
const { supplementCpuPower } = require('../src/data/cpu-power-supplements');
const { resolveModel } = require('../public/psu-flow');
const root = path.resolve(__dirname, '..');
const source = process.argv[2] || 'C:/Users/leo20/Desktop/cpu訓練';
function canonical(value) {
  return String(value).normalize('NFKC').trim().replace(/^Intel\s+/i, '').replace(/^AMD\s+/i, '')
    .replace(/^Core\s+/i, '').replace(/^R([3579])-/i, 'Ryzen $1 ')
    .replace(/-PRO$/i, ' PRO').replace(/^(Ryzen [3579]) PRO (.+)$/i, '$1 $2 PRO').replace(/\s+/g, ' ');
}
const key = value => canonical(value).toLowerCase().replace(/[\s-]/g, '');
function imagesBelow(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, item) => n + (item.isDirectory()
    ? imagesBelow(path.join(dir, item.name)) : /\.(?:jpe?g|png|webp|bmp)$/i.test(item.name) ? 1 : 0), 0);
}
async function main() {
  const db = new sqlite.Database(path.join(root, 'public/nmdwsm.db'), sqlite.OPEN_READONLY);
  const all = sql => new Promise((resolve, reject) => db.all(sql, (e, rows) => e ? reject(e) : resolve(rows)));
  try {
    const inventory = new Map();
    function add(model, source, count = 0) {
      if (!model) return;
      const id = key(model);
      const record = inventory.get(id) || { model: canonical(model), sources: [], imageCount: 0 };
      if (!record.sources.includes(source)) record.sources.push(source);
      record.imageCount += count; inventory.set(id, record);
    }
    for (const folder of fs.readdirSync(source, { withFileTypes: true }).filter(item => item.isDirectory())) {
      const count = imagesBelow(path.join(source, folder.name));
      if (count) add(folder.name, '圖片原始資料夾', count);
    }
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/cpu-library/catalog.json')));
    for (const image of catalog.images) add(image.model, '圖片索引');
    for (const row of await all("SELECT canonical_model FROM hardware_models WHERE category='cpu'")) add(row.canonical_model, '型號主表');
    for (const row of await all("SELECT DISTINCT model FROM hardware_reference_prices WHERE category='cpu'")) add(row.model, '參考價格表');
    // CPU pricing and alias tables reference hardware_models IDs; aliases are
    // alternative names, not additional physical SKUs.
    const rawPower = await all('SELECT * FROM CPU_Power_Supply_Data_2010_TO_2026');
    const power = supplementCpuPower(rawPower);
    for (const row of rawPower) add(row['CPU 型號'], '功耗表');
    const valid = value => /^\s*\d+(?:\.\d+)?\s*(?:W)?\s*$/i.test(String(value || '')) && parseFloat(value) > 0;
    const records = [...inventory.values()].sort((a,b) => a.model.localeCompare(b.model, 'en', { numeric: true })).map(record => {
      const rows = power.filter(row => key(row['CPU 型號']) === key(record.model));
      const max = rows.some(row => valid(row['最大銳頻功耗 PL2/PPT (W)']));
      const tdp = rows.some(row => valid(row['標稱 TDP (W)']));
      return { ...record, status: !rows.length ? '沒有功耗紀錄' : !max && !tdp ? '瓦數缺漏或格式無效' : !max ? '僅有 TDP' : '有最大功耗',
        runtimeStatus: resolveModel(power, 'cpu', record.model).status,
        supplement: rows.some(row => row.source),
        powerRows: rows.map(row => ({ model: row['CPU 型號'], tdp: row['標稱 TDP (W)'], maximum: row['最大銳頻功耗 PL2/PPT (W)'] })) };
    });
    const missing = records.filter(r => ['沒有功耗紀錄', '瓦數缺漏或格式無效'].includes(r.status));
    const images = missing.filter(r => r.sources.some(s => s.startsWith('圖片')));
    const dbOnly = missing.filter(r => !images.includes(r));
    const summary = { uniqueModels: records.length, imageModels: records.filter(r => r.sources.some(s=>s.startsWith('圖片'))).length,
      sourceImages: records.reduce((n,r)=>n+r.imageCount,0), rawPowerRows: rawPower.length, effectivePowerRows: power.length,
      missing: missing.length, missingImageModels: images.length, missingDatabaseOnly: dbOnly.length,
      tdpOnly: records.filter(r=>r.status==='僅有 TDP').length, invalidPower: records.filter(r=>r.status==='瓦數缺漏或格式無效').length };
    const report = { date: '2026-11-15', source, summary, records };
    fs.mkdirSync(path.join(root,'reports'), {recursive:true});
    fs.writeFileSync(path.join(root,'reports/cpu-power-audit.json'), JSON.stringify(report,null,2));
    let md = '# CPU 功耗缺漏盤點（2026-11-15）\n\n';
    md += `範圍：原始圖片資料夾、現行圖片索引、SQLite 全部 CPU 型號及參考價格、功耗表，以及網站功耗補充資料。唯讀盤點，未修改資料庫。\n\n`;
    md += `共 ${summary.uniqueModels} 個不重複型號；圖片涵蓋 ${summary.imageModels} 個型號、原始資料夾 ${summary.sourceImages} 張圖片。功耗表 ${rawPower.length} 筆，加上補充資料共 ${power.length} 筆。缺少可用功耗共 ${missing.length} 個型號，其中圖片涵蓋 ${images.length} 個、資料庫另外 ${dbOnly.length} 個。\n\n`;
    md += '完整型號精確比對，保留 K／KF／F／X／XT／X3D／PRO／Plus 等差異。圖片型號以目錄與索引標籤盤點，不表示每張圖片都已核實。CPU 價格表與別名表透過型號主表關聯，別名不另算 SKU。\n\n';
    for(const [title,list] of [['已收集圖片但缺少功耗',images],['僅資料庫收錄、缺少功耗',dbOnly],['有紀錄但瓦數缺漏',records.filter(r=>r.status==='瓦數缺漏或格式無效')],['僅有 TDP，缺最大功耗',records.filter(r=>r.status==='僅有 TDP')]]) {
      md += `## ${title}（${list.length}）\n\n`;
      md += list.length ? '| 型號 | 來源 | 原始圖片張數 | 狀態 |\n|---|---|---:|---|\n' + list.map(r=>`| ${r.model} | ${r.sources.join('、')} | ${r.imageCount} | ${r.status} |`).join('\n')+'\n\n' : '無。\n\n';
    }
    md += '## 已補充與比對限制\n\ni7-14700 已由網站補充資料提供 219 W 最大功耗，因此不列為缺漏；SQLite 原始功耗表仍未新增該筆。\n\n盤點不將建議電源供應器瓦數當作 CPU 功耗，也不從同系列相近型號推算。僅 TDP 的型號與完全缺漏分開列出。JSON 同時記錄目前網站 resolveModel 的結果，供發現命名差異使用。\n';
    fs.writeFileSync(path.join(root,'reports/cpu-power-audit.md'),md);
    console.log(JSON.stringify({summary,missingImages:images.map(r=>r.model),missingDb:dbOnly.map(r=>r.model),tdpOnly:records.filter(r=>r.status==='僅有 TDP').map(r=>r.model),runtimeMismatch:records.filter(r=>r.status==='有最大功耗'&&r.runtimeStatus!=='matched').map(r=>({model:r.model,status:r.runtimeStatus}))},null,2));
  } finally { db.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1});
