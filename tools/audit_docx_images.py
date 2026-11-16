import json
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parent.parent
rows = json.loads((ROOT / 'tools' / 'data' / 'docx-images.json').read_text(encoding='utf-8'))
cities = json.loads((ROOT / 'tools' / 'data' / 'slugs.json').read_text(encoding='utf-8'))
slug_by_name = {c['name']: c['slug'] for c in cities}

for row in rows:
    city = row['text']
    slug = slug_by_name[city]
    p = ROOT / 'assets' / 'landmarks' / f'{slug}.jpg'
    with Image.open(p) as im:
        rgb = im.convert('RGB')
        stat = ImageStat.Stat(rgb)
        mean = sum(stat.mean) / 3
        std = sum(stat.stddev) / 3
    print(f'{city:6} {slug:20} {im.size[0]}x{im.size[1]}  brightness={mean:5.1f} contrast={std:5.1f}  {p.stat().st_size//1024}KB')