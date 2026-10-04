(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketSearchPolicy = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function compact(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, ''); }

  function models(value) {
    const text = String(value || '').normalize('NFKC');
    const result = [];
    for (const match of text.matchAll(/(RTX|GTX|RX)\s*-?\s*(\d{3,4})\s*(Ti\s*SUPER|TIS|SUPER|Ti|XTX|XT|GRE|S)?(?![a-z0-9])/gi)) {
      const suffix = compact(match[3]).replace(/^s$/, 'super').replace(/^tis$/, 'tisuper');
      const family = compact(match[1] + match[2]);
      result.push({ category: 'part_gpu', family, suffix, raw: match[0], model: family + suffix });
    }
    for (const match of text.matchAll(/\bi([3579])\s*-?\s*(\d{4,5})(KF|KS|HX|F|K|T|U|H)?(?![a-z0-9])/gi)) {
      result.push({ category: 'part_cpu', family: `i${match[1]}${match[2]}`, suffix: compact(match[3]), raw: match[0], model: compact(match[0]) });
    }
    for (const match of text.matchAll(/(?:Ryzen\s*|\bR)([3579])\s*-?\s*(\d{4})(X3D|XT|X|G|F)?(?![a-z0-9])/gi)) {
      const family = `ryzen${match[1]}${match[2]}`, suffix = compact(match[3]);
      result.push({ category: 'part_cpu', family, suffix, raw: match[0], model: family + suffix });
    }
    return result;
  }

  const aliases = [
    ['part_cpu', /^(?:cpu|處理器|中央處理器)$/i],
    ['part_gpu', /^(?:gpu|顯卡|顯示卡|繪圖卡)$/i],
    ['part_ram', /^(?:ram|記憶體|ddr[345])$/i],
    ['part_ssd', /^(?:ssd|固態硬碟)$/i],
    ['part_hdd', /^(?:hdd|傳統硬碟|機械硬碟)$/i],
    ['part_motherboard', /^(?:主機板|motherboard)$/i],
    ['part_case', /^(?:機殼|電腦機殼)$/i],
    ['part_psu', /^(?:psu|電源供應器)$/i],
    ['part_cooling', /^(?:cpu散熱器|散熱器|水冷|散熱風扇)$/i],
    ['whole_desktop', /^(?:主機|桌機|桌電|桌上型電腦|電腦主機|套裝機|套裝主機|電競主機|文書主機|desktop(?:pc)?|pc)$/i],
    ['whole_laptop', /^(?:筆電|筆記型電腦|筆記本|laptop|notebook)$/i],
    ['part_monitor', /^(?:螢幕|顯示器|monitor)$/i],
    ['accessory_keyboard', /^(?:鍵盤|keyboard)$/i],
    ['accessory_mouse', /^(?:滑鼠|mouse)$/i],
    ['accessory_controller', /^(?:手把|搖桿|遊戲手把|controller|gamepad)$/i]
  ];

  function intent(keyword) {
    const query = compact(keyword);
    const found = models(keyword);
    if (found.length === 1) return { ...found[0], kind: 'model' };
    if (/^[3-9]\d{3}(?:ti|super)?$/i.test(query)) {
      const match = query.match(/^(\d+)(.*)$/);
      return { kind: 'model', category: 'part_gpu', family: match[1], suffix: match[2], model: query, numeric: true };
    }
    const alias = aliases.find(([, pattern]) => pattern.test(query));
    return { kind: alias ? 'category' : 'text', category: alias?.[0] || null };
  }

  function matchesModel(title, target, precise) {
    const found = models(title).filter(m => m.category === target.category);
    const matches = found.some(m => (target.numeric ? m.family.replace(/^[a-z]+/, '') === target.family : m.family === target.family)
      && (precise || target.suffix ? m.suffix === target.suffix : true));
    return matches && (!precise || new Set(found.map(m => m.model)).size === 1);
  }

  function suggestedExcludes(keyword) {
    const category = intent(keyword).category;
    if (category === 'part_gpu') return ['電競主機', '筆記型電腦', '組裝套餐', '顯卡支架', '顯卡散熱器', '顯卡水冷頭', '不含顯卡', '不含顯示卡', '顯卡空盒'];
    if (category === 'part_cpu') return ['電競主機', '筆記型電腦', '主機板套餐', '升級套餐', '不含CPU', '處理器空盒'];
    return [];
  }

  // Remove only words previously inserted by us. User-entered exclusions survive toggles.
  function updateExcludes(value, previousAutoWords, keyword, enabled) {
    const tokens = String(value || '').split(/[\s,，]+/).filter(Boolean);
    const previous = new Set(previousAutoWords.map(compact));
    const manual = tokens.filter(word => !previous.has(compact(word)));
    const occupied = new Set(manual.map(compact));
    const autoWords = enabled ? suggestedExcludes(keyword).filter(word => !occupied.has(compact(word))) : [];
    return { value: [...manual, ...autoWords].join(' '), autoWords };
  }

  return { compact, models, intent, matchesModel, suggestedExcludes, updateExcludes };
});
