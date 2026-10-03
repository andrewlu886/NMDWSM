const DOMAIN = /電腦|硬體|零件|顯卡|顯示卡|處理器|主機板|記憶體|硬碟|電源|電供|瓦數|散熱|內顯|筆電|桌機|主機|組裝|裝機|配電腦|估價|市價|行情|預算|保固|跑分|遊戲效能|\b(?:cpu|gpu|ssd|hdd|ram|ddr[3-6]|psu|rtx|gtx|radeon|ryzen|geforce|intel|amd|nvidia|i[3579]|core\s*ultra|kingston|crucial|thinkpad|macbook)\b/i;
const MODEL = /\b(?:RTX|GTX|RX)\s*\d{3,4}(?:\s*(?:TI|SUPER|XT|XTX|GRE))?\b|\bi[3579][-\s]*\d{4,5}[a-z]{0,3}\b|\b(?:Ryzen\s*)?[3579][-\s]+\d{4}[a-z\d]{0,5}\b|\b(?:B|Z|X|H)\d{3}\b|\bDDR[3-6]\b|\b(?:Core\s*Ultra\s*)?[3579]?\s*\d{3}[KVF]\b/i;
const BARE_MODEL = /^(?:[3-9]\d{3}(?:\s*(?:TI|SUPER|XT|XTX|GRE))?|\d{3}[KVF])$/i;
const BOUNDARY_REPLY = '這題姐姐比較幫不上忙唷～我主要協助電腦硬體、市價、二手估價、配置推薦與瓦數計算。告訴我想查的零件或完整型號，我們再一起看。';
function related(text) {
  const value = String(text || '').normalize('NFKC').trim();
  return DOMAIN.test(value) || MODEL.test(value) || BARE_MODEL.test(value);
}
function getScopeReply(text, previous = []) {
  const value = String(text || '').normalize('NFKC').trim();
  if (value.length > 2000) return '這段訊息有點長，請先用 2,000 字以內描述硬體型號、預算與想解決的問題，我們一步一步處理。';
  if (related(value) || /^(?:請|我要|幫我)?(?:查詢|搜尋|查)(?:產品|商品|市價|價格)?[?？。!！]*$/.test(value)) return null;
  const previousUser = [...previous].reverse().filter(message => message.role === 'user').slice(0, 3).find(message => related(message.content));
  const shortFollowup = value.length <= 100 && /^(?:好|可以|是|對|沒錯|請查|查吧|幫我查|不要|不對|不合理|重新查|更正|改成|不是|\d|遊戲|文書|剪輯|直播|面交|寄送|風冷|水冷|標準|高階|ITX|ATX)/i.test(value);
  if (shortFollowup && previousUser && related(previousUser.content)) return null;
  return BOUNDARY_REPLY;
}
function validMarketKeyword(keyword) {
  const value = String(keyword || '').normalize('NFKC').trim();
  if (!value || value.length > 100 || !related(value)) return false;
  if (/\bi[3579]\b/i.test(value) && !/\bi[3579][-\s]*\d{4,5}/i.test(value)) return false;
  return true;
}
function matchesMarketProduct(item, keyword) {
  const compact = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, '');
  const title = compact(item?.name);
  const queryModels = [...String(keyword || '').matchAll(new RegExp(MODEL.source, 'gi'))].map(match => compact(match[0]));
  const titleModels = [...String(item?.name || '').matchAll(new RegExp(MODEL.source, 'gi'))].map(match => compact(match[0]));
  if (queryModels.some(model => !titleModels.includes(model))) return false;
  // A matching generation is not sufficient: every requested token must match.
  return String(keyword || '').normalize('NFKC').trim().split(/\s+/).filter(Boolean)
    .every(token => title.includes(compact(token)));
}
function pruneHardwareHistory(messages, keepLast = false) {
  const result = [];
  let keepAssistant = false;
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      keepAssistant = (keepLast && index === messages.length - 1) || !getScopeReply(message.content, result);
      if (keepAssistant) result.push(message);
    } else if (keepAssistant) result.push(message);
  });
  return result;
}
module.exports = { related, getScopeReply, validMarketKeyword, matchesMarketProduct, pruneHardwareHistory };