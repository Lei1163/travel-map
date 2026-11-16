import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets' / 'landmarks' / 'raw'
OUT = ROOT / 'assets' / 'landmarks'
TARGET = (760, 475)

rows = json.loads((ROOT / 'tools' / 'data' / 'slugs.json').read_text(encoding='utf-8'))
print('cities', len(rows))

OUT.mkdir(parents=True, exist_ok=True)
manifest = {}
missing = []

for row in rows:
    slug = row['slug']
    src = RAW / f'{slug}.jpg'
    if not src.exists():
        missing.append(f"{row['name']}({slug})")
        continue
    dest = OUT / f'{slug}.jpg'
    try:
        with Image.open(src) as image:
            image = image.convert('RGB')
            width, height = image.size
            if width < 400 or height < 250:
                missing.append(f"{row['name']}(small)")
                continue
            ratio = width / height
            target_ratio = TARGET[0] / TARGET[1]
            if ratio > target_ratio:
                new_width = int(height * target_ratio)
                left = (width - new_width) // 2
                image = image.crop((left, 0, left + new_width, height))
            else:
                new_height = int(width / target_ratio)
                top = int((height - new_height) * 0.42)
                image = image.crop((0, top, width, top + new_height))
            image = image.resize(TARGET, Image.LANCZOS)
            image.save(dest, 'JPEG', quality=82, optimize=True, progressive=True, subsampling=1)
        manifest[row['name']] = f'{slug}.jpg'
    except Exception as error:
        missing.append(f"{row['name']}({error})")

referenced = set(manifest.values())
for f in OUT.glob('*.jpg'):
    if f.name not in referenced:
        f.unlink()

lines = ['/* City landmark artwork bundled with the app. */', 'window.CITY_LANDMARKS = {']
items = sorted(manifest.items(), key=lambda kv: kv[0])
for i, (city, file) in enumerate(items):
    comma = ',' if i < len(items) - 1 else ''
    lines.append(f'  "{city}": "{file}"{comma}')
lines.append('};')
(ROOT / 'data' / 'landmarks.js').write_text('\n'.join(lines) + '\n', encoding='utf-8')

total = sum((OUT / f).stat().st_size for f in manifest.values())
print(f'converted={len(manifest)} missing={len(missing)} totalMB={total / 1024 / 1024:.2f}')
if missing:
    print('missing:', '、'.join(missing))