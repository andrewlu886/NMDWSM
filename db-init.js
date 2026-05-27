const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'public', 'nmdwsm.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ 連接數據庫失敗:', err.message);
    process.exit(1);
  }
});

console.log('📊 開始初始化 SQLite 數據庫...\n');

// 啟用外鍵支援
db.run('PRAGMA foreign_keys = ON');

// 創建所有表
const createTables = () => {
  const queries = [
    // 1. 用戶表
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      role TEXT DEFAULT 'buyer',
      real_name TEXT,
      phone TEXT,
      city TEXT,
      avatar_url TEXT,
      reputation_score REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,
    
    // 2. 商品表
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      price REAL NOT NULL,
      condition TEXT,
      images TEXT,
      status TEXT DEFAULT 'active',
      burn_in_status TEXT DEFAULT 'untested',
      tested_at DATETIME,
      price_estimate REAL,
      views INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    
    // 3. 論壇文章表
    `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    
    // 4. 交易表
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      buyer_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      price REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_method TEXT,
      delivery_method TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
    );`,

    // 5. 燒機測試紀錄表
    `CREATE TABLE IF NOT EXISTS burn_in_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      tested_by INTEGER,
      test_type TEXT,
      model TEXT,
      serial_number TEXT,
      test_start DATETIME,
      test_end DATETIME,
      duration_minutes INTEGER,
      temperature_max REAL,
      temperature_avg REAL,
      power_avg REAL,
      stability_score REAL,
      error_count INTEGER DEFAULT 0,
      metrics_json TEXT,
      price_prediction REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
      FOREIGN KEY (tested_by) REFERENCES users(id) ON DELETE SET NULL
    );`,
    
    // 6. 評價表
    `CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reviewer_id INTEGER NOT NULL,
      reviewed_user_id INTEGER NOT NULL,
      transaction_id INTEGER,
      rating INTEGER,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    );`,
    
    // 6. 評論表
    `CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );`
  ];

  queries.forEach(query => {
    db.run(query, (err) => {
      if (err) console.error('❌ 創建表失敗:', err.message);
    });
  });

  console.log('✅ 已創建 users、products、posts、transactions、burn_in_records、reviews、comments 表');
};

function ensureColumn(table, column, definition) {
  db.all(`PRAGMA table_info(${table})`, (err, rows) => {
    if (err) {
      console.error(`❌ 檢查 ${table} 欄位失敗:`, err.message);
      return;
    }
    const exists = rows.some(row => row.name === column);
    if (!exists) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`, (err) => {
        if (err) {
          console.error(`❌ 新增 ${table}.${column} 失敗:`, err.message);
        } else {
          console.log(`✅ 已新增 ${table}.${column}`);
        }
      });
    }
  });
}

function migrateSchema() {
  ensureColumn('users', 'role', "role TEXT DEFAULT 'buyer'");
  ensureColumn('products', 'burn_in_status', "burn_in_status TEXT DEFAULT 'untested'");
  ensureColumn('products', 'tested_at', 'tested_at DATETIME');
  ensureColumn('products', 'price_estimate', 'price_estimate REAL');
}

// 插入測試數據
const insertTestData = () => {
  console.log('\n📝 插入測試數據...');

  // 插入用戶
  db.run(
    `INSERT OR IGNORE INTO users (email, password, username, real_name, city, reputation_score, role) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['test@example.com', '12345678', '硬體新手', '王小明', '台北', 4.5, 'buyer'],
    function(err) { if (!err) console.log('✅ 已插入測試用戶 1'); }
  );

  db.run(
    `INSERT OR IGNORE INTO users (email, password, username, real_name, city, reputation_score, role) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['seller@example.com', 'password123', '商家小王', '王小王', '台北', 4.8, 'seller'],
    function(err) { if (!err) console.log('✅ 已插入賣家用戶'); }
  );

  db.run(
    `INSERT OR IGNORE INTO users (email, password, username, real_name, city, reputation_score, role) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['buyer@example.com', 'buyer123', '李小華', '李小華', '新竹', 4.2, 'buyer'],
    function(err) { if (!err) console.log('✅ 已插入買家用戶'); }
  );

  // 插入商品
  db.run(
    `INSERT OR IGNORE INTO products (seller_id, title, description, category, price, condition, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [2, 'RTX 3060 8GB 二手', '使用三年，運行穩定，附原盒', 'GPU', 6000, 'good', 'active'],
    function(err) { if (!err) console.log('✅ 已插入測試商品 1'); }
  );

  db.run(
    `INSERT OR IGNORE INTO products (seller_id, title, description, category, price, condition, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [2, 'i7-10700K CPU', '無超頻，保修中', 'CPU', 8000, 'excellent', 'active'],
    function(err) { if (!err) console.log('✅ 已插入測試商品 2'); }
  );

  // 插入論壇文章
  db.run(
    `INSERT OR IGNORE INTO posts (author_id, title, content, category) 
     VALUES (?, ?, ?, ?)`,
    [1, '大家覺得現在買二手 RTX 3060 划算嗎？', '目前預算大約 6000 左右，主要玩特戰英豪跟一些 3A 遊戲，想請問這個價位帶收 3060 還是捏一點上 4060 比較好？', '硬體討論'],
    function(err) { if (!err) console.log('✅ 已插入測試文章 1'); }
  );

  db.run(
    `INSERT OR IGNORE INTO posts (author_id, title, content, category) 
     VALUES (?, ?, ?, ?)`,
    [1, '[閒聊] 關於平台的硬體驗證功能', '覺得這個功能滿實用的，尤其是自動抓 GPU-Z 數據，可以防範不少礦卡。期待之後能加入 CPU 的壓力測試！', '平台建議'],
    function(err) { if (!err) console.log('✅ 已插入測試文章 2'); }
  );

  // 插入示範燒機測試數據
  db.run(
    `INSERT OR IGNORE INTO burn_in_records (
       product_id, tested_by, test_type, model, serial_number, test_start, test_end,
       duration_minutes, temperature_max, temperature_avg, power_avg,
       stability_score, error_count, metrics_json, price_prediction, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [1, 2, 'gpu', 'RTX 3060', 'SN12345678', new Date(Date.now() - 86400000).toISOString(), new Date().toISOString(), 1440, 82.5, 68.3, 185.2, 92.5, 0, JSON.stringify({ idleTemp: 38, loadTemp: 82.5, avgPower: 185.2, frameStability: 99.8 }), 6200, '三天連續燒機，測試結果良好'],
    function(err) { if (!err) console.log('✅ 已插入示範燒機測試數據'); }
  );
};

// 執行初始化
createTables();
migrateSchema();
insertTestData();

// 延遲關閉連接，確保所有語句完成
setTimeout(() => {
  db.close((err) => {
    if (err) console.error('❌ 關閉數據庫失敗:', err.message);
    else {
      console.log('\n✨ 數據庫初始化完成！');
      console.log(`📁 數據庫位置: ${DB_PATH}`);
    }
  });
}, 1000);
