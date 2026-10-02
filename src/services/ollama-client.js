function createOllamaClient(env = process.env, fetchImpl = (...args) => fetch(...args)) {
  const baseUrl = String(env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const token = String(env.OLLAMA_API_KEY || '').trim();
  const clientId = String(env.OLLAMA_CF_ACCESS_CLIENT_ID || '').trim();
  const clientSecret = String(env.OLLAMA_CF_ACCESS_CLIENT_SECRET || '').trim();
  const local = (() => {
    try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname); }
    catch { return false; }
  })();
  async function request(route, options = {}) {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash) throw new Error('AI 服務網址格式不正確。');
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('遠端 AI 服務必須使用 HTTPS。');
    if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error('Cloudflare Access 的 ID 和密鑰必須一起設定。');
    if (!local && !token && !clientId) throw new Error('尚未設定共用 AI 服務的驗證密鑰。');
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (clientId) {
      headers.set('CF-Access-Client-Id', clientId);
      headers.set('CF-Access-Client-Secret', clientSecret);
    }
    return fetchImpl(baseUrl + route, { ...options, headers, redirect: 'error' });
  }
  return { request, serviceMode: local ? 'local' : 'shared' };
}
module.exports = { createOllamaClient };
