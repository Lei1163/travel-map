import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Load the UMD build of pinyin-pro inside a sandbox with a CommonJS shim.
const code = fs.readFileSync('tools/data/pinyin-pro.js', 'utf8');
const sandbox = { exports: {}, module: { exports: {} }, globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const pinyinPro = sandbox.exports.pinyin ? sandbox.exports : sandbox.module.exports;
console.log('pinyin available:', typeof pinyinPro.pinyin);

const extra = JSON.parse(fs.readFileSync('tools/data/china-cities-extra.json', 'utf8'));

// Taiwan and a few cross-strait towns are absent from the source dataset.
const TAIWAN = [
  ['台北', 25.033, 121.5654], ['新北', 25.0119, 121.4654], ['桃园', 24.9936, 121.301],
  ['台中', 24.1477, 120.6736], ['台南', 22.9999, 120.227], ['高雄', 22.6273, 120.3014],
  ['基隆', 25.1276, 121.7392], ['新竹', 24.8039, 120.9719], ['嘉义', 23.4801, 120.4491],
  ['花莲', 23.9769, 121.6044], ['台东', 22.7583, 121.1444], ['宜兰', 24.757, 121.753],
  ['屏东', 22.6691, 120.4864], ['澎湖', 23.5711, 119.5793], ['金门', 24.4369, 118.3178]
];
for (const entry of TAIWAN) {
  const name = entry[0];
  if (extra.some((city) => city.name === name)) continue;
  extra.push({ name, lat: entry[1], lon: entry[2], province: '台湾省' });
}

const toPinyin = (name) => {
  try {
    const result = pinyinPro.pinyin(name, { toneType: 'none', type: 'array', nonZh: 'removed' });
    return result.join('').toLowerCase().replace(/\s+/g, '');
  } catch (error) {
    return '';
  }
};

const cleaned = extra.map((city) => {
  const plain = String(city.name)
    .replace(/[^\u4e00-\u9fa5]/g, '')
    .replace(/(自治州|地区|盟|市|县|区)$/g, '');
  const pinyin = toPinyin(plain) || toPinyin(city.name);
  return {
    name: city.name,
    en: pinyin ? pinyin.charAt(0).toUpperCase() + pinyin.slice(1) : city.name,
    country: '中国',
    code: 'CN',
    lat: city.lat,
    lon: city.lon,
    pinyin,
    province: city.province || ''
  };
});

console.log(cleaned.slice(0, 8).map((c) => `${c.name}/${c.pinyin}`).join(' '));
console.log('empty pinyin:', cleaned.filter((c) => !c.pinyin).length);

const header = '/* Extra Chinese cities, used only by the home-city picker. */\n';
fs.writeFileSync('data/china-cities-extra.js', `${header}window.CHINA_EXTRA_CITIES = ${JSON.stringify(cleaned)};\n`, 'utf8');
console.log('written', (fs.statSync('data/china-cities-extra.js').size / 1024).toFixed(1), 'KB', cleaned.length, 'cities');