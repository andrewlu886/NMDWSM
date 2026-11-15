"""CPU recognition: image features provide candidates; readable text confirms identity."""
import re
from pathlib import Path
import numpy as np
import torch
from PIL import Image, ImageOps, ImageEnhance
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
                key = '(?:' + key + sep + re.escape(parts[2]) + '|' + re.escape(parts[2]) + sep + key + ')'
            found = re.search(r'(?<![A-Z0-9])' + key + end, text) is not None
            found = found and bool(re.search(r'AMD|RYZEN', text))
            found = found and not re.search(r'\bRX[\s-]*' + re.escape(digits), text)
            if len(parts) == 2 and re.search(r'\bPRO' + sep + re.escape(digits), text):
                found = False
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
    # The older calibrated policy permits low-confidence OCR. Direct affirmative
    # answers require clear text as well as the existing visual corroboration.
    clear_matches, _ = text_matches(lines, labels, max(0.85, policy['ocrMinConfidence']))
    fusion_matches, _ = text_matches(lines, labels, max(0.6, policy['ocrMinConfidence']))
    accepted = bool(agreed and policy['enabled'] and matches == clear_matches)
    return {'accepted': accepted, 'textVerified': accepted, 'model': canonical(matches[0]) if accepted else None,
            'fusionEligible': bool(agreed and policy['enabled'] and len(matches) == 1 and matches == fusion_matches),
            'label': matches[0] if accepted else None, 'candidates': candidates,
            'ocrModels': matches, 'evidence': evidence[:40],
            'families': family_probabilities or {},
            'brands': brand_probabilities or {},
            'reason': 'text_and_visual_agree' if accepted else
                      'ocr_text_not_clear' if agreed and policy['enabled'] else
                      'validation_insufficient' if agreed else 'unreadable_or_conflicting',
            'confidence': 'medium' if accepted else 'low'}


def label_regions(readings, labels, size):
    """Separate actual text locations. Never use a proposed SKU to place a crop."""
    regions = []
    for box, text, score in readings:
        if not re.search(r'\d{3,5}', text):
            continue
        points = np.asarray(box)
        x0,y0 = points.min(0); x1,y1 = points.max(0)
        height = max(10, y1-y0)
        nearby = []
        for other in readings:
            p = np.asarray(other[0]); ox0,oy0=p.min(0); ox1,oy1=p.max(0)
            same_line = abs((oy0+oy1-y0-y1)/2) <= height*.7 and ox0 <= x1+height*2 and ox1 >= x0-height*2
            brand_line = oy1 >= y0-height*3 and oy0 <= y1+height and ox0 <= x1+height*3 and ox1 >= x0-height*3 and re.search(r'INTEL|CORE|AMD|RYZEN|ULTRA',other[1],re.I)
            if same_line or brand_line: nearby.append(other)
        nearby.sort(key=lambda item:(np.asarray(item[0])[:,1].mean(),np.asarray(item[0])[:,0].mean()))
        models,_ = text_matches([(t,float(c)) for _,t,c in nearby], labels, 0)
        # A damaged family prefix may still locate a real SKU line. This only
        # selects pixels for OCR; it never repairs digits or establishes a model.
        context = ' '.join(t for _,t,_ in nearby)
        looks_like_sku = re.search(r'(?:[iIl1][3579][\s-]*\d{4,5}|RYZEN.*\d{4,5}|ULTRA.*\d{3})',text,re.I)
        looks_like_sku = looks_like_sku or (re.search(r'INTEL|CORE|AMD|RYZEN|ULTRA',context,re.I)
            and re.search(r'(?<!\d)\d{3,5}(?:KF|KS|K|F|X3D|XT|X|GT|G)?(?![A-Z0-9])',text,re.I))
        if not models and not looks_like_sku: continue
        # Crop around the SKU line, retaining nearby family/vendor context.
        all_points=np.asarray([p for b,_,_ in nearby for p in b])
        lo=np.maximum(all_points.min(0)-12,[0,0]).astype(int)
        hi=np.minimum(all_points.max(0)+12,size).astype(int)
        rect=[int(lo[0]),int(lo[1]),int(hi[0]),int(hi[1])]
        rank=(100 if models else 50)+float(score)*10
        digits=[re.search(r'\d{3,5}',model).group(0) for model in models]
        sku_heights=[float(np.asarray(b)[:,1].max()-np.asarray(b)[:,1].min()) for b,t,_ in nearby
                     if any(re.search(r'(?<!\d)'+number+r'(?!\d)',t) for number in digits)]
        regions.append({'rect':rect,'readings':nearby,'models':models,'rank':rank,'textHeight':max(sku_heights,default=float(height))})
    chosen=[]
    for region in sorted(regions,key=lambda r:r['rank'],reverse=True):
        x0,y0,x1,y1=region['rect']
        duplicate=False
        for previous in chosen:
            a,b,c,d=previous['rect'];intersection=max(0,min(x1,c)-max(x0,a))*max(0,min(y1,d)-max(y0,b))
            if intersection > .6*min((x1-x0)*(y1-y0),(c-a)*(d-b)): duplicate=True
        if not duplicate: chosen.append(region)
        if len(chosen)==2: break
    return chosen


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
        original_size = list(image.size)
        original_image = image.copy()
        feature = self.net(image_tensor(image).unsqueeze(0))
        logits = self.head(feature) / self.metadata['temperature']
        probabilities = logits.softmax(1)[0].numpy()
        family_scores = (self.family_head(feature) / self.metadata['familyTemperature']).softmax(1)[0].numpy()
        family_probabilities = dict(zip(self.metadata['families'], map(float, family_scores)))
        brand_scores = (self.brand_head(feature) / self.metadata['brandTemperature']).softmax(1)[0].numpy()
        brand_probabilities = dict(zip(self.metadata['brands'], map(float, brand_scores)))
        image.thumbnail((1280, 1280))
        readings = self.reader.readtext(np.asarray(image), canvas_size=1280, workers=0)
        def record_readings(items, size, stage):
            return [{'text': str(text), 'confidence': float(score), 'stage': stage,
                     'coordinateSpace': stage, 'imageSize': list(size),
                     'box': [[float(x), float(y)] for x, y in box]}
                    for box, text, score in items]
        physical_readings = record_readings(readings, image.size, 'resized-upload')
        lines = [(text, float(score)) for _, text, score in readings]
        result = decide(probabilities, self.metadata['labels'], lines, self.metadata['policy'], family_probabilities, brand_probabilities)
        # Gemma supplies a hypothesis, never OCR truth or a replacement label.
        observed = re.search(r'(?:^|\n)\s*Model\s*:\s*([^\n]+)', gemma_observation, re.I)
        compact = lambda value: re.sub(r'[^A-Z0-9]', '', re.sub(r'INTEL|AMD|CORE|RYZEN', '', value.upper()))
        target = next((label for label in self.metadata['labels']
                       if observed and compact(canonical(label)) == compact(observed[1])), None)
        guided = {'receivedGemma': bool(gemma_observation), 'hypothesis': target, 'focusedOcr': False}
        regions = label_regions(readings, self.metadata['labels'], image.size)
        if not regions and not result['accepted'] and readings and target:
            points=np.asarray([point for box,_,_ in readings for point in box])
            lo=np.maximum(points.min(0)-12,[0,0]).astype(int);hi=np.minimum(points.max(0)+12,[image.width,image.height]).astype(int)
            regions=[{'rect':[int(lo[0]),int(lo[1]),int(hi[0]),int(hi[1])],'readings':readings,'models':[],'textHeight':0}]
        region_results=[]
        # Intel boxes place the logo far from the SKU. Preserve actual uploaded
        # brand context for the existing i/1 prefix rule, never another SKU line.
        brand_context=[(i,text,float(score)) for i,(_,text,score) in enumerate(readings)
                       if re.search(r'INTEL|CORE',text,re.I) and not re.search(r'\d{3,}',text)]
        for region_index,region in enumerate(regions):
            x0,y0,x1,y1=region['rect'];group=region['readings']
            region_lines=[(text,float(score)) for _,text,score in group]
            region_lines.extend((text,score) for _,text,score in brand_context)
            decision=decide(probabilities,self.metadata['labels'],region_lines,self.metadata['policy'],family_probabilities,brand_probabilities)
            sx,sy=original_image.width/image.width,original_image.height/image.height
            original_box=(int(x0*sx),int(y0*sy),min(original_image.width,round(x1*sx)),min(original_image.height,round(y1*sy)))
            region_id=f'label-{region_index}'
            for record in physical_readings:
                if any(record['text']==text and record['box']==[[float(x),float(y)] for x,y in box] for box,text,_ in group):
                    record['regionId']=region_id
            if not decision['accepted'] and x1-x0>=20 and y1-y0>=15:
                crop=original_image.crop(original_box)
                angles=[np.degrees(np.arctan2(box[1][1]-box[0][1],box[1][0]-box[0][0])) for box,_,_ in group if box[1][0]>box[0][0]]
                angle=float(np.clip(np.median(angles),-25,25)) if angles else 0
                crop=crop.rotate(angle,Image.Resampling.BICUBIC,expand=True,fillcolor='white')
                crop=ImageEnhance.Contrast(crop.convert('L')).enhance(2)
                scale=min(3,1280/max(crop.size))
                crop=crop.resize((max(1,round(crop.width*scale)),max(1,round(crop.height*scale))),Image.Resampling.BICUBIC)
                extra_readings=self.reader.readtext(np.asarray(crop),canvas_size=1280,workers=0)
                extra=[(text,float(score)) for _,text,score in extra_readings]
                crop_records=record_readings(extra_readings,crop.size,'deskewed-upload-crop')
                for record in crop_records:
                    record.update(cropInResizedUpload=[x0,y0,x1,y1],cropInOriginalUpload=list(original_box),rotationDegrees=angle,resizeScale=scale,preprocessing='grayscale_contrast_2',regionId=region_id)
                physical_readings.extend(crop_records)
                lines.extend(extra);region_lines.extend(extra)
                decision=decide(probabilities,self.metadata['labels'],region_lines,self.metadata['policy'],family_probabilities,brand_probabilities)
                guided['focusedOcr']=True
            region_results.append({'id':region_id,'boxInOriginalUpload':list(original_box),'model':decision['model'],
                'ocrModels':[canonical(label) for label in decision['ocrModels']],'accepted':decision['accepted'],
                'fusionEligible':decision['fusionEligible'],'nativeTextHeight':round(region['textHeight']*sy,2),
                'contextReadingIndexes':[i for i,_,_ in brand_context]})
        result=decide(probabilities,self.metadata['labels'],lines,self.metadata['policy'],family_probabilities,brand_probabilities)
        # Clear text on either the CPU or the box suffices. A different complete
        # SKU in another region remains a conflict in the combined raw OCR.
        accepted_region=max((region for region in region_results if region['accepted'] and region['model']==result['model']),key=lambda region:region['nativeTextHeight'],default=None)
        if result['accepted'] and not accepted_region:
            result.update(accepted=False,textVerified=False,model=None,label=None,reason='no_complete_label_region')
        fusion=[]
        for region in region_results:
            if not region['fusionEligible'] or region['nativeTextHeight']<16 or len(region['ocrModels'])!=1: continue
            model=region['ocrModels'][0]
            fusion.append({'model':model,'regionId':region['id'],'nativeTextHeight':region['nativeTextHeight'],
                           'minimumOcrConfidence':max(.6,self.metadata['policy']['ocrMinConfidence'])})
        result['fusionEvidence']=fusion if result['fusionEligible'] else []
        result['regions']=region_results
        result['selectedRegionId']=accepted_region['id'] if accepted_region else None
        result['regionPolicy']='clearest_complete_label'
        result['guided'] = guided
        result['readings'] = physical_readings
        result['originalImageSize'] = original_size
        result['questions'] = ([f'Gemma 提到 {canonical(target)}，但影像文字尚未核對；請重讀原圖的完整數字與尾碼。']
                               if target and not result['accepted'] else [])
        result['version'] = self.metadata['version']
        result['validation'] = self.metadata['evaluation']['test']['fusion']
        return result
