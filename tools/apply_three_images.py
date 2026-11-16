import shutil
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path('.').resolve()
OUT = ROOT / 'assets' / 'landmarks'
INCOMING = ROOT / 'tools' / 'data' / 'incoming'
INCOMING.mkdir(parents=True, exist_ok=True)

ATTACH = {
    'benxi': Path(r'C:\Users\12693\.dsh\attachments\v1\objects\aa\aadf3c8620ed4253386bb3f65ac1b9deb795d91ecd7b10440c7c8fd273ecd252'),
    'dehong': Path(r'C:\Users\12693\.dsh\attachments\v1\objects\a0\a028cc1ade91680a85ae59de4a2a85af830dd315c14aa99b5a4672627be82fa1'),
}
TARGET = (760, 475)


def cover_crop(image, target=TARGET):
    image = image.convert('RGB')
    width, height = image.size
    ratio = width / height
    target_ratio = target[0] / target[1]
    if ratio > target_ratio:
        new_width = int(height * target_ratio)
        left = (width - new_width) // 2
        image = image.crop((left, 0, left + new_width, height))
    else:
        new_height = int(width / target_ratio)
        top = int((height - new_height) * 0.4)
        image = image.crop((0, top, width, top + new_height))
    return image.resize(target, Image.LANCZOS)


def save(image, name):
    dest = OUT / f'{name}.jpg'
    before = dest.stat().st_size if dest.exists() else 0
    image.save(dest, 'JPEG', quality=86, optimize=True, progressive=True, subsampling=1)
    print(f'{name:10} {image.size[0]}x{image.size[1]}  {before // 1024}KB -> {dest.stat().st_size // 1024}KB')


# 1. Chengdu: the source photo was stored rotated 90°, so rotate it back to landscape.
src = ROOT / 'tools' / 'data' / 'docx-landmark-src-2' / 'chengdu.img'
with Image.open(src) as im:
    print('chengdu source', im.size)
    rotated = im.rotate(90, expand=True)
    print('chengdu rotated', rotated.size)
    save(cover_crop(rotated), 'chengdu')

# 2. Benxi and Dehong: supplied photographs.
for name, path in ATTACH.items():
    if not path.exists():
        print('MISSING attachment for', name, path)
        continue
    local = INCOMING / f'{name}.jpg'
    shutil.copyfile(path, local)
    with Image.open(local) as im:
        print(f'{name} source', im.size)
        save(cover_crop(im), name)