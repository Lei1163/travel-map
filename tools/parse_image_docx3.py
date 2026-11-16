import json
import re
import zipfile
from pathlib import Path

DOCX = r'C:\Users\12693\Desktop\图像.docx'
OUT = Path('tools/data')
OUT.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(DOCX) as z:
    doc = z.read('word/document.xml').decode('utf-8')
    rels = z.read('word/_rels/document.xml.rels').decode('utf-8')

rid_map = {}
for m in re.finditer(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels):
    rid, target = m.group(1), m.group(2)
    if 'media' in target:
        rid_map[rid] = 'word/' + target.replace('../', '')

print('rels media', len(rid_map))

paras = re.findall(r'<w:p[ >].*?</w:p>', doc, re.S)
rows = []
for idx, para in enumerate(paras):
    texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', para, re.S)
    line = ''.join(texts).strip()
    embeds = re.findall(r'r:embed="([^"]+)"', para)
    images = [rid_map[e] for e in embeds if e in rid_map]
    if line or images:
        rows.append({'index': idx, 'text': line, 'images': images})

for r in rows:
    print(r['index'], repr(r['text']), r['images'])

(OUT / 'docx-images-3.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
print('rows', len(rows), 'images', sum(len(r['images']) for r in rows))