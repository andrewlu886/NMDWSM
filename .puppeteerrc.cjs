const path = require('path');

module.exports = process.env.RENDER
  ? { cacheDirectory: path.join(__dirname, 'node_modules', '.cache', 'puppeteer') }
  : {};
