import json
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path('.').resolve()
rows = json.loads((ROOT / 'tools' / 'data' / 'docx-images-3.json').read_text(encoding='utf-8'))
cities = {c['name']: c for c in json.loads((ROOT / 'tools' / 'data' / 'slugs.json').read_text(encoding='utf-8'))}

for row in rows:
    city = row['text']
    slug = cities[city]['slug']
    p = ROOT / 'assets' / 'landmarks' / f'{slug}.jpg'
    with Image.open(p) as im:
        st = ImageStat.Stat(im.convert('RGB'))
        mean = sum(st.mean) / 3
        std = sum(st.stddev) / 3
    print(f'{city:8} {slug:20} {im.size[0]}x{im.size[1]} bright={mean:5.1f} contrast={std:5.1f} {p.stat().st_size // 1024}KB')

total = len(list((ROOT / 'assets' / 'landmarks').glob('*.jpg')))
print('total landmark files', total)