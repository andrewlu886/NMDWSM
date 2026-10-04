const { extractCPU, extractGPU } = require('./hardware');
const { classifyProduct } = require('./product-classifier');
const policy = require('../../public/market-search-policy');

function productTitle(value) {
  return String(value || '').normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:效能同等|效能等同|效能相當|性能相當)(?:於)?\s*(?:RTX|GTX|RX)\s*\d{3,4}(?:\s*(?:Ti|SUPER|XT))?/gi, ' ')
    .replace(/(?:【[^】]*(?:加購價|加價購|加購優惠|搭購優惠)[^】]*】|\[[^\]]*(?:加購價|加價購|加購優惠|搭購優惠)[^\]]*\])/g, ' ');
}

const PC_CONTROLLER = /(?:PC|電腦|Windows).*(?:手把|手柄|搖桿|控制器|gamepad|controller)|(?:手把|手柄|搖桿|控制器|gamepad|controller).*(?:PC|電腦|Windows)/i;
const UNRELATED = /電鑽|鏈鋸|電鋸|電剪|電動工具|手持工具|電動起子|砂輪機|修剪機|吹葉機|割草機|吸塵器|掃地機|空氣清淨機|除濕機|冷氣機|冰箱|洗衣機|食物處理器|調理機|果汁機|咖啡機|電鍋|電磁爐|電腦椅|電競椅|辦公椅|人體工學椅|電腦桌(?!機)|電競桌(?!機)|(?<!文)書桌|升降桌|餐桌|餐椅|折疊椅|便椅|麻將|沙發|駕駛艙|運動鞋|球鞋|運動服|玩具|公仔|抱枕|造型貼紙|型號貼紙|電蚊香|蚊香液|防蚊液|捕蚊燈|驅蚊器|香料研磨|調味料|磨豆機|電動牙刷|沖牙機|吹風機|除毛機|美容儀|按摩器|按摩機|飲水機|iPhone|Galaxy|ROG\s*Phone|手機主機|手機空機|\b(?:drill|chainsaw|lawn\s*mower|vacuum\s*cleaner|refrigerator|blender|gaming\s*chair|computer\s*desk)\b/i;
const LAPTOP = /筆電|筆記型|laptop|notebook|macbook|chromebook|電競本/i;
const DESKTOP = /桌機|桌上型電腦|桌上型主機|套裝主機|電競主機|文書主機|商用主機|桌電|桌上電腦|電腦主機|主機電腦|套裝電腦|電腦套裝|迷你(?:電腦|桌機)|mini\s*pc|desktop(?:\s*pc)?|個人電腦|all[- ]?in[- ]?one|一體成型電腦|工作站|伺服器|工控機|\b(?:imac|mac\s*mini|mac\s*studio)\b/i;
const HARDWARE = /電腦|筆電|筆記型|顯示卡|顯卡|處理器|主機板|記憶體|硬碟|固態|機殼|散熱|水冷|螢幕|顯示器|鍵盤|滑鼠|網卡|路由器|交換器|電源供應器|\b(?:cpu|gpu|ssd|hdd|ram|ddr[3-6]|psu|nvme|geforce|radeon|ryzen|xeon|threadripper|thinkpad|zenbook|vivobook|ideapad|motherboard|monitor|keyboard|mouse|router|nas)\b/i;
const GPU_FAN_ACCESSORY = /顯(?:示)?卡(?:專用|替換|更換)?(?:散熱)?(?:器)?風扇|繪圖卡(?:專用|替換|更換)?(?:散熱)?(?:器)?風扇/i;

function isUnrelatedProduct(name) {
  const text = productTitle(name)
    .replace(/(?:支援|適用|相容|連接)\s*(?:Apple\s*)?(?:iPhone|Galaxy)[a-z0-9]*/gi, '')
    .replace(/球鞋造型(?=電腦主機|機殼)/g, '')
    .replace(/公仔(?:平臺|平台|展示架)/g, '');
  if (UNRELATED.test(text) || /^(?:.{0,20})手機(?:\s*\d+\s*GB)?$/i.test(text.trim())) return true;
  if (PC_CONTROLLER.test(text)) return false;
  if (/掌上遊戲機|Switch\s*(?:2|OLED|主機|電光)|Nintendo|任天堂|PlayStation|Xbox|\bPS[1-5]\b/i.test(text)) return true;
  const found = policy.models(text);
  return /遊戲主機/.test(text) && !(found.some(m => m.category === 'part_cpu') && found.some(m => m.category === 'part_gpu'));
}

function classifyComputerProduct(name, predict = classifyProduct) {
  const text = productTitle(name);
  if (!text.trim() || isUnrelatedProduct(text)) return { label: 'not_pc', score: 1, source: 'rule' };
  const prediction = predict(text);
  const rule = label => ({ label, score: 1, source: 'rule' });
  const found = policy.models(text);
  // Explicit product/compatibility language wins over model names mentioned in the title.
  if (PC_CONTROLLER.test(text)) return rule('accessory_controller');
  if (GPU_FAN_ACCESSORY.test(text) || /不含\s*(?:CPU|處理器|顯卡|顯示卡)|(?:處理器|CPU|顯卡|顯示卡)空盒|顯卡支架|主機(?:托架|支架)|(?:顯卡|RTX|GTX|RX).*?(?:延長線|轉接線|替換風扇)/i.test(text)) return rule('accessory');
  if (/散熱器|塔式散熱|CPU\s*塔散|水冷頭|誰稜頭|替換散熱風扇|CPU\s*散熱風扇/i.test(text)
    && !/附(?:贈)?(?:原廠)?散熱器|含原廠散熱器/.test(text)) return rule('part_cooling');
  if (/主機板(?:組合|套餐)|升級套餐|CPU主板組合|(?:搭|加|\+).*主機板|跨類.*套餐|(?:顯示卡|顯卡).*加.*電源.*組合|雙零件套餐/i.test(text)) return rule('bundle');
  if (/工業機殼|伺服器機殼|主機機箱/i.test(text)) return rule('part_case');
  if (/電競桌機|桌上型電腦|(?:文書|商用|套裝|電競|電腦)主機|套裝機/i.test(text)) return rule('whole_desktop');
  if (found.some(m => m.category === 'part_cpu') && found.some(m => m.category === 'part_gpu')) return rule(LAPTOP.test(text) ? 'whole_laptop' : 'whole_desktop');
  if (found.some(m => m.category === 'part_cpu' && /^(?:u|h|hx)$/.test(m.suffix)) && /\d+\s*G(?:B)?\s*\/\s*\d+\s*(?:G|T)/i.test(text)) return rule('whole_laptop');
  if (/^(?:二手|中古|全新)?\s*(?:電腦)?機殼/i.test(text)) return rule('part_case');
  if (/^(?:桌機|筆電|Laptop)?\s*DDR[345]\s+\d+GB$/i.test(text.trim())) return rule('part_ram');
  // Older GeForce cards often list only their vendor SKU, not RTX/GTX or the word 'graphics'.
  if (/(?:\bGT\s*\d{3,4}\b|\bN\d{3}K?-\dG)/i.test(text) && /DDR|MHz|HDMI|DVI|VGA/i.test(text)) return rule('part_gpu');
  // Known component labels prevent 'laptop RAM' from becoming a whole laptop.
  if (prediction && prediction.score >= 0.6 && /^(?:part_|accessory)/.test(prediction.label)) return { ...prediction, source: 'model' };
  if (DESKTOP.test(text)) return rule('whole_desktop');
  if (LAPTOP.test(text)) return rule('whole_laptop');
  if (prediction && prediction.score >= 0.5) return { ...prediction, source: 'model' };
  // A model-only listing still has useful type evidence; accessories already handled above.
  if (found.length && new Set(found.map(m => m.category)).size === 1) return rule(found[0].category);
  if (/DDR[345]|記憶體/i.test(text)) return rule('part_ram');
  if (/主機板/i.test(text)) return rule('part_motherboard');
  if (/SSD|固態/i.test(text)) return rule('part_ssd');
  if (/電源供應器|\bPSU\b/i.test(text)) return rule('part_psu');
  if (/機殼/.test(text)) return rule('part_case');
  if (HARDWARE.test(text)) return { label: 'accessory', score: 0, source: 'fallback' };
  return { label: 'not_pc', score: 0, source: 'fallback' };
}

function isComputerListing(name, productType, cpu = extractCPU(name), gpu = extractGPU(name)) {
  const result = classifyComputerProduct(name);
  if (result.label === 'not_pc') return false;
  if (productType === 'laptop') return result.label === 'whole_laptop';
  return result.label === 'whole_desktop' || (result.source === 'fallback' && cpu !== 'UNKNOWN' && gpu !== 'UNKNOWN');
}

function isComputerProduct(item) {
  return classifyComputerProduct(item?.name || item?.title).label !== 'not_pc';
}

function matchesComputerSearch(item, keyword, { precise = false, predict = classifyProduct } = {}) {
  const name = productTitle(item?.name || item?.title);
  const result = classifyComputerProduct(name, predict);
  if (result.label === 'not_pc') return false;
  const target = policy.intent(keyword);
  if (target.category === 'part_gpu' && GPU_FAN_ACCESSORY.test(name)) return false;
  if (target.kind === 'model') {
    const canonical = value => policy.compact(value).replace(/華碩/g, 'asus').replace(/微星/g, 'msi').replace(/技嘉/g, 'gigabyte')
      .replace(/英特爾|intelcore/g, 'intel').replace(/geforce|顯示卡|顯卡|處理器|cpu|gpu/g, '').replace(/gb/g, 'g');
    const extra = target.raw ? canonical(String(keyword).replace(target.raw, '')) : '';
    return (!extra || canonical(name).includes(extra)) && policy.matchesModel(name, target, precise)
      && (!precise || (result.label === target.category && result.source !== 'fallback'));
  }
  if (target.kind === 'category') {
    if (/^whole_/.test(target.category) || precise) return result.label === target.category && result.source !== 'fallback';
    return result.label === target.category || policy.compact(name).includes(policy.compact(keyword));
  }
  if (/^(?:電腦|電腦產品|電腦零件|硬體)$/i.test(policy.compact(keyword))) return true;
  return policy.compact(name).includes(policy.compact(keyword));
}

module.exports = { productTitle, isUnrelatedProduct, classifyComputerProduct, isComputerListing, isComputerProduct, matchesComputerSearch };
