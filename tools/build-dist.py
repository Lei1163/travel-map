from pathlib import Path
import shutil, zipfile

ROOT = Path(r'D:\project\travel map')
DIST = ROOT / 'dist'

# 干净的 dist：整站文件（不含 tools/、dist/、预览图、打包产物）
if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir()

files = ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'sw.js']
for name in files:
    shutil.copy2(ROOT / name, DIST / name)

for folder in ['data', 'assets']:
    # assets/landmarks/raw 是未加工的下载原图，只留在开发目录
    shutil.copytree(ROOT / folder, DIST / folder,
                    ignore=shutil.ignore_patterns('raw'))

# 注意：netlify.toml / vercel.json 只放在项目根目录，不能进 dist。
# 它们里面的 publish/outputDirectory 都写着 "dist"，一旦被放进被部署的目录，
# Netlify Drop 会以为还要再找一个 dist 子目录，直接报「部署目录 dist 不存在」。
# 站点是纯静态的，没有这些配置也能正常部署。

# Cloudflare Pages：SPA 兜底 + 缓存头
(DIST / '_redirects').write_text('/* /index.html 200\n', encoding='utf-8')
(DIST / '_headers').write_text(
    '/sw.js\n  Cache-Control: no-cache, no-store, must-revalidate\n'
    '/manifest.webmanifest\n  Content-Type: application/manifest+json\n'
    '/assets/*\n  Cache-Control: public, max-age=604800\n',
    encoding='utf-8')

# GitHub Pages / 静态托管的 404 兜底（所有路径都回到首页）
(DIST / '404.html').write_text(
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./index.html">',
    encoding='utf-8')

total = sum(p.stat().st_size for p in DIST.rglob('*') if p.is_file())
count = sum(1 for p in DIST.rglob('*') if p.is_file())
print(f'dist: {count} files, {total/1048576:.1f} MB')

zip_path = ROOT / 'roam-atlas-site.zip'
if zip_path.exists():
    zip_path.unlink()
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for path in sorted(DIST.rglob('*')):
        if path.is_file():
            zf.write(path, path.relative_to(DIST))
print(f'zip: {zip_path.stat().st_size/1048576:.1f} MB')