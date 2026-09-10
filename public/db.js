const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { seedImportedReferencePrices } = require('../src/data/imported-reference-prices');
const {
  hardwareModels,
  brandAliases,
  warrantyRules,
  amdGpuPricingModels,
  intelCpuPricingModels
} = require('../src/data/hardware-catalog');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'nmdwsm.db');
let db = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);

      db.run('PRAGMA foreign_keys = ON');
      db.exec(`
        CREATE TABLE IF NOT EXISTS hardware_models (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          manufacturer TEXT NOT NULL,
          canonical_model TEXT NOT NULL,
          normalized_model TEXT NOT NULL,
          series TEXT NOT NULL,
          release_year INTEGER,
          UNIQUE(category, normalized_model)
        );

        CREATE TABLE IF NOT EXISTS hardware_model_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hardware_model_id INTEGER NOT NULL,
          alias TEXT NOT NULL,
          normalized_alias TEXT NOT NULL,
          UNIQUE(hardware_model_id, normalized_alias),
          FOREIGN KEY (hardware_model_id) REFERENCES hardware_models(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hardware_brand_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          canonical_brand TEXT NOT NULL,
          alias TEXT NOT NULL,
          normalized_alias TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS hardware_warranty_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_key TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL,
          brand TEXT,
          match_type TEXT NOT NULL,
          match_value TEXT,
          warranty_type TEXT NOT NULL DEFAULT 'months',
          base_months INTEGER,
          extension_months INTEGER NOT NULL DEFAULT 0,
          registration_required INTEGER NOT NULL DEFAULT 0,
          valid_from TEXT,
          valid_to TEXT,
          priority INTEGER NOT NULL DEFAULT 0,
          source_url TEXT,
          source_checked_at TEXT
        );

        CREATE TABLE IF NOT EXISTS hardware_gpu_pricing_models (
          hardware_model_id INTEGER PRIMARY KEY,
          generation INTEGER NOT NULL,
          vram_gb REAL NOT NULL,
          launch_price_ntd INTEGER NOT NULL,
          floor_price_ntd INTEGER NOT NULL,
          latest_generation INTEGER NOT NULL DEFAULT 9,
          landing_coefficient REAL NOT NULL DEFAULT -0.040,
          market_factor REAL NOT NULL DEFAULT 0,
          model_version TEXT NOT NULL,
          FOREIGN KEY (hardware_model_id) REFERENCES hardware_models(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hardware_cpu_pricing_models (
          hardware_model_id INTEGER PRIMARY KEY,
          reference_price_ntd INTEGER NOT NULL,
          source_name TEXT NOT NULL,
          source_url TEXT NOT NULL,
          source_checked_at TEXT NOT NULL,
          FOREIGN KEY (hardware_model_id) REFERENCES hardware_models(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_hardware_models_category_normalized
          ON hardware_models(category, normalized_model);
        CREATE INDEX IF NOT EXISTS idx_hardware_aliases_normalized
          ON hardware_model_aliases(normalized_alias);
        CREATE INDEX IF NOT EXISTS idx_warranty_rules_category_priority
          ON hardware_warranty_rules(category, priority DESC);
      `, (initErr) => {
        if (initErr) return reject(initErr);

        seedHardwareCatalog().then(() => resolve(db)).catch(reject);
      });
    });
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function runQueryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function runUpdate(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function normalizeHardwareText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

async function seedHardwareCatalog() {
  await runUpdate('BEGIN TRANSACTION');
  try {
    await runUpdate(
      `DELETE FROM hardware_models
       WHERE category = 'cpu' AND manufacturer = 'Intel'
         AND series IN ('Core 10th Gen', 'Core 11th Gen')`
    );

    for (const item of hardwareModels) {
      const normalizedModel = normalizeHardwareText(item.canonicalModel);
      await runUpdate(
        `INSERT INTO hardware_models
         (category, manufacturer, canonical_model, normalized_model, series, release_year)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(category, normalized_model) DO UPDATE SET
           manufacturer = excluded.manufacturer,
           canonical_model = excluded.canonical_model,
           series = excluded.series,
           release_year = excluded.release_year
         WHERE hardware_models.manufacturer IS NOT excluded.manufacturer
            OR hardware_models.canonical_model IS NOT excluded.canonical_model
            OR hardware_models.series IS NOT excluded.series
            OR hardware_models.release_year IS NOT excluded.release_year`,
        [item.category, item.manufacturer, item.canonicalModel, normalizedModel, item.series, item.releaseYear]
      );
      const model = await runQueryOne(
        'SELECT id FROM hardware_models WHERE category = ? AND normalized_model = ?',
        [item.category, normalizedModel]
      );
      const pricingItem = item.category === 'gpu' && item.manufacturer === 'AMD'
        ? amdGpuPricingModels.find(candidate => candidate.canonicalModel === item.canonicalModel)
        : null;
      const aliases = [
        item.canonicalModel,
        `${item.manufacturer} ${item.canonicalModel}`,
        ...(pricingItem ? pricingItem.aliases : [])
      ];
      for (const alias of aliases) {
        await runUpdate(
          `INSERT OR IGNORE INTO hardware_model_aliases
           (hardware_model_id, alias, normalized_alias) VALUES (?, ?, ?)`,
          [model.id, alias, normalizeHardwareText(alias)]
        );
      }
    }

    for (const item of amdGpuPricingModels) {
      const model = await runQueryOne(
        'SELECT id FROM hardware_models WHERE category = ? AND normalized_model = ?',
        ['gpu', normalizeHardwareText(item.canonicalModel)]
      );
      if (!model) throw new Error(`找不到 AMD 顯示卡型號：${item.canonicalModel}`);
      await runUpdate(
        `INSERT INTO hardware_gpu_pricing_models
         (hardware_model_id, generation, vram_gb, launch_price_ntd, floor_price_ntd,
          latest_generation, landing_coefficient, market_factor, model_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hardware_model_id) DO UPDATE SET
           generation = excluded.generation,
           vram_gb = excluded.vram_gb,
           launch_price_ntd = excluded.launch_price_ntd,
           floor_price_ntd = excluded.floor_price_ntd,
           latest_generation = excluded.latest_generation,
           landing_coefficient = excluded.landing_coefficient,
           market_factor = excluded.market_factor,
           model_version = excluded.model_version
         WHERE hardware_gpu_pricing_models.generation IS NOT excluded.generation
            OR hardware_gpu_pricing_models.vram_gb IS NOT excluded.vram_gb
            OR hardware_gpu_pricing_models.launch_price_ntd IS NOT excluded.launch_price_ntd
            OR hardware_gpu_pricing_models.floor_price_ntd IS NOT excluded.floor_price_ntd
            OR hardware_gpu_pricing_models.latest_generation IS NOT excluded.latest_generation
            OR hardware_gpu_pricing_models.landing_coefficient IS NOT excluded.landing_coefficient
            OR hardware_gpu_pricing_models.market_factor IS NOT excluded.market_factor
            OR hardware_gpu_pricing_models.model_version IS NOT excluded.model_version`,
        [
          model.id, item.generation, item.vramGb, item.launchPriceNtd, item.floorPriceNtd,
          item.latestGeneration, item.landingCoefficient, item.marketFactor, item.modelVersion
        ]
      );
    }

    await runUpdate('DELETE FROM hardware_cpu_pricing_models');
    for (const item of intelCpuPricingModels) {
      const model = await runQueryOne(
        'SELECT id FROM hardware_models WHERE category = ? AND normalized_model = ?',
        ['cpu', normalizeHardwareText(item.canonicalModel)]
      );
      if (!model) throw new Error(`找不到 Intel CPU 型號：${item.canonicalModel}`);
      await runUpdate(
        `INSERT INTO hardware_cpu_pricing_models
         (hardware_model_id, reference_price_ntd, source_name, source_url, source_checked_at)
         VALUES (?, ?, ?, ?, ?)`,
        [model.id, item.referencePriceNtd, item.sourceName, item.sourceUrl, item.sourceCheckedAt]
      );
    }

    for (const [canonicalBrand, aliases] of Object.entries(brandAliases)) {
      for (const alias of aliases) {
        await runUpdate(
          `INSERT INTO hardware_brand_aliases
           (canonical_brand, alias, normalized_alias) VALUES (?, ?, ?)
           ON CONFLICT(normalized_alias) DO UPDATE SET
             canonical_brand = excluded.canonical_brand,
             alias = excluded.alias
           WHERE hardware_brand_aliases.canonical_brand IS NOT excluded.canonical_brand
              OR hardware_brand_aliases.alias IS NOT excluded.alias`,
          [canonicalBrand, alias, normalizeHardwareText(alias)]
        );
      }
    }

    for (const rule of warrantyRules) {
      await runUpdate(
        `INSERT INTO hardware_warranty_rules
         (rule_key, category, brand, match_type, match_value, warranty_type,
          base_months, extension_months, registration_required, valid_from,
          valid_to, priority, source_url, source_checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(rule_key) DO UPDATE SET
           category = excluded.category,
           brand = excluded.brand,
           match_type = excluded.match_type,
           match_value = excluded.match_value,
           warranty_type = excluded.warranty_type,
           base_months = excluded.base_months,
           extension_months = excluded.extension_months,
           registration_required = excluded.registration_required,
           valid_from = excluded.valid_from,
           valid_to = excluded.valid_to,
           priority = excluded.priority,
           source_url = excluded.source_url,
           source_checked_at = excluded.source_checked_at
         WHERE hardware_warranty_rules.category IS NOT excluded.category
            OR hardware_warranty_rules.brand IS NOT excluded.brand
            OR hardware_warranty_rules.match_type IS NOT excluded.match_type
            OR hardware_warranty_rules.match_value IS NOT excluded.match_value
            OR hardware_warranty_rules.warranty_type IS NOT excluded.warranty_type
            OR hardware_warranty_rules.base_months IS NOT excluded.base_months
            OR hardware_warranty_rules.extension_months IS NOT excluded.extension_months
            OR hardware_warranty_rules.registration_required IS NOT excluded.registration_required
            OR hardware_warranty_rules.valid_from IS NOT excluded.valid_from
            OR hardware_warranty_rules.valid_to IS NOT excluded.valid_to
            OR hardware_warranty_rules.priority IS NOT excluded.priority
            OR hardware_warranty_rules.source_url IS NOT excluded.source_url
            OR hardware_warranty_rules.source_checked_at IS NOT excluded.source_checked_at`,
        [
          rule.key, rule.category, rule.brand || null, rule.matchType, rule.matchValue || null,
          rule.warrantyType, rule.baseMonths ?? null, rule.extensionMonths || 0,
          rule.registrationRequired ? 1 : 0, rule.validFrom || null, rule.validTo || null,
          rule.priority, rule.sourceUrl || null, '2026-08-31'
        ]
      );
    }
    await seedImportedReferencePrices(runUpdate);
    await runUpdate('COMMIT');
  } catch (error) {
    await runUpdate('ROLLBACK');
    throw error;
  }
}

async function normalizeBrand(value) {
  const normalized = normalizeHardwareText(value);
  if (!normalized) return '';
  const alias = await runQueryOne(
    'SELECT canonical_brand FROM hardware_brand_aliases WHERE normalized_alias = ?',
    [normalized]
  );
  return alias ? alias.canonical_brand : String(value || '').trim();
}

function formatModel(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    manufacturer: row.manufacturer,
    canonicalModel: row.canonical_model,
    series: row.series,
    releaseYear: row.release_year
  };
}

async function findHardwareModel({ category, modelId, model }) {
  if (modelId) {
    return formatModel(await runQueryOne(
      'SELECT * FROM hardware_models WHERE id = ? AND category = ?',
      [Number(modelId), category]
    ));
  }

  const normalized = normalizeHardwareText(model);
  if (!normalized) return null;
  let row = await runQueryOne(
    `SELECT DISTINCT hm.* FROM hardware_models hm
     LEFT JOIN hardware_model_aliases hma ON hma.hardware_model_id = hm.id
     WHERE hm.category = ? AND (hm.normalized_model = ? OR hma.normalized_alias = ?)
     LIMIT 1`,
    [category, normalized, normalized]
  );
  if (row) return formatModel(row);

  const candidates = await runQuery('SELECT * FROM hardware_models WHERE category = ?', [category]);
  row = candidates
    .filter((candidate) => normalized.includes(candidate.normalized_model))
    .sort((a, b) => b.normalized_model.length - a.normalized_model.length)[0];
  return formatModel(row);
}

async function findGpuPricingModel(model) {
  if (!model || model.category !== 'gpu' || model.manufacturer !== 'AMD') return null;
  const row = await runQueryOne(
    'SELECT * FROM hardware_gpu_pricing_models WHERE hardware_model_id = ?',
    [model.id]
  );
  if (!row) return null;
  return {
    generation: row.generation,
    vramGb: row.vram_gb,
    launchPriceNtd: row.launch_price_ntd,
    floorPriceNtd: row.floor_price_ntd,
    latestGeneration: row.latest_generation,
    landingCoefficient: row.landing_coefficient,
    marketFactor: row.market_factor,
    modelVersion: row.model_version
  };
}

async function findCpuPricingModel(model) {
  if (!model || model.category !== 'cpu' || model.manufacturer !== 'Intel') return null;
  const row = await runQueryOne(
    'SELECT * FROM hardware_cpu_pricing_models WHERE hardware_model_id = ?',
    [model.id]
  );
  if (!row) return null;
  return {
    referencePriceNtd: row.reference_price_ntd,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    sourceCheckedAt: row.source_checked_at
  };
}

async function findReferencePrice(model) {
  if (!model) return null;
  if (model.category === 'motherboard') {
    const rows = await runQuery('SELECT * FROM hardware_motherboard_base_prices');
    const row = rows.find(r => normalizeHardwareText(`${r.platform} ${r.chipset}`) === normalizeHardwareText(model.canonicalModel));
    return row ? { priceNtd: row.base_price_ntd, basis: 'chipset_base', source: row.source_file, notes: row.price_basis } : null;
  }
  const rows = await runQuery("SELECT * FROM hardware_reference_prices WHERE category = ? AND offer_type = 'standalone' ORDER BY imported_at DESC", [model.category]);
  const row = rows.find(r => r.brand === model.manufacturer &&
    [r.model, `${r.brand} ${r.model}`].some(name => normalizeHardwareText(name) === normalizeHardwareText(model.canonicalModel)));
  return row ? { priceNtd: row.price_ntd, basis: 'reference', source: row.source_file, notes: row.notes } : null;
}

async function resolveWarranty({ category, brand, model, elapsedMonths = 0, extensionRegistered = 'unknown' }) {
  const canonicalBrand = await normalizeBrand(brand || (model && model.manufacturer));
  const rules = await runQuery(
    'SELECT * FROM hardware_warranty_rules WHERE category = ? ORDER BY priority DESC',
    [category]
  );
  const normalizedModel = normalizeHardwareText(model && model.canonicalModel);
  const normalizedSeries = normalizeHardwareText(model && model.series);

  const rule = rules.find((candidate) => {
    if (!model && candidate.match_type !== 'category_default') return false;
    if (candidate.brand && candidate.brand !== canonicalBrand) return false;
    if (candidate.match_type === 'exact_model') {
      return normalizedModel === normalizeHardwareText(candidate.match_value);
    }
    if (candidate.match_type === 'series') {
      return normalizedSeries.startsWith(normalizeHardwareText(candidate.match_value));
    }
    if (candidate.match_type === 'brand_category') return true;
    return candidate.match_type === 'category_default';
  });

  const elapsed = Math.max(0, Number(elapsedMonths) || 0);
  const appliesExtension = Boolean(rule.registration_required && extensionRegistered === 'yes');
  const totalMonths = rule.warranty_type === 'months'
    ? Number(rule.base_months || 0) + (appliesExtension ? Number(rule.extension_months || 0) : 0)
    : null;
  const remainingMonths = totalMonths === null ? null : Math.max(totalMonths - elapsed, 0);

  return {
    type: rule.warranty_type,
    baseMonths: rule.base_months,
    extensionMonths: rule.extension_months,
    totalMonths,
    elapsedMonths: elapsed,
    remainingMonths,
    expiredByMonths: totalMonths === null ? null : Math.max(elapsed - totalMonths, 0),
    isExpired: totalMonths === null ? false : elapsed > totalMonths,
    extensionAvailable: Boolean(rule.extension_months),
    registrationRequired: Boolean(rule.registration_required),
    registrationApplied: appliesExtension,
    matchLevel: model ? rule.match_type : 'category_default',
    sourceUrl: rule.source_url || null,
    checkedAt: rule.source_checked_at || null,
    note: rule.warranty_type === 'limited_lifetime'
      ? '有限終身保固，實際資格以原廠條款為準。'
      : '保固為規則推定，最終以序號、發票與原廠判定為準。'
  };
}

const HardwareCatalog = {
  async searchModels({ category, brand, query, limit = 8 }) {
    const normalizedQuery = normalizeHardwareText(query);
    if (!['cpu', 'gpu', 'motherboard'].includes(category) || !normalizedQuery) return [];
    const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
    const rows = await runQuery(
      `SELECT DISTINCT hm.* FROM hardware_models hm
       LEFT JOIN hardware_model_aliases hma ON hma.hardware_model_id = hm.id
       WHERE hm.category = ?
         AND (hm.normalized_model LIKE ? OR hma.normalized_alias LIKE ?
              OR ? LIKE '%' || hm.normalized_model || '%'
              OR ? LIKE '%' || hma.normalized_alias || '%')
       ORDER BY CASE WHEN hm.normalized_model LIKE ? OR hma.normalized_alias LIKE ? THEN 0 ELSE 1 END,
                hm.release_year DESC, hm.canonical_model ASC
       LIMIT ?`,
      [
        category,
        `%${normalizedQuery}%`,
        `%${normalizedQuery}%`,
        normalizedQuery,
        normalizedQuery,
        `%${normalizedQuery}%`,
        `%${normalizedQuery}%`,
        safeLimit
      ]
    );
    return Promise.all(rows.map(async (row) => {
      const item = formatModel(row);
      item.warranty = await resolveWarranty({ category, brand, model: item, elapsedMonths: 0 });
      item.gpuPricing = await findGpuPricingModel(item);
      item.cpuPricing = await findCpuPricingModel(item);
      item.referencePrice = await findReferencePrice(item);
      return item;
    }));
  },

  async resolveValuationInput(input) {
    const model = await findHardwareModel(input);
    const gpuPricing = await findGpuPricingModel(model);
    const cpuPricing = await findCpuPricingModel(model);
    const referencePrice = await findReferencePrice(model);
    const warranty = await resolveWarranty({
      category: input.category,
      brand: input.brand,
      model,
      elapsedMonths: input.elapsedMonths,
      extensionRegistered: input.extensionRegistered
    });
    return {
      model,
      gpuPricing,
      cpuPricing,
      referencePrice,
      warranty,
      canonicalBrand: await normalizeBrand(input.brand || (model && model.manufacturer))
    };
  }
};

module.exports = {
  initDatabase,
  runQuery,
  runQueryOne,
  runUpdate,
  HardwareCatalog,
  normalizeHardwareText
};
