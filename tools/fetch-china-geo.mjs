import fs from 'node:fs';

const SOURCES = [
  'https://geo.datav.aliyun.com/areas_v3/bound/100000.json',
  'https://cdn.jsdelivr.net/gh/echarts-maps/echarts-china-provinces-js@master/echarts-china-provinces-js/china.json'
];

let geo = null;
for (const url of SOURCES) {
  try {
    const res = await fetch(url);
    if (!res.ok) { console.log('status', res.status, url); continue; }
    geo = await res.json();
    console.log('loaded', url, 'features', (geo.features || []).length);
    break;
  } catch (error) {
    console.log('failed', url, error.message);
  }
}

if (!geo) { console.log('no source available'); process.exit(1); }
fs.mkdirSync('tools/data', { recursive: true });
fs.writeFileSync('tools/data/china-raw.json', JSON.stringify(geo));
console.log('saved', fs.statSync('tools/data/china-raw.json').size, 'bytes');
console.log('geometry types', [...new Set(geo.features.map((f) => f.geometry?.type))]);
console.log('properties sample', JSON.stringify(geo.features[0]?.properties).slice(0, 200));