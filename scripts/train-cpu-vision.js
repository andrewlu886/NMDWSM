const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const python = process.env.CPU_VISION_PYTHON || path.join(root, '.cache/cpu-vision-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) {
  console.error('請先依 docs/cpu-vision.md 建立 CPU 模型 Python 環境。');
  process.exitCode = 1;
} else {
  const child = spawn(python, ['-u', path.join(__dirname, 'cpu_vision/train.py'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
