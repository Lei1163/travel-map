// 为新增城市补充城市记录（坐标来自 tools/data/china-cities-extra.json）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const extra = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/data/china-cities-extra.json'), 'utf8'));
const byName = new Map(extra.map((c) => [c.name, c]));

const NEW = [
  ['宁波', 'Ningbo'], ['温州', 'Wenzhou'], ['台州', 'Taizhou'], ['丽水', 'Lishui'], ['衢州', 'Quzhou'],
  ['南通', 'Nantong'], ['盐城', 'Yancheng'], ['泰州', 'Taizhou'], ['合肥', 'Hefei'], ['安庆', 'Anqing'],
  ['宣城', 'Xuancheng'], ['安阳', 'Anyang'], ['南阳', 'Nanyang'], ['临沂', 'Linyi'], ['大连', 'Dalian'],
  ['沈阳', 'Shenyang'], ['长春', 'Changchun'], ['银川', 'Yinchuan'], ['林芝', 'Nyingchi'], ['阿勒泰', 'Altay'],
  ['曲阜', 'Qufu', 35.5806, 116.9865], ['莆田', 'Putian'], ['崇左', 'Chongzuo'], ['湛江', 'Zhanjiang'], ['惠州', 'Huizhou'],
  ['肇庆', 'Zhaoqing'], ['中山', 'Zhongshan'], ['佛山', 'Foshan'], ['汕头', 'Shantou'], ['万宁', 'Wanning'],
  ['琼海', 'Qionghai'], ['海口', 'Haikou'], ['石家庄', 'Shijiazhuang'], ['太原', 'Taiyuan'], ['榆林', 'Yulin'],
  ['咸阳', 'Xianyang'], ['西昌', 'Xichang', 27.8945, 102.2645], ['十堰', 'Shiyan'], ['潮州', 'Chaozhou'], ['吉林', 'Jilin', 43.8378, 126.5495],
  ['牡丹江', 'Mudanjiang'], ['丹东', 'Dandong'], ['张家口', 'Zhangjiakou'], ['邯郸', 'Handan'], ['运城', 'Yuncheng'],
  ['鄂尔多斯', 'Ordos'], ['包头', 'Baotou'], ['满洲里', 'Manzhouli', 49.5977, 117.4334], ['韶关', 'Shaoguan'], ['江门', 'Jiangmen'],
  ['梅州', 'Meizhou'], ['清远', 'Qingyuan'], ['东莞', 'Dongguan'], ['南宁', 'Nanning'], ['防城港', 'Fangchenggang'],
  ['百色', 'Baise'], ['儋州', 'Danzhou'], ['文昌', 'Wenchang'], ['陵水', 'Lingshui'], ['自贡', 'Zigong'],
  ['攀枝花', 'Panzhihua'], ['泸州', 'Luzhou'], ['德阳', 'Deyang'], ['南充', 'Nanchong'], ['雅安', "Ya'an"],
  ['康定', 'Kangding', 30.0493, 101.9637], ['六盘水', 'Liupanshui'], ['毕节', 'Bijie'], ['铜仁', 'Tongren'], ['曲靖', 'Qujing'],
  ['玉溪', 'Yuxi'], ['日喀则', 'Shigatse'], ['宝鸡', 'Baoji'], ['汉中', 'Hanzhong'], ['嘉峪关', 'Jiayuguan'],
  ['天水', 'Tianshui'], ['甘南', 'Gannan'], ['中卫', 'Zhongwei'], ['哈密', 'Hami'], ['库尔勒', 'Korla', 41.7259, 86.1746],
  ['阿克苏', 'Aksu'], ['和田', 'Hotan'], ['金华', 'Jinhua'], ['徐州', 'Xuzhou'], ['连云港', 'Lianyungang'],
  ['六安', "Lu'an"], ['三明', 'Sanming'], ['龙岩', 'Longyan'], ['宁德', 'Ningde']
];

const pinyinOf = (en) => en.toLowerCase().replace(/[^a-z]/g, '');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/cities.js'), 'utf8'), ctx);
const cities = ctx.window.TRAVEL_CITIES;
const countries = ctx.window.TRAVEL_COUNTRIES;
const before = cities.length;

const existing = new Set(cities.map((c) => c.name));
const added = [];
const skipped = [];
const noCoord = [];

for (const [name, en, lat, lon] of NEW) {
  if (existing.has(name)) { skipped.push(name); continue; }
  const src = byName.get(name) || byName.get(name + '市') || extra.find((c) => c.name.startsWith(name));
  const useLat = src ? src.lat : lat;
  const useLon = src ? src.lon : lon;
  if (typeof useLat !== 'number' || typeof useLon !== 'number') { noCoord.push(name); continue; }
  const pinyin = pinyinOf(en);
  cities.push({
    name, en, country: '中国', code: 'CN',
    lat: Number(useLat.toFixed(4)), lon: Number(useLon.toFixed(4)),
    pinyin, search: `${name} ${en} 中国 ${pinyin}`
  });
  added.push(name);
}

const lines = [];
lines.push('/* Bundled offline destination index. Search by Chinese, English or pinyin.');
lines.push('   Source: 全球热门旅游城市清单（中国 + 海外热门目的地）. */');
lines.push('window.TRAVEL_CITIES = [');
lines.push(cities.map((c) => '  ' + JSON.stringify(c)).join(',\n'));
lines.push('];');
lines.push('');
lines.push('window.TRAVEL_COUNTRIES = [');
lines.push(countries.map((c) => '  ' + JSON.stringify(c)).join(',\n'));
lines.push('];');
lines.push('');

fs.writeFileSync(path.join(ROOT, 'data/cities.js'), lines.join('\n'), 'utf8');

console.log(`cities ${before} -> ${cities.length} (+${added.length})`);
console.log('added:', added.join('、'));
if (skipped.length) console.log('skipped(existing):', skipped.join('、'));
if (noCoord.length) console.log('NO COORD:', noCoord.join('、'));