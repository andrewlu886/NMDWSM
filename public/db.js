const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

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
        chain.then(() => resolve(db)).catch(reject);
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

module.exports = {
  initDatabase,
  runQuery,
  runQueryOne,
  runUpdate,
  User,
  Post,
  Comment,
  Stats
};
