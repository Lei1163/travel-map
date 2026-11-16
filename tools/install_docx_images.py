import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'data' / 'docx-landmark-src'
OUT = ROOT / 'assets' / 'landmarks'
TARGET = (760, 475)

rows = json.loads((ROOT / 'tools' / 'data' / 'docx-images.json').read_text(encoding='utf-8'))
cities = json.loads((ROOT / 'tools' / 'data' / 'slugs.json').read_text(encoding='utf-8'))
slug_by_name = {c['name']: c['slug'] for c in cities}

replaced = []
for row in rows:
    city = row['text']
    slug = slug_by_name.get(city)
    src = SRC / f'{slug}.jpg'
    if not src.exists():
        print('missing source', city)
        continue
    dest = OUT / f'{slug}.jpg'
    before = hashlib.md5(dest.read_bytes()).hexdigest() if dest.exists() else None
    with Image.open(src) as image:
        image = image.convert('RGB')
        width, height = image.size
        target_ratio = TARGET[0] / TARGET[1]
        ratio = width / height
        if ratio > target_ratio:
            new_width = int(height * target_ratio)
            left = (width - new_width) // 2
            image = image.crop((left, 0, left + new_width, height))
        else:
            new_height = int(width / target_ratio)
            top = int((height - new_height) * 0.4)
            image = image.crop((0, top, width, top + new_height))
        image = image.resize(TARGET, Image.LANCZOS)
        image.save(dest, 'JPEG', quality=86, optimize=True, progressive=True, subsampling=1)
    after = hashlib.md5(dest.read_bytes()).hexdigest()
    replaced.append((city, f'{slug}.jpg', before != after, dest.stat().st_size))

print(f'replaced {len(replaced)} images')
for city, file, changed, size in replaced:
    print(f'  {city:6} {file:22} changed={changed} {size // 1024}KB')