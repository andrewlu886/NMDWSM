const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROMPT_VERSION = 'hardware-visible-label-v2';
const CPU_POLICY_VERSION = 'physical-evidence-v2';
const HARDWARE_PROMPT = 'Inspect this computer hardware photo. Return only four lines: Category: CPU|graphics card|motherboard|memory|unknown, Model: full visible model ONLY (no serial number) or unknown, Evidence: transcribe the complete printed model line including all digits and suffixes, Confidence: high|low. For a CPU with its box, use the clearest complete model label on either item. If two different complete models are readable, list both separated by /. Series names alone are insufficient. Never infer a model from appearance or invent missing text.';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function cpuVersion() {
  try {
    const root = path.resolve(__dirname, '../..');
    const metadata = fs.readFileSync(path.join(root, 'models/cpu-vision/metadata.json'));
    const weights = fs.statSync(path.join(root, 'models/cpu-vision/model.pt'));
    const code = ['src/services/cpu-vision.js', 'scripts/cpu_vision/common.py'].map(file => fs.readFileSync(path.join(root, file)));
    return { version: JSON.parse(metadata).version, fingerprint: hash(Buffer.concat([metadata, ...code, Buffer.from(`${weights.size}:${weights.mtimeMs}`)])) };
  } catch { return { version: 'unavailable', fingerprint: 'unavailable' }; }
}

function imageIdentity(base64) {
  const bytes = Buffer.from(base64, 'base64');
  let width = null, height = null;
  if (bytes.length >= 24 && bytes.subarray(1, 4).toString() === 'PNG') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += length + 2;
    }
  } else if (bytes.length >= 30 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    const type = bytes.subarray(12, 16).toString();
    if (type === 'VP8X') { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    else if (type === 'VP8 ') { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
    else if (type === 'VP8L') {
      const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }
  return { imageHash: hash(bytes), bytes: bytes.length, width, height };
}

function writeImageDiagnostic(record) {
  // A bounded operational log; never write image bytes, OCR text or chat content.
  try {
    const file = path.resolve(__dirname, '../../logs/image-recognition.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      const backup = file + '.1';
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      fs.renameSync(file, backup);
    }
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  } catch { /* Diagnostic storage failure cannot change recognition or trust. */ }
}

module.exports = { PROMPT_VERSION, CPU_POLICY_VERSION, HARDWARE_PROMPT, cpuVersion, imageIdentity, writeImageDiagnostic };
