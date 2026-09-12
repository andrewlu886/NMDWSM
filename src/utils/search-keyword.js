function normalizeSearchKeyword(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '');
}

function matchesSearchKeyword(text, keyword) {
  const normalizedKeyword = normalizeSearchKeyword(keyword).toLowerCase();
  if (!normalizedKeyword) return false;
  return normalizeSearchKeyword(text).toLowerCase().includes(normalizedKeyword);
}

module.exports = {
  normalizeSearchKeyword,
  matchesSearchKeyword
};
