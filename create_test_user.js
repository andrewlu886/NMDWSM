const db = require('./public/db.js');

(async () => {
  try {
    await db.initDatabase();
    const user = await db.User.findByEmail('test@example.com');
    if (user) {
      console.log('user exists:', user.email);
      process.exit(0);
    }
    const res = await db.User.create({ email: 'test@example.com', password: '12345678', username: 'testuser', real_name: '測試', phone: '', city: '' });
    console.log('created user', res);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
