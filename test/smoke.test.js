const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdwsm-smoke-'));
const port = 3210;
const baseUrl = `http://localhost:${port}`;
let server;
let serverError = '';

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
    ...options
  });
}

async function jsonRequest(method, pathname, body) {
  return request(pathname, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test.before(async () => {
  server = spawn(process.execPath, ['public/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tempRoot, 'smoke.db')
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  server.stderr.on('data', chunk => { serverError += chunk.toString(); });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early: ${serverError}`);
    try {
      const response = await request('/');
      if (response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${serverError}`);
});

test.after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
});

test('保留的網站頁面可以開啟', async () => {
  for (const pathname of ['/', '/login', '/account.html', '/forum', '/scrape', '/benchmark-instructions.html']) {
    const response = await request(pathname);
    assert.equal(response.status, 200, pathname);
  }
});

test('帳號與論壇流程可以完成', async () => {
  const email = 'smoke@example.com';
  let response = await jsonRequest('POST', '/api/register', {
    name: 'Smoke User', email, password: '12345678', confirmPassword: '12345678'
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', '/api/login', { email, password: '12345678' });
  assert.equal(response.status, 200);

  response = await jsonRequest('PUT', '/api/account/name', { userEmail: email, username: 'Smoke Renamed' });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', '/api/posts', {
    title: 'Smoke Post', content: 'Smoke content', author: email, category: '一般討論', images: []
  });
  assert.equal(response.status, 200);
  const { post_id: postId } = await response.json();

  response = await jsonRequest('POST', `/api/posts/${postId}/replies`, {
    content: 'Smoke reply', author: email, images: []
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('PUT', `/api/posts/${postId}`, {
    title: 'Smoke Edited', content: 'Edited content', images: []
  });
  assert.equal(response.status, 200);

  response = await request(`/api/account/stats?userEmail=${encodeURIComponent(email)}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { posts: 1 });

  response = await request(`/api/posts/${postId}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
});

test('舊交易頁面導回首頁', async () => {
  for (const pathname of ['/marketplace', '/seller', '/cart', '/checkout', '/transactions', '/products.html']) {
    const response = await request(pathname);
    assert.equal(response.status, 302, pathname);
    assert.equal(response.headers.get('location'), '/');
  }
});

test('舊交易 API 與商品圖片無法存取', async () => {
  for (const pathname of ['/api/products', '/api/favorites', '/api/cart', '/api/transactions', '/uploads/products/57/example.webp']) {
    const response = await request(pathname);
    assert.equal(response.status, 404, pathname);
  }
  assert.equal((await request('/does-not-exist')).status, 404);
  assert.equal((await request('/api/scrape')).status, 400);
});
