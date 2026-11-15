const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

const execute = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function readConfiguration(root = PROJECT_ROOT, environment = process.env) {
  let dotenv;
  try { dotenv = require('dotenv'); }
  catch { throw new Error('缺少網站套件，請先在專案目錄執行 npm install。'); }
  const env = { ...environment };
  for (const filename of ['.env', 'key.env']) {
    const fullPath = path.join(root, filename);
    if (!fs.existsSync(fullPath)) continue;
    for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(fullPath)))) {
      if (env[key] === undefined) env[key] = value;
    }
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必須為 1 至 65535 的整數。');
  return {
    env, port,
    textModel: env.OLLAMA_MODEL || 'llama3.1:8b',
    visionModel: env.OLLAMA_VISION_MODEL || 'gemma3:4b'
  };
}

function normalizeModel(name) {
  return name.slice(name.lastIndexOf('/') + 1).includes(':') ? name : name + ':latest';
}

function requireModels(installed, models) {
  const names = new Set(installed.map(row => normalizeModel(row.name || row.model || '')));
  const missing = models.filter(model => !names.has(normalizeModel(model)));
  if (missing.length) {
    throw new Error('尚未安裝模型，請先執行：\n' + missing.map(model => '  ollama pull ' + model).join('\n'));
  }
}

function makeWebsiteEnvironment(config, port, ollamaUrl) {
  return {
    ...config.env,
    PORT: String(port),
    OLLAMA_BASE_URL: ollamaUrl,
    OLLAMA_MODEL: config.textModel,
    OLLAMA_VISION_MODEL: config.visionModel,
    // This launch uses its own loopback-only Ollama, not a configured tunnel.
    OLLAMA_API_KEY: '',
    OLLAMA_CF_ACCESS_CLIENT_ID: '',
    OLLAMA_CF_ACCESS_CLIENT_SECRET: '',
    PTT_GATEWAY_URL: '', PTT_GATEWAY_API_KEY: '',
    CAROUSELL_GATEWAY_URL: '', CAROUSELL_GATEWAY_API_KEY: ''
  };
}

async function findFreePort(preferred = 0) {
  for (let offset = 0; offset < 20; offset++) {
    const candidate = preferred ? preferred + offset : 0;
    if (candidate > 65535) break;
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', error => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(null);
        else reject(error);
      });
      // The website currently binds all interfaces, so check the same binding.
      server.listen(candidate, () => {
        const allocated = server.address().port;
        server.close(error => error ? reject(error) : resolve(allocated));
      });
    });
    if (port) return port;
  }
  throw new Error('找不到可使用的本機連接埠。');
}

async function getJson(url, { signal, timeout = 5000, body } = {}) {
  const signals = [AbortSignal.timeout(timeout)];
  if (signal) signals.push(signal);
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any(signals), redirect: 'error'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} (${new URL(url).pathname})`);
  return response.json();
}

function isRunning(child) {
  return child && child.pid && child.exitCode === null && child.signalCode === null;
}

async function waitForHttp(url, child, signal, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (!isRunning(child)) throw new Error('啟動程序已結束，請查看 logs/website-launcher 下的紀錄。');
    try { return await getJson(url, { signal, timeout: 1500 }); }
    catch (error) {
      signal.throwIfAborted();
      await delay(300, undefined, { signal });
    }
  }
  throw new Error('等待服務啟動逾時，請查看 logs/website-launcher 下的紀錄。');
}

async function warmModels(baseUrl, config, signal, request = getJson, report = console.log) {
  // Warm vision first and text last. GPUs with limited VRAM may evict the first
  // runner; keep normal conversation ready rather than failing the whole launch.
  const models = [...new Set([config.visionModel, config.textModel])];
  const installed = await request(baseUrl + '/api/tags', { signal });
  requireModels(installed.models || [], models);
  for (const model of models) {
    report(`正在載入模型 ${model}，首次啟動可能需要一些時間…`);
    await request(baseUrl + '/api/generate', {
      signal, timeout: 600000,
      body: {
        model, stream: false, keep_alive: -1,
        ...(model === config.textModel ? { options: { num_ctx: 8192 } } : {})
      }
    });
  }
  const resident = await request(baseUrl + '/api/ps', { signal });
  try { requireModels(resident.models || [], [config.textModel]); }
  catch { throw new Error('無法載入文字模型，請確認可用記憶體，或在 .env 選擇較小的模型。'); }
  const residentNames = new Set((resident.models || []).map(row => normalizeModel(row.name || row.model || '')));
  const deferredModels = models.filter(model => !residentNames.has(normalizeModel(model)));
  if (deferredModels.length) report('顯示記憶體有限：文字模型已就緒，圖片模型會在辨識時自動切換載入。');
  return { residentModels: models.filter(model => residentNames.has(normalizeModel(model))), deferredModels };
}

async function findOllama(env) {
  const candidates = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs/Ollama/ollama.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Ollama/ollama.exe')
  ];
  try {
    const { stdout } = await execute('where.exe', ['ollama'], { windowsHide: true });
    candidates.unshift(...stdout.trim().split(/\r?\n/));
  } catch { /* The Windows installer does not always update the current PATH. */ }
  const filename = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!filename) throw new Error('找不到 Ollama，請先安裝 Ollama，再重新開啟啟動檔。');
  return filename;
}

function findBrowser(env) {
  const candidates = [];
  const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  for (const relative of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
    for (const root of roots) candidates.push(path.join(root, relative));
  }
  const filename = candidates.find(candidate => fs.existsSync(candidate));
  if (!filename) throw new Error('找不到 Microsoft Edge 或 Google Chrome，無法建立可自動關閉服務的網站視窗。');
  return filename;
}

async function stopChild(child) {
  if (!isRunning(child)) return;
  try {
    if (process.platform === 'win32') {
      await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 });
    } else { child.kill('SIGTERM'); }
  } catch { /* The Windows lifetime job also cleans up descendants on exit. */ }
}

function waitForWindow(child, signal) {
  return new Promise((resolve, reject) => {
    let output = '';
    const finish = error => {
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', finish);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes('WINDOW_READY')) finish();
    };
    const onExit = () => finish(new Error('無法確認網站視窗已開啟。'));
    const onAbort = () => finish(signal.reason);
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', finish);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function launch(options = {}) {
  if (process.platform !== 'win32') throw new Error('請在 Windows 雙擊「啟動網站.cmd」。');
  const config = readConfiguration();
  const ollama = await findOllama(config.env);
  const browser = options.headless ? null : findBrowser(config.env);
  for (const dependency of ['sqlite3', 'axios', 'cheerio']) {
    try { require.resolve(dependency); }
    catch { throw new Error('缺少網站套件，請先在專案目錄執行 npm install。'); }
  }
  if (options.checkOnly) {
    console.log(`啟動環境檢查通過。文字模型：${config.textModel}；圖片模型：${config.visionModel}。`);
    if (browser) console.log(`網站瀏覽器：${path.basename(browser) === 'chrome.exe' ? 'Google Chrome' : 'Microsoft Edge'}。`);
    console.log('正式啟動時會檢查模型是否已下載，並預載模型；顯存不足時圖片模型自動按需載入。');
    return;
  }

  const logsDir = path.join(PROJECT_ROOT, 'logs/website-launcher');
  fs.mkdirSync(logsDir, { recursive: true });
  const statePath = path.join(logsDir, 'state.json');
  const state = { supervisorPid: process.pid, startedAt: new Date().toISOString(), models: [config.textModel, config.visionModel] };
  const saveState = phase => {
    state.phase = phase;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  };
  const children = [];
  const logDescriptors = [];
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let ollamaUrl;
  let stopTimer;
  let ready = false;
  const startService = (executable, args, env, logName) => {
    const descriptor = fs.openSync(path.join(logsDir, logName), 'w');
    logDescriptors.push(descriptor);
    const child = spawn(executable, args, {
      cwd: PROJECT_ROOT, env, windowsHide: true, stdio: ['ignore', descriptor, descriptor]
    });
    child.on('error', () => stop());
    children.push(child);
    return child;
  };

  try {
    const port = await findFreePort(config.port);
    let ollamaPort;
    do { ollamaPort = await findFreePort(); } while (ollamaPort === port);
    ollamaUrl = `http://127.0.0.1:${ollamaPort}`;
    state.ollamaUrl = ollamaUrl;
    state.websiteUrl = `http://127.0.0.1:${port}`;
    console.log('正在啟動網站專用的 AI 服務…');
    const ai = startService(ollama, ['serve'], {
      ...config.env, OLLAMA_HOST: `127.0.0.1:${ollamaPort}`,
      OLLAMA_KEEP_ALIVE: '-1', OLLAMA_MAX_LOADED_MODELS: '2', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_QUEUE: '8'
    }, 'ollama.log');
    state.ollamaPid = ai.pid;
    saveState('loading-models');
    await waitForHttp(ollamaUrl + '/api/tags', ai, controller.signal);
    const modelStatus = await warmModels(ollamaUrl, config, controller.signal);
    Object.assign(state, modelStatus);

    console.log('模型已載入，正在啟動網站…');
    const website = startService(process.execPath, [path.join(PROJECT_ROOT, 'public/server.js')],
      makeWebsiteEnvironment(config, port, ollamaUrl), 'website.log');
    state.websitePid = website.pid;
    saveState('starting-website');
    const status = await waitForHttp(state.websiteUrl + '/api/chat/status', website, controller.signal);
    if (!status.available || !status.modelInstalled || !status.visionModelInstalled) {
      throw new Error('網站無法確認 AI 模型就緒，請查看 logs/website-launcher/website.log。');
    }

    let app;
    let windowWatcher;
    if (browser) {
      const profile = path.join(PROJECT_ROOT, '.cache/website-launcher/browser');
      fs.mkdirSync(profile, { recursive: true });
      app = spawn(browser, [
        '--new-window', state.websiteUrl, '--user-data-dir=' + profile,
        '--no-first-run', '--no-default-browser-check', '--disable-background-mode',
        '--disable-session-crashed-bubble'
      ], { windowsHide: false, stdio: 'ignore', env: config.env });
      app.on('error', () => stop());
      children.push(app);
      state.browserPid = app.pid;
      windowWatcher = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'watch-website-window.ps1'), '-BrowserProcessId', String(app.pid)
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      children.push(windowWatcher);
      state.windowWatcherPid = windowWatcher.pid;
      await waitForWindow(windowWatcher, controller.signal);
    }
    ready = true;
    saveState('ready');
    console.log(`網站與 AI 已就緒：${state.websiteUrl}`);
    console.log('關閉網站視窗或本啟動視窗的 X，即會關閉網站及這次啟動的 AI 模型。');
    if (options.stopAfterSeconds > 0) stopTimer = setTimeout(stop, options.stopAfterSeconds * 1000);
    while (!controller.signal.aborted && (!windowWatcher || isRunning(windowWatcher))) {
      if (!isRunning(ai) || !isRunning(website)) throw new Error('網站或 AI 服務已意外結束，請查看 logs/website-launcher。');
      await delay(250);
    }
    if (windowWatcher?.exitCode && !controller.signal.aborted) throw new Error('網站視窗監控意外結束。');
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(stopTimer);
    controller.abort();
    console.log('正在關閉網站並釋放 AI 模型…');
    for (const child of [...children].reverse()) await stopChild(child);
    for (const descriptor of logDescriptors) fs.closeSync(descriptor);
    fs.writeFileSync(path.join(logsDir, 'last-session.json'), JSON.stringify({ ...state, phase: 'stopped', wasReady: ready, stoppedAt: new Date().toISOString() }, null, 2));
    fs.rmSync(statePath, { force: true });
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    console.log('網站與本次 AI 服務已關閉。');
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const stopIndex = args.indexOf('--stop-after');
  launch({
    checkOnly: args.includes('--check'), headless: args.includes('--headless'),
    stopAfterSeconds: stopIndex < 0 ? 0 : Number(args[stopIndex + 1])
  }).catch(error => {
    console.error('啟動失敗：' + error.message);
    process.exitCode = 1;
  });
}

module.exports = { readConfiguration, normalizeModel, requireModels, makeWebsiteEnvironment, findFreePort, warmModels, getJson, waitForWindow };
