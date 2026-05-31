const axios = require('axios');

(async () => {
  try {
    const payload = {
      seller: 'test@example.com',
      title: 'RAM 測試 via script',
      category: 'ram',
      price: '500',
      desc: '測試 RAM log',
      image: '',
      benchmarkLog: `Read : 5000\nWrite : 3000\nCombined : 4000`
    };
    const res = await axios.post('http://localhost:3000/api/products', payload, { headers: { 'Content-Type': 'application/json' } });
    console.log('STATUS', res.status);
    console.log(res.data);
  } catch (err) {
    if (err.response) {
      console.error('ERR STATUS', err.response.status);
      console.error(err.response.data);
    } else {
      console.error(err.message);
    }
  }
})();
