// 百度图片兜底：标题必须包含城市名，横构图、够大、避开美食/酒店/人物。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { CHINA_LANDMARK } from './data/china-landmark.mjs';
import { CHINA_LANDMARK_EXTRA } from './data/china-landmark-extra.mjs';

const ROOT = process.cwd();
const UA = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9',
  referer: 'https://image.baidu.com/'
};
const OUT = path.join(ROOT, 'assets', 'landmarks', 'raw');
const HINTS = { ...CHINA_LANDMARK, ...CHINA_LANDMARK_EXTRA };

const BLOCKED = [
  '699pic','vcg','zcool','tuchong','huitu','nipic','58pic','veer','hellorf','photophoto',
  'quanjing','dreamstime','shutterstock','gettyimages','istockphoto','123rf','depositphotos',
  'shetu66','ztupic','ibaotu','lovepik','pngtree','hippopx','pixabay','adobe','alamy'
];
const NOISE = [
  '美食','食谱','小吃','餐厅','酒店','民宿','门票','机票','穿搭','自拍','美女','人物',
  '地图','路线图','房价','楼盘','招聘','视频','直播','表情包','壁纸','头像','车','汽车'
];
const PEOPLE = ['人物','人像','自拍','合影','游客照','女孩','男孩','美女','帅哥'];

const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
  return { w: 0, h: 0 };
}

async function baiduCandidates(query) {
  const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&ct=201326592&is=&fp=result&word=${encodeURIComponent(query)}&pn=0&rn=30&gsm=1e`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return [];
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { return []; }
  return (json.data || []).filter((x) => x && x.thumbURL).map((it) => ({
    url: it.thumbURL,
    width: Number(it.width) || 0,
    height: Number(it.height) || 0,
    title: String(it.fromPageTitleEnc || ''),
    host: String(it.fromURLHost || '')
  }));
}

function score(item, city, hints) {
  const title = item.title;
  const all = `${title} ${item.host}`.toLowerCase();
  if (BLOCKED.some((b) => all.includes(b))) return -99;
  if (NOISE.some((b) => all.includes(b))) return -99;
  if (PEOPLE.some((b) => title.includes(b))) return -99;
  const hintHit = hints.some((h) => h.length > 1 && title.includes(h));
  if (!title.includes(city) && !hintHit) return -99;
  if (item.width < 1000 || item.height < 560) return -99;
  if (item.width / item.height < 1.25) return -99;
  let s = 5;
  if (/风景|风光|景观|景区|山水|航拍|全景|日落|日出|雪|湖|山/.test(title)) s += 3;
  if (item.width >= 1600) s += 2;
  return s;
}

async function tryDownload(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!/image\/(jpeg|jpg|png|webp)/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 80000) return null;
    const size = imageSize(buf);
    if (!size.w || !size.h) return null;
    if (size.w < 900 || size.h < 500) return null;
    if (size.w / size.h < 1.25) return null;
    return { buf, size };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const only = (process.argv[2] || '').split(',').filter(Boolean);
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/cities.js'), 'utf8'), ctx);
  const index = new Map(ctx.window.TRAVEL_CITIES.map((c) => [c.name, c]));

  const ok = [];
  const bad = [];
  for (const name of only) {
    const rec = index.get(name);
    if (!rec) { bad.push(name); continue; }
    const slug = slugify(rec.en);
    const hints = String(HINTS[name] || '').split(/[\s、,，]+/).filter(Boolean);
    const queries = [`${name} 风景 航拍`, `${name} 风光`, ...hints.map((h) => `${name} ${h}`)];
    const seen = new Set();
    const pool = [];
    for (const q of queries) {
      let cands = [];
      try { cands = await baiduCandidates(q); } catch { cands = []; }
      for (const c of cands) {
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        const s = score(c, name, hints);
        if (s > 0) pool.push({ ...c, score: s });
      }
    }
    pool.sort((a, b) => b.score - a.score);
    let saved = false;
    for (const cand of pool.slice(0, 10)) {
      const got = await tryDownload(cand.url);
      if (!got) continue;
      fs.writeFileSync(path.join(OUT, `${slug}.jpg`), got.buf);
      console.log(`${name} ${got.size.w}x${got.size.h} s${cand.score} ${Math.round(got.buf.length / 1024)}KB ← ${cand.title.slice(0, 42)}`);
      ok.push(name);
      saved = true;
      break;
    }
    if (!saved) { bad.push(name); console.log(`${name} FAIL (pool ${pool.length})`); }
  }
  console.log(`\nbaidu ok=${ok.length} bad=${bad.length}`);
  if (bad.length) console.log('bad: ' + bad.join('、'));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });