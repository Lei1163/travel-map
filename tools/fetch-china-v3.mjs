import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };
const RAW = path.join(ROOT, 'assets', 'landmarks', 'raw');

// Domains that publish clean travel photography: encyclopaedias, news media,
// travel guides and photography forums.
const TRUSTED = [
  'bkimg.cdn.bcebos.com', 'baike.baidu.com', 'sinaimg.cn', 'ifengimg.com', 'qunarzz.com',
  'c-ctrip.com', 'pconline.com.cn', 'zol-img.com.cn', 'scol.com.cn', 'news.cn',
  'people.com.cn', 'xinhuanet.com', 'chinadaily.com.cn', 'cgtn.com', 'thepaper.cn',
  'stcn.com', 'yicai.com', 'mafengwo.net', 'mafengwo.cn', 'lvyou.baidu.com',
  'travel.sina.com.cn', 'unsplash.com', 'pixabay.com', 'pexels.com', 'wikimedia.org',
  'wikipedia.org', 'tripadvisor.com', 'lonelyplanet.com', 'nationalgeographic.com',
  'archdaily.com', 'sohu.com', '163.com', 'qq.com', 'zhihu.com', 'douban.com',
  'ctrip.com', 'ly.com', 'tuniu.com', 'huanqiu.com', 'guancha.cn', 'jiemian.com',
  'thehour.cn', 'cnr.cn', 'gmw.cn', 'ce.cn'
];

// Domains that watermark their previews or serve video thumbnails.
const BAD = [
  'nximg.cn', 'huitu.com', 'shetu66.com', '88vj.com', 'qpic.cn', 'tooopen.com',
  'qiantucdn.com', '58pic.com', '16pic.com', 'bigbigwork.com', 'zhituwang.com',
  'ooopic.com', '51yuansu.com', 'sucai', 'stock.', 'alamy', 'dreamstime', 'shutterstock',
  'istockphoto', 'gettyimages', '123rf', 'depositphotos', 'vecteezy', 'adobe',
  'agefotostock', 'bigstockphoto', 'canstockphoto', 'zoonar', 'photodune', 'envato',
  '699pic', 'freepik', 'vcg.com', '588ku', 'hellorf', 'zcool', 'photophoto', 'quanjing',
  'tuchong', 'hippopx', 'pngtree', 'lovepik', 'picfair', 'deskcity', 'nipic'
];

const PEOPLE_ZH = ['人像', '人物', '游客', '人流', '人群', '美女', '女生', '男生', '小姐姐', '小哥哥', '情侣',
  '亲子', '自拍', '打卡', '网红', '模特', '写真', '婚纱', '街拍', '路人', '背影', '笑脸', '合影', '全家福',
  '汉服', '旅拍', '帅哥', '少女', '孩童'];
const PEOPLE_EN = ['people', 'crowd', 'tourist', 'portrait', 'selfie', 'girl', 'boy', 'woman', 'women',
  'person', 'family', 'couple', 'model', 'children', 'kid', 'smiling', 'human', 'traveler', 'backpacker',
  'visitor', 'pedestrian'];

const SCENERY_ZH = ['风景', '风光', '景色', '夜景', '全景', '建筑', '地标', '古城', '古镇', '山水', '云海',
  '雪景', '日出', '日落', '航拍', '俯瞰', '海景', '草原', '湖泊', '瀑布', '寺庙', '石窟', '城墙', '大桥',
  '天际线', '公园', '景区', '旅游', '摄影', '美图', '画卷'];

const HINTS = JSON.parse(fs.readFileSync('tools/data/china-hints.json', 'utf8'));

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('data/cities.js', 'utf8'), ctx);
const cities = ctx.window.TRAVEL_CITIES.filter((c) => c.country === '中国');

const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const trust = (url) => TRUSTED.some((h) => url.includes(h)) ? 1 : 0;
const bad = (url) => BAD.some((h) => url.toLowerCase().includes(h));

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

function parseResults(html) {
  const out = [];
  const re = /murl&quot;:&quot;(.*?)&quot;.*?&quot;t&quot;:&quot;(.*?)&quot;/gs;
  let m;
  while ((m = re.exec(html))) {
    const title = m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/');
    out.push({ url: m[1].replace(/\\\//g, '/'), title });
  }
  if (!out.length) {
    for (const mm of html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)) out.push({ url: mm[1].replace(/\\\//g, '/'), title: '' });
  }
  return out;
}

async function bing(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:photo-photo+filterui:aspect-wide&form=IRFLTR`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return [];
  return parseResults(await res.text());
}

function titleScore(title) {
  const t = title.toLowerCase();
  if (PEOPLE_ZH.some((w) => title.includes(w))) return -100;
  if (PEOPLE_EN.some((w) => t.includes(w))) return -100;
  let score = 0;
  for (const w of SCENERY_ZH) if (title.includes(w)) score += 2;
  return score;
}

async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: UA, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    if (!/image\/(jpeg|jpg|png|webp)/i.test(res.headers.get('content-type') || '')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 45000) return null;
    const size = imageSize(buf);
    if (!size.w || size.w < 900 || size.h < 500) return null;
    if (size.w / size.h < 1.5) return null;
    return { buf, size };
  } catch (error) { return null; } finally { clearTimeout(timer); }
}

const only = process.argv.slice(2);
const targets = only.length ? cities.filter((c) => only.includes(c.name)) : cities;

const index = {};
if (fs.existsSync(path.join(RAW, 'index-china.json'))) {
  Object.assign(index, JSON.parse(fs.readFileSync(path.join(RAW, 'index-china.json'), 'utf8')).index || {});
}

const failures = [];
let done = 0;

for (const city of targets) {
  done += 1;
  const slug = slugify(city.en || city.name);
  const target = path.join(RAW, `${slug}.jpg`);
  const hint = HINTS[city.name];
  const queries = [
    hint ? `${city.name} ${hint} 风景 高清` : `${city.name} 风景 地标 高清`,
    hint ? `${city.name} ${hint} 全景` : `${city.name} 著名景点 全景`,
    `${city.name} 地标 建筑 摄影`
  ];

  let best = null;
  // Tier 1: trusted source + scenery wording. Tier 2: scenery wording only.
  // Tier 3: trusted source only. This keeps quality high without leaving gaps.
  for (const minScore of [3, 2, 0]) {
    for (const query of queries) {
      const results = await bing(query).catch(() => []);
      const ranked = results
        .filter((r) => !bad(r.url))
        .map((r) => ({ ...r, score: titleScore(r.title) + trust(r.url) * 3 }))
        .filter((r) => r.score >= minScore && (minScore > 0 ? titleScore(r.title) > 0 || trust(r.url) : true))
        .sort((a, b) => b.score - a.score);
      for (const r of ranked.slice(0, 8)) {
        const got = await download(r.url);
        if (got) { best = { ...got, url: r.url, title: r.title, score: r.score }; break; }
      }
      if (best) break;
    }
    if (best) break;
  }

  if (best) {
    fs.writeFileSync(target, best.buf);
    index[city.name] = `${slug}.jpg`;
    console.log(`[${done}/${targets.length}] ${city.name} ${best.size.w}x${best.size.h} s=${best.score} ${best.title.slice(0, 26)} | ${best.url.slice(0, 48)}`);
  } else {
    failures.push(city.name);
    console.log(`[${done}/${targets.length}] FAIL ${city.name}`);
  }
}

fs.writeFileSync(path.join(RAW, 'index-china.json'), JSON.stringify({ index, failures }, null, 1));
console.log(`DONE ok=${Object.keys(index).length} fail=${failures.length}`);
if (failures.length) console.log('failures: ' + failures.join('、'));