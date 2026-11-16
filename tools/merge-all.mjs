import fs from 'node:fs';
import { MANUAL, PINYIN } from './data/manual.mjs';

const src = JSON.parse(fs.readFileSync('tools/data/ne-matched.json', 'utf8'));
const { rows, countryEn } = src;

const out = [];
const problems = [];

for (const row of rows) {
  const manual = MANUAL[row.name];
  let lat = row.lat;
  let lon = row.lon;
  let en = row.en;
  if (manual) {
    lat = manual.lat;
    lon = manual.lon;
    en = manual.en;
  }
  if (lat == null || lon == null || !en) {
    problems.push(`${row.country}/${row.name}`);
    continue;
  }
  // Clean up Natural Earth English names (strip leading articles, fix casing).
  en = String(en).replace(/^The\s+/i, '').trim();

  const isChina = row.country === '中国';
  const pinyin = isChina ? (PINYIN[row.name] || '') : '';
  if (isChina && !pinyin) problems.push(`pinyin missing: ${row.name}`);

  out.push({
    name: row.name,
    en,
    country: row.country,
    code: row.code,
    lat: +Number(lat).toFixed(4),
    lon: +Number(lon).toFixed(4),
    pinyin
  });
}

// Sanity check coordinates land inside the country's rough bounding box.
const BOX = {
  CN: [17, 54, 73, 136], JP: [24, 46, 122, 146], KR: [33, 39, 124, 132], TH: [5, 21, 97, 106],
  SG: [1, 2, 103, 104], MY: [0, 8, 99, 120], VN: [8, 24, 102, 110], ID: [-11, 6, 95, 141],
  PH: [4, 21, 116, 127], LA: [13, 23, 99, 108], KH: [10, 15, 102, 108], MM: [9, 29, 92, 102],
  IN: [6, 36, 68, 98], LK: [5, 10, 79, 82], TR: [35, 43, 25, 45], AE: [22, 27, 51, 57],
  QA: [24, 27, 50, 52], SA: [16, 33, 34, 56], IL: [29, 34, 34, 36], JO: [29, 34, 34, 40],
  EG: [21, 32, 24, 37], MA: [27, 36, -14, -1], ZA: [-35, -22, 16, 33], KE: [-5, 5, 33, 42],
  TZ: [-12, -1, 29, 41], FR: [41, 52, -6, 10], GB: [49, 61, -9, 2], IT: [36, 48, 6, 19],
  ES: [27, 44, -19, 5], PT: [32, 43, -32, -6], NL: [50, 54, 3, 8], DE: [47, 56, 5, 16],
  AT: [46, 50, 9, 18], CH: [45, 48, 5, 11], CZ: [48, 52, 12, 19], HU: [45, 49, 16, 23],
  GR: [34, 42, 19, 30], HR: [42, 47, 13, 20], DK: [54, 58, 7, 13], SE: [55, 69, 10, 25],
  NO: [57, 72, 4, 32], IS: [63, 67, -25, -13], FI: [59, 71, 19, 32], MT: [35, 37, 14, 15],
  AU: [-44, -9, 112, 154], NZ: [-48, -33, 165, 180], US: [24, 50, -126, -66], CA: [41, 84, -142, -52],
  MX: [14, 33, -118, -86], BR: [-34, 6, -75, -33], AR: [-56, -21, -74, -52], PE: [-19, 1, -82, -68],
  CL: [-56, -16, -76, -65], CO: [-5, 14, -80, -66], CU: [19, 24, -85, -73]
};

for (const c of out) {
  const box = BOX[c.code];
  if (!box) { problems.push(`no bbox for ${c.code} (${c.name})`); continue; }
  const [minLat, maxLat, minLon, maxLon] = box;
  // Hawaii is part of the US but far outside the mainland box.
  if (c.code === 'US' && c.lon < -150) continue;
  if (c.lat < minLat - 1 || c.lat > maxLat + 1 || c.lon < minLon - 1 || c.lon > maxLon + 1) {
    problems.push(`out of box ${c.name} (${c.code}) ${c.lat},${c.lon}`);
  }
}

// Duplicate name check.
const seen = new Map();
for (const c of out) {
  const key = c.name;
  if (seen.has(key)) problems.push(`duplicate name: ${key}`);
  seen.set(key, true);
}

fs.writeFileSync('tools/data/cities-merged.json', JSON.stringify({ cities: out, countryEn }, null, 1));
console.log('cities', out.length);
console.log('problems', problems.length);
console.log(problems.slice(0, 30).join('\n'));