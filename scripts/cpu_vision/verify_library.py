"""Verify source immutability and private derivative constraints, without model inference."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    root = ROOT / 'data/cpu-library'
    read = lambda name: json.loads((root / name).read_text(encoding='utf-8'))
    inventory, catalog, selected = read('inventory.json'), read('catalog.json'), read('index.json')
    audit = json.loads((ROOT / '.cache/cpu-vision/dataset.json').read_text(encoding='utf-8'))
    prior = {r['relative']:r['sha256'] for r in audit['rows']}
    exclusions = read('evaluation-exclusions.json')
    assert len(inventory['images']) == len(catalog['images'])
    assert len(selected['images']) <= 208
    assert len({r['model'] for r in selected['images']}) == len(inventory['models'])
    checked = set()
    for row in catalog['images']:
        raw = (args.source / row['relative']).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == row['sha256'] == prior[row['relative']], row['relative']
        assert row['access'] == 'private'
        assert row['sha256'] in exclusions['knownSourceSha256']
        for variant in ['thumbnail','reference']:
            path = root / row[variant]
            assert path.stat().st_size <= 1800000
            with Image.open(path) as image:
                assert not image.getexif()
                assert image.width <= row['size'][0] and image.height <= row['size'][1]
                assert image.width*image.height <= 16000000
                assert max(image.size) <= (480 if variant == 'thumbnail' else 4096)
            checked.add(path.name)
    for row in selected['images']:
        assert row['review']['status'] == 'approved'
        assert not set(row['flags']) - {'small_image'}
        assert row['visibleText'] and len(row['labelBox']) == 4
        x,y,w,h = row['labelBox']
        assert 0 <= x < 1 and 0 <= y < 1 and w > 0 and h > 0 and x+w <= 1.0001 and y+h <= 1.0001
    report = {'date':'2026-10-15','sourceImages':len(catalog['images']),
              'sourceHashesUnchanged':True,'models':len(inventory['models']),
              'curatedReferences':len(selected['images']),'privateDerivatives':len(checked),
              'exifRemoved':True,'noUpscaling':True,'uploadLimitsRespected':True,
              'reviewCounts':dict(Counter(r['review']['status'] for r in catalog['images'])),
              'independentEvaluation':False}
    (ROOT / 'models/cpu-library/verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))


if __name__ == '__main__': main()
