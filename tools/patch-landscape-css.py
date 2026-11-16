"""横屏提示层 + 横屏布局；manifest 方向改为 landscape。"""
from pathlib import Path
import json

# ---------- index.html：加竖屏提示 ----------
html = Path('index.html')
h = html.read_text(encoding='utf-8')

anchor = '  <div class="sidebar-scrim" id="sidebarScrim"></div>'
if anchor not in h:
    anchor = '  <dialog class="add-dialog" id="addDialog"'

block = '''  <div class="rotate-hint" id="rotateHint" hidden role="status">
    <span class="rotate-icon" aria-hidden="true">
      <svg viewBox="0 0 48 48"><rect x="15" y="4" width="18" height="30" rx="4"></rect><path d="M24 40v6M18 42l6 4 6-4"></path></svg>
    </span>
    <strong>请横屏使用</strong>
    <p>把手机横过来，地图会更完整；双指可以直接缩放。</p>
  </div>

''' + anchor

assert anchor in h
h = h.replace(anchor, block, 1)
html.write_text(h, encoding='utf-8')
print('rotate hint markup added')

# ---------- manifest：横屏 ----------
manifest = Path('manifest.webmanifest')
data = json.loads(manifest.read_text(encoding='utf-8'))
data['orientation'] = 'landscape'
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('manifest orientation =', data['orientation'])

# ---------- styles.css ----------
css = Path('styles.css')
c = css.read_text(encoding='utf-8')

c += """
/* ------------------------------------------------------- 移动端：横屏优先 */
/* 竖屏时盖一层提示（仅触屏设备），提示用户把手机转过来 */
.rotate-hint {
  position: fixed; inset: 0; z-index: 300;
  display: grid; place-content: center; justify-items: center; gap: 12px;
  padding: 32px 26px; text-align: center;
  background:
    radial-gradient(circle at 50% 22%, rgba(180, 198, 174, 0.55), transparent 58%),
    #ECE8DC;
  color: var(--ink);
}
.rotate-hint[hidden] { display: none; }
.rotate-hint strong { font-family: var(--font-serif); font-size: 21px; font-weight: 600; letter-spacing: 0.04em; }
.rotate-hint p { margin: 0; max-width: 260px; font-size: 12px; line-height: 1.8; color: rgba(37, 68, 59, 0.62); }
.rotate-icon svg {
  width: 66px; height: 66px; fill: none; stroke: var(--accent-ink);
  stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;
  animation: rotateNudge 2.6s ease-in-out infinite;
}
@keyframes rotateNudge {
  0%, 55%, 100% { transform: rotate(0deg); }
  25%, 35% { transform: rotate(-90deg); }
}

/* 横屏（高度小的宽屏）：压缩顶部，地图占满，记录卡片改成右侧窄卡 */
@media (orientation: landscape) and (max-height: 560px) {
  .app { min-height: 0; height: 100svh; }
  .topbar { top: 8px; height: 42px; left: 10px; right: 10px; }
  .topbar-left { padding: 4px 10px 4px 4px; gap: 6px; }
  .scope-switch { min-width: 116px; }
  .scope-btn { padding: 4px 8px; font-size: 10.5px; }
  .share-btn { height: 34px; padding: 0 12px 0 10px; font-size: 10px; }
  .avatar-small { width: 32px; height: 32px; font-size: 10px; }
  .journal-intro h1 { font-size: 26px; }
  .journal-intro .lede { display: none; }
  .sidebar { left: 8px; top: 8px; bottom: 8px; width: 268px; padding: 14px 14px 10px; }
  .sidebar-head { margin-bottom: 6px; }
  .journal-intro { margin: 8px 0 10px; }
  .stats { padding: 8px 0; }
  .place-item { min-height: 52px; grid-template-columns: 62px 1fr 38px; }
  .place-main strong { font-size: 13px; }
  .add-place { height: 40px; margin-top: 8px; font-size: 10px; }
  .memory-panel { top: 56px; right: 8px; bottom: 8px; left: auto; width: min(330px, 44vw); height: auto; border-radius: 18px; }
  .memory-cover { height: 120px; }
  .map-bottom { display: none; }
  .map-legend { font-size: 8px; }
  .toast { top: 58px; }
  .add-dialog { height: calc(100svh - 12px); }
  .add-body { grid-template-columns: minmax(0, 1fr) 300px; }
  .add-preview { padding: 14px 16px 12px; }
  .preview-art { height: 96px; }
  .share-dialog { width: calc(100vw - 24px); }
  .share-preview { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
}

/* 双指缩放时不要选中文字、不要出现点击态 */
#travel-map.is-pinching { cursor: grabbing; }
"""

css.write_text(c, encoding='utf-8')
print('landscape styles appended')