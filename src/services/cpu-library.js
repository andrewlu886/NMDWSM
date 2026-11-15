const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../data/cpu-library');

const indexes = new Map();
function readIndex(name = 'index') {
  try {
    const filename = path.join(root, name + '.json');
    const stamp = fs.statSync(filename).mtimeMs;
    if (indexes.get(name)?.stamp !== stamp) indexes.set(name, { stamp, data: JSON.parse(fs.readFileSync(filename, 'utf8')) });
    return indexes.get(name).data;
  }
  catch { return { version: null, images: [] }; }
}

// Exact canonical match only. No nearest SKU or appearance-based substitution.
function lookupCpuReferences(model, { includePrivate = false } = {}) {
  const index = readIndex();
  const images = index.images.filter(row => row.model === model).slice(0, 2).map(row => ({
    id: row.id, model: row.model, kind: row.kind, purposes: row.purposes,
    visibleText: row.visibleText, labelBox: row.labelBox,
    access: row.access,
    ...(includePrivate || row.access === 'public' ? {
      thumbnailUrl: `/api/cpu/references/${row.id}/thumbnail`,
      referenceUrl: `/api/cpu/references/${row.id}/reference`
    } : {})
  }));
  return { version: index.version, images };
}

function handleCpuReferenceRequest(req, res, url) {
  if (!/^\/api\/cpu\/(?:references|library)(?:\/|$)/.test(url.pathname)) return false;
  const send = (code, value) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  if (req.method !== 'GET') { send(405, { error: 'Method not allowed' }); return true; }
  // Local socket AND loopback Host: forwarded/tunnel requests never expose private assets.
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')
    && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];
  if (url.pathname === '/api/cpu/library') {
    if (!local) { send(404, { error: 'Private library' }); return true; }
    const { cpuModel } = require('./cpu-vision');
    const query = url.searchParams.get('model');
    const model = cpuModel(query);
    const index = readIndex('catalog');
    const rows = index.images.filter(row => row.review?.status !== 'excluded' && (!query || row.model === model));
    const offset = Math.max(0, Math.min(rows.length, parseInt(url.searchParams.get('offset'), 10) || 0));
    send(200, { version: index.version, total: rows.length, excluded: index.images.filter(row => row.review?.status === 'excluded').length,
      models: [...new Set(index.images.map(row => row.model))].sort(),
      images: rows.slice(offset, offset + 48).map(row => ({
        id: row.id, model: row.model, kind: row.kind, relative: row.relative,
        sha256: row.sha256, size: row.size, review: row.review, flags: row.flags,
        thumbnailUrl: `/api/cpu/library/${row.id}/thumbnail`, referenceUrl: `/api/cpu/library/${row.id}/reference`
      })) }); return true;
  }
  if (url.pathname === '/api/cpu/references') {
    const { cpuModel } = require('./cpu-vision');
    const model = cpuModel(url.searchParams.get('model'));
    send(200, lookupCpuReferences(model, { includePrivate: local })); return true;
  }
  const match = url.pathname.match(/^\/api\/cpu\/(references|library)\/([a-f0-9]{20})\/(thumbnail|reference)$/);
  const row = match && readIndex(match[1] === 'library' ? 'catalog' : 'index').images.find(item => item.id === match[2]);
  if (!row || row.review?.status === 'excluded' || (!local && row.access !== 'public')) { send(404, { error: 'Reference unavailable' }); return true; }
  const filename = row[match[3]];
  if (filename !== path.basename(filename || '')) { send(404, {}); return true; }
  try {
    const bytes = fs.readFileSync(path.join(root, filename));
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes);
  } catch { send(404, { error: 'Reference unavailable' }); }
  return true;
}

module.exports = { lookupCpuReferences, handleCpuReferenceRequest };
