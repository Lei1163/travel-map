import json
import zipfile
from pathlib import Path

from PIL import Image

DOCX = r'C:\Users\12693\Desktop\地标图片.docx'
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'data' / 'docx-landmark-src'
SRC.mkdir(parents=True, exist_ok=True)

rows = json.loads((ROOT / 'tools' / 'data' / 'docx-images.json').read_text(encoding='utf-8'))

cities = json.loads((ROOT / 'tools' / 'data' / 'slugs.json').read_text(encoding='utf-8'))
slug_by_name = {c['name']: c['slug'] for c in cities}

with zipfile.ZipFile(DOCX) as z:
    for row in rows:
        city = row['text']
        image = row['images'][0] if row['images'] else None
        if not city or not image:
            print('skip row', row['index'])
            continue
        slug = slug_by_name.get(city)
        if not slug:
            print('no city match', city)
            continue
        raw = z.read(image)
        tmp = SRC / f'{slug}.jpg'
        tmp.write_bytes(raw)
        with Image.open(tmp) as im:
            im = im.convert('RGB')
            print(f'{city} -> {slug}.jpg  {im.size[0]}x{im.size[1]}  {len(raw)//1024}KB')