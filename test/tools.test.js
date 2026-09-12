const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('推薦的 CPU 與 GPU 會在資料載入後自動帶入瓦數計算器', () => {
  const recommendScript = fs.readFileSync(path.join(projectRoot, 'public', 'recommend.js'), 'utf8');
  const toolsPage = fs.readFileSync(path.join(projectRoot, 'public', 'tools.html'), 'utf8');

  assert.match(recommendScript, /calculatorLink\.href = getCalculatorUrl\(result\.recommendations\[0\]\)/);
  assert.match(recommendScript, /toolsLink\.href = getCalculatorUrl\(item\)/);
  assert.match(toolsPage, /Promise\.allSettled\(\[gpuDataRequest, cpuDataRequest\]\)/);
  assert.match(toolsPage, /\.then\(autoSelectModelFromURL\)/);
  assert.match(toolsPage, /const matchedCpuRow = findCpuRow\(queryCpu\)/);
});

test('電腦零件需選擇 CPU 或 GPU，並與主要用途分開', () => {
  const recommendPage = fs.readFileSync(path.join(projectRoot, 'public', 'recommend.html'), 'utf8');
  const recommendScript = fs.readFileSync(path.join(projectRoot, 'public', 'recommend.js'), 'utf8');

  assert.match(recommendPage, /id="usage-field"/);
  assert.match(recommendPage, /id="component-type-field" hidden/);
  assert.match(recommendPage, /id="componentType"[^>]*disabled/);
  assert.match(recommendPage, /<option value="cpu">處理器（CPU）<\/option>/);
  assert.match(recommendPage, /<option value="gpu">顯示卡（GPU）<\/option>/);
  assert.match(recommendScript, /componentTypeSelect\.required = isComponent/);
  assert.match(recommendScript, /componentTypeSelect\.focus\(\)/);
  assert.match(recommendScript, /value && value !== 'UNKNOWN'/);
});
