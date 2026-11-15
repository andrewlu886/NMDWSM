"""Read-only source audit and reproducible private CPU reference pack.

Run with --source PATH. Review decisions are separate from machine suggestions.
No image is published or admitted without an explicit visual-review record.
"""
import argparse
import hashlib
import io
import json
from collections import Counter, defaultdict
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[2]


def read(path, default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def canonical(label):
    return label.replace('R', 'Ryzen ', 1).replace('-', ' ') if label.startswith('R') else label


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/cpu-library')
    parser.add_argument('--reviews', type=Path, default=ROOT / 'models/cpu-library/reviews.json')
    parser.add_argument('--skip-contact-sheets', action='store_true')
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if output == source or source in output.parents:
        raise ValueError('Output must be outside source images')
    audit = read(ROOT / '.cache/cpu-vision/dataset.json', {'rows': []})
    prior = {r['relative']: r for r in audit['rows']}
    conflicts = {p for group in audit.get('crossLabelConflicts', []) for p in group}
    flagged = {r['image'] for r in read(ROOT / 'models/cpu-vision/label-review.json', [])}
    report = read(ROOT / 'models/cpu-vision/report.json', {})
    predictions = {r['image']: r for split in report.get('evaluation', {}).values()
                   for r in split.get('predictions', [])}
    origins = {}
    for name in ['整理清單.json', 'AMD整理清單.json']:
        for item in read(source / name, {}).get('images', []):
            origins[item.get('relative_destination', item.get('destination'))] = {
                'manifest': name, 'archiveEntry': item.get('source'), 'publicLicense': 'unknown'}
    rows = []
    for path in sorted(source.rglob('*')):
        if path.suffix.lower() not in ['.jpg', '.jpeg', '.png', '.webp']:
            continue
        rel = str(path.relative_to(source))
        old, prediction = prior.get(rel, {}), predictions.get(rel, {})
        row = dict(relative=rel, model=canonical(path.relative_to(source).parts[0]),
                   folderModel=path.relative_to(source).parts[0],
                   kind='boxed' if '盒裝' in path.parts else 'bare',
                   sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                   split=old.get('split'), group=old.get('group'),
                   origin=origins.get(rel, {'publicLicense': 'unknown'}),
                   flags=[], ocr=prediction.get('evidence', []))
        if rel in conflicts: row['flags'].append('cross_model_similarity')
        if rel in flagged: row['flags'].append('label_review_required')
        if old.get('sha256') != row['sha256']: row['flags'].append('not_in_original_audit')
        try:
            with Image.open(path) as im:
                im = ImageOps.exif_transpose(im); im.load()
                row['size'] = list(im.size)
                if min(im.size) < 500: row['flags'].append('small_image')
        except Exception:
            row['flags'].append('decode_failure'); row['size'] = [0, 0]
        row['ocrMatchesFolder'] = prediction.get('accepted') is True and prediction.get('label') == row['folderModel']
        rows.append(row)
    by_hash = defaultdict(list)
    for r in rows: by_hash[r['sha256']].append(r)
    for members in by_hash.values():
        if len(members) > 1:
            for r in members: r['flags'].append('exact_duplicate')
    grouped = defaultdict(list)
    for r in rows: grouped[(r['model'], r['kind'])].append(r)
    suggestions = []
    for key, members in sorted(grouped.items()):
        eligible = [r for r in members if not set(r['flags']) - {'small_image'}]
        eligible.sort(key=lambda r: (r['ocrMatchesFolder'], min(r['size']) >= 500, min(r['size'])), reverse=True)
        if eligible: suggestions.append(eligible[0])
    # Contact sheets are only triage, never automatic approval.
    for start in ([] if args.skip_contact_sheets else range(0, len(suggestions), 12)):
        sheet = Image.new('RGB', (1600, 1260), 'white'); draw = ImageDraw.Draw(sheet)
        for j, row in enumerate(suggestions[start:start+12]):
            with Image.open(source / row['relative']) as im:
                thumb = ImageOps.contain(ImageOps.exif_transpose(im).convert('RGB'), (390, 380))
            x, y = j % 4 * 400, j // 4 * 420
            sheet.paste(thumb, (x + (400-thumb.width)//2, y))
            draw.text((x+5, y+382), f"{start+j}: {row['folderModel']} {row['kind']}", fill='black')
            draw.text((x+5, y+399), f"{Path(row['relative']).stem.split('_')[-1]} OCR:{row['ocrMatchesFolder']}", fill='black')
        output.mkdir(parents=True, exist_ok=True); sheet.save(output / f'contact-{start//12:02}.jpg')
    reviews = read(args.reviews, {'images': {}, 'models': {}})
    selected, catalog, excluded_groups = [], [], set()
    output.mkdir(parents=True, exist_ok=True)
    def render(row):
        entry = {**row, 'id': row['sha256'][:20], 'access': 'private'}
        with Image.open(source / row['relative']) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            for variant, limit in [('thumbnail',480), ('reference',4096)]:
                # Pillow contain() also enlarges small inputs unless constrained.
                bound = min(limit, max(im.size))
                rendered = ImageOps.contain(im, (bound,bound))
                if rendered.width * rendered.height > 16000000:
                    scale = (16000000 / (rendered.width * rendered.height)) ** .5
                    rendered = rendered.resize((int(rendered.width*scale), int(rendered.height*scale)))
                while True:
                    buffer = io.BytesIO(); rendered.save(buffer, 'JPEG', quality=92)
                    if len(buffer.getvalue()) <= 1800000: break
                    rendered = rendered.resize((max(1,int(rendered.width*.85)),max(1,int(rendered.height*.85))))
                filename = f"{entry['id']}-{variant}.jpg"
                target = output / filename
                if not target.exists() or target.read_bytes() != buffer.getvalue():
                    target.write_bytes(buffer.getvalue())
                entry[variant] = filename
        return entry
    for row in rows:
        decision = reviews.get('images', {}).get(row['relative'], {})
        row['review'] = decision or {'status': 'pending'}
        if decision and decision.get('sha256') != row['sha256']:
            raise ValueError('Reviewed image changed: '+row['relative'])
        if 'decode_failure' not in row['flags']:
            catalog.append(render(row))
        if decision.get('status') != 'approved': continue
        if decision.get('sha256') != row['sha256']: raise ValueError('Reviewed image changed: '+row['relative'])
        if not decision.get('visibleText') or not decision.get('labelBox'): raise ValueError('Missing visual evidence')
        if set(row['flags']) - {'small_image'}: raise ValueError('Unresolved flag: '+row['relative'])
        entry = {**catalog[-1], 'purposes': decision['purposes'],
                 'visibleText': decision['visibleText'], 'labelBox': decision['labelBox'],
                 'coordinateSpace': 'normalized-oriented-source', 'access': 'private'}
        selected.append(entry)
        if row['group'] is not None: excluded_groups.add(row['group'])
    counts = Counter((r['model'],r['kind']) for r in selected)
    if any(n > 1 for n in counts.values()): raise ValueError('At most one image per model and kind')
    models = []
    for model in sorted({r['model'] for r in rows}):
        models.append({'model': model, 'selected': sum(r['model']==model for r in selected),
                       'review': reviews.get('models',{}).get(model,'pending_visual_review'),
                       'missing': [kind for kind in ['boxed','bare'] if not counts[(model,kind)]]})
    version = hashlib.sha256(('no-upscale-pixel-limits-v2' + json.dumps([(r['sha256'],r['review']) for r in rows],sort_keys=True)).encode()).hexdigest()[:16]
    write(output/'inventory.json', {'version':version,'images':rows,'models':models})
    write(output/'suggestions.json', suggestions)
    write(output/'index.json', {'version':version,'images':selected})
    write(output/'catalog.json', {'version':version,'images':catalog})
    exclusions = [r['sha256'] for r in rows if r['group'] in excluded_groups]
    write(output/'evaluation-exclusions.json', {'version':version,'sha256':exclusions,'groups':sorted(excluded_groups),
          'knownSourceSha256':sorted({r['sha256'] for r in rows}),
          'note':'All known-source images are ineligible for new-source independent evaluation. Reference groups are additionally excluded from future internal evaluation.'})
    summary = {'version':version,'sourceImages':len(rows),'models':len(models),'selectedImages':len(selected),
               'pendingImageReviews':sum(r['review']['status']=='pending' for r in rows),
               'modelReviews':models,'excludedEvaluationImages':len(exclusions),
               'catalogImages':len(catalog), 'externalEvaluation': 'not_available',
               'automaticAdoptionEnabled':True, 'policy':'text-first-v2; strict OCR or complete Gemma quotation + region OCR, with visual corroboration'}
    write(ROOT/'models/cpu-library/summary.json', summary)
    print(json.dumps({k:v for k,v in summary.items() if k!='modelReviews'},ensure_ascii=False))


if __name__ == '__main__': main()
