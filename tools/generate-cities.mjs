import fs from 'node:fs';

const { cities, countryEn } = JSON.parse(fs.readFileSync('tools/data/cities-merged.json', 'utf8'));

const escape = (s) => String(s).replace(/"/g, '\\"');

const cityRows = cities.map((c) => {
  const search = [c.name, c.en, c.country, c.pinyin, String(c.en).toLowerCase()]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return `  {\n    "name": "${escape(c.name)}",\n    "en": "${escape(c.en)}",\n    "country": "${escape(c.country)}",\n    "code": "${c.code}",\n    "lat": ${c.lat},\n    "lon": ${c.lon},\n    "pinyin": "${escape(c.pinyin)}",\n    "search": "${escape(search)}"\n  }`;
}).join(',\n');

// Build the country index from the cities actually present.
const byCountry = new Map();
for (const c of cities) {
  if (!byCountry.has(c.country)) byCountry.set(c.country, []);
  byCountry.get(c.country).push(c);
}

const countryRows = [...byCountry.entries()]
  .map(([name, list]) => {
    const lat = +(list.reduce((s, c) => s + c.lat, 0) / list.length).toFixed(4);
    const lon = +(list.reduce((s, c) => s + c.lon, 0) / list.length).toFixed(4);
    const en = countryEn[name] || list[0].en;
    const code = list[0].code;
    return { name, en, code, lat, lon, count: list.length };
  })
  .sort((a, b) => a.en.localeCompare(b.en, 'en'));

const countryJson = countryRows.map((c) => `  {\n    "name": "${escape(c.name)}",\n    "en": "${escape(c.en)}",\n    "code": "${c.code}",\n    "lat": ${c.lat},\n    "lon": ${c.lon},\n    "pinyin": "",\n    "search": "${escape(`${c.en} ${c.name}`.toLowerCase())}"\n  }`).join(',\n');

const header = `/* Bundled offline destination index. Search by Chinese, English or pinyin.\n   Source: 全球热门旅游城市清单（中国 + 海外热门目的地）. */\n`;
const out = `${header}window.TRAVEL_CITIES = [\n${cityRows}\n];\nwindow.TRAVEL_COUNTRIES = [\n${countryJson}\n];\n`;

fs.writeFileSync('data/cities.js', out, 'utf8');
console.log('cities', cities.length, 'countries', countryRows.length, 'bytes', Buffer.byteLength(out));
console.log('china cities', byCountry.get('中国').length);
console.log(countryRows.map((c) => `${c.name}/${c.en}(${c.count})`).join(' '));