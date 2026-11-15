const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
const {
  readConfiguration, requireModels, makeWebsiteEnvironment, findFreePort, warmModels, getJson, waitForWindow
} = require('../scripts/launch-website');

function temporaryDirectory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdwsm-launcher-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    const parent = fs.realpathSync(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(parent + 'nmdwsm-launcher-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

test('launcher respects the website environment and .env/key.env precedence', t => {
  const root = temporaryDirectory(t);
  fs.writeFileSync(path.join(root, '.env'), 'PORT=3010\nOLLAMA_MODEL=custom:text\nOLLAMA_VISION_MODEL=custom:vision\n');
  fs.writeFileSync(path.join(root, 'key.env'), 'PORT=9999\nOLLAMA_MODEL=wrong:model\nEXTRA_SETTING=retained\n');
  const config = readConfiguration(root, { PORT: '3020' });
  assert.equal(config.port, 3020);
  assert.equal(config.textModel, 'custom:text');
  assert.equal(config.visionModel, 'custom:vision');
  assert.equal(config.env.EXTRA_SETTING, 'retained');
  assert.equal(readConfiguration(root, {}).port, 3010);
  assert.throws(() => readConfiguration(root, { PORT: 'not-a-port' }), /PORT/);
});

test('private launch does not send shared gateway credentials or change the configured environment', () => {
  const env = { OLLAMA_BASE_URL: 'https://old.example', OLLAMA_API_KEY: 'private-token', OLLAMA_CF_ACCESS_CLIENT_ID: 'id', OLLAMA_CF_ACCESS_CLIENT_SECRET: 'secret', PTT_GATEWAY_URL: 'https://ptt.example', DB_PATH: 'private.db' };
  const result = makeWebsiteEnvironment({ env, textModel: 'text:a', visionModel: 'vision:b' }, 3001, 'http://127.0.0.1:12000');
  assert.equal(result.OLLAMA_BASE_URL, 'http://127.0.0.1:12000');
  assert.equal(result.OLLAMA_API_KEY, '');
  assert.equal(result.OLLAMA_CF_ACCESS_CLIENT_SECRET, '');
  assert.equal(result.PTT_GATEWAY_URL, '');
  assert.equal(result.DB_PATH, 'private.db');
  assert.equal(env.OLLAMA_API_KEY, 'private-token');
});

test('missing models fail before warming and return the exact download commands', async () => {
  assert.doesNotThrow(() => requireModels([{ name: 'text:latest' }], ['text']));
  const calls = [];
  await assert.rejects(warmModels('http://localhost', { textModel: 'text:a', visionModel: 'vision:b' }, new AbortController().signal,
    async (url) => { calls.push(url); return { models: [{ name: 'text:a' }] }; }, () => {}), /ollama pull vision:b/);
  assert.equal(calls.length, 1);
});

test('both models are warmed, text is warmed last, and VRAM eviction is reported accurately', async () => {
  const calls = [];
  const config = { textModel: 'text:a', visionModel: 'vision:b' };
  const request = async (url, options) => {
    calls.push({ url, options });
    return { models: [{ name: 'text:a' }, { name: 'vision:b' }] };
  };
  const ready = await warmModels('http://localhost', config, new AbortController().signal, request, () => {});
  const loads = calls.filter(call => call.url.endsWith('/api/generate'));
  assert.equal(loads.length, 2);
  assert.ok(loads.every(call => call.options.body.keep_alive === -1));
  assert.equal(loads.at(-1).options.body.model, 'text:a');
  assert.equal(loads.at(-1).options.body.options.num_ctx, 8192);
  assert.deepEqual(ready.deferredModels, []);
  assert.ok(calls.at(-1).url.endsWith('/api/ps'));
  await assert.rejects(warmModels('http://localhost', config, new AbortController().signal,
    async url => ({ models: url.endsWith('/api/ps') ? [{ name: 'vision:b' }] : [{ name: 'text:a' }, { name: 'vision:b' }] }), () => {}), /無法載入文字模型/);
  const limited = await warmModels('http://localhost', config, new AbortController().signal,
    async url => ({ models: url.endsWith('/api/ps') ? [{ name: 'text:a' }] : [{ name: 'text:a' }, { name: 'vision:b' }] }), () => {});
  assert.deepEqual(limited.residentModels, ['text:a']);
  assert.deepEqual(limited.deferredModels, ['vision:b']);
});

test('an occupied website port is not reused or terminated', async t => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const occupied = server.address().port;
  const selected = await findFreePort(occupied);
  assert.notEqual(selected, occupied);
  assert.ok(server.listening);
});

test('startup HTTP checks reject redirects and honor cancellation', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/ok' }); res.end(); }
    else if (req.url === '/ok') { res.end('{"ready":true}'); }
    // /slow intentionally waits until the client aborts.
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(await getJson(base + '/ok'), { ready: true });
  await assert.rejects(getJson(base + '/redirect'));
  await assert.rejects(getJson(base + '/slow', { signal: AbortSignal.timeout(50) }));
});

test('browser startup waits for its actual window and handles early exit or cancellation', async () => {
  const watcher = () => Object.assign(new EventEmitter(), { stdout: new PassThrough() });
  const ready = watcher();
  const pending = waitForWindow(ready, new AbortController().signal);
  ready.stdout.write('WINDOW_');
  ready.stdout.write('READY\r\n');
  await pending;
  assert.equal(ready.listenerCount('exit'), 0);
  const failed = watcher();
  const failure = assert.rejects(waitForWindow(failed, new AbortController().signal), /無法確認網站視窗/);
  failed.emit('exit', 1);
  await failure;
  const cancelled = watcher();
  const controller = new AbortController();
  const cancellation = assert.rejects(waitForWindow(cancelled, controller.signal));
  controller.abort();
  await cancellation;
});

test('Windows lifetime job kills child and grandchild when its owner is forcibly closed', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const root = temporaryDirectory(t);
  const statePath = path.join(root, 'pids.json');
  const lifetime = fs.readFileSync(path.join(__dirname, '../scripts/start-website.ps1'), 'utf8')
    .match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/)[1];
  const childScript = path.join(root, 'child.js');
  fs.writeFileSync(childScript, 'const {spawn}=require(\'child_process\');const fs=require(\'fs\');const child=spawn(process.execPath,[\'-e\',\'setInterval(()=>{},1000)\'],{windowsHide:true,stdio:\'ignore\'});fs.writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);');
  const quote = value => '\'' + value.replace(/'/g, '\'\'') + '\'';
  const command = `Add-Type -TypeDefinition @'\n${lifetime}\n'@\n[WebsiteProcessLifetime]::Attach()\n& ${quote(process.execPath)} ${quote(childScript)} ${quote(statePath)}`;
  const owner = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  owner.stderr.on('data', chunk => { errors += chunk.toString(); });
  t.after(() => { if (owner.exitCode === null) owner.kill(); });
  const deadline = Date.now() + 12000;
  while (!fs.existsSync(statePath) && owner.exitCode === null && Date.now() < deadline) await delay(100);
  assert.ok(fs.existsSync(statePath), 'child process did not start: ' + errors);
  const pids = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const running = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.ok(pids.every(running));
  owner.kill();
  const cleanupDeadline = Date.now() + 5000;
  while (pids.some(running) && Date.now() < cleanupDeadline) await delay(100);
  assert.ok(pids.every(pid => !running(pid)), 'a descendant remained after launcher shutdown');
});
