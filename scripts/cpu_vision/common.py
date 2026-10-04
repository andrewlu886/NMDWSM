"""CPU recognition: image features provide candidates; readable text confirms identity."""
import re
from pathlib import Path
import numpy as np
import torch
from PIL import Image, ImageOps
from torchvision import models, transforms

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / 'models' / 'cpu-vision'
torch.set_num_threads(4)


def image_tensor(image):
    # Preserve the full label instead of ImageNet's center crop.
    image = ImageOps.exif_transpose(image).convert('RGB')
    image = ImageOps.pad(image, (224, 224), color=(255, 255, 255))
    return transforms.functional.normalize(transforms.functional.to_tensor(image),
                                            [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])


def backbone(pretrained=False):
    weights = models.MobileNet_V3_Large_Weights.IMAGENET1K_V2 if pretrained else None
    net = models.mobilenet_v3_large(weights=weights)
    net.classifier = torch.nn.Identity()
    return net.eval()


def family(model):
    return model.split('-')[0] if '-' in model else ' '.join(model.split()[:2])


def brand(model):
    return 'AMD' if model.startswith('R') else 'Intel'


def canonical(model):
    if model.startswith('R'):
        return model.replace('R', 'Ryzen ', 1).replace('-', ' ')
    return model


def text_matches(lines, labels, min_confidence=0.6):
    """No fuzzy digit matching. Match complete suffixes, including F/KF/X3D/PRO."""
    kept = [str(text).upper() for text, score in lines if score >= min_confidence]
    text = ' '.join(kept)
    # OCR commonly separates a suffix with spaces. Never remove arbitrary letters.
    text = re.sub(r'[®™]', '', text)
    sep = r'[\s_\-]*'
    # A base model must not accidentally match a visibly printed variant suffix.
    end = r'(?![A-Z0-9]|\s*(?:KF|KS|K|F|G|GT|X|XT|X3D|PRO|PLUS)\b)'
    matches = []
    for label in labels:
        if label.startswith('i'):
            prefix, digits, suffix = re.fullmatch(r'(i[3579])-(\d+)([A-Z]*)', label, re.I).groups()
            key = sep.join(prefix.upper()) + sep + digits + sep + sep.join(suffix.upper())
            found = re.search(r'(?<![A-Z0-9])' + key + end, text) is not None
            if not found and re.search(r'INTEL|CORE', text):
                # On etched labels, OCR often reads the letter i as 1/l/0/[.
                # Only normalize that family prefix; SKU digits and suffix stay exact.
                alternate = r'[I1L0O\[]' + sep + prefix[-1] + sep + digits + sep + sep.join(suffix.upper())
                found = re.search(r'(?<![A-Z0-9])' + alternate + end, text) is not None
        elif label.startswith('R'):
            parts = label.upper().split('-')
            digits, suffix = re.fullmatch(r'(\d+)([A-Z0-9]*)', parts[1]).groups()
            key = digits + sep + sep.join(suffix)
            if len(parts) > 2:
                key += sep + re.escape(parts[2])
            found = re.search(r'(?<![A-Z0-9])' + key + end, text) is not None
            found = found and bool(re.search(r'AMD|RYZEN', text))
            found = found and not re.search(r'\bRX[\s-]*' + re.escape(digits), text)
        else:
            key = sep.join(re.escape(part) for part in label.upper().split())
            found = re.search(r'(?<![A-Z0-9])' + key + end, text) is not None
        if found:
            matches.append(label)
    if min_confidence > 0:
        # Discarding a low-confidence suffix must never convert 12400F into 12400.
        raw_matches, _ = text_matches(lines, labels, 0)
        if set(matches) != set(raw_matches):
            matches = []
    return matches, kept


def decide(probabilities, labels, lines, policy, family_probabilities=None, brand_probabilities=None):
    order = np.argsort(probabilities)[::-1]
    candidates = [{'model': labels[i], 'score': round(float(probabilities[i]), 5)} for i in order[:5]]
    matches, evidence = text_matches(lines, labels, policy['ocrMinConfidence'])
    agreed = len(matches) == 1 and matches[0] in [item['model'] for item in candidates[:policy['topK']]]
    family_match = False
    if len(matches) == 1 and family_probabilities and policy.get('allowFamily'):
        predicted_family = max(family_probabilities, key=family_probabilities.get)
        family_match = (predicted_family == family(matches[0]) and
                        family_probabilities[predicted_family] >= policy['familyMinProbability'])
    agreed = agreed or family_match
    if len(matches) == 1 and brand_probabilities and policy.get('allowBrand'):
        predicted_brand = max(brand_probabilities, key=brand_probabilities.get)
        agreed = agreed or (predicted_brand == brand(matches[0]) and
                            brand_probabilities[predicted_brand] >= policy['brandMinProbability'])
    # Softmax is a ranking score, never exposed as a calibrated probability of correctness.
    accepted = bool(agreed and policy['enabled'])
    return {'accepted': accepted, 'model': canonical(matches[0]) if accepted else None,
            'label': matches[0] if accepted else None, 'candidates': candidates,
            'ocrModels': matches, 'evidence': evidence[:40],
            'families': family_probabilities or {},
            'brands': brand_probabilities or {},
            'reason': 'text_and_visual_agree' if accepted else
                      'validation_insufficient' if agreed else 'unreadable_or_conflicting',
            'confidence': 'medium' if accepted else 'low'}


class Recognizer:
    def __init__(self, directory=MODEL_DIR):
        import json
        import easyocr
        self.directory = Path(directory)
        self.metadata = json.loads((self.directory / 'metadata.json').read_text(encoding='utf-8'))
        checkpoint = torch.load(self.directory / 'model.pt', map_location='cpu', weights_only=True)
        self.net = backbone()
        self.net.load_state_dict(checkpoint['backbone'])
        self.head = torch.nn.Linear(960, len(self.metadata['labels']))
        self.head.load_state_dict(checkpoint['head'])
        self.head.eval()
        self.family_head = torch.nn.Linear(960, len(self.metadata['families']))
        self.family_head.load_state_dict(checkpoint['familyHead'])
        self.family_head.eval()
        self.brand_head = torch.nn.Linear(960, len(self.metadata['brands']))
        self.brand_head.load_state_dict(checkpoint['brandHead'])
        self.brand_head.eval()
        self.reader = easyocr.Reader(['en'], gpu=False,
                                     model_storage_directory=str(self.directory / 'ocr'),
                                     download_enabled=False, verbose=False)

    @torch.inference_mode()
    def recognize(self, image, gemma_observation=''):
        image = ImageOps.exif_transpose(image).convert('RGB')
        feature = self.net(image_tensor(image).unsqueeze(0))
        logits = self.head(feature) / self.metadata['temperature']
        probabilities = logits.softmax(1)[0].numpy()
        family_scores = (self.family_head(feature) / self.metadata['familyTemperature']).softmax(1)[0].numpy()
        family_probabilities = dict(zip(self.metadata['families'], map(float, family_scores)))
        brand_scores = (self.brand_head(feature) / self.metadata['brandTemperature']).softmax(1)[0].numpy()
        brand_probabilities = dict(zip(self.metadata['brands'], map(float, brand_scores)))
        image.thumbnail((1280, 1280))
        readings = self.reader.readtext(np.asarray(image), canvas_size=1280, workers=0)
        lines = [(text, float(score)) for _, text, score in readings]
        result = decide(probabilities, self.metadata['labels'], lines, self.metadata['policy'], family_probabilities, brand_probabilities)
        # Gemma supplies a hypothesis, never OCR truth or a replacement label.
        observed = re.search(r'(?:^|\n)\s*Model\s*:\s*([^\n]+)', gemma_observation, re.I)
        compact = lambda value: re.sub(r'[^A-Z0-9]', '', re.sub(r'INTEL|AMD|CORE|RYZEN', '', value.upper()))
        target = next((label for label in self.metadata['labels']
                       if observed and compact(canonical(label)) == compact(observed[1])), None)
        guided = {'receivedGemma': bool(gemma_observation), 'hypothesis': target, 'focusedOcr': False}
        if target and not result['accepted'] and readings:
            # Locate text from pixels, not from Gemma's suggested SKU. Magnify and
            # deskew this detected region once; keep the original OCR for conflicts.
            points = np.asarray([point for box, _, _ in readings for point in box])
            x0, y0 = np.maximum(points.min(0) - 12, [0, 0]).astype(int)
            x1, y1 = np.minimum(points.max(0) + 12, [image.width, image.height]).astype(int)
            if x1 - x0 >= 20 and y1 - y0 >= 15:
                crop = image.crop((x0, y0, x1, y1))
                angles = [np.degrees(np.arctan2(box[1][1] - box[0][1], box[1][0] - box[0][0]))
                          for box, _, _ in readings if box[1][0] > box[0][0]]
                angle = float(np.clip(np.median(angles), -25, 25)) if angles else 0
                crop = crop.rotate(angle, Image.Resampling.BICUBIC, expand=True, fillcolor='white')
                scale = min(3, 1280 / max(crop.size))
                crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.BICUBIC)
                extra = [(text, float(score)) for _, text, score in self.reader.readtext(np.asarray(crop), canvas_size=1280, workers=0)]
                result = decide(probabilities, self.metadata['labels'], lines + extra, self.metadata['policy'], family_probabilities, brand_probabilities)
                guided['focusedOcr'] = True
        result['guided'] = guided
        result['questions'] = ([f'Gemma 提到 {canonical(target)}，但影像文字尚未核對；請重讀原圖的完整數字與尾碼。']
                               if target and not result['accepted'] else [])
        result['version'] = self.metadata['version']
        result['validation'] = self.metadata['evaluation']['test']['fusion']
        return result
