const axios = require('axios');
const cheerio = require('cheerio');

const SOURCES = Object.freeze({
  ptt: 'PTT 硬體版',
  carousell: '旋轉拍賣', 'yahoo-auction': 'Yahoo 拍賣'
});
const SOURCE_HOSTS = Object.freeze({
  ptt: 'www.ptt.cc',
  carousell: 'tw.carousell.com', 'yahoo-auction': 'tw.bid.yahoo.com'
});
const SOLD = /已售出|已售|售出|售完|售罄|售畢|已賣出|已成交|暫售|已預訂|已保留|交易中|已下架|停售|撤售|\bsold(?:\s*out)?\b|\breserved\b|\bpending\b/i;
const NEW = /全新|新品|未拆封|未使用|新貨|全新品|\bbrand\s*new\b/i;
const USED = /二手|中古|拆機|自用|使用過|使用中|正常使用|過保|非全新|良品|有使用痕跡|換下|拆下|拆封使用|已拆封|狀況良好|\bused\b|\bpre.?owned\b/i;
const VARIABLE_PRICE = /議價|面議|可優惠|可小議|價格另議|價格可議|價格浮動|私訊報價|私訊詢價|一元起標|競標|出價|依規格|選規格|多款價格|價格區間|\bstarting\s+at\b/i;
const NOT_A_SALE = /回收|囘收|收購|置換|換購|求購|徵求|徵收/;
const HARDWARE = /電腦|筆電|筆記型|主機|顯示卡|顯卡|處理器|主機板|記憶體|硬碟|固態|電源|機殼|散熱|水冷|風扇|螢幕|顯示器|鍵盤|滑鼠|網卡|路由器|交換器|工作站|伺服器|\b(?:cpu|gpu|ssd|hdd|ram|ddr[3-6]|psu|nvme|rtx\s*\d{3,4}(?:\s*(?:ti|super))?|gtx\s*\d{3,4}(?:\s*ti)?|rx\s*\d{3,4}(?:\s*xt)?|ryzen|xeon|threadripper|core\s*(?:ultra|i[3579])|i[3579][-\s]?\d{4,5}|macbook|imac|mac\s*mini|thinkpad|zenbook|vivobook|ideapad|laptop|desktop|notebook|motherboard|monitor|nas)\b/i;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
  'Accept-Language': 'zh-TW,zh;q=0.9'
};
const DETAIL_LIMIT = 12;

function plain(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}
function compact(value) { return plain(value).toLowerCase().replace(/[\s\-_]+/g, ''); }
function matchesKeyword(name, keyword, precise = false) {
  const title = compact(name);
  if (precise) return title.includes(compact(keyword));
  return plain(keyword).split(/\s+/).filter(Boolean).every(word => title.includes(compact(word)));
}
function sold(text) { return SOLD.test(plain(text).replace(/尚未售出|未售出|未售/g, '')); }
function textHtml(value) { return plain(cheerio.load(String(value || ''))('body').text()); }
function fixedPrice(value) {
  const text = plain(value);
  if (VARIABLE_PRICE.test(text) || /\d[\d,]*\s*(?:元|\$)?\s*[-~～至/]\s*(?:NT\$?)?\s*\d/i.test(text)) return null;
  const numbers = [...text.matchAll(/(?:NT\$?|\$|售價[:：]?|價格[:：]?)\s*([\d,]+(?:\.\d+)?)|^([\d,]+(?:\.\d+)?)\s*(?:元)?$/gi)]
    .map(match => Number((match[1] || match[2]).replace(/,/g, '')));
  return numbers.length === 1 && Number.isSafeInteger(numbers[0]) && numbers[0] > 0 ? numbers[0] : null;
}
function safeUrl(source, value) {
  try {
    const url = new URL(value, `https://${SOURCE_HOSTS[source]}`);
    if (url.protocol !== 'https:' || url.hostname !== SOURCE_HOSTS[source] || url.username || url.password) return null;
    const validPath = { ptt: /^\/bbs\/HardwareSale\/M\.[\w.]+\.html$/,
      carousell: /^\/p\/[^/]+\/?$/, 'yahoo-auction': /^\/item\/\d+\/?$/ }[source];
    if (!validPath?.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch (_) { return null; }
}
function eligible(item, keyword, exclude = '', precise = false) {
  if (!item || !matchesKeyword(item.name, keyword, precise)) return false;
  const title = plain(item.name), context = `${title} ${plain(item.evidence)}`;
  if (!HARDWARE.test(title) || sold(context) || VARIABLE_PRICE.test(context) || NOT_A_SALE.test(title)) return false;
  if (!/筆電|筆記型|主機|電腦|laptop|desktop|notebook/i.test(title) && /rtx|gtx|rx/i.test(title)) {
    const models = [...title.matchAll(/(?<!\d)([3-9]\d{3})(?!\d)/g)].map(match => match[1]);
    if (new Set(models).size > 1) return false;
  }
  if (NEW.test(context.replace(/幾乎全新|非全新/g, ''))) return false;
  if (!item.usedCondition && !USED.test(context)) return false;
  if (plain(exclude).split(/[\s,，]+/).filter(Boolean).some(word => compact(title).includes(compact(word)))) return false;
  return Boolean(safeUrl(item.source, item.url)) && Number.isSafeInteger(item.price) && item.price > 0;
}
function listing(source, name, price, url, extra = {}) {
  return { source, platform: SOURCES[source], name: plain(name), price, url: safeUrl(source, url), ...extra };
}
function verified(source, name, price, url, extra = {}) {
  return listing(source, name, price, url, { verified: true, verifiedAt: Date.now(), ...extra });
}
async function get(url, timeout = 10000) {
  return (await axios.get(url, { headers: HEADERS, timeout, maxRedirects: 3, responseType: 'text', maxContentLength: 12 * 1024 * 1024 })).data;
}
async function checkedMap(values, task, concurrency = 3) {
  let cursor = 0, failures = 0;
  const items = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const value = values[cursor++];
      try { const result = await task(value); if (result) items.push(result); } catch (_) { failures += 1; }
    }
  }));
  return { items, scanned: values.length, verificationFailed: failures };
}

function parsePttArticle(html, title, url) {
  const $ = cheerio.load(html), content = $('#main-content').clone();
  if (!content.length) throw new Error('文章內容無法讀取');
  content.find('.push, .article-metaline, .article-metaline-right, .f2').remove();
  // Board template warnings mention sold prices, new goods and penalty numbers.
  // They are instructions, not the seller's product or transaction status.
  const body = content.text().normalize('NFKC').split(/\n--\s*\n/)[0]
    .replace(/\((?:禁止販售未拆封|沒有明確價格|購買日期、保固有無)[^\n)]*\)?/g, '');
  if (sold(`${title} ${body.replace(/換卡售出|升級售出/g, '')}`)) return null;
  const section = label => {
    const pattern = new RegExp(`(?:${label})[ \\t]*:[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*[◎○●]|$)`);
    return body.match(pattern)?.[1].trim() || '';
  };
  const priceText = section('欲售價格|售價|價格');
  if (!priceText || VARIABLE_PRICE.test(priceText) || /沒了|已無|已賣|已收訂|暫訂|暫定/.test(priceText)) return null;
  const numbers = [...priceText.matchAll(/(?:\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d+)?/g)]
    .map(match => Number(match[0].replace(/,/g, '')));
  if (numbers.length !== 1 || !Number.isSafeInteger(numbers[0]) || numbers[0] <= 0) return null;
  const condition = section('品樣狀況|商品狀況|使用狀況');
  return verified('ptt', title.replace(/^\[[^\]]+\]\s*/, ''), numbers[0], url, { evidence: `${title} ${condition}` });
}
async function searchPtt(keyword) {
  const posts = new Map();
  let url = `https://www.ptt.cc/bbs/HardwareSale/search?q=${encodeURIComponent(keyword)}`;
  for (let page = 0; page < 3 && url; page += 1) {
    const $ = cheerio.load(await get(url));
    if (!$('.r-ent').length && !$('.btn-group-paging').length) throw new Error('PTT 公開搜尋頁無法讀取');
    $('.r-ent .title a').each((_, node) => {
      const title = plain($(node).text()), href = safeUrl('ptt', $(node).attr('href'));
      if (href && /^\[賣(?:\/|\])/.test(title) && matchesKeyword(title, keyword) && !sold(title)) posts.set(href, { title, url: href });
    });
    const next = $('.btn-group-paging a').filter((_, node) => $(node).text().includes('上頁')).attr('href');
    const nextUrl = next ? new URL(next, 'https://www.ptt.cc') : null;
    url = nextUrl?.hostname === 'www.ptt.cc' && nextUrl.pathname === '/bbs/HardwareSale/search' ? nextUrl.href : null;
    if (posts.size >= 30) break;
  }
  return checkedMap([...posts.values()].slice(0, 30), async post => parsePttArticle(await get(post.url, 8000), post.title, post.url));
}

function parseYahoo(html) {
  const $ = cheerio.load(html);
  return $('a[href*="tw.bid.yahoo.com/item/"]').map((_, node) => {
    const anchor = $(node), url = safeUrl('yahoo-auction', anchor.attr('href'));
    const name = anchor.find('img[alt]').first().attr('alt') || anchor.find('[class*=sc-481yfv-7]').first().text();
    const text = plain(anchor.text());
    const price = fixedPrice(anchor.find('[class*=sc-1kltuah-2]').first().text());
    if (!url || !price || sold(text) || VARIABLE_PRICE.test(text)) return null;
    return listing('yahoo-auction', name, price, url, { evidence: text });
  }).get().filter(Boolean);
}
function parseYahooDetail(html, url) {
  const $ = cheerio.load(html);
  let item;
  try { item = JSON.parse($('#isoredux-data').text()).item; } catch (_) { throw new Error('Yahoo 商品資料無法驗證'); }
  if (!item || !Array.isArray(item.models)) throw new Error('Yahoo 商品狀態格式已變更');
  if (String(item.id) !== new URL(url).pathname.split('/')[2]) throw new Error('Yahoo 商品資料不一致');
  const stock = item.models.reduce((sum, model) => sum + (Number(model.qty) || 0), 0);
  const range = item.priceRange || {};
  if (Number(item.status) !== 2 || Number(item.type) !== 1 || stock <= 0 || item.isSnapshot || item.isBargain
    || item.hasMultiplePrice || (Number(range.lowPrice) > 0 && Number(range.lowPrice) !== Number(range.highPrice))
    || (Number(item.endTime) > 0 && Number(item.endTime) * 1000 <= Date.now()) || String(item.condition) !== '2') return null;
  return verified('yahoo-auction', item.title, Number(item.price), url, {
    evidence: `${item.title} ${textHtml(item.description)}`, usedCondition: true
  });
}
async function searchYahoo(keyword) {
  const $ = cheerio.load(await get(`https://tw.bid.yahoo.com/search/auction/product?p=${encodeURIComponent(keyword)}`, 15000));
  const links = [...new Set($('a[href*="tw.bid.yahoo.com/item/"]').map((_, node) => safeUrl('yahoo-auction', $(node).attr('href'))).get().filter(Boolean))];
  if (!links.length && /登入|驗證|captcha|Access Denied/i.test(textHtml($.html()))) throw new Error('Yahoo 公開搜尋頁暫時無法讀取');
  return checkedMap(links.slice(0, DETAIL_LIMIT), async url => parseYahooDetail(await get(url), url));
}

function parseCarousell(html) {
  const $ = cheerio.load(html);
  return $('a[href*="/p/"]').map((_, node) => {
    const anchor = $(node), url = safeUrl('carousell', anchor.attr('href'));
    const text = plain(anchor.text()), name = plain(anchor.find('img[alt]').first().attr('alt') || text.replace(/NT\$[\d,]+.*/, ''));
    const prices = [...text.matchAll(/NT\$\s*([\d,]+)/gi)];
    if (!url || prices.length !== 1) return null;
    return listing('carousell', name, Number(prices[0][1].replace(/,/g, '')), url, { evidence: text });
  }).get().filter(Boolean);
}
function productsJsonLd(html) {
  const $ = cheerio.load(html), products = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if ([].concat(value['@type'] || []).includes('Product')) products.push(value);
    if (value['@graph']) visit(value['@graph']);
  }
  $('script[type="application/ld+json"]').each((_, node) => { try { visit(JSON.parse($(node).text())); } catch (_) { /* Invalid metadata is never used as a listing. */ } });
  return products;
}
function parseCarousellDetail(html, url) {
  const products = productsJsonLd(html);
  const product = products.find(value => [].concat(value.offers || []).some(offer => safeUrl('carousell', offer.url) === safeUrl('carousell', url)));
  if (!product) throw new Error('旋轉拍賣商品狀態無法驗證');
  const offers = [].concat(product.offers || []);
  if (offers.length !== 1) return null;
  const offer = offers[0];
  if (!/\/InStock$/.test(offer.availability || '') || !/\/(UsedCondition|RefurbishedCondition)$/.test(offer.itemCondition || '')
    || offer.priceCurrency !== 'TWD' || ('lowPrice' in offer) || ('highPrice' in offer)
    || (offer.priceValidUntil && new Date(`${offer.priceValidUntil}T23:59:59+08:00`).getTime() < Date.now())) return null;
  return verified('carousell', product.name, Number(offer.price), url, { evidence: product.description, usedCondition: true });
}
async function searchCarousell(keyword) {
  const puppeteer = require('../scrapers/browser');
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 15000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(`https://tw.carousell.com/search/${encodeURIComponent(keyword)}/`, { waitUntil: 'domcontentloaded', timeout: 18000 });
    await page.waitForSelector('a[href*="/p/"]', { timeout: 6000 }).catch(() => {});
    const html = await page.content();
    if (/Just a moment|Attention Required|Checking your browser/.test(html)) throw new Error('旋轉拍賣公開搜尋遭到驗證阻擋');
    const $ = cheerio.load(html);
    const links = [...new Set($('a[href*="/p/"]').map((_, node) => safeUrl('carousell', $(node).attr('href'))).get().filter(Boolean))].slice(0, DETAIL_LIMIT);
    if (!links.length && /captcha|請登入/i.test(textHtml(html))) throw new Error('旋轉拍賣公開搜尋頁暫時無法讀取');
    await page.close();
    return await checkedMap(links, async url => {
      const detail = await browser.newPage();
      try {
        await detail.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await detail.waitForSelector('script[type="application/ld+json"]', { timeout: 3000 });
        return parseCarousellDetail(await detail.content(), url);
      } finally { await detail.close(); }
    }, 2);
  } finally { await browser.close(); }
}

const SEARCHERS = { ptt: searchPtt, carousell: searchCarousell, 'yahoo-auction': searchYahoo };
function sourceError(error) {
  const status = error?.response?.status;
  if (status === 403 || status === 429) return `來源拒絕讀取（HTTP ${status}），請稍後再試`;
  if (status) return `來源回應 HTTP ${status}`;
  if (error?.code === 'ECONNABORTED' || /timeout|timed out/i.test(error?.message || '')) return '來源連線逾時，請稍後再試';
  if (error?.code || /net::|Could not find Chrome|Failed to launch/i.test(error?.message || '')) return '來源連線或瀏覽器暫時無法使用';
  return error?.message || '來源無法讀取';
}
async function searchUsedProducts({ keyword, platforms = 'all', exclude = '', precise = false }, dependencies = {}) {
  const query = plain(keyword);
  if (!query || query.length > 80) throw new Error('請輸入 1 至 80 字的搜尋關鍵字');
  const requested = Array.isArray(platforms) ? platforms : String(platforms).split(',');
  const selected = Object.keys(SOURCES).filter(id => requested.includes('all') || requested.includes(id));
  if (!selected.length) throw new Error('請至少選擇一個二手查詢來源');
  const searchers = dependencies.searchers || SEARCHERS;
  const settled = await Promise.allSettled(selected.map(id => Promise.resolve().then(() => searchers[id](query))));
  const sourceStatus = {}, seen = new Set(), data = [];
  settled.forEach((result, index) => {
    const id = selected[index];
    if (result.status === 'rejected') {
      sourceStatus[id] = { name: SOURCES[id], status: 'unavailable', count: 0, message: sourceError(result.reason) };
      return;
    }
    const collection = Array.isArray(result.value) ? { items: result.value } : result.value;
    const items = collection.items || [];
    const verificationFailed = collection.verificationFailed || 0, discoveryFailed = collection.discoveryFailed || 0;
    const failures = verificationFailed + discoveryFailed;
    let count = 0;
    for (const item of items) {
      if (!item.verified || item.source !== id || !eligible(item, query, exclude, precise) || seen.has(item.url)) continue;
      seen.add(item.url); count += 1;
      data.push({ source: item.source, platform: item.platform, name: item.name, price: item.price, url: item.url,
        verifiedAt: item.verifiedAt || Date.now(), condition: 'used' });
    }
    const scanned = collection.scanned ?? items.length;
    sourceStatus[id] = { name: SOURCES[id], status: failures ? 'partial' : count ? 'ok' : 'empty', count,
      scanned, filtered: Math.max(0, scanned - count - verificationFailed), verificationFailed, discoveryFailed,
      message: failures ? (collection.failureMessage || `${failures} 筆刊登或來源無法驗證，已略過`) : count ? '' : (collection.emptyMessage || '沒有符合二手、未標示售出及固定價格條件的商品') };
  });
  data.sort((left, right) => left.price - right.price);
  return { data, meta: { updatedAt: Date.now(), sourceStatus, mode: 'used' } };
}
module.exports = { SOURCES, eligible, fixedPrice, parsePttArticle,
  parseYahoo, parseYahooDetail, parseCarousell, parseCarousellDetail, searchUsedProducts };
