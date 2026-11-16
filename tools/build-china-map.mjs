import fs from 'node:fs';

const WIDTH = 1440;
const HEIGHT = 900;
const PAD = 46;

// Albers equal-area conic, the usual choice for a China-only map.
const PHI1 = (25 * Math.PI) / 180;
const PHI2 = (47 * Math.PI) / 180;
const LON0 = 105;
const LAT0 = (35 * Math.PI) / 180;

const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2;
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1);
const RHO0 = Math.sqrt(C - 2 * N * Math.sin(LAT0)) / N;

function albers(lon, lat) {
  const theta = (N * (lon - LON0) * Math.PI) / 180;
  const rho = Math.sqrt(Math.max(0, C - 2 * N * Math.sin((lat * Math.PI) / 180))) / N;
  return { x: rho * Math.sin(theta), y: RHO0 - rho * Math.cos(theta) };
}

const geo = JSON.parse(fs.readFileSync('tools/data/china-raw.json', 'utf8'));
const feature = geo.features[0];
const polygons = feature.geometry.type === 'MultiPolygon'
  ? feature.geometry.coordinates
  : [feature.geometry.coordinates];

// Project everything, dropping the rings that are too small to see.
const projected = [];
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const rings of polygons) {
  const outer = rings[0];
  if (outer.length < 3) continue;
  const pts = outer.map(([lon, lat]) => { const p = albers(lon, lat); return { x: p.x, y: -p.y }; });
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area) < 1e-7) continue;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  projected.push(pts);
}

const scale = Math.min((WIDTH - PAD * 2) / (maxX - minX), (HEIGHT - PAD * 2) / (maxY - minY));
const ox = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
const oy = (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale;

console.log('polygons kept', projected.length, 'scale', scale.toFixed(2), 'origin', ox.toFixed(1), oy.toFixed(1));

// Douglas-Peucker in screen space so the tolerance is a pixel value.
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const sqTolerance = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = -1;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i += 1) {
      const p = points[i];
      let dist;
      if (lenSq === 0) {
        dist = (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
      } else {
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        dist = (p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2;
      }
      if (dist > maxDist) { maxDist = dist; index = i; }
    }
    if (maxDist > sqTolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

let totalPoints = 0;
const subpaths = [];
for (const pts of projected) {
  const screen = pts.map((p) => ({ x: p.x * scale + ox, y: p.y * scale + oy }));
  const simplified = simplify(screen, 0.55);
  if (simplified.length < 3) continue;
  totalPoints += simplified.length;
  subpaths.push('M' + simplified.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L') + 'Z');
}

console.log('points after simplify', totalPoints, 'subpaths', subpaths.length);

const payload = {
  width: WIDTH,
  height: HEIGHT,
  projection: {
    type: 'albers',
    phi1: 25,
    phi2: 47,
    lon0: LON0,
    lat0: 35,
    n: N,
    c: C,
    rho0: RHO0,
    scale,
    ox,
    oy
  },
  land: subpaths.join('')
};

fs.writeFileSync('data/china-map.js', 'window.CHINA_MAP = ' + JSON.stringify(payload) + ';\n', 'utf8');
console.log('written data/china-map.js', (fs.statSync('data/china-map.js').size / 1024).toFixed(1), 'KB');