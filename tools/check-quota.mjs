import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = 'D:\\project\\travel map';
const PORT = 9941;
const URL = 'file:///D:/project/travel%20map/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(ROOT, '.cdp-quota');

async function main() {
  await fs.rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  const proc = spawn(EDGE, ['--headless=new', '--no-sandbox', '--disable-crash-reporter', '--disable-breakpad', '--no-first-run', '--hide-scrollbars', '--window-size=1440,900', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, URL], { stdio: 'ignore', windowsHide: true });
  let target;
  for (let i = 0; i < 80; i += 1) { await sleep(250); try { const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()); target = list.find((t) => t.type === 'page' && t.url.startsWith('file:')); if (target) break; } catch (e) { /* retry */ } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.resolve(m.result); } });
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, { resolve }); ws.send(JSON.stringify({ id, method, params })); });
  const evalv = async (expression) => { const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (m.exceptionDetails) return { error: m.exceptionDetails.exception?.description }; return m.result?.value; };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2200);

  const info = await evalv(`(async () => {
    const out = { origin: location.origin, protocol: location.protocol };
    try {
      const est = await navigator.storage.estimate();
      out.quotaMB = Math.round(est.quota / 1048576);
      out.usageMB = Math.round(est.usage / 1048576);
    } catch (e) { out.estimateError = String(e); }
    try {
      out.persisted = await navigator.storage.persisted();
    } catch (e) { out.persistedError = String(e); }
    return out;
  })()`);

  console.log(JSON.stringify(info, null, 2));
  ws.close(); proc.kill(); await sleep(200);
  await fs.rm(PROFILE, { recursive: true, force: true }).catch(() => {});
}
main().catch((e) => { console.error(e); process.exitCode = 1; });