const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = __dirname;
const fastText = path.join(
  root,
  "node_modules",
  "fasttext.js",
  "lib",
  "bin",
  "win32",
  "fastText.exe"
);
const trainFile = path.join(root, "data", "train_keyword3.csv");
const outputPrefix = path.join(root, "models", "pc_classifier");

if (!fs.existsSync(fastText) || !fs.existsSync(trainFile)) {
  console.error("找不到 FastText 執行檔或訓練資料，請確認檔案路徑。");
  process.exit(1);
}

const args = [
  "supervised",
  "-input", trainFile,
  "-output", outputPrefix,
  "-label", "__label__",
  "-epoch", "25",
  "-wordNgrams", "2",
  "-minn", "2",
  "-maxn", "5",
  "-loss", "softmax",
  "-thread", "4",
];

const training = spawn(fastText, args, { stdio: "inherit", windowsHide: true });

training.on("error", (error) => {
  console.error("訓練失敗：", error.message);
  process.exitCode = 1;
});

training.on("close", (code) => {
  if (code === 0) {
    console.log(`模型已建立：${outputPrefix}.bin`);
  } else {
    console.error(`訓練失敗，結束代碼為：${code}`);
    process.exitCode = code || 1;
  }
});