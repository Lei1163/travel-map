// 验证：横屏布局 + 双指缩放 + 竖屏提示
const PORT = process.argv[2] || '10161';
const fs = require('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  let target = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      target = list.find((x) => x.type === 'page');
      if (target) break;
    } catch (e) { /* retry */ }
  }
  if (!target) throw new Error('no target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let seq = 0; const pend = new Map(); const events = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    else if (m.method) events.push(m);
  });
  const send = (method, params = {}) => new Promise((r) => {
    const id = ++seq;
    pend.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalv = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return m?.result?.value;
  };
  return { ws, send, evalv, events };
}

(async () => {
  const { ws, send, evalv, events } = await connect();
  await send('Runtime.enable');
  await send('Page.enable');

  const PLACES = [
    { id: 'p1', city: '厦门', country: '中国', code: 'CN', lat: 24.4798, lon: 118.0894, kind: 'city', tripId: 't1', date: '2024-05-01', dateEnd: '2024-05-03', note: '', cover: '', media: [] },
    { id: 'p2', city: '泉州', country: '中国', code: 'CN', lat: 24.8741, lon: 118.6757, kind: 'city', tripId: 't1', date: '2024-05-04', dateEnd: '2024-05-05', note: '', cover: '', media: [] },
    { id: 'p3', city: '杭州', country: '中国', code: 'CN', lat: 30.2741, lon: 120.1551, kind: 'city', tripId: 't2', date: '2024-08-01', dateEnd: '2024-08-03', note: '', cover: '', media: [] }
  ];

  // ---------- 1) 竖屏 390x844：应出现旋转提示 ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await evalv(`(() => { localStorage.setItem('roam-atlas:v2', ${JSON.stringify(JSON.stringify(PLACES))}); localStorage.setItem('roam-atlas:v2:scope','china'); return true; })()`);
  await send('Page.reload');
  await sleep(3200);
  const portrait = await evalv(`(() => {
    const hint = document.querySelector('#rotateHint');
    return { hintExists: Boolean(hint), hidden: hint ? hint.hidden : null, display: hint ? getComputedStyle(hint).display : null };
  })()`);

  // ---------- 2) 横屏 844x390 ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await sleep(1200);
  const landscape = await evalv(`(() => {
    const hint = document.querySelector('#rotateHint');
    const app = document.querySelector('.app');
    const topbar = document.querySelector('.topbar');
    const map = document.querySelector('#travel-map');
    return {
      hintHidden: hint.hidden,
      appHeight: Math.round(app.getBoundingClientRect().height),
      viewportHeight: window.innerHeight,
      topbarHeight: Math.round(topbar.getBoundingClientRect().height),
      mapHeight: Math.round(map.getBoundingClientRect().height),
      bodyOverflowY: document.documentElement.scrollHeight - window.innerHeight
    };
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('mobile-landscape.png', Buffer.from(shot.data, 'base64'));

  // ---------- 3) 双指捏合放大 ----------
  const before = await evalv(`document.querySelector('#map-content').getAttribute('transform')`);
  const centre = { x: 422, y: 195 };
  const spread = async (from, to, steps = 6) => {
    const points = (half) => [
      { x: centre.x - half, y: centre.y, id: 1 },
      { x: centre.x + half, y: centre.y, id: 2 }
    ];
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
    for (let i = 1; i <= steps; i += 1) {
      const half = from + ((to - from) * i) / steps;
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(half) });
      await sleep(45);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };
  await spread(40, 120);
  const afterOut = await evalv(`document.querySelector('#map-content').getAttribute('transform')`);

  await spread(120, 40);
  const afterIn = await evalv(`document.querySelector('#map-content').getAttribute('transform')`);

  const scaleOf = (t) => {
    const m = /scale\(([0-9.]+)\)/.exec(t || '');
    return m ? Number(m[1]) : null;
  };

  // ---------- 4) 竖屏再切回，确认提示重新出现 ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await sleep(900);
  const portraitAgain = await evalv(`document.querySelector('#rotateHint').hidden`);

  console.log(JSON.stringify({
    portrait,
    landscape,
    pinch: {
      before: scaleOf(before),
      afterZoomOut: scaleOf(afterOut),
      afterZoomIn: scaleOf(afterIn),
      grew: (scaleOf(afterOut) ?? 0) > (scaleOf(before) ?? 0),
      shrank: (scaleOf(afterIn) ?? 0) < (scaleOf(afterOut) ?? 0)
    },
    portraitAgain,
    exceptions: events.filter((e) => e.method === 'Runtime.exceptionThrown').length
  }, null, 2));

  ws.close();
})().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1); });