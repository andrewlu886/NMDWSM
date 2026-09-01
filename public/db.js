const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { hardwareModels, brandAliases, warrantyRules, amdGpuPricingModels } = require('../src/data/hardware-catalog');

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
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          username TEXT NOT NULL,
          real_name TEXT,
          phone TEXT,
          city TEXT,
          role TEXT DEFAULT 'member',
          reputation_score INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id INTEGER,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          category TEXT,
          images TEXT,
          views INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (author_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER,
          author_id INTEGER,
          content TEXT NOT NULL,
          images TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts(id),
          FOREIGN KEY (author_id) REFERENCES users(id)
        );

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

        CREATE INDEX IF NOT EXISTS idx_hardware_models_category_normalized
          ON hardware_models(category, normalized_model);
        CREATE INDEX IF NOT EXISTS idx_hardware_aliases_normalized
          ON hardware_model_aliases(normalized_alias);
        CREATE INDEX IF NOT EXISTS idx_warranty_rules_category_priority
          ON hardware_warranty_rules(category, priority DESC);
      `, (initErr) => {
        if (initErr) return reject(initErr);

        const migrations = [
          'ALTER TABLE posts ADD COLUMN images TEXT',
          'ALTER TABLE comments ADD COLUMN images TEXT'
        ];
        let chain = Promise.resolve();
        migrations.forEach((sql) => {
          chain = chain.then(() => new Promise((done) => db.run(sql, () => done())));
        });
        chain.then(seedHardwareCatalog).then(() => resolve(db)).catch(reject);
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
           release_year = excluded.release_year`,
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
           model_version = excluded.model_version`,
        [
          model.id, item.generation, item.vramGb, item.launchPriceNtd, item.floorPriceNtd,
          item.latestGeneration, item.landingCoefficient, item.marketFactor, item.modelVersion
        ]
      );
    }

    for (const [canonicalBrand, aliases] of Object.entries(brandAliases)) {
      for (const alias of aliases) {
        await runUpdate(
          `INSERT INTO hardware_brand_aliases
           (canonical_brand, alias, normalized_alias) VALUES (?, ?, ?)
           ON CONFLICT(normalized_alias) DO UPDATE SET
             canonical_brand = excluded.canonical_brand,
             alias = excluded.alias`,
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
           source_checked_at = excluded.source_checked_at`,
        [
          rule.key, rule.category, rule.brand || null, rule.matchType, rule.matchValue || null,
          rule.warrantyType, rule.baseMonths ?? null, rule.extensionMonths || 0,
          rule.registrationRequired ? 1 : 0, rule.validFrom || null, rule.validTo || null,
          rule.priority, rule.sourceUrl || null, '2026-08-31'
        ]
      );
    }
    await runUpdate('COMMIT');
  } catch (error) {
    await runUpdate('ROLLBACK');
    throw error;
  }
}

const User = {
  findByEmail(email) {
    return runQueryOne('SELECT * FROM users WHERE email = ?', [email]);
  },

  findById(id) {
    return runQueryOne('SELECT * FROM users WHERE id = ?', [id]);
  },

  create(data) {
    return runUpdate(
      `INSERT INTO users (email, password, username, real_name, phone, city)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.email, data.password, data.username, data.real_name, data.phone, data.city]
    );
  },

  updateUsername(userId, username) {
    return runUpdate('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
  }
};

const Post = {
  getAll() {
    return runQuery(`SELECT p.*, u.username AS author_name, u.email AS author_email
                     FROM posts p LEFT JOIN users u ON p.author_id = u.id
                     ORDER BY p.created_at DESC LIMIT 50`);
  },

  findById(id) {
    return runQueryOne(`SELECT p.*, u.username AS author_name, u.email AS author_email
                        FROM posts p LEFT JOIN users u ON p.author_id = u.id
                        WHERE p.id = ?`, [id]);
  },

  create(data) {
    return runUpdate(
      'INSERT INTO posts (author_id, title, content, category, images) VALUES (?, ?, ?, ?, ?)',
      [data.author_id, data.title, data.content, data.category, data.images || null]
    );
  },

  update(id, data) {
    return runUpdate(
      'UPDATE posts SET title = ?, content = ?, images = ? WHERE id = ?',
      [data.title, data.content, data.images || null, id]
    );
  },

  async delete(id) {
    await runUpdate('DELETE FROM comments WHERE post_id = ?', [id]);
    return runUpdate('DELETE FROM posts WHERE id = ?', [id]);
  }
};

const Comment = {
  getByPost(postId) {
    return runQuery(`SELECT c.*, u.username, u.email AS author_email
                     FROM comments c LEFT JOIN users u ON c.author_id = u.id
                     WHERE c.post_id = ? ORDER BY c.created_at ASC`, [postId]);
  },

  create(data) {
    return runUpdate(
      'INSERT INTO comments (post_id, author_id, content, images) VALUES (?, ?, ?, ?)',
      [data.post_id, data.author_id, data.content, data.images || null]
    );
  }
};

const Stats = {
  async getByUser(userId) {
    const posts = await runQueryOne('SELECT COUNT(*) AS count FROM posts WHERE author_id = ?', [userId]);
    return { posts: posts.count };
  }
};

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
    if (!['cpu', 'gpu'].includes(category) || !normalizedQuery) return [];
    const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
    const rows = await runQuery(
      `SELECT DISTINCT hm.* FROM hardware_models hm
       LEFT JOIN hardware_model_aliases hma ON hma.hardware_model_id = hm.id
       WHERE hm.category = ?
         AND (hm.normalized_model LIKE ? OR hma.normalized_alias LIKE ?
              OR ? LIKE '%' || hm.normalized_model || '%'
              OR ? LIKE '%' || hma.normalized_alias || '%')
       ORDER BY CASE WHEN hm.normalized_model LIKE ? THEN 0 ELSE 1 END,
                hm.release_year DESC, hm.canonical_model ASC
       LIMIT ?`,
      [
        category,
        `%${normalizedQuery}%`,
        `%${normalizedQuery}%`,
        normalizedQuery,
        normalizedQuery,
        `${normalizedQuery}%`,
        safeLimit
      ]
    );
    return Promise.all(rows.map(async (row) => {
      const item = formatModel(row);
      item.warranty = await resolveWarranty({ category, brand, model: item, elapsedMonths: 0 });
      item.gpuPricing = await findGpuPricingModel(item);
      return item;
    }));
  },

  async resolveValuationInput(input) {
    const model = await findHardwareModel(input);
    const gpuPricing = await findGpuPricingModel(model);
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
  User,
  Post,
  Comment,
  Stats,
  HardwareCatalog,
  normalizeHardwareText
};
