const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const target=path.resolve(__dirname,'../.env.ai-gateway');
try {
  fs.writeFileSync(target,'AI_GATEWAY_TOKEN='+crypto.randomBytes(32).toString('hex')+'\nAI_GATEWAY_PORT=11435\nAI_GATEWAY_MAX_CONCURRENT=2\nAI_GATEWAY_TIMEOUT_MS=120000\n',{flag:'wx',mode:0o600});
  console.log('已建立 .env.ai-gateway；將 AI_GATEWAY_TOKEN 的值填入 Render 的 OLLAMA_API_KEY。密鑰不會輸出到終端。');
} catch(error) {if(error.code==='EEXIST')console.log('.env.ai-gateway 已存在，保留原有密鑰。');else throw error;}
