const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
function createAiGateway({ token, ollamaUrl = 'http://127.0.0.1:11434', maxConcurrent = 2, timeoutMs = 120000, fetchImpl = fetch, pttSearch = keyword => require('../src/services/used-search').searchPttDirect(keyword) } = {}) {
  if (!token || token.length < 32) throw new Error('AI_GATEWAY_TOKEN 必須至少 32 字元；請先執行 npm run ai:setup。');
  const upstream = new URL(ollamaUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(upstream.hostname) || upstream.username || upstream.password || upstream.search || upstream.hash) throw new Error('轉接服務只能連線到本機 Ollama。');
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('轉接服務的並行數或逾時設定不正確。');
  const expected = crypto.createHash('sha256').update('Bearer ' + token).digest();
  let active = 0;
  let pttActive = 0;
  const pttCache = new Map();
  const send = (res, status, message) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify({error:message})); };
  return http.createServer(async (req, res) => {
    const received = crypto.createHash('sha256').update(String(req.headers.authorization || '')).digest();
    if (!crypto.timingSafeEqual(expected, received)) return send(res,401,'驗證失敗。');
    if (req.method === 'POST' && req.url === '/api/ptt/search') {
      if (pttActive >= 2) return send(res,503,'PTT 查詢忙碌中，請稍後重試。');
      pttActive++;
      try {
        const chunks = []; let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 2048) return send(res,413,'查詢內容過大。');
          chunks.push(chunk);
        }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return send(res,400,'請提供 JSON 查詢。'); }
        if (typeof data?.keyword !== 'string' || !data.keyword.trim() || data.keyword.trim().length > 80 || Object.keys(data).some(key => key !== 'keyword')) return send(res,400,'請提供 1 至 80 字的關鍵字。');
        const keyword = data.keyword.normalize('NFKC').trim();
        const cached = pttCache.get(keyword);
        const result = cached && Date.now() - cached.time < 60000 ? cached.result : await pttSearch(keyword);
        if (!cached || result !== cached.result) {
          if (pttCache.size >= 50) pttCache.delete(pttCache.keys().next().value);
          pttCache.set(keyword, { time: Date.now(), result });
        }
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        res.end(JSON.stringify(result));
      } catch { if (!res.destroyed) send(res,502,'本機無法讀取 PTT，請稍後再試。'); }
      finally { pttActive--; }
      return;
    }
    const isChat = req.method === 'POST' && req.url === '/api/chat';
    if (!(req.method === 'GET' && req.url === '/api/tags') && !isChat) return send(res,404,'不支援此操作。');
    if (active >= maxConcurrent) return send(res,503,'AI 忙碌中，請稍後重試。');
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close',onClose);
    try {
      let body;
      if (isChat) {
        const chunks=[];let length=0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 3000000) return send(res,413,'訊息或圖片過大。');
          chunks.push(chunk);
        }
        let data;
        try { data=JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return send(res,400,'請提供 JSON 訊息。'); }
        if (!data || !['llama3.1:8b','gemma3:4b'].includes(data.model) || !Array.isArray(data.messages)) return send(res,400,'模型或訊息格式不正確。');
        if (data.stream === true) return send(res,400,'此服務使用完整回覆模式。');
        body=JSON.stringify({...data,stream:false});
      }
      const response=await fetchImpl(ollamaUrl.replace(/\/+$/, '') + req.url, {
        method:req.method, headers:isChat?{'Content-Type':'application/json'}:undefined,
        body, signal:controller.signal, redirect:'error'
      });
      const data=await response.json();
      if (!response.ok) return send(res,response.status,'本機模型未能完成請求。');
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(data));
    } catch { if (!res.destroyed) send(res, controller.signal.aborted ? 504 : 502,'AI 服務暫時無法回應。'); }
    finally {clearTimeout(timer);res.off('close',onClose);active--;}
  });
}
if (require.main === module) {
  require('dotenv').config({path:path.resolve(__dirname,'../.env.ai-gateway'),quiet:true});
  try {
    const server=createAiGateway({token:process.env.AI_GATEWAY_TOKEN,ollamaUrl:process.env.AI_GATEWAY_OLLAMA_URL,maxConcurrent:Number(process.env.AI_GATEWAY_MAX_CONCURRENT || 2),timeoutMs:Number(process.env.AI_GATEWAY_TIMEOUT_MS || 120000)});
    server.listen(Number(process.env.AI_GATEWAY_PORT || 11435),'127.0.0.1',()=>console.log('AI 轉接服務已啟動：http://127.0.0.1:'+(process.env.AI_GATEWAY_PORT || 11435)));
  } catch (error) {console.error(error.message);process.exitCode=1;}
}
module.exports={createAiGateway};
