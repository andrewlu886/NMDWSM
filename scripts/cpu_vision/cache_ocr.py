"""Parallel held-out OCR preparation; independent workers never write the shared cache."""
import concurrent.futures
import json
import multiprocessing
from pathlib import Path
from common import ROOT, MODEL_DIR


def process_image(row):
    import numpy as np
    from PIL import Image, ImageOps
    global reader
    with Image.open(row['path']) as opened:
        image = ImageOps.exif_transpose(opened).convert('RGB')
        image.thumbnail((1280, 1280))
        result = [[text, float(score)] for _, text, score in reader.readtext(
            np.asarray(image), canvas_size=1280, workers=0)]
    return row['sha256'], result


def initialize():
    import easyocr
    import torch
    torch.set_num_threads(2)
    global reader
    reader = easyocr.Reader(['en'], gpu=False, model_storage_directory=str(MODEL_DIR / 'ocr'),
                            download_enabled=False, verbose=False)


def main():
    cache = ROOT / '.cache' / 'cpu-vision'
    dataset = json.loads((cache / 'dataset.json').read_text(encoding='utf-8'))
    destination = cache / 'ocr.json'
    ocr = json.loads(destination.read_text(encoding='utf-8')) if destination.exists() else {}
    remaining = [row for row in dataset['rows'] if row.get('split') in ['validation', 'test'] and row['sha256'] not in ocr]
    print(f'Cached {len(ocr)}, remaining {len(remaining)}', flush=True)
    with concurrent.futures.ProcessPoolExecutor(max_workers=2, initializer=initialize) as executor:
        futures = [executor.submit(process_image, row) for row in remaining]
        for i, future in enumerate(concurrent.futures.as_completed(futures)):
            key, result = future.result()
            ocr[key] = result
            if i % 10 == 0 or i == len(futures) - 1:
                temporary = destination.with_suffix('.tmp')
                temporary.write_text(json.dumps(ocr, ensure_ascii=False), encoding='utf-8')
                temporary.replace(destination)
                print(f'OCR cached {len(ocr)}', flush=True)


if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
