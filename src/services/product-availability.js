const axios = require('axios');
const cheerio = require('cheerio');

const HOSTS = new Set(['24h.pchome.com.tw', 'www.momoshop.com.tw', 'www.sinya.com.tw', 'www.ruten.com.tw', 'tw.buy.yahoo.com', 'www.newegg.com']);
const outcome = (availability, reason, extra = {}) => ({ availability, reason, ...extra });
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const models = value => (String(value).toUpperCase().match(/(?:RTX|GTX|RX)\s*\d{3,4}(?:\s*(?:TI|SUPER|XTX|XT|GRE))*(?!\d)|I[3579][ -]*\d{4,5}[A-Z]*|\d+\s*GB|WHITE|白色/g) || []).map(normalize).sort().join('|');
function parseAvailability(html, item) {
  const $ = cheerio.load(String(html));
  if (/just a moment|captcha|checking your browser|access denied/i.test($('title').text())) return outcome('unknown', 'challenge');
  const host = new URL(item.url).hostname;
  if (host === 'www.momoshop.com.tw') return parseMomo($);
  if (host === 'www.sinya.com.tw') return parseSinya($, item);
  const products = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if ([].concat(value['@type'] || []).includes('Product')) products.push(value);
    if (value['@graph']) visit(value['@graph']);
    if (value.hasVariant) visit(value.hasVariant);
  }
  $('script[type="application/ld+json"]').each((_, el) => { try { visit(JSON.parse($(el).text())); } catch {} });
  const target = normalize(item.name);
  const candidates = products.filter(p => {
    // Yahoo appends "| category | Yahoo購物中心" to the product name, which can mention other models.
    const title = String(p.name || '').replace(/\s*\|[^|]*\|\s*Yahoo購物中心\s*$/, '');
    const name = normalize(title);
    return target.length >= 8 && name.length >= 8 && models(title) === models(item.name) && (name === target || name.includes(target) || target.includes(name));
  });
  if (candidates.length !== 1) return outcome('unknown', 'product_or_variant_unconfirmed');
  const offers = [].concat(candidates[0].offers || []);
  if (offers.length !== 1 || offers[0]['@type'] === 'AggregateOffer') return outcome('unknown', 'variant_unconfirmed');
  const offer = offers[0];
  const stock = String(offer.availability || '').split('/').pop();
  if (['OutOfStock', 'SoldOut', 'Discontinued'].includes(stock)) return outcome('unavailable', 'out_of_stock');
  if (stock !== 'InStock') return outcome('unknown', 'stock_unconfirmed');
  const price = Number(offer.price);
  const currency = /newegg/i.test(item.platform) ? 'USD' : 'TWD';
  if (offer.priceCurrency !== currency || !Number.isFinite(price) || price <= 0 || offer.lowPrice || offer.highPrice) return outcome('unknown', 'price_unconfirmed');
  if (offer.priceValidUntil && Date.parse(offer.priceValidUntil) < Date.now()) return outcome('unknown', 'price_expired');
  return outcome('available', 'product_offer', { price, currency });
}

// Momo omits stock from JSON-LD; its Open Graph meta carries it, and sold-out goods redirect to a notice page.
function parseMomo($) {
  const stock = $('meta[name="product:availability"]').attr('content');
  if (stock === 'out of stock' || /管理訊息/.test($('title').text()) && /熱銷一空|已售完|已下架|銷售完畢|商品目前無展售/.test($('body').text())) return outcome('unavailable', 'out_of_stock');
  if (stock !== 'in stock') return outcome('unknown', 'stock_unconfirmed');
  const price = Number(String($('meta[name="product:price:amount"]').attr('content') || '').replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0) return outcome('unknown', 'price_unconfirmed');
  return outcome('available', 'product_meta', { price, currency: 'TWD' });
}

// Sinya renders discounts in several layouts, so only stock is confirmed and the search price is kept.
function parseSinya($, item) {
  const id = new URL(item.url).pathname.split('/')[2];
  if ($('button.btnNoStock').length) return outcome('unavailable', 'out_of_stock');
  if ($('button.addToCart').filter((_, el) => $(el).attr('data-pid') === id).length) return outcome('available', 'product_button');
  return outcome('unknown', 'stock_unconfirmed');
}

async function checkPchome(url, signal, request) {
  const id = url.pathname.match(/^\/prod\/([A-Z0-9]+-[A-Z0-9]+)$/i)?.[1];
  if (!id) return outcome('unknown', 'invalid_product_id');
  const r = await request(`https://ecapi-cdn.pchome.com.tw/ecshop/prodapi/v2/prod/button&id=${id}&fields=Id,Price,Qty,ButtonType,SaleStatus`, { timeout: 7000, signal, maxRedirects: 0 });
  if (!Array.isArray(r.data)) return outcome('unknown', 'source_unavailable');
  const rows = r.data.filter(row => String(row?.Id || '').startsWith(`${id}-`));
  if (!rows.length) return outcome('unknown', 'product_missing');
  const forSale = rows.filter(row => row.ButtonType === 'ForSale' && Number(row.SaleStatus) === 1);
  // NotReady is also what PChome returns for a product id that no longer exists.
  if (!forSale.length) return rows.every(row => ['SoldOut', 'OrderRefill', 'NotReady'].includes(row.ButtonType))
    ? outcome('unavailable', 'out_of_stock') : outcome('unknown', 'stock_unconfirmed');
  const prices = new Set(forSale.map(row => Number(row.Price?.P)));
  const [price] = prices;
  return prices.size === 1 && Number.isFinite(price) && price > 0
    ? outcome('available', 'product_api', { price, currency: 'TWD' }) : outcome('available', 'product_api');
}

async function checkProduct(item, { signal, request = axios.get } = {}) {
  let url;
  try { url = new URL(item.url); } catch { return outcome('unknown', 'invalid_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || !HOSTS.has(url.hostname)) return outcome('unknown', 'unsupported_url');
  try {
    if (url.hostname === 'www.ruten.com.tw') {
      const id = url.search.slice(1);
      if (!/^\d+$/.test(id)) return outcome('unknown', 'invalid_product_id');
      const r = await request(`https://rtapi.ruten.com.tw/api/prod/v3/index.php/prod?id=${id}`, { timeout: 7000, signal, maxRedirects: 0 });
      if (!Array.isArray(r.data)) return outcome('unknown', 'source_unavailable');
      const p = r.data.find(p => String(p?.ProdId) === id);
      // Ruten answers [] or [null] for deleted listings.
      if (!p) return r.data.every(p => p === null) ? outcome('unavailable', 'removed') : outcome('unknown', 'product_missing');
      if (/已售出|售完|已成交|已下架/.test(p.ProdName || '')) return outcome('unavailable', 'sold');
      if (normalize(p.ProdName) !== normalize(item.name)) return outcome('unknown', 'product_changed');
      const close = p.CloseTime ? Date.parse(p.CloseTime) : null;
      if (p.StockQty !== undefined && p.StockQty !== null && Number(p.StockQty) <= 0 || close !== null && close <= Date.now()) return outcome('unavailable', 'out_of_stock');
      if (p.StockQty === undefined || p.StockQty === null || !Number.isFinite(Number(p.StockQty)) || close !== null && !Number.isFinite(close)) return outcome('unknown', 'stock_unconfirmed');
      const prices = p.PriceRange?.length ? p.PriceRange.map(Number) : [Number(p.Price || p.DirectPrice)];
      if (new Set(prices).size !== 1 || !Number.isFinite(prices[0]) || prices[0] <= 0) return outcome('unknown', 'variant_unconfirmed');
      return outcome('available', 'product_api', { price: prices[0], currency: 'TWD' });
    }
    if (url.hostname === '24h.pchome.com.tw') return await checkPchome(url, signal, request);
    // Only follow redirects inside the explicit source allowlist; never fetch an arbitrary destination.
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await request(url.href, { timeout: 7000, signal, maxRedirects: 0, maxContentLength: 3_000_000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-TW,zh;q=0.9' }, validateStatus: () => true });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const next = new URL(response.headers.location, url);
      if (next.protocol !== 'https:' || next.hostname !== url.hostname || next.username || next.password) return outcome('unknown', 'redirect_unconfirmed');
      url = next;
    }
    if ([404, 410].includes(response.status)) return outcome('unavailable', 'removed');
    // Sinya serves a 500 error page that explicitly states the product no longer exists.
    if (url.hostname === 'www.sinya.com.tw' && response.status === 500 && /此產品不存在或已經下架/.test(String(response.data))) return outcome('unavailable', 'removed');
    if (response.status !== 200) return outcome('unknown', response.status === 429 ? 'rate_limited' : 'source_unavailable');
    return parseAvailability(response.data, item);
  } catch (error) {
    return outcome('unknown', error.response?.status === 429 ? 'rate_limited' : 'verification_failed');
  }
}
module.exports = { checkProduct, parseAvailability };
