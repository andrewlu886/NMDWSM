const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'nmdwsm.db');
let db = null;

// 初始化數據庫連接
function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('❌ 連接數據庫失敗:', err.message);
        reject(err);
      } else {
        db.run('PRAGMA foreign_keys = ON');
        
        // 自動建立所有需要的資料表
        const initSql = `
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            username TEXT NOT NULL,
            real_name TEXT,
            phone TEXT,
            city TEXT,
            role TEXT DEFAULT 'buyer',
            reputation_score INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seller_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            price INTEGER NOT NULL,
            condition TEXT,
            image_url TEXT,
            location TEXT,
            usage_tag TEXT,
            negotiable INTEGER DEFAULT 0,
            views INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (seller_id) REFERENCES users(id)
          );

          CREATE TABLE IF NOT EXISTS burn_in_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER,
            tested_by INTEGER,
            test_type TEXT DEFAULT 'unknown',
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
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (tested_by) REFERENCES users(id)
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

          CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER,
            buyer_id INTEGER,
            seller_id INTEGER,
            price INTEGER,
            status TEXT DEFAULT 'pending',
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (buyer_id) REFERENCES users(id),
            FOREIGN KEY (seller_id) REFERENCES users(id)
          );

          CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, product_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS transaction_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            author_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
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

          CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
          );
        `;

        db.exec(initSql, (err) => {
          if (err) {
            console.error('❌ 初始化資料表失敗:', err.message);
            reject(err);
          } else {
            // 自動容錯：嘗試幫舊版資料庫補上 role 欄位 (若欄位已存在會靜默忽略)
            db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'buyer'", () => {});
            db.run("ALTER TABLE products ADD COLUMN image_url TEXT", () => {});
            db.run("ALTER TABLE products ADD COLUMN location TEXT", () => {});
            db.run("ALTER TABLE products ADD COLUMN usage_tag TEXT", () => {});
            db.run("ALTER TABLE products ADD COLUMN negotiable INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE products ADD COLUMN views INTEGER DEFAULT 0", () => {});
            db.run("ALTER TABLE transactions ADD COLUMN note TEXT", () => {});
            db.run(`CREATE TABLE IF NOT EXISTS transaction_comments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              transaction_id INTEGER NOT NULL,
              author_id INTEGER NOT NULL,
              content TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
              FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            )`, () => {});
            db.run("ALTER TABLE posts ADD COLUMN images TEXT", () => {});
            db.run("ALTER TABLE comments ADD COLUMN images TEXT", () => {});
            db.run("ALTER TABLE cart_items ADD COLUMN quantity INTEGER DEFAULT 1", () => {});
            
            console.log('✅ 數據庫連接成功並完成資料表初始化');
            resolve(db);
          }
        });
      }
    });
  });
}

// 執行查詢（返回所有結果）
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// 執行單行查詢
function runQueryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// 執行插入/更新/刪除
function runUpdate(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

// 用戶相關
const User = {
  async findByEmail(email) {
    return runQueryOne('SELECT * FROM users WHERE email = ?', [email]);
  },

  async findById(id) {
    return runQueryOne('SELECT * FROM users WHERE id = ?', [id]);
  },

  async create(data) {
    // 移除 role 的強制寫入，交給資料庫的 DEFAULT 'buyer' 處理，這樣能最大化相容舊版結構
    const sql = `INSERT INTO users (email, password, username, real_name, phone, city) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    return runUpdate(sql, [data.email, data.password, data.username, data.real_name, data.phone, data.city]);
  },

  async updateUsername(userId, username) {
    return runUpdate('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
  },

  async getAll() {
    return runQuery('SELECT id, email, username, real_name, city, reputation_score, role, created_at FROM users LIMIT 50');
  }
};

// 商品相關
const Product = {
  async findById(id) {
    return runQueryOne(`SELECT p.*, u.username as seller_name, u.email as seller_email FROM products p
                       JOIN users u ON p.seller_id = u.id WHERE p.id = ?`, [id]);
  },

  async findBySeller(sellerId) {
    return runQuery(`SELECT * FROM products WHERE seller_id = ?
                    ORDER BY created_at DESC LIMIT 100`, [sellerId]);
  },

  async getActive() {
    return runQuery(`SELECT p.*, u.username as seller_name, u.email as seller_email FROM products p
                    JOIN users u ON p.seller_id = u.id WHERE p.status = 'active'
                    ORDER BY p.created_at DESC LIMIT 50`);
  },

  async create(data) {
    const sql = `INSERT INTO products (
                 seller_id, title, description, category, price, condition,
                 status, image_url, location, usage_tag, negotiable
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return runUpdate(sql, [
      data.seller_id,
      data.title,
      data.description,
      data.category,
      data.price,
      data.condition || 'used',
      data.status || 'active',
      data.image_url || null,
      data.location || '',
      data.usage_tag || '',
      data.negotiable ? 1 : 0
    ]);
  },

  async update(id, data) {
    const sql = `UPDATE products SET
                 title = ?, category = ?, price = ?, description = ?,
                 image_url = ?, condition = ?, location = ?, usage_tag = ?,
                 negotiable = ?, status = ?
                 WHERE id = ?`;
    return runUpdate(sql, [
      data.title,
      data.category,
      data.price,
      data.description || '',
      data.image_url || null,
      data.condition || 'used',
      data.location || '',
      data.usage_tag || '',
      data.negotiable ? 1 : 0,
      data.status || 'active',
      id
    ]);
  },

  async updateStatus(id, sellerId, status) {
    return runUpdate('UPDATE products SET status = ? WHERE id = ? AND seller_id = ?', [status, id, sellerId]);
  },

  async incrementViews(id) {
    return runUpdate('UPDATE products SET views = COALESCE(views, 0) + 1 WHERE id = ?', [id]);
  },

  async search(keyword) {
    return runQuery(`SELECT p.*, u.username as seller_name FROM products p 
                    JOIN users u ON p.seller_id = u.id 
                    WHERE p.status = 'active' AND (p.title LIKE ? OR p.description LIKE ?)
                    ORDER BY p.created_at DESC LIMIT 30`, [`%${keyword}%`, `%${keyword}%`]);
  }
};

// 燒機測試資料
const BurnInRecord = {
  async create(data) {
    const sql = `INSERT INTO burn_in_records (
                 product_id, tested_by, test_type, model, serial_number,
                 test_start, test_end, duration_minutes,
                 temperature_max, temperature_avg, power_avg,
                 stability_score, error_count, metrics_json,
                 price_prediction, notes
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return runUpdate(sql, [
      data.product_id || null,
      data.tested_by || null,
      data.test_type || 'unknown',
      data.model || null,
      data.serial_number || null,
      data.test_start || null,
      data.test_end || null,
      data.duration_minutes || null,
      data.temperature_max || null,
      data.temperature_avg || null,
      data.power_avg || null,
      data.stability_score || null,
      data.error_count || 0,
      data.metrics_json ? JSON.stringify(data.metrics_json) : null,
      data.price_prediction || null,
      data.notes || null
    ]);
  },

  async getByProduct(productId) {
    return runQuery(`SELECT * FROM burn_in_records WHERE product_id = ? ORDER BY created_at DESC`, [productId]);
  },

  async getByUser(userId) {
    return runQuery(`SELECT * FROM burn_in_records WHERE tested_by = ? ORDER BY created_at DESC`, [userId]);
  },

  async getRecent(limit = 50) {
    return runQuery(`SELECT * FROM burn_in_records ORDER BY created_at DESC LIMIT ?`, [limit]);
  }
};

// 論壇文章相關
const Post = {
  async getAll() {
    return runQuery(`SELECT p.*, u.username as author_name, u.email as author_email FROM posts p
                    LEFT JOIN users u ON p.author_id = u.id
                    ORDER BY p.created_at DESC LIMIT 50`);
  },

  async findById(id) {
    return runQueryOne(`SELECT p.*, u.username as author_name, u.email as author_email FROM posts p
                       LEFT JOIN users u ON p.author_id = u.id WHERE p.id = ?`, [id]);
  },

  async create(data) {
    const sql = `INSERT INTO posts (author_id, title, content, category, images)
                 VALUES (?, ?, ?, ?, ?)`;
    return runUpdate(sql, [data.author_id, data.title, data.content, data.category, data.images || null]);
  },

  async update(id, data) {
    const sql = `UPDATE posts SET title = ?, content = ?, images = ? WHERE id = ?`;
    return runUpdate(sql, [data.title, data.content, data.images || null, id]);
  },

  async delete(id) {
    await runUpdate('DELETE FROM comments WHERE post_id = ?', [id]);
    return runUpdate('DELETE FROM posts WHERE id = ?', [id]);
  },

  async addView(id) {
    return runUpdate('UPDATE posts SET views = views + 1 WHERE id = ?', [id]);
  }
};

// 交易相關
const Transaction = {
  async create(data) {
    const sql = `INSERT INTO transactions (product_id, buyer_id, seller_id, price, status, note)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    return runUpdate(sql, [
      data.product_id,
      data.buyer_id,
      data.seller_id,
      data.price,
      data.status || 'pending',
      data.note || ''
    ]);
  },

  async getByBuyer(buyerId) {
    return runQuery(`SELECT t.*, p.title as product_title, p.image_url, u.username as seller_name
                    FROM transactions t
                    JOIN products p ON t.product_id = p.id
                    JOIN users u ON t.seller_id = u.id
                    WHERE t.buyer_id = ? ORDER BY t.created_at DESC`, [buyerId]);
  },

  async getBySeller(sellerId) {
    return runQuery(`SELECT t.*, p.title as product_title, p.image_url, u.username as buyer_name
                    FROM transactions t
                    JOIN products p ON t.product_id = p.id
                    JOIN users u ON t.buyer_id = u.id
                    WHERE t.seller_id = ? ORDER BY t.created_at DESC`, [sellerId]);
  },

  async getByStatus(status) {
    return runQuery(`SELECT t.*, p.title as product_title FROM transactions t 
                    JOIN products p ON t.product_id = p.id 
                    WHERE t.status = ? ORDER BY t.created_at DESC`, [status]);
  },

  async updateStatus(id, userId, status) {
    return runUpdate(
      'UPDATE transactions SET status = ? WHERE id = ? AND (buyer_id = ? OR seller_id = ?)',
      [status, id, userId, userId]
    );
  },

  async findForUser(id, userId) {
    return runQueryOne('SELECT * FROM transactions WHERE id = ? AND (buyer_id = ? OR seller_id = ?)', [id, userId, userId]);
  }
};

const TransactionComment = {
  async getByTransaction(transactionId, userId) {
    const transaction = await Transaction.findForUser(transactionId, userId);
    if (!transaction) return null;

    return runQuery(`SELECT tc.*, u.username as author_name, u.email as author_email
                    FROM transaction_comments tc
                    JOIN users u ON tc.author_id = u.id
                    WHERE tc.transaction_id = ?
                    ORDER BY tc.created_at ASC`, [transactionId]);
  },

  async create(transactionId, userId, content) {
    const transaction = await Transaction.findForUser(transactionId, userId);
    if (!transaction) return null;

    return runUpdate(
      'INSERT INTO transaction_comments (transaction_id, author_id, content) VALUES (?, ?, ?)',
      [transactionId, userId, content]
    );
  }
};

const Favorite = {
  async add(userId, productId) {
    return runUpdate('INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)', [userId, productId]);
  },

  async remove(userId, productId) {
    return runUpdate('DELETE FROM favorites WHERE user_id = ? AND product_id = ?', [userId, productId]);
  },

  async getByUser(userId) {
    return runQuery(`SELECT f.id as favorite_id, p.*, u.username as seller_name
                    FROM favorites f
                    JOIN products p ON f.product_id = p.id
                    JOIN users u ON p.seller_id = u.id
                    WHERE f.user_id = ?
                    ORDER BY f.created_at DESC`, [userId]);
  },

  async exists(userId, productId) {
    return runQueryOne('SELECT id FROM favorites WHERE user_id = ? AND product_id = ?', [userId, productId]);
  }
};

const Stats = {
  async getByUser(userId) {
    const activeProducts = await runQueryOne("SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND status = 'active'", [userId]);
    const soldProducts = await runQueryOne("SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND status = 'sold'", [userId]);
    const posts = await runQueryOne('SELECT COUNT(*) as count FROM posts WHERE author_id = ?', [userId]);
    const favorites = await runQueryOne('SELECT COUNT(*) as count FROM favorites WHERE user_id = ?', [userId]);

    return {
      activeProducts: activeProducts.count,
      soldProducts: soldProducts.count,
      posts: posts.count,
      favorites: favorites.count
    };
  }
};

// 評論相關
const Comment = {
  async getByPost(postId) {
    return runQuery(`SELECT c.*, u.username, u.email as author_email FROM comments c
                    LEFT JOIN users u ON c.author_id = u.id
                    WHERE c.post_id = ? ORDER BY c.created_at ASC`, [postId]);
  },

  async create(data) {
    const sql = `INSERT INTO comments (post_id, author_id, content, images)
                 VALUES (?, ?, ?, ?)`;
    return runUpdate(sql, [data.post_id, data.author_id, data.content, data.images || null]);
  }
};

// 購物車相關
const Cart = {
  async add(userId, productId) {
    // 避免重複將相同商品加入購物車
    const existing = await runQueryOne('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?', [userId, productId]);
    if (existing) {
      return runUpdate('UPDATE cart_items SET quantity = quantity + 1 WHERE id = ?', [existing.id]);
    }
    
    const sql = `INSERT INTO cart_items (user_id, product_id) VALUES (?, ?)`;
    return runUpdate(sql, [userId, productId]);
  },

  async remove(cartItemId, userId) {
    return runUpdate('DELETE FROM cart_items WHERE id = ? AND user_id = ?', [cartItemId, userId]);
  },

  async getByUser(userId) {
    // JOIN products 與 users，這樣前端就能直接顯示商品名稱、價格與賣家名稱
    return runQuery(`
      SELECT c.id as cart_item_id, c.quantity, p.*, u.username as seller_name
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
      JOIN users u ON p.seller_id = u.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `, [userId]);
  },

  async updateQuantity(cartItemId, userId, quantity) {
    if (quantity <= 0) {
      return this.remove(cartItemId, userId);
    }

    return runUpdate('UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?', [quantity, cartItemId, userId]);
  },

  async clear(userId) {
    return runUpdate('DELETE FROM cart_items WHERE user_id = ?', [userId]);
  }
};

module.exports = {
  initDatabase,
  runQuery,
  runQueryOne,
  runUpdate,
  User,
  Product,
  Post,
  Transaction,
  TransactionComment,
  Favorite,
  Stats,
  Comment,
  BurnInRecord,
  Cart
};
