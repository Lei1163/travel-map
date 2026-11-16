import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('data/cities.js', 'utf8'), ctx);
const cities = ctx.window.TRAVEL_CITIES;

const ctx2 = { window: {} };
vm.createContext(ctx2);
vm.runInContext(fs.readFileSync('data/landmarks.js', 'utf8'), ctx2);
const marks = ctx2.window.CITY_LANDMARKS;

const missing = cities.filter((c) => !marks[c.name]);
console.log('cities', cities.length, 'with image', cities.length - missing.length, 'missing', missing.length);
console.log(missing.map((c) => `${c.name}/${c.country}`).join(' '));
const orphans = Object.keys(marks).filter((n) => !cities.some((c) => c.name === n));
console.log('orphan entries', orphans.length, orphans.join(' '));