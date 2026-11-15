const axios = require('axios');
const cheerio = require('cheerio');

const HOSTS = new Set(['24h.pchome.com.tw', 'www.momoshop.com.tw', 'www.sinya.com.tw', 'www.ruten.com.tw', 'tw.buy.yahoo.com', 'www.newegg.com']);
const outcome = (availability, reason, extra = {}) => ({ availability, reason, ...extra });
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const models = value => (String(value).toUpperCase().match(/(?:RTX|GTX|RX)\s*\d{3,4}(?:\s*(?:TI|SUPER|XTX|XT|GRE))*(?!\d)|I[3579][ -]*\d{4,5}[A-Z]*|\d+\s*GB|WHITE|白色/g) || []).map(normalize).sort().join('|');
function parseAvailability(html, item) {
  const $ = cheerio.load(String(html));
  if (/just a moment|captcha|checking your browser|access denied/i.test($('title').text())) return outcome('unknown', 'challenge');
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
    const name = normalize(p.name);
    return target.length >= 8 && name.length >= 8 && models(p.name) === models(item.name) && (name === target || name.includes(target) || target.includes(name));
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

async function checkProduct(item, { signal, request = axios.get } = {}) {
  let url;
  try { url = new URL(item.url); } catch { return outcome('unknown', 'invalid_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || !HOSTS.has(url.hostname)) return outcome('unknown', 'unsupported_url');
  try {
    if (url.hostname === 'www.ruten.com.tw') {
      const id = url.search.slice(1);
      if (!/^\d+$/.test(id)) return outcome('unknown', 'invalid_product_id');
      const r = await request(`https://rtapi.ruten.com.tw/api/prod/v3/index.php/prod?id=${id}`, { timeout: 7000, signal, maxRedirects: 0 });
      const p = Array.isArray(r.data) && r.data.find(p => String(p.ProdId) === id);
      if (!p) return outcome('unknown', 'product_missing');
      if (/已售出|售完|已成交|已下架/.test(p.ProdName || '')) return outcome('unavailable', 'sold');
      if (normalize(p.ProdName) !== normalize(item.name)) return outcome('unknown', 'product_changed');
      const close = p.CloseTime ? Date.parse(p.CloseTime) : null;
      if (p.StockQty !== undefined && p.StockQty !== null && Number(p.StockQty) <= 0 || close !== null && close <= Date.now()) return outcome('unavailable', 'out_of_stock');
      if (p.StockQty === undefined || p.StockQty === null || !Number.isFinite(Number(p.StockQty)) || close !== null && !Number.isFinite(close)) return outcome('unknown', 'stock_unconfirmed');
      const prices = p.PriceRange?.length ? p.PriceRange.map(Number) : [Number(p.Price || p.DirectPrice)];
      if (new Set(prices).size !== 1 || !Number.isFinite(prices[0]) || prices[0] <= 0) return outcome('unknown', 'variant_unconfirmed');
      return outcome('available', 'product_api', { price: prices[0], currency: 'TWD' });
    }
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
    if (response.status !== 200) return outcome('unknown', response.status === 429 ? 'rate_limited' : 'source_unavailable');
    return parseAvailability(response.data, item);
  } catch (error) {
    return outcome('unknown', error.response?.status === 429 ? 'rate_limited' : 'verification_failed');
  }
}
module.exports = { checkProduct, parseAvailability };
