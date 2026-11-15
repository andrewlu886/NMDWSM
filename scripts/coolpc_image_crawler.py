#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CoolPC 清單圖片爬蟲:每個型號下載「有包裝」5 張、「無包裝」5 張。

安裝:
    pip install requests pillow ddgs

用法:
    python coolpc_image_crawler.py coolpc_models_single_unique.txt --dry-run      # 只解析清單、看資料夾結構,不連網
    python coolpc_image_crawler.py coolpc_models_single_unique.txt --match "rtx 5060" --limit 3   # 小量試跑
    python coolpc_image_crawler.py coolpc_models_single_unique.txt                # 全部下載(可中斷,再執行會續跑)
    python coolpc_image_crawler.py coolpc_models_single_unique.txt --verify gemma3:4b   # 用本機 Ollama 視覺模型過濾
    python coolpc_image_crawler.py --add "cpu|intel lga1700|Intel Core i3-12100" --verify gemma3:4b   # 單一型號試抓(例:i3-12100)

畫質規則:排除浮水印 / 廣告橫幅 / 價格貼紙 / 拼貼 / 渲染圖 / 明顯 P 圖;所有格式(含 webp)一律轉存為 .jpg。
前兩項靠標題關鍵字與長寬比做粗篩,真正判斷靠 --verify(強烈建議開)。

輸出結構:
    dataset/
      gpu/rtx 5060/asus dual-rtx5060-o8g/有包裝/01.jpg ... 05.jpg
                                         /無包裝/01.jpg ... 05.jpg
      ram/ddr4/<型號>/有包裝|無包裝/
      mb/amd am5/<型號>/有包裝|無包裝/        (腳位:amd am4 / amd am5 / intel lga1700 / intel lga1851)
      manifest.csv                           (每張圖的來源網址,方便日後檢查)
"""
import argparse
import base64
import csv
import hashlib
import html
import io
import json
import random
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

LABELS = ("有包裝", "無包裝")

# ----------------------------------------------------------------------------
# 清單解析
# ----------------------------------------------------------------------------
SECTION = {"主機板": "mb", "記憶體": "ram", "顯示卡": "gpu"}

BRANDS = {  # 清單中的品牌前綴 -> 英文名(搜尋用)
    "華碩": "ASUS", "微星": "MSI", "技嘉": "Gigabyte", "華擎": "ASRock",
    "威剛": "ADATA", "芝奇": "G.Skill", "海盜船": "Corsair", "美光": "Micron",
    "金士頓": "Kingston", "宏碁": "Acer", "十銓": "TeamGroup",
    "KLEVV(科賦)": "KLEVV", "UMAX": "UMAX", "Biwin": "Biwin", "Origin": "Origin Code",
    "NVIDIA": "NVIDIA", "MSI": "MSI", "Gigabyte": "Gigabyte", "INNO3D": "INNO3D", "ZOTAC": "ZOTAC", "ASUS": "ASUS", "NZXT": "NZXT",
}
PREFIXES = sorted(BRANDS, key=len, reverse=True)

CHIPSET_SOCKET = {}
for _c in "A320 A520 B350 B450 B550 X370 X470 X570".split():
    CHIPSET_SOCKET[_c] = "amd am4"
for _c in "A620 B650 X670 B840 B850 X870".split():
    CHIPSET_SOCKET[_c] = "amd am5"
for _c in "H610 B660 H670 Z690 H770 B760 Z790 W680".split():
    CHIPSET_SOCKET[_c] = "intel lga1700"
for _c in "H810 B860 H870 Z890 W880".split():
    CHIPSET_SOCKET[_c] = "intel lga1851"

CJK = r"[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]"
COLOR_MAP = [("冰魄白", "ice white"), ("黑銀", "black silver"), ("銀白", "silver white"),
             ("白色", "white"), ("黑色", "black"), ("白", "white"), ("黑", "black"),
             ("銀", "silver"), ("灰", "gray")]


def dedupe_words(s):
    out = []
    for w in s.split():
        if not out or out[-1].lower() != w.lower():
            out.append(w)
    return " ".join(out)


def clean_name(s):
    """去掉中文行銷字樣與括號雜訊,保留英文型號 / 料號 / 顏色。"""
    s = re.sub(r"【[^】]*】", " ", s)
    s = re.sub(r"\((?:雙通|四通)\s*(\d+)\s*G?B?\s*[xX*]\s*(\d+)\)", r" \2x\1GB ", s)
    s = re.sub(r"\(\d+\*\d+\)", " ", s)  # (1024*8) 之類的雜訊

    def paren(m):
        inner = m.group(1)
        return " " if re.search(CJK, inner) else f" {inner} "

    s = re.sub(r"\(([^()]*)\)", paren, s)
    for zh, en in COLOR_MAP:
        s = s.replace(zh, f" {en} ")
    s = re.sub(CJK, " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return dedupe_words(s)


def sanitize(s, maxlen=100):
    s = s.replace("*", "x")
    s = re.sub(r'[\\/:?"<>|]', "-", s)
    s = re.sub(r"\s+", " ", s).strip(" .").lower()
    if len(s) > maxlen:
        s = s[: maxlen - 9].rstrip() + "-" + hashlib.md5(s.encode()).hexdigest()[:8]
    return s


def split_brand(line):
    for p in PREFIXES:
        if line.startswith(p):
            return p, line[len(p):].strip()
    parts = line.split(" ", 1)
    return parts[0], (parts[1] if len(parts) > 1 else "")


def group_of(category, raw):
    up = raw.upper()
    if category == "gpu":
        m = re.search(r"(GTX|RTX)\s*-?\s*(\d{4})(?!\d)\s*(TI)?\s*(SUPER)?", up)
        if m:
            return f"{m.group(1).lower()} {m.group(2)}" + (" ti" if m.group(3) else "") + (" super" if m.group(4) else "")
    elif category == "ram":
        m = re.search(r"DDR([45])", up)
        if m:
            return f"ddr{m.group(1)}"
    elif category == "mb":
        m = re.search(r"(?<![A-Z0-9])([ABHWXZ])(\d{3})", up)
        if m:
            return CHIPSET_SOCKET.get(m.group(1) + m.group(2), "unknown socket")
    return "unknown"


@dataclass
class Item:
    category: str
    group: str
    folder: str
    brand_en: str
    brand_zh: str
    name: str
    raw: str

    @property
    def path_str(self):
        return f"{self.category}/{self.group}/{self.folder}"

    @property
    def q_en(self):
        return dedupe_words(f"{self.brand_en} {self.name}")

    @property
    def q_zh(self):
        b = re.sub(r"[()]", "", self.brand_zh)
        return dedupe_words(f"{b} {self.name}")


def parse_list(path):
    cat, items = None, {}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.endswith((":", "：")):
            cat = next((v for k, v in SECTION.items() if line.startswith(k)), None)
            continue
        if cat is None and re.search(r"(?:RTX|GTX)\s*-?\s*\d{4}", line, re.I):
            cat = "gpu"
        if cat is None or "全配" in line:  # 跳過整機組合包
            continue
        brand_zh, rest = split_brand(line)
        brand_en = BRANDS.get(brand_zh, brand_zh)
        name = clean_name(rest)
        folder = sanitize(dedupe_words(f"{brand_en} {name}"))
        it = Item(cat, group_of(cat, line), folder, brand_en, brand_zh, name, line)
        items.setdefault(it.path_str, it)  # 清理後同名 = 同一產品,只抓一次
    return list(items.values())


# ----------------------------------------------------------------------------
# 搜尋
# ----------------------------------------------------------------------------
QUERIES = {
    "gpu": {"有包裝": ["{en} graphics card retail box packaging", "{zh} 顯示卡 外盒 包裝",
                       "{en} box photo"],
            "無包裝": ["{en} graphics card product photo", "{zh} 顯示卡 裸卡",
                       "{en} graphics card white background"]},
    "mb": {"有包裝": ["{en} motherboard retail box packaging", "{zh} 主機板 外盒 包裝",
                      "{en} box photo"],
           "無包裝": ["{en} motherboard top view", "{zh} 主機板 裸板",
                      "{en} motherboard white background"]},
    "ram": {"有包裝": ["{en} memory retail box packaging", "{zh} 記憶體 外盒 包裝",
                       "{en} box photo"],
            "無包裝": ["{en} ram memory module", "{zh} 記憶體 條",
                       "{en} memory white background"]},
    "cpu": {"有包裝": ["{en} processor retail box", "{zh} 處理器 盒裝 外盒",
                       "{en} boxed cpu photo"],
            "無包裝": ["{en} processor cpu chip", "{zh} 處理器 散片",
                       "{en} cpu tray white background"]},
}
BOX_WORDS = ("box", "packag", "retail", "unbox", "外盒", "包裝", "盒裝", "開箱", "盒")
# 標題/網址含這些字 = 促銷圖、賣場橫幅、渲染圖、拼貼圖,直接排除(寧缺勿濫)
BAD_WORDS = ("sale", "promo", "discount", "coupon", "deal", "banner", "watermark",
             "render", "3d model", "mockup", "collage", "comparison",
             "特價", "促銷", "優惠", "折扣", "限時", "活動", "免運", "現貨", "渲染", "效果圖", "合成")
BLOCK_DOMAINS = ("pinterest", "alamy", "shutterstock", "gettyimages", "dreamstime",
                 "istockphoto", "depositphotos", "123rf", "hardwareand.co")
EMPTY_BOX = re.compile(r"空盒|不含顯示卡|盒子而已|empty\s+box|box\s+only", re.I)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")


def get_session():
    import requests
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"})
    return s


def dimension(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def search_ddgs(q, n):
    try:
        from ddgs import DDGS
    except ImportError:
        from duckduckgo_search import DDGS
    res = DDGS(timeout=20).images(q, max_results=n)
    return [{"url": r["image"], "title": r.get("title", ""),
             "w": dimension(r.get("width")), "h": dimension(r.get("height"))} for r in (res or []) if r.get("image")]


def search_bing(session, q, n):
    r = session.get("https://www.bing.com/images/async",
                    params={"q": q, "first": 0, "count": min(n, 100), "adlt": "off", "mmasync": 1},
                    timeout=20)
    out = []
    for m in re.finditer(r'class="iusc"[^>]*?\sm="([^"]+)"', r.text):
        try:
            d = json.loads(html.unescape(m.group(1)))
        except Exception:
            continue
        if d.get("murl"):
            out.append({"url": d["murl"], "title": re.sub(r"[\ue000\ue001]", "", d.get("t", "")),
                        "w": None, "h": None})
    return out


def search(session, q, n):
    for attempt in range(2):
        try:
            res = search_ddgs(q, n)
            if res:
                return res
        except Exception as e:
            print(f"    [search] ddgs 失敗 ({type(e).__name__}),稍後重試", flush=True)
            time.sleep(5 * (attempt + 1))
    try:
        return search_bing(session, q, n)
    except Exception as e:
        print(f"    [search] bing 也失敗: {type(e).__name__}", flush=True)
        return []


def rank(cands, label, min_side):
    keep = []
    for c in cands:
        if any(d in urlparse(c["url"]).netloc.lower() for d in BLOCK_DOMAINS):
            continue
        if c["w"] and c["h"] and min(c["w"], c["h"]) < min_side:
            continue
        if any(w in (c["title"] + " " + c["url"]).lower() for w in BAD_WORDS):
            continue
        if EMPTY_BOX.search(c["title"]):
            continue
        keep.append(c)

    def hits(c):
        t = (c["title"] + " " + c["url"]).lower()
        return sum(w in t for w in BOX_WORDS)

    # 有包裝:標題/網址含 box 字樣者優先;無包裝:不含者優先
    return sorted(keep, key=lambda c: -hits(c) if label == "有包裝" else hits(c))


# ----------------------------------------------------------------------------
# 下載 / 驗證
# ----------------------------------------------------------------------------
def fetch(session, url):
    try:
        p = urlparse(url)
        r = session.get(url, timeout=15, headers={"Referer": f"{p.scheme}://{p.netloc}/"})
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image"):
            return None
        data = r.content
        return data if 10_000 <= len(data) <= 15_000_000 else None
    except Exception:
        return None


def load_image(data, min_side):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 50_000_000
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return None
    w, h = im.size
    # 長寬比限制 0.5~2.0:排除廣告橫幅、長條拼貼圖。webp/png/gif 等都會在下方轉成 RGB,最後存成 .jpg
    if min(w, h) < min_side or not (0.5 <= w / h <= 2.0):
        return None
    try:
        im.seek(0)  # 動態 webp / gif 只取第一幀
    except Exception:
        pass
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")
    im.thumbnail((1600, 1600))
    return im


def ahash(im):
    from PIL import Image
    px = list(im.convert("L").resize((8, 8), Image.LANCZOS).getdata())
    avg = sum(px) / 64
    return sum(1 << i for i, p in enumerate(px) if p > avg)


def is_dup(h, hashes):
    return any(bin(h ^ x).count("1") <= 5 for x in hashes)


CLEAN_RULES = (
    "A GOOD image is a single, natural-looking product photo, either on a plain/white background or "
    "on an ordinary surface, like these references: a real photo of a retail box sitting on a floor, "
    "or a bare chip on a plain white background. "
    "A BAD image has ANY of: a watermark or website/shop logo overlaid on the picture; promotional "
    "text, banners, price tags, discount stickers, badges or arrows added on top; an added frame or "
    "border; a collage or several panels; an obviously photoshopped, pasted-in or heavily retouched "
    "look; a CGI render or illustration instead of a photo; several different products; "
    "a person's face; or the product being mostly cropped out."
)
VERIFY_PROMPT = {
    "有包裝": "You are checking training images of a PC component. " + CLEAN_RULES +
              "\nQuestion 1: does the image show the product's printed retail box/packaging as the main "
              "subject? Question 2: is it a GOOD image (none of the BAD conditions)?"
              "\nReply in exactly this format and nothing else:\nBOXED: YES or NO\nCLEAN: YES or NO",
    "無包裝": "You are checking training images of a PC component. " + CLEAN_RULES +
              "\nQuestion 1: does the image show the bare product itself, with NO retail box/packaging as "
              "the main subject? Question 2: is it a GOOD image (none of the BAD conditions)?"
              "\nReply in exactly this format and nothing else:\nBARE: YES or NO\nCLEAN: YES or NO",
}
PHOTO_CHECK = (
    "Look critically at this image as a training-data auditor. The desired result is a natural "
    "photograph of a single real physical GPU or its real retail box, taken with a camera. "
    "Does it contain a third-party watermark/shop logo, a promo badge or caption added to the "
    "image, a marketing composition with several objects, or a digitally rendered/isolated GPU? "
    "Be conservative. Reply ONLY two lines: PHOTO: YES or NO; OVERLAY: YES or NO. "
    "PHOTO means a natural camera photo. OVERLAY means any added logo/text/badge apart from "
    "printing physically on the hardware/box."
)


def ollama_ok(session, im, label, model, url, expected=""):
    """用 Ollama 視覺模型同時檢查「有/無包裝」與「畫面乾淨(無浮水印/廣告/P圖感)」。"""
    im2 = im.copy()
    im2.thumbnail((896, 896))
    buf = io.BytesIO()
    im2.save(buf, "JPEG", quality=88)
    try:
        r = session.post(f"{url}/api/chat", timeout=180, json={
            "model": model, "stream": False, "options": {"temperature": 0},
            "messages": [{"role": "user", "content": VERIFY_PROMPT[label] + "\nExpected exact product: " + expected +
                          "\nAlso reply MATCH: YES or NO. MATCH is YES only when the visible model marking "
                          "or unique physical features identify this exact brand and variant (Ti/SUPER, memory, color). "
                          "If uncertain or a different product, MATCH: NO. Reject CGI renders, promotional composites "
                          "and digitally pasted products; prefer real hardware photographed on an ordinary surface.",
                          "images": [base64.b64encode(buf.getvalue()).decode()]}]})
        r.raise_for_status()
        text = r.json()["message"]["content"].upper()
    except Exception as e:
        print(f"    [verify] Ollama 呼叫失敗 ({type(e).__name__}),跳過未驗證圖片", flush=True)
        return False
    key = "BOXED" if label == "有包裝" else "BARE"
    type_ok = re.search(rf"{key}\W*YES", text) is not None
    clean_ok = re.search(r"CLEAN\W*YES", text) is not None
    if not (type_ok and clean_ok and re.search(r"MATCH\W*YES", text)):
        return False
    # An independent second look catches some watermark/composite false positives
    # from the first product/packaging check. Keep doubtful photos for manual review.
    try:
        audit = session.post(f"{url}/api/chat", timeout=180, json={
            "model": model, "stream": False, "options": {"temperature": 0},
            "messages": [{"role": "user", "content": PHOTO_CHECK,
                          "images": [base64.b64encode(buf.getvalue()).decode()]}]})
        audit.raise_for_status()
        answer = audit.json()["message"]["content"].upper()
        return bool(re.search(r"PHOTO\W*YES", answer) and re.search(r"OVERLAY\W*NO", answer))
    except Exception as error:
        print(f"    [verify] second pass failed ({type(error).__name__}); skipped image", flush=True)
        return False


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def crawl_item(item, root, args, session, pool, writer, mf):
    base = root / item.category / item.group / item.folder
    seen_urls, hashes, result = set(), [], {}
    for lab in LABELS:  # 續跑:讀入已存在圖片的 hash,避免同型號重複
        d = base / lab
        if d.exists():
            from PIL import Image
            for f in d.glob("*.jpg"):
                try:
                    hashes.append(ahash(Image.open(f).convert("RGB")))
                except Exception:
                    pass

    t0 = time.time()
    for lab in LABELS:
        d = base / lab
        d.mkdir(parents=True, exist_ok=True)
        got = len(list(d.glob("*.jpg")))
        fruitless = 0
        for tmpl in QUERIES[item.category][lab]:
            if got >= args.per_class:
                break
            # 提前終止:連續 patience 次搜尋都沒新增圖,或單一型號超時,就放棄補滿、換下一個
            if fruitless >= args.patience or time.time() - t0 > args.item_timeout:
                break
            before = got
            q = tmpl.format(en=item.q_en, zh=item.q_zh)
            cands = [c for c in rank(search(session, q, args.pool), lab, args.min_side)
                     if c["url"] not in seen_urls]
            for i in range(0, len(cands), args.workers):
                if got >= args.per_class or time.time() - t0 > args.item_timeout:
                    break
                chunk = cands[i:i + args.workers]
                seen_urls.update(c["url"] for c in chunk)
                datas = list(pool.map(lambda c: fetch(session, c["url"]), chunk))
                for c, data in zip(chunk, datas):
                    if got >= args.per_class or time.time() - t0 > args.item_timeout:
                        break
                    if not data:
                        continue
                    im = load_image(data, args.min_side)
                    if im is None:
                        continue
                    h = ahash(im)
                    if is_dup(h, hashes):
                        continue
                    if args.verify and not ollama_ok(session, im, lab, args.verify, args.ollama_url, item.q_en):
                        continue
                    got += 1
                    hashes.append(h)
                    index = 1
                    while (d / f"{index:02d}.jpg").exists():
                        index += 1
                    fname = f"{index:02d}.jpg"
                    with (d / fname).open("xb") as image_file:
                        im.save(image_file, "JPEG", quality=92)
                    writer.writerow([item.category, item.group, item.folder, lab, fname,
                                     c["url"], c["title"]])
                    mf.flush()
                    print(f"    [saved] {item.path_str}/{lab}/{fname}", flush=True)
            fruitless = fruitless + 1 if got == before else 0
            time.sleep(args.delay + random.random())
        result[lab] = got
    return result


def main():
    ap = argparse.ArgumentParser(description="CoolPC 清單圖片爬蟲(有包裝/無包裝各 N 張)")
    ap.add_argument("list_file", nargs="?", help="CoolPC 清單 txt(只用 --add 時可省略)")
    ap.add_argument("--add", action="append", metavar="CAT|GROUP|NAME",
                    help="手動加一個型號,可重複。例:--add \"cpu|intel lga1700|Intel Core i3-12100\"")
    ap.add_argument("--out", default="dataset")
    ap.add_argument("--gpu-series", choices=["40"], help="只收集 GeForce RTX 40 系列")
    ap.add_argument("--report-prefix", default="", help="缺額/進度報告前綴，避免覆蓋其他批次")
    ap.add_argument("--per-class", type=int, default=5, help="每個型號、每種(有/無包裝)張數")
    ap.add_argument("--only", help="只抓某些類別,例:gpu,ram,mb")
    ap.add_argument("--match", help="只抓路徑含此字串的型號,例:'rtx 5060'")
    ap.add_argument("--limit", type=int, help="只處理前 N 個型號(試跑用)")
    ap.add_argument("--pool", type=int, default=40, help="每次搜尋取的候選圖數")
    ap.add_argument("--workers", type=int, default=8, help="同時下載的執行緒數")
    ap.add_argument("--delay", type=float, default=2.0, help="每次搜尋後的等待秒數(防被封)")
    ap.add_argument("--min-side", type=int, default=300, help="圖片短邊最小像素")
    ap.add_argument("--patience", type=int, default=2,
                    help="連續幾次搜尋都沒新增圖就提前放棄該類(沒湊滿也繼續下一個型號)")
    ap.add_argument("--item-timeout", type=int, default=180, help="單一型號最長花費秒數,超過就跳過")
    ap.add_argument("--verify", metavar="MODEL", help="用 Ollama 視覺模型驗證有/無包裝,例:gemma3:4b")
    ap.add_argument("--ollama-url", default="http://localhost:11434")
    ap.add_argument("--dry-run", action="store_true", help="只解析清單與印出結構,不連網")
    args = ap.parse_args()

    items = parse_list(args.list_file) if args.list_file else []
    for spec in args.add or []:
        cat, grp, name = [x.strip() for x in spec.split("|", 2)]
        items.append(Item(cat, sanitize(grp), sanitize(name), "", "", name, name))
    if not items:
        sys.exit("沒有任何型號:請給清單檔或使用 --add")
    if args.only:
        wanted = set(args.only.split(","))
        items = [i for i in items if i.category in wanted]
    if args.match:
        items = [i for i in items if args.match.lower() in i.path_str.lower()]
    if args.gpu_series:
        items = [i for i in items if i.category == "gpu" and re.search(r"RTX\s*-?\s*40[6-9]0(?!\d)", i.raw, re.I)]
    if args.limit:
        items = items[: args.limit]
    if not items:
        sys.exit("篩選後沒有型號")

    if args.dry_run:
        print(f"型號(資料夾)數:{len(items)};預計圖片數:{len(items) * len(LABELS) * args.per_class}")
        for cat, n in Counter(i.category for i in items).items():
            print(f"  {cat}: {n}")
        for (cat, grp), n in sorted(Counter((i.category, i.group) for i in items).items()):
            print(f"    {cat}/{grp}: {n}")
        print("範例:")
        for i in items[:: max(1, len(items) // 12)]:
            print(f"  {i.path_str}/{{{'/'.join(LABELS)}}}    q={i.q_en!r}")
        bad = [i.raw for i in items if i.group.startswith("unknown")]
        if bad:
            print("無法判斷分組的項目:", *bad, sep="\n  ")
        return

    if args.verify:
        s = get_session()
        try:
            s.get(f"{args.ollama_url}/api/tags", timeout=5).raise_for_status()
        except Exception:
            sys.exit(f"連不到 Ollama ({args.ollama_url}),請先啟動並 `ollama pull {args.verify}`")

    root = Path(args.out)
    root.mkdir(parents=True, exist_ok=True)
    mpath = root / "manifest.csv"
    new = not mpath.exists()
    session = get_session()
    short = []
    status_path = root / (args.report_prefix + "progress.json")
    processed = 0
    interrupted = False
    def status(state, current=""):
        temp = status_path.with_suffix(".tmp")
        temp.write_text(json.dumps({"state": state, "processed": processed, "total": len(items),
                                   "current": current, "short_models": len(short), "updated": time.time()},
                                  ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(status_path)
    status("running")
    with open(mpath, "a", newline="", encoding="utf-8-sig") as mf, \
            ThreadPoolExecutor(max_workers=args.workers) as pool:
        writer = csv.writer(mf)
        if new:
            writer.writerow(["category", "group", "folder", "label", "file", "url", "title"])
        try:
            for n, it in enumerate(items, 1):
                status("running", it.path_str)
                res = crawl_item(it, root, args, session, pool, writer, mf)
                processed = n
                line = "  ".join(f"{k} {v}/{args.per_class}" for k, v in res.items())
                print(f"[{n}/{len(items)}] {it.path_str}  {line}", flush=True)
                if any(v < args.per_class for v in res.values()):
                    short.append((it.path_str, res))
                status("running", it.path_str)
        except KeyboardInterrupt:
            interrupted = True
            status("interrupted")
            print("\n已中斷,重新執行同樣指令即可續跑。")
    if short:
        with open(root / (args.report_prefix + "shortfall.csv"), "w", newline="", encoding="utf-8-sig") as sf:
            w = csv.writer(sf)
            w.writerow(["path", "有包裝", "無包裝"])
            for p, r in short:
                w.writerow([p, r.get("有包裝", 0), r.get("無包裝", 0)])
        print(f"\n共 {len(short)} 個型號未達 {args.per_class} 張(可稍後重跑補抓):")
        for p, r in short:
            print(f"  {p}  {r}")

    status("interrupted" if interrupted else "finished")
    if not interrupted:
        print(f"Finished {time.strftime('%Y-%m-%d %H:%M:%S')} processed={processed}/{len(items)}", flush=True)


if __name__ == "__main__":
    main()
