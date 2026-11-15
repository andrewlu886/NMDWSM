// Repeat original bytes with different feature captions, including a new server
// process to bypass its verified-photo cache. No filename or expected SKU is sent.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { readConfiguration, makeWebsiteEnvironment, findFreePort } = require('./launch-website');
const root = path.resolve(__dirname, '..');

async function main() {
  const files = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (!files.length) throw new Error('請提供一個或多個本機圖片路徑。');
  const ollamaUrl = process.argv.find(arg => arg.startsWith('--ollama-url='))?.slice(13) || 'http://127.0.0.1:11434';
  const parsed = new URL(ollamaUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error('測試僅使用本機 Ollama。');
  const output = path.join(root, '.cache/image-consistency'); fs.mkdirSync(output, { recursive: true });
  const config = readConfiguration();
  const before = await (await fetch(ollamaUrl + '/api/ps')).json();
  const loaded = new Set((before.models || []).map(model => model.name));
  const report = { startedAt: new Date().toISOString(), originalHistoricalUploadsAvailable: false,
    filenameSentToModel: false, note: '提供的本機圖片用於重現；不宣稱是舊請求的原始上傳位元組。', samples: [] };
  let child;
  async function start() {
    const port = await findFreePort(3910);
    const wrapper = "require('./public/server');process.on('message',m=>{if(m?.type==='stop'){require('./src/services/cpu-vision').stopWorker();process.exit(0);}});process.on('disconnect',()=>{require('./src/services/cpu-vision').stopWorker();process.exit(0);});";
    child = spawn(process.execPath, ['-e', wrapper], { cwd: root, windowsHide: true,
      env: { ...makeWebsiteEnvironment(config, port, ollamaUrl), DB_PATH: ':memory:' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(base + '/api/chat/status', { signal: AbortSignal.timeout(2000) })).ok) return base; } catch {}
      if (child.exitCode !== null) throw new Error('測試網站啟動失敗。');
      await delay(100);
    }
    throw new Error('測試網站啟動逾時。');
  }
  async function stop() {
    if (!child) return;
    const current = child;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(current.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          else current.kill();
        } catch { reject(new Error(`無法關閉測試網站 PID ${current.pid}，停止建立更多測試程序。`)); }
      }, 4000);
      current.once('exit', () => { clearTimeout(timer); resolve(); });
      if (current.exitCode !== null) { clearTimeout(timer); resolve(); }
      else current.send({ type: 'stop' }, error => { if (error) { clearTimeout(timer); reject(error); } });
    });
    child = null;
  }
  try {
    for (const file of files) {
      const bytes = fs.readFileSync(path.resolve(file));
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      let base = await start();
      const captions = ['請辨識這張硬體圖片', '這是什麼 CPU', '這是我的 CPU，幫我做市價查詢', '幫我估價'];
      const sample = { file: path.basename(file), imageHash: hash, runs: [] }; report.samples.push(sample);
      for (const [index, caption] of [...captions, ...captions].entries()) {
        if (index >= captions.length) { await stop(); base = await start(); }
        const started = Date.now();
        const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recognitionOnly: true, routeFeatures: true, messages: [{ role: 'user', content: caption, images: [bytes.toString('base64')] }] }),
          signal: AbortSignal.timeout(75000) });
        const result = await response.json();
        const run = { caption, freshServer: index === 0 || index >= captions.length, elapsedMs: Date.now() - started,
          success: result.success, recognition: result.cpuRecognition, diagnostics: result.recognitionDiagnostics, message: result.message };
        sample.runs.push(run);
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ file: sample.file, index, success: result.success, model: result.cpuRecognition?.model,
          candidates: result.cpuRecognition?.candidates, status: result.cpuRecognition?.status, elapsedMs: run.elapsedMs, cacheHit: result.recognitionDiagnostics?.cacheHit }));
        if (!response.ok || !result.success || result.recognitionDiagnostics?.imageHash !== hash) throw new Error('辨識失敗或實際送出圖片雜湊不符。');
      }
      const signatures = sample.runs.map(run => JSON.stringify([run.recognition?.status, run.recognition?.model, run.recognition?.candidates]));
      sample.consistent = new Set(signatures).size === 1;
      await stop();
    }
    report.passed = report.samples.every(sample => sample.consistent);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await stop();
    for (const model of [config.visionModel, config.textModel]) {
      if (!loaded.has(model)) await fetch(ollamaUrl + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(15000) }).catch(() => {});
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
