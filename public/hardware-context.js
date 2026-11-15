/* Shared image observations and conversation routing. Never derives trust from assistant prose. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HardwareContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const labels = { cpu: 'CPU', gpu: '顯卡', motherboard: '主機板', ram: '記憶體' };
  const clean = value => typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, 160) : '';
  const known = value => value && !/^(?:unknown|unreadable|unclear|uncertain|不明|未知|無法辨識)/i.test(value);
  const key = value => clean(value).toLowerCase().replace(/[®™]/g, '').replace(/\(r\)|\(tm\)/g, '').replace(/[\s_-]/g, '');
  function modelKey(value, category) {
    let text = clean(value);
    if (category === 'cpu') text = text.replace(/^intel\s*/i, '').replace(/^core\s*(?=i[3579])/i, '').replace(/^amd\s*/i, '');
    return key(text);
  }
  function categoryOf(value) {
    const text = clean(value);
    if (/主機板|motherboard|mainboard/i.test(text)) return 'motherboard';
    if (/記憶體|memory|\bram\b/i.test(text)) return 'ram';
    if (/顯示卡|顯卡|graphics card|video card|\bgpu\b/i.test(text)) return 'gpu';
    if (/處理器|processor|\bcpu\b/i.test(text)) return 'cpu';
    return '';
  }
  function observation(analysis, cpu, legacy = false) {
    const field = name => clean(String(analysis || '').match(new RegExp(`^(?:${name})\\s*[:：]\\s*([^\\n]+)`, 'im'))?.[1]);
    const category = cpu ? 'cpu' : categoryOf(field('Category|種類'));
    if (!category) return null;
    const model = field('Model|型號');
    const candidates = [...new Set((cpu && Array.isArray(cpu.candidates) ? cpu.candidates
      : [model, ...field('Candidate|候選型號').split(/\s+\/\s+/)]).map(clean).filter(known))];
    const verified = !legacy && (category === 'cpu'
      ? cpu?.status === 'verified' && cpu.requiresConfirmation === false && candidates.length === 1 && cpu.model === candidates[0]
      : candidates.length === 1 && known(model) && !/^(?:low|uncertain|低|不確定)$/i.test(field('Confidence|信心')));
    return { schemaVersion: 1, category, model: verified ? candidates[0] : null, candidates,
      status: verified ? 'verified' : candidates.length > 1 ? 'conflict' : candidates.length ? 'candidate' : 'unreadable',
      requiresConfirmation: !verified };
  }
  function records(history) {
    const result = [];
    let photoNumber = 0;
    function add(record) {
      const duplicate = record.model && !record.separate && result.find(other => !other.separate && other.model && other.category === record.category && modelKey(other.model, record.category) === modelKey(record.model, record.category));
      if (duplicate) {
        duplicate.sourceIds.push(...record.sourceIds); duplicate.photoNumbers.push(...record.photoNumbers);
      } else result.push(record);
    }
    for (const item of history) {
      if (item.role === 'user' && !item.contextInvalidated && Array.isArray(item.hardwareInputs)) {
        for (const [index, input] of item.hardwareInputs.entries()) {
          if (!labels[input.category] || !known(clean(input.model))) continue;
          add({ id: `${item.id}:product-${index}`, sourceIds: [item.id], photoNumbers: [], category: input.category,
            model: clean(input.model), candidates: [clean(input.model)], status: 'confirmed', requiresConfirmation: false,
            conditions: modelKey(item.valuationConditions?.model, input.category) === modelKey(input.model, input.category) ? item.valuationConditions : {}, separate: /另一(?:個|顆|張|件|條|組)|另[一1]件/.test(item.displayContent || '') });
        }
      }
      if (item.role !== 'user' || !(item.imageAnalysis || item.hardwareRecognition || item.imageName || item.thumbnailUrl)) continue;
      photoNumber += 1;
      const number = Number.isInteger(item.photoNumber) && item.photoNumber > 0 ? item.photoNumber : photoNumber;
      const observed = item.hardwareRecognition || observation(item.imageAnalysis, item.cpuRecognition, !item.cpuRecognition);
      if (!observed || !labels[observed.category]) continue;
      const confirmation = !item.contextInvalidated && item.hardwareConfirmation;
      const candidates = (observed.candidates || []).map(clean).filter(known);
      const model = confirmation?.model || observed.model;
      if (!candidates.length && !known(model)) continue;
      const verified = !item.contextInvalidated && observed.status === 'verified' && observed.requiresConfirmation === false;
      const accepted = known(model) && (verified || confirmation?.source === 'user');
      const record = { id: item.id, sourceIds: [item.id], photoNumbers: [number], category: observed.category,
        model: accepted ? model : null, candidates: accepted ? [model] : candidates,
        status: accepted ? (confirmation ? 'confirmed' : 'verified') : item.contextInvalidated ? 'candidate' : observed.status,
        requiresConfirmation: !accepted, conditions: item.valuationConditions || {},
        separate: /另一(?:個|顆|張|件|條|組)|另[一1]件|不同(?:的)?(?:一|另)|第二件/.test(item.displayContent || '') };
      add(record);
    }
    return result;
  }
  function blockedIntent(text) {
    return /不要|不用|不想|不需要|別幫|取消|停止|什麼(?:意思)?|是什麼|如何(?:估價|估值)|怎麼(?:估價|計算)|了解|介紹|解釋|說明/.test(clean(text));
  }
  function valuationIntent(text) {
    const value = clean(text);
    return !blockedIntent(value) && !/手機|平板/.test(value) &&
      /估價|估值|估二手價|二手(?:價|值)|(?:這|那)(?:個|顆|張|條|組|塊).{0,24}(?:值多少|能賣多少|賣多少)|幫我.{0,16}(?:值多少|賣多少)/.test(value);
  }
  function select(records, text) {
    const value = clean(text);
    let matches = records;
    const ordinal = value.match(/第\s*([一二三四五六七八九十\d]+)\s*(?:張|個|顆|條|項|件)/);
    if (ordinal) {
      const number = /^\d+$/.test(ordinal[1]) ? Number(ordinal[1]) : '一二三四五六七八九十'.indexOf(ordinal[1]) + 1;
      matches = matches.filter(item => item.photoNumbers.includes(number));
    }
    const category = categoryOf(value);
    if (category) matches = matches.filter(item => item.category === category);
    // An explicitly different SKU must never silently resolve to the only old photo.
    const skuPatterns = [
      /\bi[3579]\s*[- ]?\d{4,5}[a-z]{0,3}\b|\bRyzen\s*[3579]\s*\d{4}[a-z0-9]*\b|\b(?:Core\s*)?Ultra\s*[3579]\s*\d{3,4}[a-z]*\b/i,
      /\b(?:RTX|GTX)\s*\d{4}(?:\s*(?:Ti|SUPER))*(?![a-z0-9])|\bRX\s*\d{4}(?:\s*(?:XT|XTX|GRE))?(?![a-z0-9])/i,
      /\b[BHZX]\d{3}[a-z0-9]*\b/i
    ];
    for (const pattern of skuPatterns) {
      const sku = value.match(pattern)?.[0];
      if (sku) matches = matches.filter(item => [item.model, ...item.candidates].filter(Boolean)
        .some(model => key(model.match(pattern)?.[0]) === key(sku)));
    }
    for (const [requested, observed] of [
      [/\bWHITE\b|白色|白款/i, /\bWHITE\b|白色|白款/i],
      [/\bBLACK\b|黑色|黑款/i, /\bBLACK\b|黑色|黑款/i]
    ]) {
      if (requested.test(value)) matches = matches.filter(item => [item.model, ...item.candidates].filter(Boolean).some(model => observed.test(model)));
    }
    const capacity = value.match(/\b\d+\s*(?:GB|TB)\b/i)?.[0];
    if (capacity) matches = matches.filter(item => [item.model, ...item.candidates].filter(Boolean).some(model => key(model).includes(key(capacity))));
    const explicit = matches.filter(item => [item.model, ...item.candidates].filter(Boolean)
      .some(model => {
        const query = key(value), target = modelKey(model, item.category);
        const position = query.indexOf(target);
        return position >= 0 && !/^[a-z0-9]/i.test(query.slice(position + target.length));
      }));
    if (explicit.length) matches = explicit;
    if (/剛才|剛剛|最後|最新/.test(value)) matches = matches.slice(-1);
    return matches;
  }
  const features = { market: '市價查詢', valuation: '二手估價', recommendation: '智慧推薦', power: '瓦數計算' };
  const featurePattern = /市價查詢|市場價格查詢|價格查詢|查(?:詢)?(?:一下)?市價|查價|市價|二手估價|二手估值|估二手價格?|估(?:個)?二手價|估價|估值|二手(?:值多少|多少錢|價|值)|值多少|能賣多少|賣掉能拿回多少|多少錢|售價|行情|智慧推薦|硬體推薦|配置推薦|推薦配置|裝機推薦|推薦(?:一套)?(?:電腦|主機|配置)|配電腦|組電腦|瓦數計算|功耗計算|計算(?:整機|電源)?瓦數|算(?:整機|電源)?瓦數|幾瓦/g;
  function extractProducts(text) {
    const value = String(text || '').normalize('NFKC').slice(0, 1000);
    // Keep the complete printed ASCII name (including brand, capacity and color),
    // rather than reducing a graphics card to its GPU chip alone.
    const result = [];
    for (const match of value.matchAll(/[A-Za-z0-9][A-Za-z0-9®™ ._+*/()\-]*/g)) {
      let model = clean(match[0].replace(/^(?:CPU|GPU|RAM)\s*[:：]?\s*/i, ''));
      const cpuToken = model.match(/\b(?:Intel\s*(?:Core\s*)?)?(?:i[3579]\s*[- ]?\d{4,5}[a-z]{0,3}|(?:AMD\s*)?Ryzen\s*[3579]\s*\d{4}[a-z0-9]*|(?:Core\s*)?Ultra\s*[3579]\s*\d{3,4}[a-z]*)(?:\s+(?:PRO|Plus))?\b/i);
      const gpuToken = model.match(/\b(?:RTX|GTX|RX|ARC)\s*\d{3,4}/i);
      if (cpuToken && gpuToken) {
        // ASCII '+' or a space can separate an explicitly listed CPU and GPU.
        const cpuFirst = cpuToken.index < gpuToken.index;
        const splitAt = cpuFirst ? cpuToken.index + cpuToken[0].length : cpuToken.index;
        const parts = [model.slice(0, splitAt), model.slice(splitAt)].map(part => part.replace(/^[\s+/,]+|[\s+/,]+$/g, '').replace(/^(?:and|with)\s+/i, ''));
        for (const product of extractProducts(parts.join('，'))) if (!result.some(item => item.category === product.category && modelKey(item.model, item.category) === modelKey(product.model, product.category))) result.push(product);
        continue;
      }
      const category = /\bi[3579]\s*[- ]?\d{4,5}[a-z]{0,3}\b|\bRyzen\s*[3579]\s*\d{4}[a-z0-9]*\b|\bUltra\s*[3579]\s*\d{3,4}[a-z]*\b/i.test(model) ? 'cpu'
        : /\b(?:RTX|GTX|RX|ARC)\s*\d{3,4}/i.test(model) ? 'gpu'
          : /\b[BHZX]\d{3}[a-z0-9]*(?:\b|[- ])/i.test(model) ? 'motherboard'
            : /\bDDR[345]\b|\b\d+\s*GB\s*(?:[x*]\s*\d+)?\b/i.test(model) ? 'ram' : '';
      const color = value.slice(match.index + match[0].length).match(/^\s*(白色|白款|黑色|黑款)/)?.[1];
      if (category === 'gpu' && color) model = clean(`${model} ${color}`);
      if (category && !result.some(item => item.category === category && modelKey(item.model, category) === modelKey(model, category))) result.push({ category, model });
    }
    return result;
  }
  function featureBlocked(text) {
    return /不要|不用|不想|不需要|取消|停止|別|了解|介紹|解釋|說明|什麼|意思|差別|如何|怎麼/.test(text);
  }
  function parseFeatureRequest(text) {
    const value = String(text || '').normalize('NFKC').trim().slice(0, 1000);
    if (/手機|平板/.test(value)) return null;
    if (/差別|差異|意思|原理|是什麼|有什麼|怎麼|如何|做什麼/.test(value) && !/幫我|請|我要|我想|想要|開始|進行|開啟|切換|改成|查一下/.test(value)) return null;
    const found = [];
    for (const match of value.matchAll(featurePattern)) {
      const prefix = value.slice(0, match.index).split(/[，,。.!！?？;；]|但(?:是)?|改成|改用|改做|換成|接著|然後|幫我|請/g).at(-1);
      const after = value.slice(match.index + match[0].length);
      if (featureBlocked(prefix) || /^(?:功能)?(?:是什麼|有什麼|怎麼|如何|的意思|介紹|說明|差別)/.test(after)) continue;
      const name = /瓦數|功耗|幾瓦/.test(match[0]) ? 'power' : /推薦|配電腦|組電腦/.test(match[0]) ? 'recommendation'
        : /市價|查價|價格查詢|售價|行情/.test(match[0]) || match[0] === '多少錢' ? 'market' : 'valuation';
      if (!found.includes(name)) found.push(name);
    }
    return found.length ? { schemaVersion: 1, features: found, targetText: value, products: extractProducts(value) } : null;
  }
  function validateFeatureRequest(action, text) {
    if (!action || !Array.isArray(action.features) || action.features.length < 1 || action.features.length > 4) return null;
    const value = String(text || '').normalize('NFKC').slice(0, 1000);
    const deterministic = parseFeatureRequest(value);
    // Literal commands take precedence over a model's interpretation.
    if (deterministic) return deterministic;
    if (blockedIntent(value) || /手機|平板/.test(value)) return null;
    if (action.features.some(name => !Object.hasOwn(features, name))) return null;
    const targetText = typeof action.targetText === 'string' && value.includes(action.targetText.normalize('NFKC')) ? action.targetText.normalize('NFKC').slice(0, 1000) : value;
    return { schemaVersion: 1, features: [...new Set(action.features)], targetText, products: extractProducts(value) };
  }
  function mayRequestFeature(text) {
    const value = String(text || '').normalize('NFKC').slice(0, 1000);
    return !blockedIntent(value) && /幫|請|想|能不能|可不可以|哪裡|哪邊|划算|賣掉/.test(value) &&
      /查|找|賣|換|買|配|推薦|值|多少|功耗|電源|幾成|划算/.test(value);
  }
  return { labels, key, modelKey, observation, records, categoryOf, valuationIntent, blockedIntent, select,
    features, extractProducts, parseFeatureRequest, validateFeatureRequest, mayRequestFeature };
});
