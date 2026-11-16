const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['cities.js', 'china-cities-extra.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'), ctx);
}
const cities = ctx.window.TRAVEL_CITIES;
const extra = ctx.window.CHINA_EXTRA_CITIES || [];

// 主城市库没有省级字段，这里按实际归属补一份映射
const PROVINCE = {
  北京: '北京市', 上海: '上海市', 天津: '天津市', 重庆: '重庆市',
  承德: '河北省', 秦皇岛: '河北省', 唐山: '河北省', 保定: '河北省',
  临汾: '山西省', 平遥: '山西省', 大同: '山西省', 忻州: '山西省',
  呼和浩特: '内蒙古自治区', 乌兰布统: '内蒙古自治区', 阿尔山: '内蒙古自治区', 海拉尔: '内蒙古自治区',
  本溪: '辽宁省', 盘锦: '辽宁省',
  延吉: '吉林省', 长白山: '吉林省', 通化: '吉林省',
  哈尔滨: '黑龙江省',
  南京: '江苏省', 苏州: '江苏省', 扬州: '江苏省', 镇江: '江苏省', 无锡: '江苏省', 常州: '江苏省',
  杭州: '浙江省', 舟山: '浙江省', 嘉兴: '浙江省', 绍兴: '浙江省', 奉化: '浙江省', 桐庐: '浙江省', 安吉: '浙江省',
  黄山: '安徽省',
  厦门: '福建省', 泉州: '福建省', 福州: '福建省', 漳州: '福建省',
  婺源: '江西省', 上饶: '江西省', 抚州: '江西省', 赣州: '江西省',
  青岛: '山东省', 淄博: '山东省', 潍坊: '山东省', 烟台: '山东省', 威海: '山东省', 日照: '山东省', 济南: '山东省', 泰安: '山东省',
  洛阳: '河南省', 开封: '河南省', 郑州: '河南省', 焦作: '河南省', 新乡: '河南省',
  武汉: '湖北省', 宜昌: '湖北省', 襄阳: '湖北省', 恩施: '湖北省', 神农架: '湖北省',
  长沙: '湖南省', 张家界: '湖南省', 凤凰: '湖南省', 岳阳: '湖南省', 常德: '湖南省', 衡阳: '湖南省', 郴州: '湖南省',
  广州: '广东省', 深圳: '广东省',
  桂林: '广西壮族自治区', 北海: '广西壮族自治区',
  三亚: '海南省',
  成都: '四川省', 乐山: '四川省', 眉山: '四川省', 九寨沟: '四川省', 绵阳: '四川省', 广元: '四川省',
  贵阳: '贵州省', 荔波: '贵州省', 镇远: '贵州省', 凯里: '贵州省', 遵义: '贵州省',
  丽江: '云南省', 大理: '云南省', 腾冲: '云南省', 普洱: '云南省', 西双版纳: '云南省', 香格里拉: '云南省', 德宏: '云南省', 昆明: '云南省',
  拉萨: '西藏自治区',
  西安: '陕西省',
  敦煌: '甘肃省', 张掖: '甘肃省',
  西宁: '青海省',
  乌鲁木齐: '新疆维吾尔自治区', 喀什: '新疆维吾尔自治区', 吐鲁番: '新疆维吾尔自治区', 伊犁: '新疆维吾尔自治区',
  '宁波': '浙江省',
  '温州': '浙江省',
  '台州': '浙江省',
  '丽水': '浙江省',
  '衢州': '浙江省',
  '金华': '浙江省',
  '南通': '江苏省',
  '盐城': '江苏省',
  '泰州': '江苏省',
  '徐州': '江苏省',
  '连云港': '江苏省',
  '合肥': '安徽省',
  '安庆': '安徽省',
  '宣城': '安徽省',
  '六安': '安徽省',
  '安阳': '河南省',
  '南阳': '河南省',
  '临沂': '山东省',
  '大连': '辽宁省',
  '丹东': '辽宁省',
  '沈阳': '辽宁省',
  '长春': '吉林省',
  '吉林': '吉林省',
  '银川': '宁夏回族自治区',
  '林芝': '西藏自治区',
  '日喀则': '西藏自治区',
  '阿勒泰': '新疆维吾尔自治区',
  '库尔勒': '新疆维吾尔自治区',
  '阿克苏': '新疆维吾尔自治区',
  '和田': '新疆维吾尔自治区',
  '哈密': '新疆维吾尔自治区',
  '曲阜': '山东省',
  '莆田': '福建省',
  '三明': '福建省',
  '龙岩': '福建省',
  '宁德': '福建省',
  '崇左': '广西壮族自治区',
  '南宁': '广西壮族自治区',
  '防城港': '广西壮族自治区',
  '百色': '广西壮族自治区',
  '湛江': '广东省',
  '惠州': '广东省',
  '肇庆': '广东省',
  '中山': '广东省',
  '佛山': '广东省',
  '汕头': '广东省',
  '潮州': '广东省',
  '韶关': '广东省',
  '江门': '广东省',
  '梅州': '广东省',
  '清远': '广东省',
  '东莞': '广东省',
  '万宁': '海南省',
  '琼海': '海南省',
  '海口': '海南省',
  '儋州': '海南省',
  '文昌': '海南省',
  '陵水': '海南省',
  '石家庄': '河北省',
  '张家口': '河北省',
  '邯郸': '河北省',
  '太原': '山西省',
  '运城': '山西省',
  '榆林': '陕西省',
  '咸阳': '陕西省',
  '宝鸡': '陕西省',
  '汉中': '陕西省',
  '西昌': '四川省',
  '十堰': '湖北省',
  '鄂尔多斯': '内蒙古自治区',
  '包头': '内蒙古自治区',
  '满洲里': '内蒙古自治区',
  '牡丹江': '黑龙江省',
  '自贡': '四川省',
  '攀枝花': '四川省',
  '泸州': '四川省',
  '德阳': '四川省',
  '南充': '四川省',
  '雅安': '四川省',
  '康定': '四川省',
  '六盘水': '贵州省',
  '毕节': '贵州省',
  '铜仁': '贵州省',
  '曲靖': '云南省',
  '玉溪': '云南省',
  '嘉峪关': '甘肃省',
  '天水': '甘肃省',
  '甘南': '甘肃省',
  '中卫': '宁夏回族自治区',
};

const ORDER = ['北京市','天津市','上海市','重庆市','河北省','山西省','内蒙古自治区','辽宁省','吉林省','黑龙江省','江苏省','浙江省','安徽省','福建省','江西省','山东省','河南省','湖北省','湖南省','广东省','广西壮族自治区','海南省','四川省','贵州省','云南省','西藏自治区','陕西省','甘肃省','青海省','新疆维吾尔自治区'];

const domestic = cities.filter((c) => c.code === 'CN');
const abroad = cities.filter((c) => c.code !== 'CN');

const groups = {};
for (const c of domestic) {
  const p = PROVINCE[c.name] || '其他';
  (groups[p] = groups[p] || []).push(c.name);
}
const missing = domestic.filter((c) => !PROVINCE[c.name]).map((c) => c.name);

const countryOrder = [];
const abroadGroups = {};
for (const c of abroad) {
  if (!abroadGroups[c.country]) { abroadGroups[c.country] = []; countryOrder.push(c.country); }
  abroadGroups[c.country].push(c);
}

const extraByProvince = {};
for (const c of extra) {
  const p = c.province || '其他';
  (extraByProvince[p] = extraByProvince[p] || []).push(c.name);
}

// ---------- markdown ----------
const md = [];
md.push('# 赴迹 · 城市清单', '');
md.push(`- **国内目的地**：${domestic.length} 座（地图上按省级行政区排布）`);
md.push(`- **国际目的地**：${abroad.length} 座，分属 ${countryOrder.length} 个国家/地区`);
md.push(`- **居住城市可选**：另外还包含 ${extra.length} 座国内城市/地区（仅用于设置出发地，不打点）`);
md.push('', '---', '');

md.push(`## 一、国内目的地（${domestic.length} 座）`, '');
md.push('| 省级行政区 | 数量 | 城市 |', '| --- | --- | --- |');
for (const p of ORDER) {
  if (!groups[p]) continue;
  md.push(`| ${p} | ${groups[p].length} | ${groups[p].join('、')} |`);
}
md.push('', '---', '');

md.push(`## 二、国际目的地（${abroad.length} 座 / ${countryOrder.length} 个国家·地区）`, '');
md.push('| 国家·地区 | 数量 | 城市 |', '| --- | --- | --- |');
for (const country of countryOrder) {
  const list = abroadGroups[country];
  md.push(`| ${country} | ${list.length} | ${list.map((c) => c.name).join('、')} |`);
}
md.push('', '---', '');

md.push(`## 三、附：居住城市可选清单（${extra.length} 座，仅作出发地）`, '');
for (const p of Object.keys(extraByProvince).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))) {
  md.push(`**${p}**（${extraByProvince[p].length}）：${extraByProvince[p].join('、')}`);
  md.push('');
}

fs.writeFileSync(path.join(ROOT, '城市清单.md'), md.join('\n'), 'utf8');

// ---------- console summary ----------
console.log('domestic', domestic.length, '| abroad', abroad.length, '| countries', countryOrder.length, '| extra', extra.length);
console.log('unmapped domestic:', missing.length ? missing.join(',') : 'none');
for (const p of ORDER) if (groups[p]) console.log(`${p} (${groups[p].length}): ${groups[p].join('、')}`);
console.log('---');
for (const country of countryOrder) console.log(`${country} (${abroadGroups[country].length}): ${abroadGroups[country].map((c) => c.name).join('、')}`);