"""把新增城市的原图裁成 760x475 并重写 data/landmarks.js。

- 只处理 raw/ 里存在、而 assets/landmarks/ 里还没有的城市
- 已有的 326 张成品图保持不动
- 最后按城市名排序重写 data/landmarks.js（覆盖全部有图的城市）
"""
import json
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets' / 'landmarks' / 'raw'
OUT = ROOT / 'assets' / 'landmarks'
TARGET = (760, 475)

# 用 node 读出城市表（保持和 app 同一份数据）
node = subprocess.run(
    ['node', '-e', r'''
const fs=require("fs"),vm=require("vm");
const ctx={window:{}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync("data/cities.js","utf8"),ctx);
console.log(JSON.stringify(ctx.window.TRAVEL_CITIES.map(c=>({name:c.name,en:c.en}))));
'''],
    cwd=str(ROOT), capture_output=True, text=True, encoding='utf-8', check=True)
cities = json.loads(node.stdout)


def slugify(value: str) -> str:
    import unicodedata

    # 去掉变音符号（Ürümqi -> urumqi），和前端 make-slugs 的规则保持一致
    text = unicodedata.normalize('NFKD', value.lower())
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    out = []
    for ch in text:
        if ch.isalnum() and ch.isascii():
            out.append(ch)
        elif out and out[-1] != '-':
            out.append('-')
    return ''.join(out).strip('-')


converted = []
skipped = []
failed = []

for city in cities:
    slug = slugify(city['en'] or city['name'])
    dest = OUT / f'{slug}.jpg'
    src = RAW / f'{slug}.jpg'
    if dest.exists() and dest.stat().st_size > 20000:
        continue
    if not src.exists():
        skipped.append(city['name'])
        continue
    try:
        with Image.open(src) as image:
            image = image.convert('RGB')
            width, height = image.size
            if width < 800 or height < 450:
                failed.append(f"{city['name']}(small {width}x{height})")
                continue
            ratio = width / height
            target_ratio = TARGET[0] / TARGET[1]
            if ratio > target_ratio:
                new_width = int(height * target_ratio)
                left = (width - new_width) // 2
                image = image.crop((left, 0, left + new_width, height))
            else:
                new_height = int(width / target_ratio)
                # 稍微偏上取景，天空/远山保留更多
                top = int((height - new_height) * 0.38)
                image = image.crop((0, top, width, top + new_height))
            image = image.resize(TARGET, Image.LANCZOS)
            image.save(dest, 'JPEG', quality=82, optimize=True, progressive=True, subsampling=1)
        converted.append(city['name'])
    except Exception as error:  # noqa: BLE001
        failed.append(f"{city['name']}({error})")

# 重写 landmarks.js：所有有成品图的城市
manifest = {}
for city in cities:
    slug = slugify(city['en'] or city['name'])
    if (OUT / f'{slug}.jpg').exists():
        manifest[city['name']] = f'{slug}.jpg'

lines = ['/* City landmark artwork bundled with the app. */', 'window.CITY_LANDMARKS = {']
items = sorted(manifest.items(), key=lambda kv: kv[0])
for index, (city_name, file_name) in enumerate(items):
    comma = ',' if index < len(items) - 1 else ''
    lines.append(f'  "{city_name}": "{file_name}"{comma}')
lines.append('};')
(ROOT / 'data' / 'landmarks.js').write_text('\n'.join(lines) + '\n', encoding='utf-8')

total = sum((OUT / f).stat().st_size for f in manifest.values())
print(f'converted={len(converted)} missingRaw={len(skipped)} failed={len(failed)} total={len(manifest)}')
print(f'imageMB={total / 1024 / 1024:.2f}')
if converted:
    print('new:', '、'.join(converted))
if failed:
    print('failed:', '、'.join(failed))