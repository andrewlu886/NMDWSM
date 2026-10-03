function classifyProductCondition(item) {
  const title = String(item?.name || item?.title || '').normalize('NFKC');
  const condition = String(item?.condition || item?.itemCondition || '').toLowerCase();
  const explicitlyUsed = item?.usedCondition === true || item?.isUsed === true
    || /^(?:used|refurbished)$|\/(?:usedcondition|refurbishedcondition)$/.test(condition)
    || /二手|中古|幾乎全新|[一二三四五六七八九十1-9]成新|自用|使用過|正常使用|有使用痕跡|已拆封|拆封使用|拆機|翻新|整新|再生品|福利品|展示品|展示機|拆封品|非全新|\b(?:used|pre[ -]?owned|refurbished|renewed|open[ -]?box)\b/i.test(title);
  const explicitlyNew = /全新|新品|未拆封|未使用|\bbrand[ -]?new\b/i.test(title.replace(/非全新|幾乎全新/g, ''))
    || /^new$|\/newcondition$/.test(condition);
  if (explicitlyNew && explicitlyUsed) return 'conflict';
  if (explicitlyUsed) return 'used';
  if (explicitlyNew) return 'new';
  return 'unknown';
}
function matchesProductCondition(item, requested = 'new') {
  const condition = classifyProductCondition(item);
  if (requested === 'used') return condition === 'used';
  // Preserve the original retailer workflow for listings without a condition label.
  return condition === 'new' || (condition === 'unknown'
    && !/二手|中古|福利品|翻新|整新|展示品|非全新/i.test(String(item?.name || item?.title || ''))
    && item?.condition !== 'used' && item?.usedCondition !== true);
}
module.exports = { classifyProductCondition, matchesProductCondition };