import fs from 'node:fs';
const codes = ['co', 'hu', 'mm', 'mt', 'sa'];
for (const c of codes) {
  const url = `https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/${c}.svg`;
  try {
    const r = await fetch(url);
    if (!r.ok) { console.log('FAIL', c, r.status); continue; }
    const t = await r.text();
    fs.writeFileSync(`assets/flags/${c}.svg`, t);
    console.log('ok', c, t.length);
  } catch (e) { console.log('ERR', c, e.message); }
}
