// 只为「新增城市」抓取地标风景图。评分式挑选：
//   + 来源页/文件名包含城市名或地标关键词
//   + 公共/百科/新闻/旅游站点
//   + 横构图、足够大
//   - 图库水印站、汽车/电商/房产/招聘等无关站
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

const NEW_CITIES = [
  '宁波','温州','台州','丽水','衢州','南通','盐城','泰州','合肥','安庆','宣城','安阳','南阳','临沂','大连',
  '沈阳','长春','银川','林芝','阿勒泰','曲阜','莆田','崇左','湛江','惠州','肇庆','中山','佛山','汕头','万宁',
  '琼海','海口','石家庄','太原','榆林','咸阳','西昌','十堰','潮州','吉林','牡丹江','丹东','张家口','邯郸','运城',
  '鄂尔多斯','包头','满洲里','韶关','江门','梅州','清远','东莞','南宁','防城港','百色','儋州','文昌','陵水','自贡',
  '攀枝花','泸州','德阳','南充','雅安','康定','六盘水','毕节','铜仁','曲靖','玉溪','日喀则','宝鸡','汉中','嘉峪关',
  '天水','甘南','中卫','哈密','库尔勒','阿克苏','和田','金华','徐州','连云港','六安','三明','龙岩','宁德'
];

const BLOCKED = [
  'alamy','dreamstime','shutterstock','istockphoto','gettyimages','123rf','depositphotos','vecteezy',
  'adobe','agefotostock','bigstockphoto','canstockphoto','zoonar','photodune','envato','699pic',
  'freepik','vcg.com','588ku','hellorf','zcool','photophoto','quanjing','tuchong','hippopx','pngtree',
  'lovepik','sixteen-nine','picfair','shetu66','nipic','huitu','ztupic','ibaotu','58pic','veer',
  'gaopinimages','droitstock','sucai','qiantu','51miz','90sheji','ooopic','16pic','zhituwang',
  'zhimg.com','pixabay'
];

// 与城市风景无关的站点
const NOISE = [
  'autohome','autoimg','pcauto','bitauto','dongchedi','yiche','xcar','cheshi','autohome',
  'taobao','tmall','jd.com','pinduoduo','1688','alibaba','amazon','ebay',
  'fang.com','anjuke','lianjia','ke.com','zhaopin','58.com','liepin','51job',
  'douban','zhihu','weibo','tieba','bilibili','douyin','kuaishou','xiaohongshu',
  'csdn','cnblogs','jianshu','github','gitee','baike.com/item/人物'
];

const PEOPLE = [
  'people','crowd','tourist','portrait','selfie','girl','boy','woman','women','-man',
  'person','family','couple','model','children','kid','smiling','human','traveler',
  'backpacker','visitor','pedestrian','street-life'
];

const PREFERRED = [
  'wikipedia','wikimedia','unsplash','pexels','gov.cn','xinhuanet','news.cn','people.com.cn',
  'china.org.cn','chinadaily','cctv','thepaper','mafengwo','ctrip','qunar','travel',
  'nationalgeographic','lonelyplanet','bcebos','qhimg','pconline','sinaimg','sohu','ifeng',
  'qq.com','163.com','huanqiu','cnwest','chinanews','bjnews','yunnan.cn','xinhua'
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
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { w: 1200, h: 800 };
  return { w: 0, h: 0 };
}

function decodeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\\//g, '/');
}

async function bingCandidates(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:imagesize-large+filterui:phototype-photo&form=IRFLTR&first=1`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return [];
  const html = await res.text();
  const out = [];
  for (const m of html.matchAll(/class="mimg"[^>]*?src="([^"]+)"[^>]*?|m="(\{[^"]+?\})"/g)) {
    const raw = m[2];
    if (!raw) continue;
    try {
      const json = JSON.parse(decodeHtml(raw));
      if (json.murl) out.push({ murl: decodeHtml(json.murl), purl: decodeHtml(json.purl || ''), title: decodeHtml(json.t || '') });
    } catch { /* ignore */ }
  }
  return out;
}

function scoreCandidate(cand, city, hints) {
  const murl = cand.murl.toLowerCase();
  const purl = cand.purl.toLowerCase();
  const text = `${murl} ${purl} ${cand.title}`.toLowerCase();
  if (BLOCKED.some((b) => text.includes(b))) return -99;
  if (NOISE.some((b) => text.includes(b))) return -99;
  if (PEOPLE.some((b) => murl.includes(b))) return -99;
  let score = 0;
  if (text.includes(city)) score += 3;
  for (const hint of hints) if (hint.length > 1 && text.includes(hint)) score += 3;
  if (PREFERRED.some((p) => murl.includes(p) || purl.includes(p))) score += 3;
  if (/\.(jpg|jpeg)/.test(murl)) score += 1;
  return score;
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

function queriesFor(name, hints) {
  const q = [`${name} 风景`, `${name} 城市风光 全景`];
  if (hints[0]) q.unshift(`${name} ${hints[0]} 风景`, `${name} ${hints[0]}`);
  return q;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv[2] ? process.argv[2].split(',') : NEW_CITIES;

  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/cities.js'), 'utf8'), ctx);
  const cityIndex = new Map(ctx.window.TRAVEL_CITIES.map((c) => [c.name, c]));

  const failures = [];
  const results = {};
  let done = 0;

  for (const name of only) {
    done += 1;
    const rec = cityIndex.get(name);
    const slug = slugify(rec ? rec.en : name);
    const target = path.join(OUT, `${slug}.jpg`);
    if (fs.existsSync(target) && fs.statSync(target).size > 120000) {
      results[name] = { slug, reuse: true };
      console.log(`[${done}/${only.length}] reuse ${name}`);
      continue;
    }

    const hints = String(HINTS[name] || '').split(/[\s、,，]+/).filter(Boolean);
    const seen = new Set();
    const pool = [];
    for (const query of queriesFor(name, hints)) {
      let cands = [];
      try { cands = await bingCandidates(query); } catch { cands = []; }
      for (const c of cands) {
        if (seen.has(c.murl)) continue;
        seen.add(c.murl);
        const score = scoreCandidate(c, name, hints);
        if (score > 0) pool.push({ ...c, score, query });
      }
    }
    pool.sort((a, b) => b.score - a.score);

    let saved = false;
    for (const cand of pool.slice(0, 14)) {
      const got = await tryDownload(cand.murl);
      if (got) {
        fs.writeFileSync(target, got.buf);
        results[name] = { slug, w: got.size.w, h: got.size.h, kb: Math.round(got.buf.length / 1024), score: cand.score, murl: cand.murl, purl: cand.purl };
        console.log(`[${done}/${only.length}] ${name} ${got.size.w}x${got.size.h} s${cand.score} ${Math.round(got.buf.length / 1024)}KB ${cand.purl.slice(0, 52)}`);
        saved = true;
        break;
      }
    }
    if (!saved) {
      failures.push(name);
      console.log(`[${done}/${only.length}] FAIL ${name} (candidates ${pool.length})`);
    }
  }

  fs.writeFileSync(path.join(ROOT, 'tools', 'data', 'new-landmarks.json'), JSON.stringify({ results, failures }, null, 1));
  console.log(`\nDONE ok=${Object.keys(results).length} fail=${failures.length}`);
  if (failures.length) console.log('failures: ' + failures.join('、'));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });