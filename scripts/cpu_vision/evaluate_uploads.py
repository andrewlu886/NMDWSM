"""Secondary smoke sample after browser-like JPEG resize, without policy tuning."""
import concurrent.futures
import io
import json
import random
import time
from PIL import Image, ImageOps
from common import ROOT, MODEL_DIR, Recognizer


def initialize():
    import torch
    torch.set_num_threads(2)
    global recognizer
    recognizer = Recognizer()


def evaluate(row):
    started = time.monotonic()
    with Image.open(row['path']) as opened:
        image = ImageOps.exif_transpose(opened).convert('RGB')
        image.thumbnail((1024, 1024))
        encoded = io.BytesIO()
        image.save(encoded, format='JPEG', quality=78)
        encoded.seek(0)
        with Image.open(encoded) as uploaded:
            result = recognizer.recognize(uploaded)
    return {'image': row['relative'], 'truth': row['label'], 'seconds': round(time.monotonic() - started, 3), **result}


def main():
    dataset = json.loads((ROOT / '.cache/cpu-vision/dataset.json').read_text(encoding='utf-8'))
    rows = [row for row in dataset['rows'] if row.get('split') == 'test']
    sample = random.Random(9012026).sample(rows, min(50, len(rows)))
    with concurrent.futures.ProcessPoolExecutor(max_workers=2, initializer=initialize) as executor:
        futures = [executor.submit(evaluate, row) for row in sample]
        results = []
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            if len(results) % 10 == 0:
                print(f'Upload smoke {len(results)}/{len(sample)}', flush=True)
    accepted = sum(item['accepted'] for item in results)
    correct = sum(item['accepted'] and item['label'] == item['truth'] for item in results)
    report = {'description': '50 random test images, approximate browser 1024px/JPEG quality78; Pillow encoding differs from browser canvas. No threshold tuning.',
              'samples': len(results), 'accepted': accepted, 'correct': correct,
              'precision': correct / accepted if accepted else None, 'coverage': accepted / len(results),
              'predictions': results}
    (MODEL_DIR / 'report-web-upload.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    summary = f'\n## 網站壓縮圖片抽測\n\n固定種子從 test 抽 {len(results)} 張圖片，以 1024px／JPEG 品質 78 模擬上傳；{accepted} 張通過核對，其中 {correct} 張正確。涵蓋率 {report["coverage"]:.1%}。\n\n這不是外部獨立測試集，Pillow 編碼也與瀏覽器 canvas 有差異；此檢查未調整核對門檻。詳見 report-web-upload.json。\n'
    markdown_path = MODEL_DIR / 'report.md'
    markdown = markdown_path.read_text(encoding='utf-8').split('\n## 網站壓縮圖片抽測')[0]
    markdown_path.write_text(markdown + summary, encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'predictions'}), flush=True)


if __name__ == '__main__':
    main()
