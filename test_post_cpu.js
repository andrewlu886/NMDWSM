const axios = require('axios');

(async () => {
  try {
    const payload = {
      seller: 'test@example.com',
      title: 'CPU 測試 via script',
      category: 'cpu',
      price: '1000',
      desc: '測試 CPU log',
      image: '',
      benchmarkLog: `1 threads, SSE : 100
12 threads, SSE : 1200
1 threads, AVX : 110
12 threads, AVX : 1300`
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
