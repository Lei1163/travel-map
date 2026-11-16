// 严格重取：只接受「标题/来源页同时出现城市名 + 地标词」，且来自可信站点的高清横图。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { CHINA_LANDMARK } from './data/china-landmark.mjs';
import { CHINA_LANDMARK_EXTRA } from './data/china-landmark-extra.mjs';

const ROOT = process.cwd();
const UA = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9'
};
const OUT = path.join(ROOT, 'assets', 'landmarks', 'raw');
const HINTS = { ...CHINA_LANDMARK, ...CHINA_LANDMARK_EXTRA };

const BLOCKED = [
  'alamy','dreamstime','shutterstock','istockphoto','gettyimages','123rf','depositphotos','vecteezy',
  'adobe','agefotostock','bigstockphoto','canstockphoto','zoonar','photodune','envato','699pic',
  'freepik','vcg.com','588ku','hellorf','zcool','photophoto','quanjing','tuchong','hippopx','pngtree',
  'lovepik','sixteen-nine','picfair','shetu66','nipic','huitu','ztupic','ibaotu','58pic','veer',
  'gaopinimages','droitstock','sucai','qiantu','51miz','90sheji','ooopic','16pic','zhituwang','pixabay'
];

const NOISE = [
  'autohome','autoimg','pcauto','bitauto','dongchedi','yiche','xcar',
  'taobao','tmall','jd.com','pinduoduo','1688','alibaba','amazon','ebay',
  'fang.com','anjuke','lianjia','zhaopin','58.com','liepin','51job',
  'douban','zhihu','weibo','tieba','bilibili','douyin','kuaishou',
  'csdn','cnblogs','jianshu','github','gitee',
  'sanguosha','vrqjcs','kuaijianji','3dmgame','17173','gamersky','v.qq.com','y.qq.com',
  'mm131','meinv','dytt','movie','game','youxi','bet','casino'
];

const TRUSTED = [
  'baike.so.com','bcebos','qhimg','baike.baidu','wikipedia','wikimedia',
  'ctrip','qunar','mafengwo','travel','gov.cn','xinhuanet','news.cn','people.com.cn',
  'china.org.cn','chinadaily','cctv','thepaper','sohu.com','sinaimg','sina.com','ifeng',
  '163.com','pconline','huanqiu','chinanews','bjnews','cnwest','yunnan.cn','scol.com.cn',
  'jiemian','unsplash','pexels'
];

const PEOPLE = [
  'people','crowd','tourist','portrait','selfie','girl','boy','woman','women','-man',
  'person','family','couple','model','children','kid','smiling','human','traveler',
  'backpacker','visitor','pedestrian','street-life'
];

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

const decodeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\\//g, '/');

async function bingCandidates(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:imagesize-large+filterui:phototype-photo&form=IRFLTR&first=1`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return [];
  const html = await res.text();
  const out = [];
  for (const m of html.matchAll(/m="(\{[^"]+?\})"/g)) {
    try {
      const json = JSON.parse(decodeHtml(m[1]));
      if (json.murl) out.push({ murl: decodeHtml(json.murl), purl: decodeHtml(json.purl || ''), title: decodeHtml(json.t || '') });
    } catch { /* ignore */ }
  }
  return out;
}

function accept(cand, city, hints) {
  const murl = cand.murl.toLowerCase();
  const purl = cand.purl.toLowerCase();
  const title = cand.title.toLowerCase();
  const all = murl + ' ' + purl + ' ' + title;
  if (BLOCKED.some((b) => all.includes(b))) return false;
  if (NOISE.some((b) => all.includes(b))) return false;
  if (PEOPLE.some((b) => murl.includes(b))) return false;
  if (!TRUSTED.some((t) => murl.includes(t) || purl.includes(t))) return false;
  const named = title.includes(city) || purl.includes(city) || decodeURIComponent(purl).includes(city);
  const hinted = hints.some((h) => h.length > 1 && all.includes(h.toLowerCase()));
  return named && (hinted || /风景|旅游|景观|景区|风光|摄影/.test(all));
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
    if (buf.length < 120000) return null;
    const size = imageSize(buf);
    if (!size.w || !size.h) return null;
    if (size.w < 1000 || size.h < 560) return null;
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
    if (!rec) { bad.push(name + '(unknown)'); continue; }
    const slug = slugify(rec.en);
    const hints = String(HINTS[name] || '').split(/[\s、,，]+/).filter(Boolean);
    const queries = [
      ...hints.map((h) => `${name} ${h}`),
      `${name} 风景 旅游景区`,
      `${name} 风光`
    ];
    const seen = new Set();
    const pool = [];
    for (const q of queries) {
      let cands = [];
      try { cands = await bingCandidates(q); } catch { cands = []; }
      for (const c of cands) {
        if (seen.has(c.murl)) continue;
        seen.add(c.murl);
        if (accept(c, name, hints)) pool.push(c);
      }
    }
    let saved = false;
    for (const cand of pool.slice(0, 12)) {
      const got = await tryDownload(cand.murl);
      if (!got) continue;
      fs.writeFileSync(path.join(OUT, `${slug}.jpg`), got.buf);
      console.log(`${name} ${got.size.w}x${got.size.h} ${Math.round(got.buf.length / 1024)}KB ← ${cand.purl.slice(0, 70)}`);
      ok.push(name);
      saved = true;
      break;
    }
    if (!saved) { bad.push(name); console.log(`${name} FAIL (pool ${pool.length})`); }
  }
  console.log(`\nstrict ok=${ok.length} bad=${bad.length}`);
  if (bad.length) console.log('bad: ' + bad.join('、'));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });