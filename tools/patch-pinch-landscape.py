"""1) 地图支持双指缩放  2) 移动端横屏布局 + 竖屏提示"""
from pathlib import Path

js = Path('app.js')
t = js.read_text(encoding='utf-8')

# ---------------------------------------------------------------- 双指缩放
old = """  function initMapInteraction() {
    mapSvg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const point = eventToViewBox(event);
      zoomMapAt(point.x, point.y, event.deltaY < 0 ? 1.09 : 0.917);
    }, { passive: false });

    mapSvg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('.map-marker')) return;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        tx: state.map.tx,
        ty: state.map.ty,
        moved: false
      };
      mapSvg.setPointerCapture?.(event.pointerId);
    });

    mapSvg.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      mapSvg.classList.add('is-dragging');
      const scaleX = mapSvg.viewBox.baseVal.width / mapSvg.clientWidth;
      const scaleY = mapSvg.viewBox.baseVal.height / mapSvg.clientHeight;
      const factor = Math.max(scaleX, scaleY);
      state.map.tx = drag.tx + dx * factor;
      state.map.ty = drag.ty + dy * factor;
      clampMap();
      applyMapTransform();
    });

    const endDrag = (event) => {
      if (!drag) return;
      if (drag.moved) {
        suppressMapClick = true;
        state.mapMoved = true;
        setTimeout(() => { suppressMapClick = false; }, 80);
      }
      drag = null;
      mapSvg.classList.remove('is-dragging');
      if (mapSvg.hasPointerCapture?.(event.pointerId)) mapSvg.releasePointerCapture(event.pointerId);
    };
    mapSvg.addEventListener('pointerup', endDrag);
    mapSvg.addEventListener('pointercancel', endDrag);"""

new = """  // 正在按下的手指/指针，双指时用来算缩放比例
  const activePointers = new Map();

  function pointerDistance() {
    const points = [...activePointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function pointerCentre() {
    const points = [...activePointers.values()];
    if (points.length < 2) return null;
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  }

  function viewBoxPoint(clientX, clientY) {
    const ctm = mapSvg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const point = mapSvg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  function initMapInteraction() {
    mapSvg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const point = eventToViewBox(event);
      zoomMapAt(point.x, point.y, event.deltaY < 0 ? 1.09 : 0.917);
    }, { passive: false });

    mapSvg.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // 第二根手指按下：进入双指缩放，取消拖动
      if (activePointers.size === 2) {
        drag = null;
        mapSvg.classList.remove('is-dragging');
        pinch = { distance: pointerDistance(), centre: pointerCentre() };
        mapSvg.classList.add('is-pinching');
        mapSvg.setPointerCapture?.(event.pointerId);
        return;
      }
      if (activePointers.size > 2) return;

      if (event.target.closest('.map-marker')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        tx: state.map.tx,
        ty: state.map.ty,
        moved: false
      };
      mapSvg.setPointerCapture?.(event.pointerId);
    });

    mapSvg.addEventListener('pointermove', (event) => {
      if (activePointers.has(event.pointerId)) {
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      // 双指：按距离比例缩放，同时跟随两指中心平移
      if (activePointers.size >= 2) {
        event.preventDefault();
        const distance = pointerDistance();
        const centre = pointerCentre();
        if (!pinch || !pinch.distance || !centre) return;
        const ratio = distance / pinch.distance;
        if (Math.abs(ratio - 1) > 0.002 && Number.isFinite(ratio)) {
          const local = viewBoxPoint(centre.x, centre.y);
          const target = clamp(state.map.k * ratio, 0.72, 3.2);
          const applied = target / state.map.k;
          zoomMapAt(local.x, local.y, applied);
          pinch.distance = distance;
        }
        // 两指整体移动时拖动地图
        if (pinch.centre) {
          const scaleX = mapSvg.viewBox.baseVal.width / mapSvg.clientWidth;
          const scaleY = mapSvg.viewBox.baseVal.height / mapSvg.clientHeight;
          const factor = Math.max(scaleX, scaleY);
          const dx = (centre.x - pinch.centre.x) * factor;
          const dy = (centre.y - pinch.centre.y) * factor;
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            state.map.tx += dx;
            state.map.ty += dy;
            clampMap();
            applyMapTransform();
          }
        }
        pinch.centre = centre;
        state.mapMoved = true;
        return;
      }

      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      mapSvg.classList.add('is-dragging');
      const scaleX = mapSvg.viewBox.baseVal.width / mapSvg.clientWidth;
      const scaleY = mapSvg.viewBox.baseVal.height / mapSvg.clientHeight;
      const factor = Math.max(scaleX, scaleY);
      state.map.tx = drag.tx + dx * factor;
      state.map.ty = drag.ty + dy * factor;
      clampMap();
      applyMapTransform();
    });

    const endPointer = (event) => {
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2 && pinch) {
        pinch = null;
        mapSvg.classList.remove('is-pinching');
        suppressMapClick = true;
        state.mapMoved = true;
        setTimeout(() => { suppressMapClick = false; }, 120);
      }
      if (activePointers.size === 1 && !pinch) {
        // 双指松开一指后，剩下那根继续可拖动
        const [id] = [...activePointers.keys()];
        const point = activePointers.get(id);
        drag = { pointerId: id, startX: point.x, startY: point.y, tx: state.map.tx, ty: state.map.ty, moved: false };
      }
      if (!drag) return;
      if (drag.moved) {
        suppressMapClick = true;
        state.mapMoved = true;
        setTimeout(() => { suppressMapClick = false; }, 80);
      }
      drag = null;
      mapSvg.classList.remove('is-dragging');
      if (mapSvg.hasPointerCapture?.(event.pointerId)) mapSvg.releasePointerCapture(event.pointerId);
    };
    mapSvg.addEventListener('pointerup', endPointer);
    mapSvg.addEventListener('pointercancel', endPointer);
    mapSvg.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') endPointer(event);
    });"""

assert old in t
t = t.replace(old, new, 1)

# 变量声明
old_decl = """  let suppressMapClick = false;
  let drag = null;"""
new_decl = """  let suppressMapClick = false;
  let drag = null;
  let pinch = null;"""
assert old_decl in t
t = t.replace(old_decl, new_decl, 1)

# 移动端横屏：尝试锁定方向（需全屏/支持时才生效）
anchor = "    registerServiceWorker();"
addition = """    registerServiceWorker();
    enableLandscapeHint();"""
assert anchor in t
t = t.replace(anchor, addition, 1)

helper_anchor = "  // Offline shell for the installed app. Skipped on file:// where it cannot work."
helper = '''  // 竖屏时提示旋转到横屏；支持方向锁的浏览器顺带请求锁定。
  function enableLandscapeHint() {
    const hint = document.getElementById('rotateHint');
    if (!hint) return;
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouch) return;

    const sync = () => {
      const portrait = window.innerHeight > window.innerWidth;
      const narrow = Math.min(window.innerWidth, window.innerHeight) <= 820;
      hint.hidden = !(portrait && narrow);
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', () => setTimeout(sync, 160));
  }

  // Offline shell for the installed app. Skipped on file:// where it cannot work.'''
assert helper_anchor in t
t = t.replace(helper_anchor, helper, 1)

js.write_text(t, encoding='utf-8')
print('pinch zoom + landscape hint wired')