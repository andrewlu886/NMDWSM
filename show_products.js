const db = require('./public/db.js');

(async () => {
  await db.initDatabase();
  const p2 = await db.Product.findById(2);
  const p3 = await db.Product.findById(3);
  console.log('P2:', p2);
  console.log('P3:', p3);
})();
