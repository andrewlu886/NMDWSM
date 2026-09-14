const axios = require('axios');
const cheerio = require('cheerio');
const { matchesSearchKeyword } = require('../utils/search-keyword');

const COOLPC_ORIGIN = 'https://coolpc.com.tw';
const COOLPC_EVALUATE_URL = 'https://www.coolpc.com.tw/evaluate.php';
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
};

function buildCoolpcSearchUrl(keyword) {
  return `${COOLPC_ORIGIN}/tw/?s=${encodeURIComponent(String(keyword || '').trim())}`;
}

function cleanCoolpcProductSearchText(value) {
  let text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\.\.\.$/, '')
    .replace(/【[^】]*】|\[[^\]]*\]/gu, '')
    .replace(/展示品/gu, '')
    .replace(/^酷[！!]\s*PC\s*/u, '')
    .trim();

  // Keep the product identity while dropping price and promotional annotations.
  text = text
    .replace(/(?:省|折)\s*\$?\s*[\d,]+[\s\S]*$/u, '')
    .replace(/\$\s*[\d,]+[\s\S]*$/u, '')
    .replace(/(?:參考價|特價|熱賣|任搭|搭配|贈品|送)[\s\S]*$/u, '')
    .replace(/[◆◇★☆✦♥❤]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function normalizeIdentifier(value) {
  return String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function extractGpuIdentifier(value) {
  const match = String(value || '').normalize('NFKC').toUpperCase()
    .match(/\b(RTX|GTX|RX)\s*-?\s*(\d{4})(?:\s*-?\s*(TI|SUPER))?\b/);
  return match ? `${match[1]}${match[2]}${match[3] || ''}` : null;
}

function extractCpuIdentifier(value) {
  const text = String(value || '').normalize('NFKC').toUpperCase();
  const intel = text.match(/\bI[3579]\s*-?\s*\d{4,5}[A-Z]{0,3}\b/);
  if (intel) return normalizeIdentifier(intel[0]);
  const ultra = text.match(/\bULTRA\s*[3579]\s*\d{3}[A-Z]{0,2}\b/);
  if (ultra) return normalizeIdentifier(ultra[0]);
  const amd = text.match(/\bR[3579]\s*-?\s*\d{4}[A-Z0-9]{0,4}\b/);
  return amd ? normalizeIdentifier(amd[0]) : null;
}

function extractCoreProductIdentifier(value) {
  const text = String(value || '').normalize('NFKC').toUpperCase();
  const hyphenated = text.match(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]+)+\b/g) || [];
  const strongHyphenated = hyphenated
    .filter((token) => /[A-Z]/.test(token) && /\d/.test(token))
    .filter((token) => !/^I[3579]-\d/.test(token))
    .filter((token) => !/^(?:DDR|PCIE|WI-FI|WIFI)/.test(token))
    .sort((left, right) => right.length - left.length);
  if (strongHyphenated.length) return strongHyphenated[0];

  const compact = text.match(/\b[A-Z0-9]{5,}\b/g) || [];
  const productCode = compact.find((token) => (
    /[A-Z]/.test(token)
    && /\d/.test(token)
    && !/^(?:RTX|GTX|RX)\d/.test(token)
    && !/^(?:DDR|PCIE|UHD|SSD|NVME)\d/.test(token)
    && !/^\d{4,5}[A-Z]{1,3}$/.test(token)
    && !/^\d+(?:GB|TB|MHZ|GHZ|W)$/.test(token)
  ));
  if (productCode) return productCode;

  return extractCpuIdentifier(text) || extractGpuIdentifier(text);
}

function normalizeCoolpcProductUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || (!/^https?:\/\//i.test(raw) && !raw.startsWith('/'))) return null;

  try {
    const parsed = new URL(raw, COOLPC_ORIGIN);
    const hostname = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (hostname !== 'coolpc.com.tw' && !hostname.endsWith('.coolpc.com.tw')) return null;
    if (!parsed.pathname.toLowerCase().startsWith('/tw/portfolio-items/')) return null;
    return parsed.href;
  } catch (error) {
    return null;
  }
}

function extractCoolpcProductUrl($, element) {
  const candidates = [
    $(element).attr('href'),
    $(element).attr('data-url'),
    $(element).attr('data-href'),
    $(element).attr('data-product-url'),
    $(element).attr('value')
  ];
  return candidates.map(normalizeCoolpcProductUrl).find(Boolean) || null;
}

function extractCoolpcSearchProducts(html) {
  const $ = cheerio.load(String(html || ''));
  const products = new Map();

  $('a[href]').each((_index, element) => {
    const url = normalizeCoolpcProductUrl($(element).attr('href'));
    if (!url || products.has(url)) return;

    const link = $(element);
    const container = link.closest('article, [id^="post-"], .fusion-post-wrapper, .fusion-post-content, .post-content');
    const title = link.attr('title') || link.attr('aria-label') || link.text();
    const context = container.length ? container.text() : link.parent().text();
    products.set(url, {
      url,
      text: `${title || ''} ${context || ''}`.replace(/\s+/g, ' ').trim()
    });
  });

  return [...products.values()];
}

function findCoolpcDirectProductUrl(productName, searchProducts) {
  const identifier = extractCoreProductIdentifier(productName);
  if (!identifier) return null;

  const normalizedIdentifier = normalizeIdentifier(identifier);
  const isGpuIdentifier = /^(?:RTX|GTX|RX)\d{4}(?:TI|SUPER)?$/.test(normalizedIdentifier);
  const isCpuIdentifier = /^(?:I[3579]\d{4,5}[A-Z]{0,3}|ULTRA[3579]\d{3}[A-Z]{0,2}|R[3579]\d{4}[A-Z0-9]{0,4})$/.test(normalizedIdentifier);
  const matches = (searchProducts || []).filter((product) => {
    if (isGpuIdentifier) return extractGpuIdentifier(product.text) === normalizedIdentifier;
    if (isCpuIdentifier) return extractCpuIdentifier(product.text) === normalizedIdentifier;
    return normalizeIdentifier(product.text).includes(normalizedIdentifier);
  });

  return matches.length === 1 ? matches[0].url : null;
}

async function scrape(keyword) {
  const searchUrl = buildCoolpcSearchUrl(keyword);
  console.log(`[原價屋] 正在搜尋: ${keyword}`);
  const [evaluateRequest, searchRequest] = await Promise.allSettled([
    axios.get(COOLPC_EVALUATE_URL, {
      responseType: 'arraybuffer',
      headers: REQUEST_HEADERS,
      timeout: 5000
    }),
    axios.get(searchUrl, { headers: REQUEST_HEADERS, timeout: 5000 })
  ]);

  if (evaluateRequest.status === 'rejected') {
    console.error(`原價屋爬蟲失敗: ${evaluateRequest.reason.message}`);
    return [{ platform: '原價屋', name: '錯誤: 取得失敗', price: 'N/A', url: searchUrl }];
  }

  try {
    const response = evaluateRequest.value;
    const searchProducts = searchRequest.status === 'fulfilled'
      ? extractCoolpcSearchProducts(searchRequest.value.data)
      : [];
    if (searchRequest.status === 'rejected') {
      console.warn(`原價屋商品頁搜尋失敗，改用搜尋頁: ${searchRequest.reason.message}`);
    }

    const html = new TextDecoder('big5').decode(response.data);
    const $ = cheerio.load(html);
    const results = [];

    $('option').each((_index, element) => {
      const text = $(element).text();
      if (matchesSearchKeyword(text, keyword)) {
        const priceMatch = text.match(/\$(\d+)/);
        const displayName = cleanCoolpcProductSearchText(text) || text;
        const productSearchText = extractCoreProductIdentifier(displayName) || keyword;
        results.push({
          platform: '原價屋',
          name: displayName,
          price: priceMatch ? priceMatch[1] : '請至官網確認',
          url: extractCoolpcProductUrl($, element)
            || findCoolpcDirectProductUrl(displayName, searchProducts)
            || buildCoolpcSearchUrl(productSearchText)
        });
      }
    });

    console.log(`[原價屋] 搜尋完成，找到 ${results.length} 筆`);
    return results.slice(0, 99);
  } catch (error) {
    console.error(`原價屋爬蟲失敗: ${error.message}`);
    return [{ platform: '原價屋', name: '錯誤: 取得失敗', price: 'N/A', url: searchUrl }];
  }
}

module.exports = {
  scrape,
  buildCoolpcSearchUrl,
  cleanCoolpcProductSearchText,
  extractCoreProductIdentifier,
  normalizeCoolpcProductUrl,
  extractCoolpcProductUrl,
  extractCoolpcSearchProducts,
  findCoolpcDirectProductUrl
};
