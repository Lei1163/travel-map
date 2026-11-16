import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'tools', 'data', 'borders-cache');
fs.mkdirSync(CACHE, { recursive: true });

async function fetchJson(url, cacheName) {
  const file = path.join(CACHE, cacheName);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const json = await res.json();
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

const country = await fetchJson('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json', 'china-provinces.json');
const rows = new Map();

function addCity(name, lon, lat, province) {
  const clean = String(name || '').replace(/市$/, '').trim();
  if (!clean || rows.has(clean)) return;
  rows.set(clean, { name: clean, province, lat: Number(lat), lon: Number(lon) });
}

for (const feature of country.features) {
  const province = feature.properties?.name || '';
  const adcode = feature.properties?.adcode;
  if (!adcode) continue;
  let data;
  try {
    data = await fetchJson(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`, `province-${adcode}.json`);
  } catch (error) {
    console.log('skip province', province, error.message);
    continue;
  }
  for (const city of data.features || []) {
    const props = city.properties || {};
    const center = props.center || props.centroid;
    if (!center) continue;
    addCity(props.name, center[0], center[1], province);
  }
}

console.log('cities collected', rows.size);

// Which of them are already in the bundled travel list?
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('data/cities.js', 'utf8'), ctx);
const known = new Set(ctx.window.TRAVEL_CITIES.filter((c) => c.country === '中国').map((c) => c.name));

const extra = [...rows.values()].filter((c) => !known.has(c.name));
extra.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
console.log('extra cities', extra.length);
console.log(extra.slice(0, 10).map((c) => c.name).join(' '));

fs.writeFileSync('tools/data/china-cities-extra.json', JSON.stringify(extra, null, 1), 'utf8');