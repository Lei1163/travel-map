import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'tools', 'data', 'borders-cache');
fs.mkdirSync(CACHE, { recursive: true });

async function fetchJson(url, cacheName) {
  const file = path.join(CACHE, cacheName);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const json = await res.json();
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('data/world-map.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('data/china-map.js', 'utf8'), ctx);
const WORLD = ctx.window.WORLD_MAP;
const CHINA = ctx.window.CHINA_MAP;

const ROBINSON_X = [1, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const ROBINSON_Y = [0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function projectWorld(lon, lat) {
  const absLat = Math.min(90, Math.abs(Number(lat)));
  const index = Math.min(17, Math.floor(absLat / 5));
  const fraction = (absLat - index * 5) / 5;
  const rx = ROBINSON_X[index] * (1 - fraction) + ROBINSON_X[Math.min(18, index + 1)] * fraction;
  const ry = ROBINSON_Y[index] * (1 - fraction) + ROBINSON_Y[Math.min(18, index + 1)] * fraction;
  const x = 0.8487 * rx * ((Number(lon) * Math.PI) / 180);
  const y = 1.3523 * ry * (Number(lat) >= 0 ? 1 : -1) * (WORLD.yScale || 1);
  let screenX = x * WORLD.scale * (WORLD.xScale || 1) + WORLD.ox;
  let screenY = WORLD.oy - y * WORLD.scale;
  if (WORLD.eastWarp) {
    const { start, span, strength, yFull = 300, yZero = 460 } = WORLD.eastWarp;
    if (screenX > start) {
      const tx = clamp((screenX - start) / span, 0, 1);
      const sx = tx * tx * (3 - 2 * tx);
      const ty = clamp((screenY - yFull) / (yZero - yFull), 0, 1);
      const sy = 1 - ty * ty * (3 - 2 * ty);
      screenX += (screenX - start) * strength * sx * sy;
    }
  }
  const t = WORLD.oceaniaTransforms;
  if (t) {
    if (lon >= 110 && lon <= 156 && lat <= -9 && lat >= -48) {
      const { cx, cy, angle } = t.australia;
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = screenX - cx;
      const dy = screenY - cy;
      screenX = cx + dx * cos + dy * sin;
      screenY = cy - dx * sin + dy * cos;
    } else if (lon >= 164 && lon <= 180 && lat <= -32 && lat >= -50) {
      const { cx, cy, angle, longScale, shortScale } = t.newZealand;
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = screenX - cx;
      const dy = screenY - cy;
      const along = (dx * cos + dy * sin) * longScale;
      const across = (-dx * sin + dy * cos) * shortScale;
      screenX = cx + along * cos - across * sin;
      screenY = cy + along * sin + across * cos;
    }
  }
  return { x: screenX, y: screenY };
}

function projectChina(lon, lat) {
  const p = CHINA.projection;
  const rad = Math.PI / 180;
  const theta = p.n * (lon - p.lon0) * rad;
  const rho = Math.sqrt(Math.max(0, p.c - 2 * p.n * Math.sin(lat * rad))) / p.n;
  return {
    x: rho * Math.sin(theta) * p.scale + p.ox,
    y: p.oy - (p.rho0 - rho * Math.cos(theta)) * p.scale
  };
}

// Douglas-Peucker, endpoints always kept.
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const sq = tolerance * tolerance;
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
    if (maxDist > sq && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/* ---------------------------------------------------------------- provinces
   Every province polygon carries its own copy of each border it shares with a
   neighbour. Counting oriented edges and keeping only the ones used twice
   leaves exactly one copy of every internal border. Vertices are matched
   exactly (no snapping), so the kept edges link up into continuous lines
   without gaps. Chains are cut at junctions so simplification can never round
   off a tripoint corner. */
function buildProvinceBorders(features, project, tolerance) {
  // Integers avoid the "-0.000" vs "0.000" mismatch that used to create two
  // nodes at the same pixel.
  const key = (pt) => `${Math.round(pt.x * 1000)}:${Math.round(pt.y * 1000)}`;
  const edges = new Map();

  for (const feature of features) {
    for (const ring of ringsOf(feature.geometry || feature)) {
      if (!ring || ring.length < 2) continue;
      const pts = ring.map((coord) => project(coord[0], coord[1]));
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const ka = key(a);
        const kb = key(b);
        if (ka === kb) continue;
        const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const current = edges.get(id);
        if (current) current.count += 1;
        else edges.set(id, { ka, kb, a, b, count: 1 });
      }
    }
  }

  const shared = [...edges.values()].filter((edge) => edge.count >= 2);
  const total = edges.size;

  const adjacency = new Map();
  const link = (from, to) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  };
  const points = new Map();
  for (const edge of shared) {
    link(edge.ka, { key: edge.kb, point: edge.b });
    link(edge.kb, { key: edge.ka, point: edge.a });
    points.set(edge.ka, edge.a);
    points.set(edge.kb, edge.b);
  }

  const used = new Set();
  const edgeId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const chains = [];
  const isJunction = (nodeKey) => (adjacency.get(nodeKey) || []).length !== 2;

  const walkFrom = (startKey, firstStep) => {
    const chain = [points.get(startKey)];
    let currentKey = startKey;
    let step = firstStep;
    for (;;) {
      used.add(edgeId(currentKey, step.key));
      chain.push(step.point);
      currentKey = step.key;
      if (isJunction(currentKey)) break;
      const next = (adjacency.get(currentKey) || []).find((edge) => !used.has(edgeId(currentKey, edge.key)));
      if (!next) break;
      step = next;
    }
    return chain;
  };

  // Start from junctions / endpoints first so every chain spans two of them.
  for (const [nodeKey, list] of adjacency) {
    if (!isJunction(nodeKey)) continue;
    for (const edge of list) {
      if (used.has(edgeId(nodeKey, edge.key))) continue;
      const chain = walkFrom(nodeKey, edge);
      if (chain.length > 1) chains.push(chain);
    }
  }
  // Closed rings with no junction at all.
  for (const [nodeKey, list] of adjacency) {
    for (const edge of list) {
      if (used.has(edgeId(nodeKey, edge.key))) continue;
      const chain = walkFrom(nodeKey, edge);
      if (chain.length > 1) chains.push(chain);
    }
  }

  // Simplify first, then clean up the few leftovers that would render as a
  // stray blob or a doubled short stroke.
  const simplifiedChains = [];
  for (const chain of chains) {
    const simplified = simplify(chain, tolerance);
    if (simplified.length < 2) continue;
    let length = 0;
    for (let i = 0; i < simplified.length - 1; i += 1) {
      length += Math.hypot(simplified[i + 1].x - simplified[i].x, simplified[i + 1].y - simplified[i].y);
    }
    if (length < 0.9) continue;
    simplifiedChains.push({ points: simplified, length });
  }

  const segDistance = (pt, a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq ? ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
  };
  const nearChain = (pt, chain, tol) => {
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = { x: chain[i].x, y: chain[i].y };
      const b = { x: chain[i + 1].x, y: chain[i + 1].y };
      if (pt.x < Math.min(a.x, b.x) - tol || pt.x > Math.max(a.x, b.x) + tol) continue;
      if (pt.y < Math.min(a.y, b.y) - tol || pt.y > Math.max(a.y, b.y) + tol) continue;
      if (segDistance(pt, a, b) < tol) return true;
    }
    return false;
  };

  // Drop chains that are already covered by a longer chain: those draw a
  // second, slightly offset stroke on top of the real border.
  const kept = [];
  const order = [...simplifiedChains].sort((a, b) => b.length - a.length);
  for (const candidate of order) {
    const covered = kept.some((other) => candidate.points.every((pt) => nearChain(pt, other.points, 0.5)));
    if (covered) continue;
    kept.push(candidate);
  }

  let out = '';
  let pointCount = 0;
  for (const chain of kept) {
    pointCount += chain.points.length;
    out += 'M' + chain.points.map((pt) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join('L');
  }
  return {
    d: out,
    points: pointCount,
    chains: kept.length,
    dropped: chains.length - kept.length,
    total,
    shared: shared.length
  };
}

const countryFull = await fetchJson('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json', 'china-provinces.json');
const provinceBorders = buildProvinceBorders(countryFull.features, projectChina, 0.55);
console.log('provinces', countryFull.features.length);
console.log('province path', (provinceBorders.d.length / 1024).toFixed(1), 'KB',
  provinceBorders.points, 'pts', provinceBorders.chains, 'chains',
  'edges', provinceBorders.total, 'shared', provinceBorders.shared);

const worldLines = await fetchJson('https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_boundary_lines_land.geojson', 'world-borders-50m.json');
const worldParts = [];
let worldPoints = 0;
for (const feature of worldLines.features) {
  for (const line of ringsOf(feature.geometry || feature)) {
    if (!line || line.length < 2) continue;
    const pts = line.map((coord) => projectWorld(coord[0], coord[1]));
    const simplified = simplify(pts, 1.1);
    if (simplified.length < 2) continue;
    worldPoints += simplified.length;
    worldParts.push('M' + simplified.map((pt) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join('L'));
  }
}
const worldD = worldParts.join('');
console.log('world path', (worldD.length / 1024).toFixed(1), 'KB', worldPoints, 'pts');

fs.writeFileSync('data/borders.js', 'window.MAP_BORDERS = ' + JSON.stringify({
  world: worldD,
  china: { provinces: provinceBorders.d }
}) + ';\n', 'utf8');
console.log('total', (fs.statSync('data/borders.js').size / 1024).toFixed(1), 'KB');