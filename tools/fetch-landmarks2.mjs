import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { CHINA_LANDMARK } from './data/china-landmark.mjs';

const ROOT = path.join(process.cwd());
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };
const OUT = path.join(ROOT, 'assets', 'landmarks', 'raw');

// Watermarked stock previews.
const BLOCKED = [
  'alamy', 'dreamstime', 'shutterstock', 'istockphoto', 'gettyimages', '123rf', 'depositphotos',
  'vecteezy', 'adobe', 'agefotostock', 'bigstockphoto', 'canstockphoto', 'zoonar', 'photodune',
  'envato', '699pic', 'freepik', 'vcg.com', '588ku', 'hellorf', 'zcool', 'photophoto', 'quanjing',
  'tuchong', 'hippopx', 'pngtree', 'lovepik', 'sixteen-nine', 'photodune', 'picfair', 'agefotostock'
];

// Photo URLs that almost always contain people in the foreground.
const PEOPLE = [
  'people', 'crowd', 'tourist', 'portrait', 'selfie', 'girl', 'boy', 'woman', 'women', 'man-',
  '-man', 'person', 'family', 'couple', 'model', 'children', 'kid', 'smiling', 'human',
  'traveler', 'backpacker', 'visitor', 'pedestrian', 'street-life', 'portrait'
];

const PREFERRED = [
  'unsplash', 'pixabay', 'pexels', 'wikimedia', 'wikipedia', 'storyblok', 'timeout',
  'nationalgeographic', 'bbc', 'cnn', 'reuters', 'apnews', 'theguardian', 'lonelyplanet',
  'tripadvisor', 'travelandleisure', 'cntraveler', 'afar.com', 'atlasobscura', 'culturetrip',
  'japan.travel', 'china.org.cn', 'gov.cn', 'ctrip', 'mafengwo', 'qunar', 'travel',
  'architecture', 'archdaily', 'dezeen'
];

const GEO = JSON.parse(fs.readFileSync('tools/data/ne_10m_places.geojson', 'utf8'));
const byZh = new Map();
for (const f of GEO.features) {
  const p = f.properties;
  const rec = { en: p.NAME, pop: p.POP_MAX || 0 };
  for (const key of [p.NAME_ZH, p.NAME_ZHT]) {
    if (!key) continue;
    const cur = byZh.get(key);
    if (!cur || rec.pop > cur.pop) byZh.set(key, rec);
  }
}

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('data/cities.js', 'utf8'), ctx);
const cities = ctx.window.TRAVEL_CITIES || [];

fs.mkdirSync(OUT, { recursive: true });

const slugify = (s) => String(s).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function imageSize(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { w: 1200, h: 800 };
  return { w: 0, h: 0 };
}

function looksCrowded(url) {
  const u = url.toLowerCase();
  return PEOPLE.some((word) => u.includes(word));
}

async function bingImages(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:photo-photo&form=IRFLTR&first=1`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return [];
  const html = await res.text();
  return [...html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)]
    .map((m) => m[1].replace(/\\\//g, '/'))
    .filter((u) => /^https?:\/\//.test(u))
    .filter((u) => !BLOCKED.some((h) => u.toLowerCase().includes(h)))
    .filter((u) => !looksCrowded(u));
}

async function tryDownload(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!/image\/(jpeg|jpg|png|webp)/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 45000) return null;
    const size = imageSize(buf);
    if (!size.w || !size.h) return null;
    if (size.w < 800 || size.h < 450) return null;
    if (size.w / size.h < 1.15) return null; // keep landscape
    return { buf, size };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function queriesFor(city) {
  const isChina = city.country === '中国';
  const hint = CHINA_LANDMARK[city.name];
  if (isChina) {
    const list = [];
    if (hint) {
      list.push(`${city.name} ${hint} 风景`);
      list.push(`${city.name} ${hint}`);
    }
    list.push(`${city.name} 地标 建筑 风景`);
    list.push(`${city.name} 著名景点`);
    return list;
  }
  const en = city.en;
  return [
    `${en} landmark`,
    `${en} iconic landmark architecture`,
    `${en} famous sight`,
    `${city.name} 地标`
  ];
}

async function main() {
  const only = process.argv[2] || 'all'; // all | china | missing
  const existing = new Set(
    fs.existsSync(path.join(ROOT, 'assets', 'landmarks'))
      ? fs.readdirSync(path.join(ROOT, 'assets', 'landmarks')).filter((f) => /\.(jpg|webp)$/.test(f))
      : []
  );

  const targets = cities.filter((c) => {
    if (only === 'china' && c.country !== '中国') return false;
    const slug = slugify(c.en || c.name);
    if (only === 'missing' && (existing.has(`${slug}.jpg`) || existing.has(`${slug}.webp`))) return false;
    return true;
  });

  const index = {};
  const sources = {};
  const failures = [];
  let done = 0;

  for (const city of targets) {
    done += 1;
    const slug = slugify(city.en || city.name) || slugify(city.name);
    const target = path.join(OUT, `${slug}.jpg`);
    if (fs.existsSync(target) && fs.statSync(target).size > 45000 && only !== 'china') {
      index[city.name] = `${slug}.jpg`;
      console.log(`[${done}/${targets.length}] reuse ${city.name}`);
      continue;
    }
    let saved = false;
    for (const query of queriesFor(city)) {
      let urls = [];
      try { urls = await bingImages(query); } catch (error) { urls = []; }
      const preferred = urls.filter((u) => PREFERRED.some((h) => u.toLowerCase().includes(h)));
      const others = urls.filter((u) => !preferred.includes(u));
      for (const url of [...preferred.slice(0, 6), ...others.slice(0, 5)]) {
        const got = await tryDownload(url);
        if (got) {
          fs.writeFileSync(target, got.buf);
          index[city.name] = `${slug}.jpg`;
          sources[city.name] = url;
          console.log(`[${done}/${targets.length}] ${city.name} ${got.size.w}x${got.size.h} ${Math.round(got.buf.length / 1024)}KB ${url.slice(0, 66)}`);
          saved = true;
          break;
        }
      }
      if (saved) break;
    }
    if (!saved) {
      failures.push(city.name);
      console.log(`[${done}/${targets.length}] FAIL ${city.name}`);
    }
  }

  fs.writeFileSync(path.join(OUT, `index-${only}.json`), JSON.stringify({ index, sources, failures }, null, 1));
  console.log(`DONE ok=${Object.keys(index).length} fail=${failures.length}`);
  if (failures.length) console.log('failures: ' + failures.join('、'));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });