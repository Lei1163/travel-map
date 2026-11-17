// 验证拖动增益 0.7 的实际位移：6px 手指 → 约 15.5 地图单位
const PORT = process.argv[2] || '10311';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
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
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0; const pend = new Map(); const events = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    else if (m.method) events.push(m);
  });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evalv = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await evalv(`(() => {
    localStorage.setItem('roam-atlas:v2', JSON.stringify([
      { id:'p1', city:'厦门', country:'中国', code:'CN', lat:24.4798, lon:118.0894, kind:'city', tripId:'t1', date:'2024-05-01', dateEnd:'2024-05-03', note:'', cover:'', media:[] },
      { id:'p3', city:'杭州', country:'中国', code:'CN', lat:30.2741, lon:120.1551, kind:'city', tripId:'t2', date:'2024-08-01', dateEnd:'2024-08-03', note:'', cover:'', media:[] }
    ]));
    localStorage.setItem('roam-atlas:v2:scope','china');
    return true;
  })()`);
  await send('Page.reload');
  await sleep(3400);

  // 慢速均匀拖动 20 步，每步 6px
  const start = { x: 260, y: 430 };
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
  const samples = [];
  for (let i = 1; i <= 20; i += 1) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - i * 6, y: start.y, id: 1 }] });
    await sleep(20);
    samples.push(await evalv("document.querySelector('#map-content').getAttribute('transform')"));
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(320);
  const finalT = await evalv("document.querySelector('#map-content').getAttribute('transform')");

  const xs = samples.map((t) => Number((/translate\(([-0-9.]+)/.exec(t) || [])[1]));
  const steps = [];
  for (let i = 1; i < xs.length; i += 1) steps.push(Math.round(Math.abs(xs[i] - xs[i - 1]) * 10) / 10);
  const valid = steps.filter((s) => s > 0.5);

  const totalFinger = 20 * 6;          // 120px
  const totalMap = Math.abs(xs[xs.length - 1] - xs[0]);
  const viewScale = 1440 / 390;        // viewBox 单位 / 屏幕像素

  console.log(JSON.stringify({
    steps: valid,
    min: Math.min(...valid),
    max: Math.max(...valid),
    avg: +(valid.reduce((s, d) => s + d, 0) / valid.length).toFixed(1),
    fingerPx: totalFinger,
    mapUnits: Math.round(totalMap),
    pixelsPer6px: +(valid.reduce((s, d) => s + d, 0) / valid.length).toFixed(1),
    expectedPer6px: +(6 * viewScale * 0.7).toFixed(1),
    uniform: (Math.max(...valid) / Math.min(...valid)) < 1.5,
    finalTransform: finalT,
    exceptions: events.filter((e) => e.method === 'Runtime.exceptionThrown').length
  }, null, 2));
  ws.close();
})().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1); });