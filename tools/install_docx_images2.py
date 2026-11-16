import hashlib
import json
import zipfile
from pathlib import Path

from PIL import Image

DOCX = r'C:\Users\12693\Desktop\地标.docx'
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'data' / 'docx-landmark-src-2'
OUT = ROOT / 'assets' / 'landmarks'
TARGET = (760, 475)

# The document uses a shortened name for one city.
ALIAS = {'胡志明': '胡志明市', '胡志明市': '胡志明市'}

SRC.mkdir(parents=True, exist_ok=True)
rows = json.loads((ROOT / 'tools' / 'data' / 'docx-images-2.json').read_text(encoding='utf-8'))
cities = json.loads((ROOT / 'tools' / 'data' / 'slugs.json').read_text(encoding='utf-8'))
by_name = {c['name']: c for c in cities}

results = []
with zipfile.ZipFile(DOCX) as z:
    for row in rows:
        raw_name = row['text']
        city = ALIAS.get(raw_name, raw_name)
        info = by_name.get(city)
        if not info or not row['images']:
            print(f'skip {raw_name}')
            continue
        slug = info['slug']
        raw = z.read(row['images'][0])
        src = SRC / f'{slug}.img'
        src.write_bytes(raw)

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
            resized = image.resize(TARGET, Image.LANCZOS)
            resized.save(dest, 'JPEG', quality=86, optimize=True, progressive=True, subsampling=1)
            size = resized.size

        after = hashlib.md5(dest.read_bytes()).hexdigest()
        results.append({
            'city': city,
            'file': f'{slug}.jpg',
            'changed': before != after,
            'kb': dest.stat().st_size // 1024,
            'size': f'{size[0]}x{size[1]}'
        })

print(f'replaced {len(results)} images')
for r in results:
    print(f"  {r['city']:8} {r['file']:22} changed={r['changed']} {r['size']} {r['kb']}KB")
print('unchanged:', [r['city'] for r in results if not r['changed']])