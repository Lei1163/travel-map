import json
import re
import zipfile
from pathlib import Path

DOCX = r'C:\Users\12693\Desktop\全球热门旅游城市清单.docx'
OUT = Path('tools/data')
OUT.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(DOCX) as z:
    xml = z.read('word/document.xml').decode('utf-8')

paras = re.findall(r'<w:p[ >].*?</w:p>', xml, re.S)
lines = []
for para in paras:
    texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', para, re.S)
    line = ''.join(texts).strip()
    if line:
        lines.append(line)

china_line = next(l for l in lines if l.startswith('北京、'))
china = [c.strip() for c in china_line.split('、') if c.strip()]

foreign = []
for line in lines:
    if '：' not in line:
        continue
    country, rest = line.split('：', 1)
    country = country.strip()
    if not country or len(country) > 12 or country.startswith('第一部分') or country.startswith('第二部分'):
        continue
    for city in rest.split('、'):
        city = city.strip()
        if city:
            foreign.append({'country': country, 'city': city})

payload = {'china': china, 'foreign': foreign}
(OUT / 'docx-cities.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')

print('china', len(china), 'foreign', len(foreign), 'countries', len({f['country'] for f in foreign}))
print('china list ok:', china[:5], '...', china[-3:])
print('countries:', '、'.join(sorted({f['country'] for f in foreign})))