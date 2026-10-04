"""Private stdio worker. Accept image bytes only, never caller-provided file paths."""
import base64
import io
import json
import sys
from PIL import Image
from common import Recognizer

Image.MAX_IMAGE_PIXELS = 16_000_000
recognizer = Recognizer()
for line in sys.stdin:
    request = {}
    try:
        if len(line) > 2_505_000:
            raise ValueError('Image too large')
        request = json.loads(line)
        observation = request.get('gemmaObservation', '')
        if not isinstance(observation, str) or len(observation) > 2000:
            raise ValueError('Invalid observation')
        raw = base64.b64decode(request['image'], validate=True)
        if len(raw) > 1_875_000:
            raise ValueError('Image too large')
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                raise ValueError('Image dimensions too large')
            image.load()
            result = recognizer.recognize(image, observation)
        print(json.dumps({'id': request['id'], 'result': result}, ensure_ascii=True), flush=True)
    except Exception:
        print(json.dumps({'id': request.get('id'), 'error': 'CPU image could not be analyzed'}), flush=True)
