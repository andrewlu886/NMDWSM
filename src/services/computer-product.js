const { extractCPU, extractGPU } = require('./hardware');

function productTitle(value) {
  return String(value || '').normalize('NFKC')
    .replace(/(?:【[^】]*(?:加購價|加價購|加購優惠)[^】]*】|\[[^\]]*(?:加購價|加價購|加購優惠)[^\]]*\])/g, ' ');
}

const HOUSEHOLD_PRODUCT = /電蚊香|蚊香液|捕蚊燈|驅蚊器|香料研磨|調味料|磨豆機|研磨機|電動牙刷|沖牙機|吹風機|除毛機|美容儀|按摩器|按摩機/i;
const PC_CONTROLLER = /(?:\bPC\b|電腦|Windows).*(?:遊戲手把|遊戲手柄|搖桿|控制器|gamepad|controller)/i;

// Reject unrelated products even when their titles mention a PC or a matching model number.
const UNRELATED_PRODUCT = /電鑽|鏈鋸|電鋸|電剪|電動工具|手持工具|起子|砂輪機|修剪機|吹葉機|割草機|吸塵器|掃地機|空氣清淨機|除濕機|冷氣機|冰箱|洗衣機|食物處理器|調理機|果汁機|咖啡機|電鍋|電磁爐|電腦椅|電競椅|電腦桌|電競桌|餐桌|餐椅|折疊椅|球鞋|運動鞋|運動服|玩具|模型公仔|遊戲主機|\b(?:drill|chainsaw|lawn\s*mower|vacuum\s*cleaner|refrigerator|blender|gaming\s*chair|computer\s*desk|playstation|xbox|nintendo)\b/i;
const LAPTOP = /筆電|筆記型|laptop|notebook|macbook|chromebook|電競本/i;
const DESKTOP = /桌機|桌上型電腦|桌上型主機|套裝主機|電競主機|文書主機|桌電|桌上電腦|電腦主機|主機電腦|套裝電腦|電腦套裝|迷你(?:電腦|桌機)|mini\s*pc|desktop(?:\s*pc)?|個人電腦|all[- ]?in[- ]?one|一體成型電腦|工作站|伺服器|\b(?:imac|mac\s*mini|mac\s*studio)\b/i;
const COMPUTER_HARDWARE = /電腦|筆電|筆記型|顯示卡|顯卡|處理器|主機板|記憶體|硬碟|固態|機殼|散熱|水冷|螢幕|顯示器|鍵盤|滑鼠|網卡|路由器|交換器|電源供應器|\b(?:cpu|gpu|ssd|hdd|ram|ddr[3-6]|psu|nvme|(?:rtx|gtx|rx)\s*\d{3,4}|geforce|radeon|ryzen|xeon|threadripper|core\s*(?:ultra|i[3579])|thinkpad|zenbook|vivobook|ideapad|motherboard|graphics\s*card|video\s*card|monitor|keyboard|mouse|router|network\s*switch|power\s*supply|heatsink|cpu\s*cooler|nas)\b/i;

function isUnrelatedProduct(name) {
  const text = productTitle(name);
  return UNRELATED_PRODUCT.test(text) || HOUSEHOLD_PRODUCT.test(text);
}

function isComputerListing(name, productType, cpu = extractCPU(name), gpu = extractGPU(name)) {
  const text = productTitle(name);
  if (isUnrelatedProduct(text)) return false;
  if (PC_CONTROLLER.test(text)) return false;
  if (productType === 'laptop') return LAPTOP.test(text);
  return DESKTOP.test(text) || (cpu !== 'UNKNOWN' && gpu !== 'UNKNOWN');
}

function isComputerProduct(item) {
  const text = productTitle(item?.name || item?.title);
  if (!text || isUnrelatedProduct(text)) return false;
  // Use the title rather than seller descriptions, which may list unrelated search keywords.
  return PC_CONTROLLER.test(text) || LAPTOP.test(text) || DESKTOP.test(text) || COMPUTER_HARDWARE.test(text)
    || extractCPU(text) !== 'UNKNOWN' || extractGPU(text) !== 'UNKNOWN';
}

function matchesComputerSearch(item, keyword) {
  if (!isComputerProduct(item)) return false;
  const query = String(keyword || '').normalize('NFKC').replace(/\s+/g, '');
  const name = productTitle(item?.name || item?.title);
  if (/^(?:主機|桌機|桌電|桌上型電腦|電腦主機|套裝機|套裝主機|電競主機|文書主機|desktop(?:pc)?|pc)$/i.test(query)) {
    return isComputerListing(name, 'desktop');
  }
  if (/^(?:筆電|筆記型電腦|筆記本|laptop|notebook)$/i.test(query)) {
    return isComputerListing(name, 'laptop');
  }
  return true;
}

module.exports = { isUnrelatedProduct, isComputerListing, isComputerProduct, matchesComputerSearch };
