"""Train frozen MobileNet features + CPU identity head with duplicate-group holdouts."""
import argparse
import hashlib
import json
import os
import random
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import torch
from PIL import Image, ImageOps
from common import ROOT, MODEL_DIR, backbone, image_tensor, family, brand, decide


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def inventory(source, cache):
    rows, bad = [], []
    for directory in sorted(source.iterdir()):
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob('*')):
            if path.suffix.lower() not in ['.jpg', '.jpeg', '.png', '.webp']:
                continue
            try:
                with Image.open(path) as opened:
                    im = ImageOps.exif_transpose(opened).convert('RGB')
                    gray = np.asarray(im.resize((9, 8)).convert('L'))
                    bits = (gray[:, 1:] > gray[:, :-1]).flatten()
                    dhash = sum(int(bit) << i for i, bit in enumerate(bits))
                    thumb = np.asarray(im.resize((24, 24)), dtype=np.float32)
                    rows.append({'path': str(path), 'relative': str(path.relative_to(source)),
                                 'label': directory.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                 'pixelHash': hashlib.sha256(im.tobytes() + str(im.size).encode()).hexdigest(),
                                 'dhash': dhash, '_thumb': thumb})
            except Exception as error:
                bad.append({'path': str(path), 'error': str(error)})
    parent = list(range(len(rows)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, left in enumerate(rows):
        for j in range(i):
            right = rows[j]
            if left['pixelHash'] == right['pixelHash'] or (
                (left['dhash'] ^ right['dhash']).bit_count() <= 8 and
                np.abs(left['_thumb'] - right['_thumb']).mean() < 18):
                parent[find(i)] = find(j)
    groups = defaultdict(list)
    for i, row in enumerate(rows):
        row.pop('_thumb')
        row['group'] = find(i)
        groups[row['group']].append(row)
    conflict = [g for g, members in groups.items() if len({m['label'] for m in members}) > 1]
    rng = random.Random(20261005)
    by_label = defaultdict(list)
    for group, members in groups.items():
        if group not in conflict:
            by_label[members[0]['label']].append(group)
    excluded = []
    for directory in sorted(source.iterdir()):
        if not directory.is_dir():
            continue
        ids = sorted(by_label[directory.name])
        if len(ids) < 3:
            excluded.append({'model': directory.name, 'images': sum(r['label'] == directory.name for r in rows),
                             'independentGroups': len(ids), 'reason': 'fewer_than_3_independent_groups'})
            continue
        rng.shuffle(ids)
        count = max(1, round(len(ids) * 0.2))
        for position, group in enumerate(ids):
            split = 'test' if position < count else 'validation' if position < 2 * count else 'train'
            for row in groups[group]:
                row['split'] = split
    used = [r for r in rows if 'split' in r]
    audit = {'source': str(source), 'images': len(rows), 'usedImages': len(used),
             'independentGroups': len(groups), 'crossLabelConflicts':
             [[r['relative'] for r in groups[g]] for g in conflict],
             'excludedModels': excluded, 'invalidImages': bad,
             'splits': dict(Counter(r['split'] for r in used)), 'rows': rows}
    save_json(cache / 'dataset.json', audit)
    return used, audit


def metrics(prob, labels, rows, ocr, policy, family_prob=None, families=None, brand_prob=None, brands=None):
    correct, top5, family_correct, brand_correct, accepted, accepted_correct = 0, 0, 0, 0, 0, 0
    per_class = defaultdict(lambda: {'total': 0, 'top1Correct': 0, 'accepted': 0, 'acceptedCorrect': 0})
    examples = []
    for index, (p, row) in enumerate(zip(prob, rows)):
        order = np.argsort(p)[::-1]
        truth = row['label']
        family_scores = dict(zip(families, map(float, family_prob[index]))) if family_prob is not None else None
        brand_scores = dict(zip(brands, map(float, brand_prob[index]))) if brand_prob is not None else None
        result = decide(p, labels, ocr[row['sha256']], policy, family_scores, brand_scores)
        hit = labels[order[0]] == truth
        correct += hit
        top5 += truth in [labels[i] for i in order[:5]]
        family_correct += (max(family_scores, key=family_scores.get) if family_scores else family(labels[order[0]])) == family(truth)
        brand_correct += (max(brand_scores, key=brand_scores.get) if brand_scores else brand(labels[order[0]])) == brand(truth)
        accepted += result['accepted']
        accepted_correct += result['accepted'] and result['label'] == truth
        cls = per_class[truth]
        cls['total'] += 1
        cls['top1Correct'] += hit
        cls['accepted'] += result['accepted']
        cls['acceptedCorrect'] += result['accepted'] and result['label'] == truth
        examples.append({'image': row['relative'], 'truth': truth, **result})
    n = len(rows)
    return {'samples': n, 'visualTop1Accuracy': correct / n, 'visualTop5Accuracy': top5 / n,
            'visualFamilyAccuracy': family_correct / n,
            'visualBrandAccuracy': brand_correct / n,
            'fusion': {'accepted': int(accepted), 'correct': int(accepted_correct),
                       'precision': accepted_correct / accepted if accepted else None,
                       'coverage': accepted / n}, 'perClass': dict(per_class), 'predictions': examples}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    args = parser.parse_args()
    cache = ROOT / '.cache' / 'cpu-vision'
    cache.mkdir(parents=True, exist_ok=True)
    os.environ['TORCH_HOME'] = str(cache / 'torch')
    random.seed(20261005)
    np.random.seed(20261005)
    torch.manual_seed(20261005)
    started = time.monotonic()
    rows, audit = inventory(args.data, cache)
    labels = sorted({r['label'] for r in rows})
    if len(labels) < 2:
        raise RuntimeError('At least two supported models are required.')
    print(f'Dataset: {len(rows)} images, {len(labels)} classes; splits {audit["splits"]}', flush=True)
    net = backbone(pretrained=True)
    feature_cache = cache / 'features.pt'
    fingerprint = hashlib.sha256(''.join(r['sha256'] for r in rows).encode()).hexdigest()
    if feature_cache.exists() and torch.load(feature_cache, weights_only=True)['fingerprint'] == fingerprint:
        features = torch.load(feature_cache, weights_only=True)['features']
    else:
        features = []
        with torch.inference_mode():
            for offset in range(0, len(rows), 24):
                batch = torch.stack([image_tensor(Image.open(r['path'])) for r in rows[offset:offset + 24]])
                features.append(net(batch))
                if offset % 120 == 0:
                    print(f'Features: {offset}/{len(rows)}', flush=True)
        features = torch.cat(features)
        torch.save({'fingerprint': fingerprint, 'features': features}, feature_cache)
    targets = torch.tensor([labels.index(r['label']) for r in rows])
    masks = {name: torch.tensor([r['split'] == name for r in rows]) for name in ['train', 'validation', 'test']}
    head = torch.nn.Linear(960, len(labels))
    optimizer = torch.optim.AdamW(head.parameters(), lr=0.01, weight_decay=0.1)
    class_counts = torch.bincount(targets[masks['train']], minlength=len(labels)).float()
    loss_fn = torch.nn.CrossEntropyLoss(weight=1 / class_counts.clamp_min(1).sqrt())
    best_loss, best_epoch, state = float('inf'), 0, None
    for epoch in range(600):
        head.train()
        optimizer.zero_grad()
        loss = loss_fn(head(features[masks['train']]), targets[masks['train']])
        loss.backward()
        optimizer.step()
        with torch.no_grad():
            val_loss = torch.nn.functional.cross_entropy(head(features[masks['validation']]), targets[masks['validation']]).item()
        if val_loss < best_loss:
            best_loss, best_epoch = val_loss, epoch
            state = {key: value.detach().clone() for key, value in head.state_dict().items()}
        if epoch % 50 == 0:
            print(f'Head epoch {epoch}: train loss {loss.item():.3f}, validation loss {val_loss:.3f}', flush=True)
        if epoch - best_epoch > 70:
            break
    head.load_state_dict(state)
    head.eval()
    with torch.no_grad():
        logits = head(features).detach()
    # Calibration uses validation only; test remains untouched until final evaluation.
    temperatures = [0.5, 0.75, 1, 1.5, 2, 3, 5, 8]
    temperature = min(temperatures, key=lambda t: torch.nn.functional.cross_entropy(
        logits[masks['validation']] / t, targets[masks['validation']]).item())
    probabilities = (logits / temperature).softmax(1).numpy()
    families = sorted({family(label) for label in labels})
    family_targets = torch.tensor([families.index(family(row['label'])) for row in rows])
    family_head = torch.nn.Linear(960, len(families))
    family_optimizer = torch.optim.AdamW(family_head.parameters(), lr=0.01, weight_decay=0.1)
    best_family_loss, best_family_epoch, family_state = float('inf'), 0, None
    for epoch in range(400):
        family_optimizer.zero_grad()
        family_loss = torch.nn.functional.cross_entropy(family_head(features[masks['train']]), family_targets[masks['train']])
        family_loss.backward()
        family_optimizer.step()
        with torch.no_grad():
            value = torch.nn.functional.cross_entropy(family_head(features[masks['validation']]), family_targets[masks['validation']]).item()
        if value < best_family_loss:
            best_family_loss, best_family_epoch = value, epoch
            family_state = {key: value.detach().clone() for key, value in family_head.state_dict().items()}
        if epoch - best_family_epoch > 50:
            break
    family_head.load_state_dict(family_state)
    family_head.eval()
    with torch.no_grad():
        family_logits = family_head(features).detach()
    family_temperature = min(temperatures, key=lambda t: torch.nn.functional.cross_entropy(
        family_logits[masks['validation']] / t, family_targets[masks['validation']]).item())
    family_probabilities = (family_logits / family_temperature).softmax(1).numpy()
    brands = ['AMD', 'Intel']
    brand_targets = torch.tensor([brands.index(brand(row['label'])) for row in rows])
    brand_head = torch.nn.Linear(960, 2)
    brand_optimizer = torch.optim.AdamW(brand_head.parameters(), lr=0.01, weight_decay=0.1)
    best_brand_loss, best_brand_epoch, brand_state = float('inf'), 0, None
    for epoch in range(400):
        brand_optimizer.zero_grad()
        brand_loss = torch.nn.functional.cross_entropy(brand_head(features[masks['train']]), brand_targets[masks['train']])
        brand_loss.backward()
        brand_optimizer.step()
        with torch.no_grad():
            value = torch.nn.functional.cross_entropy(brand_head(features[masks['validation']]), brand_targets[masks['validation']]).item()
        if value < best_brand_loss:
            best_brand_loss, best_brand_epoch = value, epoch
            brand_state = {key: value.detach().clone() for key, value in brand_head.state_dict().items()}
        if epoch - best_brand_epoch > 50:
            break
    brand_head.load_state_dict(brand_state)
    brand_head.eval()
    with torch.no_grad():
        brand_logits = brand_head(features).detach()
    brand_temperature = min(temperatures, key=lambda t: torch.nn.functional.cross_entropy(
        brand_logits[masks['validation']] / t, brand_targets[masks['validation']]).item())
    brand_probabilities = (brand_logits / brand_temperature).softmax(1).numpy()
    print('Preparing OCR for held-out images...', flush=True)
    import easyocr
    reader = easyocr.Reader(['en'], gpu=False, model_storage_directory=str(MODEL_DIR / 'ocr'), verbose=False)
    ocr_path = cache / 'ocr.json'
    ocr = json.loads(ocr_path.read_text(encoding='utf-8')) if ocr_path.exists() else {}
    heldout = [r for r in rows if r['split'] != 'train']
    for i, row in enumerate(heldout):
        if row['sha256'] not in ocr:
            with Image.open(row['path']) as opened:
                im = ImageOps.exif_transpose(opened).convert('RGB')
                im.thumbnail((1280, 1280))
                ocr[row['sha256']] = [[text, float(score)] for _, text, score in reader.readtext(
                    np.asarray(im), canvas_size=1280, workers=0)]
        if i % 20 == 0:
            save_json(ocr_path, ocr)
            print(f'OCR: {i}/{len(heldout)}', flush=True)
    save_json(ocr_path, ocr)
    val_rows = [r for r in rows if r['split'] == 'validation']
    val_prob = probabilities[masks['validation'].numpy()]
    # Require >=90% validation precision and >=20 accepted examples to enable fusion.
    options = []
    for top_k in [1, 3, 5]:
        for confidence in [0.3, 0.4, 0.5, 0.6, 0.75, 0.9]:
            for allow_family in [False, True]:
                for allow_brand in [False, True]:
                    policy = {'topK': top_k, 'ocrMinConfidence': confidence, 'enabled': True,
                              'allowFamily': allow_family, 'familyMinProbability': 0.5,
                              'allowBrand': allow_brand, 'brandMinProbability': 0.7}
                    result = metrics(val_prob, labels, val_rows, ocr, policy,
                                     family_probabilities[masks['validation'].numpy()], families,
                                     brand_probabilities[masks['validation'].numpy()], brands)['fusion']
                    if result['accepted'] >= 20 and result['precision'] >= 0.9:
                        options.append((result['coverage'], policy))
    policy = max(options, key=lambda item: item[0])[1] if options else {'topK': 1, 'ocrMinConfidence': 0.9, 'enabled': False}
    evaluation = {}
    for name in ['validation', 'test']:
        evaluation[name] = metrics(probabilities[masks[name].numpy()], labels,
                                   [r for r in rows if r['split'] == name], ocr, policy,
                                   family_probabilities[masks[name].numpy()], families,
                                   brand_probabilities[masks[name].numpy()], brands)
    # Preserve the evaluated head, never refit on the test set for production.
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    temporary_weights = MODEL_DIR / 'model.pt.tmp'
    torch.save({'backbone': net.state_dict(), 'head': head.state_dict(), 'familyHead': family_head.state_dict(), 'brandHead': brand_head.state_dict()}, temporary_weights)
    temporary_weights.replace(MODEL_DIR / 'model.pt')
    label_review = [{'split': name, 'image': item['image'], 'folderLabel': item['truth'], 'readModel': item['ocrModels'][0]}
                    for name, result in evaluation.items() for item in result['predictions']
                    if len(item['ocrModels']) == 1 and item['ocrModels'][0] != item['truth']]
    save_json(MODEL_DIR / 'label-review.json', label_review)
    report = {'version': datetime.now(timezone.utc).isoformat(),
              'labels': labels, 'sourceImages': audit['images'], 'usedImages': len(rows),
              'independentGroups': audit['independentGroups'], 'splits': audit['splits'],
              'excludedModels': audit['excludedModels'], 'crossLabelConflicts': audit['crossLabelConflicts'],
              'temperature': temperature, 'bestEpoch': best_epoch, 'policy': policy,
              'families': families, 'familyTemperature': family_temperature,
              'brands': brands, 'brandTemperature': brand_temperature,
              'evaluation': evaluation, 'elapsedSeconds': round(time.monotonic() - started),
              'datasetFingerprint': fingerprint, 'splitSeed': 20261005, 'labelReviewCount': len(label_review),
              'limitations': ['CPU-only training data; not a general hardware/OOD detector.',
                             'Exact variants require readable text; softmax is not correctness confidence.',
                             'Holdouts grouped by pixel/perceptual similarity; same-photo recrops may remain.',
                             'Folder labels were supplied by the dataset; ambiguous box labels may be incorrect.',
                             'Initial test aggregate metrics were viewed during architecture development; holdout results are exploratory.',
                             'No external independent test collection; results apply to this holdout only.']}
    report['architecture'] = f'MobileNetV3-Large ImageNet V2 + trained {len(labels)}-way identity head, {len(families)}-way family head, 2-way brand head'
    save_json(MODEL_DIR / 'report.json', report)
    small_report = json.loads(json.dumps(report))
    for part in small_report['evaluation'].values():
        part.pop('predictions')
        part.pop('perClass')
    save_json(MODEL_DIR / 'metadata.json', small_report)
    tested = evaluation['test']
    fusion = tested['fusion']
    precision_text = f'{fusion["precision"]:.1%}' if fusion['precision'] is not None else '尚無可採用結果'
    markdown = f'''# CPU 圖片模型驗證報告

建構時間：{report['version']}

以桌面 cpu訓練 資料夾作為標籤來源；同型號的所有圖片合併為同一類，沒有盒裝／散片分類。

- 原始圖片：{audit['images']} 張；本次採用：{len(rows)} 張。
- 支援型號：{len(labels)} 種；沒有足夠獨立圖片的型號：{', '.join(r['model'] for r in audit['excludedModels'])}。
- 訓練／校準／最終測試圖片：{audit['splits']['train']}／{audit['splits']['validation']}／{audit['splits']['test']}。
- 跨型號高度相似的圖片群：{len(audit['crossLabelConflicts'])} 群，先排除；未刪改原圖。
- 完整型號純影像 Top-1 正確率：{tested['visualTop1Accuracy']:.1%}；Top-5：{tested['visualTop5Accuracy']:.1%}。
- CPU 系列純影像正確率：{tested['visualFamilyAccuracy']:.1%}。
- CPU 品牌純影像正確率：{tested['visualBrandAccuracy']:.1%}。
- 文字與影像核對後採用：{fusion['accepted']}／{tested['samples']} 張，其中 {fusion['correct']} 張正確。
- 採用結果正確率：{precision_text}；涵蓋率：{fusion['coverage']:.1%}。
- OCR 讀到其他已收錄型號、需要人工複核資料夾標籤的照片：{len(label_review)} 張，見 label-review.json。未自動改標籤。

模型：MobileNetV3-Large 的 ImageNet 預訓練影像特徵，使用本次 CPU 照片訓練完整型號、CPU 系列與品牌分類層。
另用 EasyOCR 讀取圖片上的型號文字。分類分數只用於候選排序，不是正確率；只有完整文字與圖片模型通過核對才提供型號。
尾碼 F、K、KF、KS、G、GT、X、XT、X3D、PRO、Plus 不互相替代。尚無圖片的型號不宣稱可識別。

這是現有資料內保留圖片的驗證，沒有外部獨立測試集。照片來源可能重複、裁切相似，且部分包裝看不到完整型號；資料夾標籤仍可能有錯。
訓練架構開發時已檢視初版測試集的總體指標；核對門檻仍只依校準集選擇，這些結果需再以新來源圖片驗證。
跨型號近似圖排除與分組不能保證完全消除同一商品照片的來源關聯。純外觀不足以可靠分辨所有尾碼。
未通過核對時要求補拍標籤；CPU 模型離線時沿用原本的視覺模型，不提高信心。

權重保存在本機 models/cpu-vision/model.pt；詳細逐張結果見 report.json。
Render 必須經本機已更新的 AI gateway 才能使用此模型；本次沒有推送或部署。
'''
    (MODEL_DIR / 'report.md').write_text(markdown, encoding='utf-8')
    print('Finished:', json.dumps({name: {k: v for k, v in result.items() if k not in ['perClass', 'predictions']} for name, result in evaluation.items()}), flush=True)


if __name__ == '__main__':
    main()
