const fs = require('fs');
const path = require('path');
const { estimate: estimatePsu } = require('./psu-flow');
const { searchProductsWithMeta } = require('../src/services/search');
const { getRecommendationsWithMeta } = require('../src/services/recommendation');
const { isBodyTooLarge, parseJsonBody } = require('./json-body');

const { createOllamaClient } = require('../src/services/ollama-client');
const ollamaClient = createOllamaClient();
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'gemma3:4b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 90000);
const MAX_TOOL_ROUNDS = 2;
let activeAiRequests = 0;
const { getScopeReply, validMarketKeyword, matchesMarketProduct, pruneHardwareHistory } = require('../src/services/chat-scope');

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'estimate_used_value',
      description:
        '使用網站正式二手估價公式估算 CPU、GPU、主機板或 RAM。資料不足時先向使用者追問，不要猜測。',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['cpu', 'gpu', 'motherboard', 'ram'] },
          model: { type: 'string', description: '硬體完整型號' },
          brand: { type: 'string' },
          originalPrice: { type: 'number', description: '新品價格；型號資料庫已有價格時可省略' },
          elapsedMonths: { type: 'number', description: '已使用月數' },
          totalWarrantyMonths: {
            type: 'number',
            description: '總保固月數；不確定時可省略使用系統資料'
          },
          extensionRegistered: { type: 'string', enum: ['yes', 'no', 'unknown'] },
          condition: { type: 'string', enum: ['like_new', 'good', 'fair', 'poor'] }
        },
        required: ['category', 'model', 'elapsedMonths', 'condition']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_market_prices',
      description: '查詢網站支援通路的即時硬體市價，並返回商品連結。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '具體硬體型號或搜尋詞' },
          platforms: { type: 'string', description: '平台 ID 或 all；預設 all' },
          exclude: { type: 'string', description: '要排除的商品詞' },
          include: { type: 'string', description: '結果必須包含的商品詞' }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recommend_hardware',
      description: '依預算及用途使用網站智慧推薦功能。預算、產品類型、用途或商品新舊選擇不足時先追問；先詢問使用者想要二手（通常較便宜）還是全新品，不得自行預設。',
      parameters: {
        type: 'object',
        properties: {
          budget: { type: 'number', description: '新台幣預算' },
          productType: { type: 'string', enum: ['desktop', 'laptop', 'component'] },
          usage: { type: 'string', enum: ['gaming', 'office'] },
          componentType: { type: 'string', enum: ['cpu', 'gpu'] },
          condition: { type: 'string', enum: ['new', 'used'], description: '使用者選擇的商品狀況；new 全新品、used 二手，未選擇時先追問' }
        },
        required: ['budget', 'productType', 'usage', 'condition']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate_psu_wattage',
      description:
        '查詢網站 CPU/GPU 功耗資料並計算整機建議 PSU。至少提供 CPU 型號或瓦數以及 GPU 型號或瓦數；沒有獨顯可填 gpuModel 為「內顯」。',
      parameters: {
        type: 'object',
        properties: {
          cpuModel: { type: 'string' },
          cpuWatts: { type: 'number' },
          gpuModel: { type: 'string' },
          gpuWatts: { type: 'number' },
          motherboardWatts: { type: 'number', description: '未指定時採標準主機板 25W' },
          coolingWatts: { type: 'number', description: '未指定時採基本風冷 15W' },
          driveCount: { type: 'number', description: '硬碟數量，未指定時 1；每顆估 10W' }
        }
      }
    }
  }
];

function normalizeModelName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

function isMarketIntent(text) {
  return /市價|行情|通路.{0,4}價|查價|市場價|價格查詢|商品價格|多少錢|多少元|價位|售價/.test(
    String(text || '')
  );
}

function extractHardwareKeyword(text) {
  const value = String(text || '').normalize('NFKC');
  const patterns = [
    /\b(?:RTX|GTX)\s*\d{4}\s*(?:(?:TI|SUPER)\b)?/gi,
    /\bRX\s*\d{4}\s*(?:(?:XT|XTX|GRE)\b)?/gi,
    /\b(?:CORE\s*)?I[3579][-\s]*\d{4,5}[A-Z]{0,3}\b/gi,
    /\b(?:RYZEN\s*)?[3579][-\s]*\d{4}[A-Z\d]{0,5}\b/gi,
    /\b(?:B|Z|X|H)\d{3}(?:[-\s][A-Z\d]+)?\b/gi,
    /\bDDR[45](?:[-\s]?\d{4})?\b/gi,
    /\b\d{4}\s*(?:TI|SUPER|XT|XTX|GRE)?\b/gi
  ];
  const matches = [];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      matches.push({ value: match[0], end: match.index + match[0].length });
    }
  }
  matches.sort((left, right) => right.end - left.end || right.value.length - left.value.length);
  return matches[0]?.value.replace(/\s+/g, ' ').trim() || null;
}

function extractWattageModels(userTurns) {
  const models = { cpuModel: '', gpuModel: '' };
  const cpuPatterns = [
    /\b(?:CORE\s*)?ULTRA\s+[3579]\s+\d{3,4}[A-Z]{0,3}\b/gi,
    /\b(?:CORE\s*)?I[3579][-\s]*\d{4,5}[A-Z]{0,3}\b/gi,
    /\bRYZEN\s+[3579]\s+\d{4}[A-Z\d]{0,5}\b/gi
  ];
  const gpuPatterns = [
    /\b(?:RTX|GTX)\s*\d{4}\s*(?:(?:TI|SUPER)\b)?/gi,
    /\bRX\s*\d{4}\s*(?:(?:XT|XTX|GRE)\b)?/gi
  ];
  for (const turn of [...userTurns].reverse()) {
    const text = String(turn.content || '').normalize('NFKC');
    for (const pattern of cpuPatterns) {
      const match = [...text.matchAll(pattern)].at(-1)?.[0];
      if (match) {
        models.cpuModel = match.replace(/\s+/g, ' ').trim();
        break;
      }
    }
    for (const pattern of gpuPatterns) {
      const match = [...text.matchAll(pattern)].at(-1)?.[0];
      if (match) {
        models.gpuModel = match.replace(/\s+/g, ' ').trim();
        break;
      }
    }
    if (models.cpuModel && models.gpuModel) break;
  }
  return models;
}

async function answerMarketQuery(keyword, userMessage, dependencies = {}, options = {}) {
  if (!validMarketKeyword(keyword)) {
    return {
      answer: '可以呀，想查哪個硬體？給我完整型號就好，例如 RTX 5070。\n[前往市價查詢](/scrape)',
      products: []
    };
  }

  const marketData = dependencies.searchProducts
    ? { data: await dependencies.searchProducts({ keyword, platforms: 'all', include: '', exclude: '', categories: '' }), meta: null }
    : await searchProductsWithMeta({ keyword, platforms: 'all', include: '', exclude: '', categories: '', forceRefresh: options.forceRefresh === true });
  const products = marketData.data.filter(item => matchesMarketProduct(item, keyword));
  const updatedText = marketData.meta?.updatedAt
    ? `\n資料更新時間：${new Date(marketData.meta.updatedAt).toLocaleString('zh-TW')}。`
    : '';
  const marketUrl = `/scrape?keyword=${encodeURIComponent(keyword)}`;
  const entries = products.slice(0, 5).map(item => {
    const price = Number.isFinite(Number(item.priceNtd))
      ? `${item.originalPrice}（約 NT$ ${Number(item.priceNtd).toLocaleString('zh-TW')}）`
      : item.price && item.price !== '待實作 DOM 解析' ? `NT$ ${item.price}` : '請至通路查看價格';
    const name = String(item.name || '查看商品').replace(/[\[\]\r\n]/g, '').trim();
    let title = name;
    try {
      const url = new URL(item.url);
      if (['http:', 'https:'].includes(url.protocol)) title = '[' + name + '](' + url.href.replace(/\(/g, '%28').replace(/\)/g, '%29') + ')';
    } catch { /* Keep the product name when no valid URL is available. */ }
    return '- ' + title + '｜' + price + '｜' + (item.platform || '通路未標示');
  });
  const staleWarning = marketData.meta?.stale ? '\n這次沒有更新到通路資料，以下是先前結果；實際價格請以商品頁為準。' : '';
  const answer = entries.length
    ? `我查到「${keyword}」的通路結果了，先給你幾筆參考（實際價格以商品頁為準）：\n${entries.join('\n')}${updatedText}${staleWarning}\n\n[帶入「${keyword}」到市價頁](${marketUrl})`
    : `我還沒查到「${keyword}」的通路商品，先不猜價格。你可以試試更完整的型號，或稍後再查。${updatedText}\n[帶入「${keyword}」到市價頁](${marketUrl})`;
  return { answer, products: products.slice(0, 5), userMessage, marketMeta: marketData.meta };
}

function getMarketQueryKeyword(text, imageAnalysis = '') {
  const value = String(text || '').normalize('NFKC').trim();
  const keyword = value
    .replace(/^(?:(?:請|幫我|我想|我要|想要|查一下|查詢|搜尋|查價|市價查詢|看看|查)\s*)+/g, '')
    .replace(/(?:的)?(?:最新|目前|當前)?(?:產品)?(?:資訊(?:與|和|及)?市價|資訊(?:與|和|及)?價格|市價|行情|價格|資訊)[？?。！!]*$/g, '').trim();
  const isImagePrompt = /^(?:照片(?:中(?:的)?(?:產品|商品|硬體))?|圖片|產品|商品|硬體|這個|這張照片|照片中產品的資訊與市價|辨識這張電腦硬體照片|辨識這張硬體圖片|辨識這張硬體照片)$/.test(keyword);
  if (keyword && !isImagePrompt) {
    const corrected = /更正|修正|不是|改成|我說錯/.test(value) ? extractHardwareKeyword(value) : null;
    return (corrected || keyword).slice(0, 100);
  }
  if (imageAnalysis) {
    const match = imageAnalysis.match(/(?:^|\n)\s*(?:Model|型號)\s*[:：]\s*([^\n]+)/i);
    const model = match?.[1]?.trim();
    if (!model || /unknown|unreadable|uncertain|不明|無法|不確定/i.test(model)
      || /(?:Confidence|信心|可信度)\s*[:：]\s*(?:low|uncertain|低|不確定)/i.test(imageAnalysis)) return null;
    return model.replace(/^["「]|["」]$/g, '').slice(0, 100);
  }
  return null;
}

function validateImages(images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  if (images.length > 1) throw new Error('一次請上傳一張硬體照片。');
  const image = String(images[0] || '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_500_000) {
    throw new Error('圖片格式不正確或檔案過大，請重新選擇圖片。');
  }
  return [image];
}

async function analyzeHardwareImage(image, signal, receipt = false) {
  const tagResponse = await ollamaClient.request('/api/tags', { signal });
  if (!tagResponse.ok) throw new Error(`無法確認圖片辨識模型 ${OLLAMA_VISION_MODEL} 是否已安裝。`);
  const tags = await tagResponse.json();
  const installed = (tags.models || []).some(model => model.name === OLLAMA_VISION_MODEL);
  if (!installed) {
    throw new Error(
      ollamaClient.serviceMode === 'shared'
        ? '共用 AI 的圖片辨識模型尚未準備好，請聯絡網站管理者。'
        : `AI 服務主機尚未安裝圖片辨識模型 ${OLLAMA_VISION_MODEL}。請先執行：ollama pull ${OLLAMA_VISION_MODEL}`
    );
  }

  const response = await ollamaClient.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_VISION_MODEL,
      stream: false,
      options: { temperature: 0 },
      messages: [{
        role: 'user',
        content: receipt
          ? 'Read this purchase invoice or receipt. Return ONLY one JSON object with keys purchase_date (YYYY-MM-DD or null), total_paid_ntd (number or null), and product_name (string or null). Use only clearly printed information; do not guess. Ignore unrelated numbers such as phone numbers, tax IDs, and invoice numbers.'
          : 'Inspect this computer hardware photo. In English, identify the likely category (CPU, graphics card, motherboard, or memory), then report the exact visible model and manufacturer using the explicit format "Category: ...\nModel: ...\nEvidence: ...\nConfidence: ...". Quote only text actually visible. If the exact model is not legible, say Model: unknown; never guess a model from appearance alone.',
        images: [image]
      }]
    }),
    signal
  });
  if (!response.ok) throw new Error(`圖片辨識模型回應錯誤（HTTP ${response.status}）。`);
  const result = await response.json();
  const analysis = String(result.message?.content || '').trim();
  if (!analysis) throw new Error('圖片辨識沒有取得結果，請換一張標籤較清楚的照片。');
  return analysis.slice(0, 3000);
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

async function fetchLocalJson(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${Number(process.env.PORT || 3000)}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `網站 API 回應 ${response.status}`);
  return data;
}

function pickHardwareRecord(rows, model, nameFields) {
  const query = normalizeModelName(model);
  if (!query) throw new Error('請提供完整硬體型號，或直接提供瓦數。');
  const matched = rows.filter(row =>
    nameFields.some(field => {
      const name = normalizeModelName(row[field]);
      return name && (name === query || name.includes(query) || query.includes(name));
    })
  );
  if (matched.length === 0)
    throw new Error(`資料庫找不到「${model}」，請確認型號或提供該零件的瓦數。`);
  if (matched.length > 1) {
    const names = matched
      .slice(0, 5)
      .map(row => nameFields.map(field => row[field]).find(Boolean))
      .filter(Boolean);
    throw new Error(`「${model}」可能對應多筆資料：${names.join('、')}。請提供更完整型號。`);
  }
  return matched[0];
}

function firstNumber(value) {
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

async function calculatePsu(args, dependencies = {}) {
  const fetchJson = dependencies.fetchLocalJson || fetchLocalJson;
  let cpuWatts = Number(args.cpuWatts);
  let gpuWatts = Number(args.gpuWatts);
  let gpuRecommendedPsu = 0;
  const sources = [];

  if ((!Number.isFinite(cpuWatts) || cpuWatts < 0) && args.cpuModel) {
    const rows = await fetchJson('/api/cpu-data');
    const row = pickHardwareRecord(rows, args.cpuModel, ['CPU型號']);
    cpuWatts = firstNumber(row['最大銳頻功耗'] || row.PL2 || row.PPT || row['標稱TDP'] || row.TDP);
    if (cpuWatts === null)
      throw new Error(`查到 ${args.cpuModel}，但資料沒有可用的功耗數字；請手動提供 CPU 瓦數。`);
    sources.push(`CPU 資料庫：${row['CPU型號']}`);
  }

  if ((!Number.isFinite(gpuWatts) || gpuWatts < 0) && args.gpuModel) {
    if (/內顯|無獨顯|沒有顯卡/i.test(args.gpuModel)) {
      gpuWatts = 0;
    } else {
      const rows = await fetchJson('/api/gpu-data');
      const row = pickHardwareRecord(rows, args.gpuModel, ['顯示卡型號']);
      gpuWatts = firstNumber(row.TDP || row.TGP || row['官方功耗']);
      gpuRecommendedPsu =
        firstNumber(
          row['官方建議瓦數'] || row['官方建議PSU'] || row['建議瓦數'] || row['建議電源'] || row.PSU
        ) || 0;
      if (gpuWatts === null)
        throw new Error(`查到 ${args.gpuModel}，但資料沒有可用的功耗數字；請手動提供 GPU 瓦數。`);
      sources.push(`GPU 資料庫：${row['顯示卡型號']}`);
    }
  }

  if (!Number.isFinite(cpuWatts) || cpuWatts < 0 || !Number.isFinite(gpuWatts) || gpuWatts < 0) {
    throw new Error('請提供 CPU 與 GPU 的型號或瓦數；沒有獨立顯卡請註明內顯。');
  }

  const motherboardWatts = toPositiveNumber(args.motherboardWatts, 25);
  const coolingWatts = toPositiveNumber(args.coolingWatts, 15);
  const driveCount = toPositiveNumber(args.driveCount, 1);
  const { totalWatts, recommendedWatts } = estimatePsu({ cpuWatts, gpuWatts, motherboardWatts, coolingWatts, driveCount, gpuRecommendedPsu });

  return {
    cpuWatts,
    gpuWatts,
    motherboardWatts,
    coolingWatts,
    driveCount,
    totalWatts,
    recommendedWatts,
    gpuRecommendedPsu,
    formula:
      'CPU + GPU + 主機板 + 散熱 + 硬碟數×10W；預估功耗×1.3 後進位至 50W，最低 300W，且不低於顯卡官方建議。',
    sources
  };
}

async function answerWattageQuery(userTurns, dependencies = {}) {
  const { cpuModel, gpuModel } = extractWattageModels(userTurns);
  if (!cpuModel || !gpuModel) {
    const missing = [!cpuModel && 'CPU', !gpuModel && '顯示卡'].filter(Boolean).join('與');
    return {
      answer: `我已辨識到${cpuModel ? ` CPU「${cpuModel}」` : ''}${gpuModel ? ` 顯示卡「${gpuModel}」` : ''}。請再提供${missing}型號；若沒有獨立顯卡，請回覆「內顯」。`
    };
  }

  try {
    const result = await calculatePsu({ cpuModel, gpuModel }, dependencies);
    return {
      answer: `依資料庫型號估算：CPU「${cpuModel}」約 ${result.cpuWatts}W，顯示卡「${gpuModel}」約 ${result.gpuWatts}W。\n主機板、散熱與硬碟等一併估算後，整機滿載約 ${result.totalWatts}W，建議選擇至少 ${result.recommendedWatts}W 的電源供應器。\n${result.formula}\n資料來源：${result.sources.join('；')}。[開啟瓦數計算](/tools)`
    };
  } catch (error) {
    return {
      answer: `我辨識到 CPU「${cpuModel}」與顯示卡「${gpuModel}」，但目前無法從功耗資料完成可靠計算：${error.message}。請確認型號或使用瓦數計算頁手動選擇。[開啟瓦數計算](/tools)`
    };
  }
}

async function executeTool(name, args) {
  switch (name) {
  case 'estimate_used_value': {
    const data = await fetchLocalJson('/api/valuation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...args,
        extensionRegistered: args.extensionRegistered || 'unknown'
      })
    });
    return data;
  }
  case 'search_market_prices': {
    if (!validMarketKeyword(args.keyword)) throw new Error('請提供電腦硬體的完整型號，不接受無關對話作為搜尋關鍵字。');
    const result = await searchProductsWithMeta({
      keyword: String(args.keyword).slice(0, 100),
      platforms: args.platforms || 'all',
      exclude: String(args.exclude || '').slice(0, 100),
      include: String(args.include || '').slice(0, 100),
      categories: ''
    });
    const products = result.data.filter(item => matchesMarketProduct(item, args.keyword));
    return { keyword: args.keyword, count: products.length, products: products.slice(0, 8), marketMeta: result.meta };
  }
  case 'recommend_hardware': {
    const budget = Number(args.budget);
    if (!Number.isFinite(budget) || budget < 1000)
      throw new Error('請提供至少 NT$1,000 的有效預算。');
    if (!['new', 'used'].includes(args.condition)) {
      throw new Error('你想找二手（通常較便宜的主機），還是全新品？請先確認使用者的選擇。');
    }
    if (args.productType === 'component' && !['cpu', 'gpu'].includes(args.componentType)) {
      throw new Error('推薦單一零件時，請再確認要 CPU 還是 GPU。');
    }
    return getRecommendationsWithMeta({ ...args, budget });
  }
  case 'calculate_psu_wattage':
    return calculatePsu(args);
  default:
    throw new Error('不支援的 AI 工具。');
  }
}

function formatRecommendationAnswer(result) {
  if (!result.recommendations.length) {
    return '這組條件暫時沒有找到合適商品。要不要調整預算或用途，我再幫你找一次？[調整推薦條件](/recommend)';
  }
  const lines = ['根據您的需求，找到以下推薦商品（點選藍字可查看商品頁）：'];
  result.recommendations.slice(0, 3).forEach((item, index) => {
    const title = String(item.title || '查看推薦商品').replace(/[\[\]\r\n]/g, '').trim();
    let productUrl = `/scrape?keyword=${encodeURIComponent(title)}`;
    try {
      const url = new URL(item.url);
      if (['http:', 'https:'].includes(url.protocol)) {
        productUrl = url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
      }
    } catch {
      // Use the product search page when no valid product URL is available.
    }
    const specs = [item.cpu, item.gpu, item.ram, item.os]
      .filter(value => value && value !== 'UNKNOWN').join(' · ');
    lines.push(`${index + 1}. [${title}](${productUrl})\n價格：NT$ ${Number(item.price).toLocaleString('zh-TW')} · ${item.platform || '通路資訊'}${specs ? `\n規格：${specs}` : ''}`);
  });
  return lines.join('\n\n');
}

// Handle only complete social/off-topic turns. A mixed request must continue to the
// hardware tools, e.g. "你好，幫我查 RTX 5060 市價".
function getConversationalReply(userMessage) {
  const text = String(userMessage || '').normalize('NFKC').trim()
    .replace(/[\s，,。.!！?？～~]+/g, '').toLowerCase();
  if (/^(?:你好|您好|哈囉|哈啰|嗨|hi|hello|早安|午安|晚安|有人在嗎|在嗎|你在嗎|你是誰|你是啥|所以你是啥|你是什麼|你叫什麼名字|你能做什麼|你會做什麼|自我介紹|自我介紹一下|你是機器人嗎|你是客服嗎)(?:呀|啊|喔|哦)?$/.test(text)) {
    return '嗨，我是紀亦緹！想查零件市價、估二手價格、配電腦，或算電源瓦數，都可以告訴我。我們一步一步來。';
  }
  if (/^(?:謝謝|謝謝你|感謝|感謝你|感恩|多謝|辛苦了|拜拜|再見|掰掰)(?:呀|啊|喔|哦)?$/.test(text)) {
    return '不客氣，能幫上忙就好！還有硬體問題，隨時找我。';
  }
  if (/^(?:今天天氣(?:如何|怎樣|怎麼樣)?|天氣(?:如何|怎樣|怎麼樣)?|誰是.{0,30}|bbb|123|隨便|測試)$/.test(text)) {
    return '這題我可能幫不上忙耶。我比較熟電腦硬體；想查市價、估二手價格、配電腦或算瓦數，我可以陪你一起看。';
  }
  if (/^(?:(?:我想|我要|想)?(?:幫我)?(?:估價|估算|查二手價|算二手價)(?:一台|一下)?(?:手機|平板)|(?:手機|平板)(?:可以)?(?:估價|估算|查二手價|算二手價)(?:嗎)?)$/.test(text)) {
    return '手機和平板目前沒有可用的二手估價資料。如果是電腦零件，告訴我完整型號與使用狀況，我再幫你估。';
  }
  return null;
}

function fallbackAnswerForUserMessage(userMessage) {
  const conversationalReply = getConversationalReply(userMessage);
  if (conversationalReply) return conversationalReply;
  const text = String(userMessage || '').trim().toLowerCase();
  if (/裝機|組裝|推薦|菜單|配電腦/.test(text)) {
    return '想配電腦嗎？先告訴我預算和主要用途，再說想找桌機、筆電或 CPU／顯卡，我會幫你縮小範圍。[開啟智慧推薦](/recommend)';
  }
  if (/估價|二手|價錢|價格|價格估算|幾錢|多少/.test(text))
    return '可以，我們來估看看。先告訴我零件種類和完整型號，再補上使用時間與外觀狀況就好。[開啟二手估價工具](/valuation)';
  if (/市價|行情|價格查詢|查價|市場價格|買賣|想買|要買|購買/.test(text))
    return '想查哪個零件的價格？給我完整型號，我會看看支援通路目前查得到哪些商品。[開啟市價查詢](/scrape)';
  if (/瓦數|電源|供電|電供|供應器/.test(text))
    return '我們先確認 CPU 和顯示卡型號，再來估整機瓦數；如果只用內顯，直接說「內顯」就可以。[開啟瓦數計算](/tools)';
  if (/手機|平板/.test(text)) {
    return '手機和平板目前沒有可用的二手估價資料。如果是電腦零件，告訴我完整型號與使用狀況，我再幫你估。';
  }
  return '我還不太確定你想做哪一件事。你可以直接說「查 RTX 5060 市價」、「幫我估二手價」或「我想配電腦」，我就能接著幫你。';
}

function appendChatLog(userMessage, answer) {
  try {
    const logPath = path.join(__dirname, 'chat_logs.csv');
    const escapeCSV = value => `"${String(value || '').replace(/"/g, '""')}"`;
    const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '\uFEFF時間,使用者問題,AI回答\n');
    fs.appendFile(
      logPath,
      `${escapeCSV(time)},${escapeCSV(userMessage)},${escapeCSV(answer)}\n`,
      () => {}
    );
  } catch (error) {
    console.warn('無法寫入聊天紀錄:', error.message);
  }
}

async function getStatus() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OLLAMA_STATUS_TIMEOUT_MS || 5000));
  try {
    const response = await ollamaClient.request('/api/tags', { signal: controller.signal });
    if (!response.ok) return { available: false, model: OLLAMA_MODEL };
    const data = await response.json();
    const models = (data.models || []).map(model => model.name);
    const loadedModel = models.some(
      name => name === OLLAMA_MODEL || name.startsWith(`${OLLAMA_MODEL.split(':')[0]}:`)
    );
    const visionModelInstalled = models.some(name => name === OLLAMA_VISION_MODEL);
    return {
      available: true,
      serviceMode: ollamaClient.serviceMode,
      model: OLLAMA_MODEL,
      modelInstalled: loadedModel,
      visionModel: OLLAMA_VISION_MODEL,
      visionModelInstalled
    };
  } catch (error) {
    return {
      available: false,
      model: OLLAMA_MODEL,
      visionModel: OLLAMA_VISION_MODEL,
      visionModelInstalled: false
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function trainNlpModel() {
  if (!manager || isModelTrained) return;
  manager.addDocument('zh', '你好', 'intent.greeting');
  manager.addDocument('zh', '您好', 'intent.greeting');
  manager.addDocument('zh', '嗨', 'intent.greeting');
  manager.addDocument('zh', '哈囉', 'intent.greeting');
  manager.addDocument('zh', '有人在嗎', 'intent.greeting');
  manager.addDocument('zh', '早安', 'intent.greeting');
  manager.addDocument('zh', '午安', 'intent.greeting');
  manager.addDocument('zh', '晚安', 'intent.greeting');
  manager.addDocument('zh', '你是誰', 'intent.greeting');
  manager.addDocument('zh', '你是啥', 'intent.greeting');
  manager.addDocument('zh', '你是什麼', 'intent.greeting');
  manager.addDocument('zh', '自我介紹一下', 'intent.greeting');
  manager.addDocument('zh', '你是機器人嗎', 'intent.greeting');
  manager.addDocument('zh', '你是客服嗎', 'intent.greeting');
  manager.addDocument('zh', '所以你是啥', 'intent.greeting');
  manager.addAnswer('zh', 'intent.greeting', '您好！我是網站的專屬導遊，有什麼電腦零件估價或行情查詢的需求，都可以問我喔！');
  manager.addDocument('zh', '謝謝', 'intent.thanks');
  manager.addDocument('zh', '感謝', 'intent.thanks');
  manager.addDocument('zh', '感恩', 'intent.thanks');
  manager.addDocument('zh', '拜拜', 'intent.thanks');
  manager.addDocument('zh', '再見', 'intent.thanks');
  manager.addDocument('zh', '掰掰', 'intent.thanks');
  manager.addAnswer('zh', 'intent.thanks', '不會！很高興能為您服務。如果有其他問題，隨時歡迎再來找我喔！');
  manager.addDocument('zh', '買', 'intent.scrape');
  manager.addDocument('zh', '我想買', 'intent.scrape');
  manager.addDocument('zh', '我要買', 'intent.scrape');
  manager.addDocument('zh', '我要買顯卡', 'intent.scrape');
  manager.addDocument('zh', '我想購買', 'intent.scrape');
  manager.addDocument('zh', '市場價格', 'intent.scrape');
  manager.addDocument('zh', '市價', 'intent.scrape');
  manager.addDocument('zh', '行情', 'intent.scrape');
  manager.addAnswer('zh', 'intent.scrape', '想了解最新的市場行情嗎？[點此前往市價查詢](/scrape)');
  manager.addDocument('zh', '我想估價', 'intent.valuation');
  manager.addDocument('zh', '顯示卡', 'intent.valuation');
  manager.addDocument('zh', 'CPU', 'intent.valuation');
  manager.addDocument('zh', 'GPU', 'intent.valuation');
  manager.addDocument('zh', '主機板', 'intent.valuation');
  manager.addDocument('zh', '滑鼠鍵盤', 'intent.valuation');
  manager.addDocument('zh', '電腦零件', 'intent.valuation');
  manager.addAnswer('zh', 'intent.valuation', '需要估算電腦零件的價格嗎？請點擊這裡：[點此前往零件估價工具](/valuation)');
  manager.addDocument('zh', '一體機', 'intent.recommend');
  manager.addDocument('zh', '套裝機', 'intent.recommend');
  manager.addDocument('zh', '電腦裝機', 'intent.recommend');
  manager.addDocument('zh', '我想找電腦裝機', 'intent.recommend');
  manager.addDocument('zh', '組裝電腦', 'intent.recommend');
  manager.addDocument('zh', '智慧推薦', 'intent.recommend');
  manager.addDocument('zh', '推薦電腦', 'intent.recommend');
  manager.addDocument('zh', '電腦菜單', 'intent.recommend');
  manager.addDocument('zh', '幫我配電腦', 'intent.recommend');
  manager.addAnswer('zh', 'intent.recommend', '需要尋找裝機推薦嗎？請點擊這裡：[點此前往智慧推薦](/recommend)');
  manager.addDocument('zh', '瓦數計算', 'intent.tools');
  manager.addDocument('zh', '電源供應器', 'intent.tools');
  manager.addDocument('zh', '電供', 'intent.tools');
  manager.addAnswer('zh', 'intent.tools', '若需計算電源供應器瓦數：[點此前往瓦數計算工具](/tools)');
  manager.addDocument('zh', '手機', 'intent.unsupported');
  manager.addDocument('zh', '平板', 'intent.unsupported');
  manager.addDocument('zh', '筆電', 'intent.unsupported');
  manager.addDocument('zh', '筆記型電腦', 'intent.unsupported');
  manager.addAnswer('zh', 'intent.unsupported', '非常抱歉，目前我們僅針對電腦零組件提供估價喔！[點此前往零件估價工具](/valuation)');
  manager.addDocument('zh', '誰是', 'intent.none');
  manager.addDocument('zh', '這是什麼', 'intent.none');
  manager.addDocument('zh', '天氣', 'intent.none');
  manager.addDocument('zh', 'BBB', 'intent.none');
  manager.addDocument('zh', '123', 'intent.none');
  manager.addDocument('zh', '測試', 'intent.none');
  manager.addDocument('zh', '隨便', 'intent.none');
  manager.addAnswer('zh', 'intent.none', '不好意思，這部分超出了我的專業範圍😅。我能幫助你跳轉到電腦零組件的估價、裝機推薦與行情查詢，您要不要試試看問我這類的問題呢？');

  try {
    await manager.train();
    manager.save();
    isModelTrained = true;
    console.log('✅ 輕量級 NLP 模型訓練完成');
  } catch (error) {
    console.warn('⚠️ NLP 模型訓練失敗，將使用詞彙備援回應。');
    isModelTrained = true;
  }
}

function escapeCSV(text) {
  if (!text) return '""';
  return `"${String(text).replace(/"/g, '""')}"`;
}

async function handle(req, res) {
  try {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      body = {};
    }
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const userMessage = [...rawMessages].reverse().find(m => m.role === 'user')?.content || '';

    if (!userMessage) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: '請提供有效的訊息內容' }));
    }

    await trainNlpModel();

    let answer = fallbackAnswerForUserMessage(userMessage);

    if (manager && !/智慧推薦/.test(userMessage)) {
      try {
        const response = await manager.process('zh', userMessage);
        if (response.intent === 'None' || response.score < 0.75) {
          answer = fallbackAnswerForUserMessage(userMessage);
        } else {
          answer = response.answer || fallbackAnswerForUserMessage(userMessage);
        }
      } catch (error) {
        console.warn('⚠️ NLP 執行失敗，改用關鍵字備援回答。');
        answer = fallbackAnswerForUserMessage(userMessage);
      }
    }

    try {
      const timeString = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      const logPath = path.join(__dirname, 'chat_logs.csv');
      const csvLine = `${escapeCSV(timeString)},${escapeCSV(userMessage)},${escapeCSV(answer)}\n`;
      if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '\uFEFF時間,使用者問題,AI回答\n');
      fs.appendFile(logPath, csvLine, () => {});
    } catch (e) {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, answer }));
  } catch (error) {
    console.error('❌ NLP 服務發生錯誤:', error);
    res.writeHead(isBodyTooLarge(error) ? 413 : 500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: false,
      message: isBodyTooLarge(error) ? error.message : '系統錯誤'
    }));
  }
}

async function handle(req, res) {
  let lastUserMessage = '';
  let imageRequested = false;
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > 3_000_000) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: false, message: '訊息或圖片過大，請縮小後重試。' }));
      }
    }
    const parsed = body ? JSON.parse(body) : {};
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const latestUser = [...messages].reverse().find(message => message.role === 'user');
    const images = validateImages(latestUser?.images);
    imageRequested = images.length > 0;
    const conversation = messages
      .filter(
        message =>
          ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
      )
      .slice(imageRequested ? -8 : -12)
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 2000)
      }));
    const userMessage = [...conversation]
      .reverse()
      .find(message => message.role === 'user')?.content;
    if (!userMessage && !imageRequested) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, message: '請提供有效的訊息內容。' }));
    }
    lastUserMessage = userMessage || '請辨識這張電腦硬體照片';

    // Market/photo requests keep their existing workflow even when the caption
    // looks like a greeting or another short social message.
    const conversationalReply = !imageRequested && parsed.intent !== 'market'
      ? getConversationalReply(userMessage)
      : null;
    if (conversationalReply) {
      appendChatLog(userMessage, conversationalReply);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: true, answer: conversationalReply, provider: 'conversation' }));
    }

    if (!imageRequested) {
      const socialReply = getConversationalReply(userMessage);
      const scopeReply = socialReply || getScopeReply(latestUser?.content || userMessage, conversation.slice(0, -1));
      if (scopeReply) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: true, answer: scopeReply, provider: 'conversation' }));
      }
    }
    if (activeAiRequests >= 2) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '10' });
      return res.end(JSON.stringify({ success: false, message: '姐姐正在處理其他硬體問題，請稍後再試一次。' }));
    }
    activeAiRequests += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    try {
      const effectiveUserMessage = userMessage || '請辨識這張電腦硬體照片';
      const receiptRequested = /發票|收據|receipt|invoice/i.test(effectiveUserMessage);
      const imageAnalysis = imageRequested
        ? await analyzeHardwareImage(images[0], controller.signal, receiptRequested)
        : '';
      const userTurns = conversation.filter(message => message.role === 'user');
      const explicitMarketQuery = parsed.intent === 'market';
      const marketIntent = explicitMarketQuery || isMarketIntent(effectiveUserMessage) || (
        (/^(好|可以|是|對|沒錯|請查|查吧|幫我查)[！!。,. ]*$/.test(effectiveUserMessage.trim()) ||
          /更正|修正|不是|我說錯|應該是|改成/.test(effectiveUserMessage)) &&
        userTurns.slice(-3, -1).some(message => isMarketIntent(message.content))
      );
      if (marketIntent) {
        const userText = userTurns.map(message => message.content).join('\n');
        // A new photo must use its own recognized model, never an older conversation model.
        const isConfirmation = /^(?:好|可以|是|對|沒錯|請查|查吧|幫我查)[！!。,. ]*$/.test(effectiveUserMessage.trim());
        const keyword = imageRequested
          ? getMarketQueryKeyword(effectiveUserMessage, imageAnalysis)
          : isConfirmation
            ? extractHardwareKeyword(conversation.at(-2)?.content) || extractHardwareKeyword(userText)
            : getMarketQueryKeyword(effectiveUserMessage);
        let market;
        try {
          market = keyword
            ? await answerMarketQuery(keyword, effectiveUserMessage, {}, { forceRefresh: true })
            : { answer: imageRequested ? '照片中的型號不夠清楚，請上傳標籤清楚的照片，或直接輸入產品名稱與型號，我再查詢資訊與市價。' : '請輸入想查詢的產品名稱或完整型號，也可以上傳產品照片。' };
        } catch (error) {
          const marketUrl = keyword
            ? `/scrape?keyword=${encodeURIComponent(keyword)}`
            : '/scrape';
          market = {
            answer: `目前無法完成即時通路查詢（${error.message}），我不會提供未查證的價格。\n[帶入型號到市價頁](${marketUrl})`
          };
        }
        const answer = imageAnalysis
          ? `照片辨識結果：${imageAnalysis}\n\n${market.answer}`
          : market.answer;
        appendChatLog(effectiveUserMessage, answer);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: true, answer, imageAnalysis: imageAnalysis || undefined, provider: 'tools' }));
      }

      if (/瓦數|電源|供電|電供|PSU|幾瓦/i.test(effectiveUserMessage)) {
        const wattage = await answerWattageQuery(userTurns);
        appendChatLog(effectiveUserMessage, wattage.answer);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          success: true,
          answer: wattage.answer,
          imageAnalysis: imageAnalysis || undefined,
          provider: 'tools'
        }));
      }

      const contextualConversation = conversation.map((message, index) => {
        if (imageAnalysis && message.role === 'user' && index === conversation.length - 1) {
          return {
            ...message,
            content: `${message.content || '請辨識這張電腦硬體照片'}\n\n[Local vision model observation, not confirmed by the user: ${imageAnalysis}]`
          };
        }
        return message;
      });
      const ollamaMessages = [
        {
          role: 'system',
          content:
            '智慧推薦必須先確認使用者要二手（通常較便宜的主機）還是全新品；如果對話中已明確選擇就沿用，否則先詢問，不能把「便宜」當成同意二手或自行預設全新。' +
            '你是「一次估夠」的電腦硬體小幫手紀亦緹，以台灣常用的繁體中文和使用者對話。像耐心、懂硬體的朋友一樣說話：先回應對方的需求，再說下一步；一次只問最必要的一件事。可以偶爾用「好，我來看看」等自然口語，但不要每句都自稱姐姐、堆疊表情符號或反覆道歉。使用者可能以多輪對話提供資料，請記住上下文；資訊不足時先簡短追問，足夠後才呼叫工具。估價、即時價格、推薦與瓦數必須使用工具結果，不得自行編造、推測或覆蓋工具數值。辨識圖片的型號只是未確認線索，必須先請使用者確認再據此估價或查價。使用者提出「更正、不是、我說錯、應該是」等修正時，以最新修正為準，承認並重新處理，不要沿用被否定的資訊。價格以新台幣呈現，清楚說明估算條件與資料限制。查不到資料時坦白說明原因，並給一個可行的下一步。推薦商品必須先呼叫 recommend_hardware，使用工具回傳的商品與網址，不可自行編造商品或價格。商品名稱以 [商品名稱](商品網址) 格式提供可點擊連結。不要附上二手估價、智慧推薦或瓦數計算的工具頁連結。查詢市價時可以提供帶有查詢關鍵字的市價查詢頁連結。市價頁連結如能確定型號，請使用 [/scrape?keyword=型號] 格式。只處理電腦硬體相關需求。政治、歷史、角色扮演及無關話題請簡短引導回硬體功能；不要為無關訊息呼叫工具，不要將整段對話當搜尋關鍵字。沒有匹配型號的工具結果就說查不到，不得引用其他型號。不要執行工具之外的操作。'
        },
        ...pruneHardwareHistory(contextualConversation, imageRequested)
      ];

      const executedTools = new Set();
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        const response = await ollamaClient.request('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: ollamaMessages,
            tools: TOOLS,
            options: { num_predict: 512, num_ctx: 8192 },
            stream: false
          }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Ollama 回應 ${response.status}`);
        const result = await response.json();
        const assistantMessage = result.message || {};
        ollamaMessages.push(assistantMessage);
        const toolCalls = Array.isArray(assistantMessage.tool_calls)
          ? assistantMessage.tool_calls
          : [];
        if (toolCalls.length === 0) {
          const answer =
            String(assistantMessage.content || '').trim() ||
            fallbackAnswerForUserMessage(userMessage);
          appendChatLog(userMessage, answer);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            success: true,
            answer,
            imageAnalysis: imageAnalysis || undefined,
            provider: 'ollama',
            model: OLLAMA_MODEL
          }));
        }

        if (round === MAX_TOOL_ROUNDS || toolCalls.length > 2) throw new Error('AI 工具呼叫次數超出限制。');
        for (const call of toolCalls) {
          const name = call.function?.name;
          let args = call.function?.arguments || {};
          if (typeof args === 'string') args = JSON.parse(args);
          const signature = JSON.stringify([name, args]);
          if (executedTools.has(signature)) throw new Error('AI 重複呼叫相同工具，已停止本次處理。');
          executedTools.add(signature);
          let toolResult;
          try {
            toolResult = await executeTool(name, args);
          } catch (error) {
            toolResult = { error: error.message };
          }
          if (name === 'recommend_hardware' && Array.isArray(toolResult.recommendations)) {
            const answer = formatRecommendationAnswer(toolResult);
            appendChatLog(effectiveUserMessage, answer);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, answer, provider: 'tools' }));
          }
          ollamaMessages.push({
            role: 'tool',
            tool_name: name,
            content: JSON.stringify(toolResult)
          });
        }
      }
      throw new Error('AI 工具呼叫次數超出限制。');
    } finally {
      clearTimeout(timeout);
      activeAiRequests -= 1;
    }
  } catch (error) {
    const answer = imageRequested
      ? error.message
      : fallbackAnswerForUserMessage(lastUserMessage);
    console.warn('本機 Llama 服務未完成請求:', error.message);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({ success: true, answer, provider: 'fallback', model: OLLAMA_MODEL })
    );
  }
}

module.exports = {
  handle,
  getStatus,
  executeTool,
  calculatePsu,
  pickHardwareRecord,
  extractHardwareKeyword,
  extractWattageModels,
  answerWattageQuery,
  answerMarketQuery,
  getMarketQueryKeyword,
  getConversationalReply,
  fallbackAnswerForUserMessage,
  TOOLS
};
