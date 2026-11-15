const fs = require('node:fs');
const path = require('node:path');
const { checkProduct } = require('./product-availability');
const MINUTE = 60000, RETENTION = 7 * 86400000;

function createMarketLifecycle({ file = process.env.MARKET_STATE_PATH || path.join(__dirname, '../../.cache/market-lifecycle-v1.json'), now = Date.now, check = checkProduct, budgetMs = 20000 } = {}) {
  let state = { version: 1, products: {}, queries: {}, cleanupAt: 0, discoveryAt: 0 };
  if (file) { try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (saved.version === 1 && saved.products && saved.queries) state = saved; } catch {} }
  const pending = new Map();
  let activeChecks = 0;
  const waiters = [];
  const cooldowns = new Map();
  async function limitedCheck(item, signal) {
    if (activeChecks >= 4) await new Promise(resolve => waiters.push(resolve));
    activeChecks++;
    try {
      const host = new URL(item.url).hostname;
      if ((cooldowns.get(host) || 0) > now()) return { availability: 'unknown', reason: 'source_cooldown' };
      const verdict = signal?.aborted ? { availability: 'unknown', reason: 'verification_budget' } : await check(item, { signal });
      if (['rate_limited', 'source_unavailable', 'challenge'].includes(verdict.reason)) cooldowns.set(host, now() + 5 * MINUTE);
      return verdict;
    }
    finally { activeChecks--; waiters.shift()?.(); }
  }
  let running = false;
  const keyOf = item => item.url;
  function save() {
    for (const [key, row] of Object.entries(state.products)) if (now() - row.lastSeen > RETENTION) delete state.products[key];
    for (const [key, row] of Object.entries(state.queries)) if (now() - row.lastSeen > RETENTION) delete state.queries[key];
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(state));
    fs.renameSync(file + '.tmp', file);
  }
  const queryKey = options => JSON.stringify([options.keyword.toLowerCase().trim(), [...new Set(Array.isArray(options.platforms) ? options.platforms : String(options.platforms || 'all').split(','))].sort()]);
  function retained(options) {
    return (state.queries[queryKey(options)]?.urls || []).map(url => state.products[url])
      .filter(row => row && now() - row.lastSeen < RETENTION && row.item.condition !== 'used').map(row => row.item);
  }
  function observeUsed(options, items, sourceStatus) {
    const found = new Set(items.map(item => item.url));
    for (const url of state.queries[queryKey(options)]?.urls || []) {
      const row = state.products[url];
      if (!row || row.item.condition !== 'used' || found.has(url) || !sourceStatus[row.item.source]) continue;
      row.availability = 'unknown';
      row.reason = sourceStatus[row.item.source].status === 'unavailable' ? 'source_unavailable' : 'listing_not_reconfirmed';
      row.availabilityCheckedAt = now();
      row.nextCheckAt = now() + 30 * MINUTE;
    }
  }
  function trackQuery(options, items = []) {
    const platforms = [...new Set(Array.isArray(options.platforms) ? options.platforms : String(options.platforms || 'all').split(','))].sort();
    const key = JSON.stringify([options.keyword.toLowerCase().trim(), platforms]);
    const previous = state.queries[key];
    state.queries[key] = { options: { keyword: options.keyword, platforms }, count: (previous?.count || 0) + (options.maintenance ? 0 : 1), lastSeen: options.maintenance ? previous?.lastSeen || now() : now(), nextCheckAt: previous?.nextCheckAt || 0,
      urls: [...new Set([...(previous?.urls || []), ...items.map(i => i.url)])].slice(-500) };
  }
  async function verify(item, signal, touch = true) {
    const key = keyOf(item);
    const old = state.products[key];
    if (old && touch) old.lastSeen = now();
    if (old && old.availabilityCheckedAt > now() - MINUTE && old.item.name === item.name) return old;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      let verdict;
      // Used listings have already passed a source-specific detail check in this request.
      if (item.condition === 'used' && item.verifiedAt > now() - MINUTE) verdict = { availability: 'available', reason: 'source_detail' };
      else if (item.condition === 'used') verdict = { availability: 'unknown', reason: 'requires_source_refresh' };
      else verdict = await limitedCheck(item, signal);
      const time = now();
      const checkedAt = item.condition === 'used' && verdict.availability === 'available' ? item.verifiedAt : time;
      const row = { item: { ...item }, ...verdict, availabilityCheckedAt: checkedAt,
        lastSeen: touch ? time : old?.lastSeen || time, nextCheckAt: time + (verdict.availability === 'unknown' ? 5 : 30) * MINUTE };
      state.products[key] = row;
      return row;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  async function filter(items, { touch = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    const result = [], hidden = [], failures = {};
    let cursor = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
        while (cursor < items.length) {
          const item = items[cursor++];
          let row;
          if (controller.signal.aborted) {
            row = { item, availability: 'unknown', reason: 'verification_budget', availabilityCheckedAt: now(), lastSeen: touch ? now() : state.products[item.url]?.lastSeen || now(), nextCheckAt: now() + 5 * MINUTE };
            state.products[item.url] = row;
          } else {
            try { row = await verify(item, controller.signal, touch); }
            catch { row = { item, availability: 'unknown', reason: 'verification_failed', availabilityCheckedAt: now(), lastSeen: now(), nextCheckAt: now() + 5 * MINUTE }; state.products[item.url] = row; }
          }
          if (row.availability === 'available') {
            const fresh = { ...item, availability: row.availability, availabilityCheckedAt: row.availabilityCheckedAt };
            if (row.price) {
              if (row.currency === 'USD') { fresh.currency = 'USD'; fresh.originalPrice = `USD $${row.price}`; }
              else fresh.price = String(row.price);
            }
            result.push(fresh);
          } else {
            hidden.push(item.url);
            if (row.availability === 'unknown') failures[item.source || item.platform] = (failures[item.source || item.platform] || 0) + 1;
          }
        }
      }));
    } finally { clearTimeout(timer); save(); }
    return { products: result, hidden, failures };
  }
  async function runDue(search) {
    if (running) return false;
    running = true;
    try {
      if (now() - state.cleanupAt >= 30 * MINUTE) {
        const due = Object.values(state.products).filter(r => now() - r.lastSeen < RETENTION && r.nextCheckAt <= now())
          .sort((a, b) => a.nextCheckAt - b.nextCheckAt).slice(0, 100);
        const retail = due.filter(r => r.item.condition !== 'used');
        const checked = await filter(retail.map(r => r.item), { touch: false });
        require('./market-cache').removeMarketProducts(checked.hidden);
        // Used sources must be checked through their gateway rather than direct requests on Render.
        const sources = new Set(due.filter(r => r.item.condition === 'used').map(r => r.item.source));
        const recent = Object.values(state.queries).filter(q => now() - q.lastSeen < RETENTION)
          .sort((a, b) => a.nextCheckAt - b.nextCheckAt);
        for (const q of recent.filter(q => q.options.platforms.includes('all') || q.options.platforms.some(s => sources.has(s))).slice(0, 10)) {
          try { await search({ ...q.options, forceRefresh: true, maintenance: true }); } catch {}
          q.nextCheckAt = now() + 30 * MINUTE;
        }
        state.cleanupAt = now();
      }
      if (now() - state.discoveryAt >= 6 * 60 * MINUTE) {
        const queries = Object.values(state.queries).filter(q => now() - q.lastSeen < RETENTION)
          .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, 50);
        for (const q of queries) {
          try { await search({ ...q.options, forceRefresh: true, maintenance: true }); }
          catch { q.nextCheckAt = now() + 30 * MINUTE; }
        }
        state.discoveryAt = now();
      }
      save();
      return true;
    } finally { running = false; }
  }
  function start(search) {
    const tick = () => runDue(search).catch(error => console.warn('[商品狀態] 更新未完成：', error.code || error.name));
    const startup = setTimeout(tick, 10000); startup.unref();
    const timer = setInterval(tick, MINUTE); timer.unref();
    return () => { clearTimeout(startup); clearInterval(timer); };
  }
  return { filter, trackQuery, retained, observeUsed, runDue, start, state, save };
}
let singleton;
function getMarketLifecycle() { return singleton ||= createMarketLifecycle(); }
module.exports = { createMarketLifecycle, getMarketLifecycle };
