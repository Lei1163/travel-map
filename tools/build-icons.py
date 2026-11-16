from pathlib import Path
from PIL import Image

ROOT = Path(r'D:\project\travel map')
src = Image.open(ROOT / 'assets' / 'brand' / 'logo.png').convert('RGBA')
cream = (236, 232, 220, 255)  # matches the app background

def save(img, size, name):
    out = img.resize((size, size), Image.LANCZOS)
    out.save(ROOT / 'assets' / 'brand' / name, optimize=True)
    print(name, out.size)

# Plain icons: logo centred on the cream background (no transparency issues).
def padded(size, scale):
    canvas = Image.new('RGBA', (size, size), cream)
    inner = int(size * scale)
    art = src.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    canvas.alpha_composite(art, (offset, offset))
    return canvas

save(padded(192, 0.86), 192, 'icon-192.png')
save(padded(512, 0.86), 512, 'icon-512.png')
# Maskable icon keeps the art inside the safe zone (80%).
save(padded(512, 0.62), 512, 'icon-maskable-512.png')
save(padded(180, 0.86), 180, 'apple-touch-icon.png')
print('icons ready')