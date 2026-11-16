"""
把整站打包成「一个 HTML 文件」：双击即用，不需要服务器、不需要网络。
- CSS、全部 JS、地图数据、地标图、国旗都内联成 data URL
- 地标图会重新压到 900px 宽 / JPEG 72，体积从 28MB 降到约 8MB
- 产出：D:\\project\\travel map\\赴迹.html（单文件，可直接发给朋友）
"""
from pathlib import Path
import base64, io, re, json
from PIL import Image

ROOT = Path(r'D:\project\travel map')
OUT = ROOT / '赴迹.html'

LANDMARK_MAX_W = 680
LANDMARK_QUALITY = 64
FLAG_MAX_W = 96

def data_url_bytes(raw: bytes, mime: str) -> str:
    return f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')

def shrink_image(path: Path, max_w: int, quality: int) -> str:
    if path.suffix.lower() == '.svg':
        return data_url_bytes(path.read_bytes(), 'image/svg+xml')
    img = Image.open(path)
    if img.width > max_w:
        h = round(img.height * max_w / img.width)
        img = img.resize((max_w, h), Image.LANCZOS)
    buf = io.BytesIO()
    if img.mode in ('RGBA', 'LA', 'P'):
        # 保留透明通道，压成 PNG 会更小
        img = img.convert('RGBA')
        img.save(buf, 'PNG', optimize=True)
        return data_url_bytes(buf.getvalue(), 'image/png')
    img = img.convert('RGB')
    img.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
    return data_url_bytes(buf.getvalue(), 'image/jpeg')

def inline_svg(path: Path) -> str:
    return data_url_bytes(path.read_bytes(), 'image/svg+xml')

assets = {}
for folder, max_w, quality in (('landmarks', LANDMARK_MAX_W, LANDMARK_QUALITY), ('flags', FLAG_MAX_W, 80)):
    for path in sorted((ROOT / 'assets' / folder).iterdir()):
        if not path.is_file():
            continue
        key = f'assets/{folder}/{path.name}'
        assets[key] = inline_svg(path) if path.suffix.lower() == '.svg' else shrink_image(path, max_w, quality)

for path in sorted((ROOT / 'assets' / 'cities').iterdir()):
    if path.is_file():
        assets[f'assets/cities/{path.name}'] = inline_svg(path) if path.suffix.lower() == '.svg' else shrink_image(path, 600, 80)

for path in sorted((ROOT / 'assets' / 'brand').iterdir()):
    if path.is_file() and path.name in ('logo.png', 'icon-192.png'):
        assets[f'assets/brand/{path.name}'] = shrink_image(path, 320, 88)

def read(name: str) -> str:
    return (ROOT / name).read_text(encoding='utf-8')

html = read('index.html')
css = read('styles.css')
app = read('app.js')
data_files = ['data/world-map.js', 'data/china-map.js', 'data/borders.js',
              'data/china-cities-extra.js', 'data/cities.js', 'data/landmarks.js']

# ---- app.js 已内置 resolveAsset()，会自动查 window.__ATLAS_ASSETS，无需改写路径 ----

# 单文件里不需要 PWA 清单
html = html.replace('  <link rel="manifest" href="manifest.webmanifest">\n', '', 1)

# ---- 内联 CSS ---------------------------------------------------------------
html = html.replace('  <link rel="stylesheet" href="styles.css">', '  <style>\n' + css + '\n  </style>', 1)

# ---- 内联 HTML 里的图片 -----------------------------------------------------
def swap_src(text: str, rel: str) -> str:
    url = assets.get(rel, '')
    return text.replace(f'"{rel}"', f'"{url}"')

for rel in ('assets/brand/logo.png', 'assets/brand/apple-touch-icon.png', 'assets/cities/generic.svg'):
    html = swap_src(html, rel)

# ---- 替换脚本加载块 ---------------------------------------------------------
loader_start = html.index('  <script>\n    // Load the scripts with a fresh stamp')
loader_end = html.index('  </script>\n</body>')
asset_json = json.dumps(assets, ensure_ascii=False, separators=(',', ':'))
payload = ['  <script id="atlas-assets">window.__ATLAS_ASSETS=' + asset_json + ';</script>']
for name in data_files:
    payload.append('  <script>\n' + read(name) + '\n  </script>')
payload.append('  <script>\n' + app + '\n  </script>')
html = html[:loader_start] + '\n'.join(payload) + '\n' + html[loader_end + len('  </script>\n'):]

OUT.write_text(html, encoding='utf-8')
print(f'{OUT.name}: {OUT.stat().st_size/1048576:.1f} MB, {len(assets)} assets inlined')