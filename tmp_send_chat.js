(async ()=>{
  try {
    const res = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3211',
        'Referer': 'http://localhost:3211/'
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: '測試 gpt-4o-mini' }] })
    });
    const text = await res.text();
    console.log('STATUS', res.status);
    console.log('BODY', text);
  } catch (e) {
    console.error('REQUEST ERROR', e);
  }
})();