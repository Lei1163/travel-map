(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const NS = 'http://www.w3.org/2000/svg';
  const WORLD = window.WORLD_MAP;
  const CHINA = window.CHINA_MAP;
  const CITIES = window.TRAVEL_CITIES || [];
  // Every Chinese city, used only by the home-city picker.
  const EXTRA_CHINA_CITIES = window.CHINA_EXTRA_CITIES || [];
  const COUNTRIES = window.TRAVEL_COUNTRIES || [];
  const LANDMARKS = window.CITY_LANDMARKS || {};
  const COUNTRY_EN_FALLBACK = { '老挝': 'Laos', '柬埔寨': 'Cambodia' };
  const STORE_KEY = 'roam-atlas:v2';
  const SELECT_KEY = 'roam-atlas:v2:selected';
  const PROFILE_KEY = 'roam-atlas:v2:profile';
  const SCOPE_KEY = 'roam-atlas:v2:scope';
  const DEFAULT_PROFILE = { nickname: '我', avatar: '' };
  const DEFAULT_COVER = 'assets/cities/generic.svg';
  const LANDMARK_DIR = 'assets/landmarks/';

  // Single-file build inlines every picture as a data URL and exposes the map as
  // window.__ATLAS_ASSETS. Records saved by the folder build still hold relative
  // paths such as "assets/cities/generic.svg", so everything goes through here
  // first; in the folder build the table is absent and paths stay untouched.
  function resolveAsset(src) {
    if (!src) return '';
    const key = String(src);
    if (/^(data:|blob:|https?:)/i.test(key)) return key;
    const table = window.__ATLAS_ASSETS;
    if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    return key;
  }

  // The app keeps two independent maps: the world outside China, and China.
  const SCOPES = {
    world: { label: '国际', place: '世界', cn: false },
    china: { label: '国内', place: '中国', cn: true }
  };

  function landmarkFor(place) {
    const file = place && LANDMARKS[place.city || place.name];
    return file ? resolveAsset(`${LANDMARK_DIR}${file}`) : '';
  }


  // Intentionally empty: every journey starts with the visitor's own first place.
  const SEED_PLACES = [];

  const state = {
    places: [],
    selectedId: null,
    activeTripId: null,
    albumEditing: false,
    albumSelection: new Set(),
    tripEditing: false,
    tripSelection: new Set(),
    scope: 'china',
    home: null,
    tripSlots: [],
    activeSlot: 0,
    addPreview: null,
    addCountry: null,
    addProvince: null,
    addQuery: '',
    noteEditing: false,
    lightboxIndex: 0,
    lightboxAlbumOpen: false,
    map: { k: 1.13, tx: -394, ty: 193 },
    mapMoved: false,
    objectUrls: new Set(),
    confirmResolver: null,
    toastTimer: null,
    toastHideTimer: null,
    addNoticeTimer: null,
    profile: { ...DEFAULT_PROFILE },
    pendingAvatar: ''
  };
  const SLOT_COUNT = 6;
  const HOME_KEY = 'roam-atlas:v2:home';
  let wasMobileViewport = window.innerWidth <= 760;

  /* --------------------------------------------------------------- Utilities */
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const pad2 = (n) => String(n).padStart(2, '0');
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalize = (value) => String(value || '').toLowerCase().trim();
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function formatDate(date, style = 'dot') {
    const parts = String(date || '').split('-');
    if (parts.length !== 3) return date || '';
    if (style === 'dot') return `${parts[0]}.${parts[1]}.${parts[2]}`;
    if (style === 'short') return `${parts[0]}.${parts[1]}`;
    return `${parts[0]} 年 ${Number(parts[1])} 月 ${Number(parts[2])} 日`;
  }

  // A place can be visited in up to two windows. Older records only carry a
  // single `date`, so everything is normalised into a small list here.
  function placePeriods(place) {
    const list = [];
    const seen = new Set();
    const push = (start, end) => {
      const from = String(start || '');
      if (!from) return;
      const to = String(end || from);
      const key = `${from}|${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ start: from, end: to });
    };
    if (Array.isArray(place?.periods)) {
      place.periods.forEach((item) => push(item?.start, item?.end));
    }
    push(place?.date, place?.dateEnd);
    return list;
  }

  function placeStart(place) {
    const periods = placePeriods(place);
    return periods.length ? periods.map((item) => item.start).sort()[0] : '';
  }

  function placeEnd(place) {
    const periods = placePeriods(place);
    return periods.length ? periods.map((item) => item.end).sort().reverse()[0] : '';
  }

  // "06.18 — 06.22 · 07.01 — 07.05"
  function placeRangeText(place) {
    const periods = placePeriods(place);
    return periods.map((item) => formatRange(item.start, item.end)).join(' · ');
  }

  // 06.18 — 06.22
  function formatRange(start, end) {
    const a = String(start || '');
    const b = String(end || start || '');
    const short = (iso) => {
      const parts = iso.split('-');
      return parts.length === 3 ? `${parts[1]}.${parts[2]}` : iso;
    };
    if (!a) return '';
    if (!b || b === a) return short(a);
    return `${short(a)} — ${short(b)}`;
  }

  // 2024.06 — 07, used by the trip card header.
  function formatMonthSpan(start, end) {
    const a = String(start || '');
    if (a.length < 7) return a || '未标日期';
    const head = `${a.slice(0, 4)}.${a.slice(5, 7)}`;
    const b = String(end || start || '');
    if (b.length >= 10 && b.slice(0, 4) === a.slice(0, 4) && b.slice(5, 7) !== a.slice(5, 7)) {
      return `${head} — ${b.slice(5, 7)}`;
    }
    return head;
  }

  function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }

  function formatNumber(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  function formatCoord(lat, lon, compact = false) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return '';
    const ns = Number(lat) >= 0 ? 'N' : 'S';
    const ew = Number(lon) >= 0 ? 'E' : 'W';
    const digits = compact ? 2 : 4;
    const sep = compact ? '  ' : '   ';
    return `${Math.abs(Number(lat)).toFixed(digits)}° ${ns}${sep}${Math.abs(Number(lon)).toFixed(digits)}° ${ew}`;
  }

  function haversine(a, b) {
    if (!a || !b) return 0;
    const toRad = (d) => (Number(d) * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function englishPlace(place) {
    const country = (place.countryEn || place.country || '').toUpperCase();
    if (place.kind === 'country') return country;
    return `${(place.en || place.city || place.country || '').toUpperCase()}, ${country}`;
  }

  function inScope(place) {
    const isChina = place.country === '中国';
    return state.scope === 'china' ? isChina : !isChina;
  }

  function scopeMeta() {
    return SCOPES[state.scope] || SCOPES.world;
  }

  function loadScope() {
    let stored = null;
    try { stored = localStorage.getItem(SCOPE_KEY); } catch (error) { /* ignore */ }
    // 国内 is the open-with view; an explicit choice of 国际 is remembered.
    return stored === 'world' ? 'world' : 'china';
  }

  function saveScope() {
    try { localStorage.setItem(SCOPE_KEY, state.scope); return true; } catch (error) { return false; }
  }

  function sortedPlaces() {
    return state.places
      .filter(inScope)
      .sort((a, b) => {
        const byDate = placeStart(a).localeCompare(placeStart(b));
        return byDate || String(a.id).localeCompare(String(b.id));
      });
  }

  function selectedPlace() {
    if (state.selectedId === 'home' && departurePlace()) return homePlaceForDetail();
    const place = state.places.find((p) => p.id === state.selectedId) || null;
    return place && inScope(place) ? place : null;
  }

  function selectedIndex() {
    return sortedPlaces().findIndex((p) => p.id === state.selectedId);
  }

  function countryEnglish(name) {
    return COUNTRIES.find((c) => c.name === name)?.en || COUNTRY_EN_FALLBACK[name] || name;
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    $('#toastText').textContent = message;
    // Lift the toast into the top layer so an open dialog cannot cover it.
    if (typeof toast.showPopover === 'function' && !toast.matches(':popover-open')) {
      try { toast.showPopover(); } catch (error) { /* already open */ }
    }
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    clearTimeout(state.toastTimer);
    clearTimeout(state.toastHideTimer);
    state.toastTimer = setTimeout(() => {
      toast.classList.remove('is-visible');
      state.toastHideTimer = setTimeout(() => {
        if (typeof toast.hidePopover === 'function' && toast.matches(':popover-open')) {
          try { toast.hidePopover(); } catch (error) { /* already closed */ }
        }
      }, 320);
    }, 2900);
  }

  /* --------------------------------------------------------------- Persistence */
  let dbPromise = null;

  function openMediaDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = indexedDB.open('roam-atlas-media', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('camera')) db.createObjectStore('camera');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    });
    return dbPromise;
  }

  async function storeBlob(key, blob) {
    const db = await openMediaDB();
    await new Promise((resolve, reject) => {
      const request = db.transaction('camera', 'readwrite').objectStore('camera').put(blob, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function readBlob(key) {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction('camera', 'readonly').objectStore('camera').get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function removeBlob(key) {
    if (!key) return;
    try {
      const db = await openMediaDB();
      await new Promise((resolve, reject) => {
        const request = db.transaction('camera', 'readwrite').objectStore('camera').delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('Unable to remove stored media', error);
    }
  }

  function cloneSeed() {
    return JSON.parse(JSON.stringify(SEED_PLACES));
  }

  function loadPlaces() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((p) => p && p.id && p.date)) {
          return parsed.map((p) => ({
            ...p,
            kind: p.kind || 'city',
            tripId: p.tripId || null,
            media: Array.isArray(p.media) ? p.media : [],
            cover: p.cover || DEFAULT_COVER
          }));
        }
      }
    } catch (error) {
      console.warn('Unable to restore journey', error);
    }
    return cloneSeed();
  }

  function loadHome() {
    try {
      const raw = localStorage.getItem(HOME_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.name) return null;
      return {
        name: parsed.name,
        en: parsed.en || parsed.name,
        country: parsed.country || '',
        code: parsed.code || '',
        lat: Number(parsed.lat),
        lon: Number(parsed.lon)
      };
    } catch (error) {
      return null;
    }
  }

  function saveHome() {
    try {
      if (state.home) localStorage.setItem(HOME_KEY, JSON.stringify(state.home));
      else localStorage.removeItem(HOME_KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  function savePlaces() {
    try {
      const clean = state.places.map((place) => ({
        ...place,
        media: place.media.map((item) => {
          if (item.storageKey) {
            const { src, thumbUrl, ...rest } = item;
            return rest;
          }
          return item;
        })
      }));
      localStorage.setItem(STORE_KEY, JSON.stringify(clean));
    } catch (error) {
      console.warn('Unable to save journey', error);
      showToast('本机存储空间不足，请删除一些影像后重试');
    }
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      state.profile = {
        nickname: typeof parsed.nickname === 'string' && parsed.nickname.trim()
          ? parsed.nickname.trim().slice(0, 20)
          : DEFAULT_PROFILE.nickname,
        avatar: typeof parsed.avatar === 'string' && /^data:image\//.test(parsed.avatar)
          ? parsed.avatar
          : ''
      };
    } catch (error) {
      console.warn('Unable to restore profile', error);
    }
  }

  function saveProfile() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
      return true;
    } catch (error) {
      console.warn('Unable to save profile', error);
      showToast('本机存储空间不足，头像未能保存');
      return false;
    }
  }

  function avatarInitial(nickname) {
    return Array.from(nickname || '我')[0] || '我';
  }

  function applyProfile() {
    const nickname = state.profile.nickname || DEFAULT_PROFILE.nickname;
    const initial = avatarInitial(nickname);
    const avatar = state.profile.avatar;

    $('#profileName').textContent = `${nickname}的旅行档案`;
    $('#topAvatarText').textContent = initial;
    $('#sidebarAvatarText').textContent = initial;

    const topImage = $('#topAvatarImage');
    const sideImage = $('#sidebarAvatarImage');
    if (avatar) {
      topImage.src = avatar;
      topImage.hidden = false;
      topImage.alt = `${nickname}的头像`;
      sideImage.src = avatar;
      sideImage.hidden = false;
      sideImage.alt = `${nickname}的头像`;
      $('#topAvatarText').hidden = true;
      $('#sidebarAvatarText').hidden = true;
    } else {
      topImage.hidden = true;
      topImage.removeAttribute('src');
      sideImage.hidden = true;
      sideImage.removeAttribute('src');
      $('#topAvatarText').hidden = false;
      $('#sidebarAvatarText').hidden = false;
    }

    const button = $('#profileAvatarBtn');
    button.setAttribute('aria-label', `编辑${nickname}的个人资料`);
    button.title = '编辑个人资料';
    renderProfileSummary();
  }

  function renderProfileEditorAvatar() {
    const nickname = $('#profileNickname')?.value.trim() || state.profile.nickname || DEFAULT_PROFILE.nickname;
    const preview = $('#profileAvatarPreview');
    const fallback = $('#profileAvatarFallback');
    const removeButton = $('#removeAvatarBtn');
    if (state.pendingAvatar) {
      preview.src = state.pendingAvatar;
      preview.alt = `${nickname}的新头像`;
      preview.hidden = false;
      fallback.hidden = true;
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
      fallback.hidden = false;
      fallback.textContent = avatarInitial(nickname);
    }
    removeButton.disabled = !state.pendingAvatar;
  }

  function renderProfileSummary() {
    const target = $('#profileSummary');
    if (!target) return;
    const places = sortedPlaces();
    const countries = new Set(places.map((place) => place.country)).size;
    const media = places.reduce((sum, place) => sum + place.media.length, 0);
    target.innerHTML = `
      <span><strong>${pad2(places.length)}</strong> 个目的地</span>
      <i></i>
      <span><strong>${pad2(countries)}</strong> 个国家</span>
      <i></i>
      <span><strong>${pad2(media)}</strong> 段记忆</span>`;
  }

  const crop = { image: null, src: '', naturalW: 0, naturalH: 0, baseScale: 1, scale: 1, x: 0, y: 0, stage: 0, dragging: null };

  function clampCrop() {
    const size = crop.stage;
    const width = crop.naturalW * crop.scale;
    const height = crop.naturalH * crop.scale;
    crop.x = Math.min(0, Math.max(size - width, crop.x));
    crop.y = Math.min(0, Math.max(size - height, crop.y));
  }

  function paintCrop() {
    if (!crop.naturalW) return;
    clampCrop();
    const img = $('#cropImage');
    if (!img) return;
    img.style.width = `${Math.round(crop.naturalW * crop.scale)}px`;
    img.style.height = `${Math.round(crop.naturalH * crop.scale)}px`;
    img.style.transform = `translate(${Math.round(crop.x)}px, ${Math.round(crop.y)}px)`;
    drawCropPreview();
  }

  // Draws the circle the avatar will become, straight from the current framing.
  function drawCropPreview() {
    const canvas = $('#cropPreview');
    if (!canvas || !crop.naturalW || !crop.scale || !crop.stage) return;
    const ctx = canvas.getContext('2d');
    const side = canvas.width;
    const scale = crop.scale;
    const sx = -crop.x / scale;
    const sy = -crop.y / scale;
    const size = crop.stage / scale;
    ctx.clearRect(0, 0, side, side);
    ctx.save();
    ctx.beginPath();
    ctx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#f2eadc';
    ctx.fillRect(0, 0, side, side);
    try {
      ctx.drawImage(crop.image, sx, sy, size, size, 0, 0, side, side);
    } catch (error) {
      /* ignore transient draw errors while the image is still loading */
    }
    ctx.restore();
  }

  // The dialog can be measured before it has a box, so retry until it is real.
  function measureStage() {
    const stage = $('#cropStage');
    if (!stage) return 0;
    const box = stage.getBoundingClientRect();
    return Math.round(Math.max(box.width, stage.clientWidth) || 0);
  }

  function resetCropView(attempt = 0) {
    const stage = $('#cropStage');
    if (!stage || !crop.naturalW) return;
    const size = measureStage();
    if (!size) {
      if (attempt < 12) requestAnimationFrame(() => resetCropView(attempt + 1));
      return;
    }
    crop.stage = size;
    // Cover the square: the shorter side fills the stage.
    crop.baseScale = Math.max(crop.stage / crop.naturalW, crop.stage / crop.naturalH);
    crop.scale = crop.baseScale;
    crop.x = (crop.stage - crop.naturalW * crop.scale) / 2;
    crop.y = (crop.stage - crop.naturalH * crop.scale) / 2;
    const zoom = $('#cropZoom');
    if (zoom) zoom.value = '1';
    paintCrop();
  }

  function setCropZoom(multiplier) {
    if (!crop.image || !crop.naturalW || !crop.baseScale) return;
    const previous = crop.scale;
    crop.scale = crop.baseScale * multiplier;
    // Keep the stage centre anchored while zooming.
    const centreX = crop.stage / 2;
    const centreY = crop.stage / 2;
    crop.x = centreX - ((centreX - crop.x) / previous) * crop.scale;
    crop.y = centreY - ((centreY - crop.y) / previous) * crop.scale;
    paintCrop();
  }

  function openCropDialog(src) {
    crop.src = src;
    const img = $('#cropImage');
    const dialog = $('#cropDialog');
    img.onload = () => {
      crop.image = img;
      crop.naturalW = img.naturalWidth;
      crop.naturalH = img.naturalHeight;
      if (!dialog.open) dialog.showModal();
      // Measure once the dialog has a layout box.
      requestAnimationFrame(resetCropView);
    };
    img.onerror = () => {
      showToast('无法读取这张图片，请换一张试试');
      if (dialog.open) dialog.close();
    };
    img.src = src;
  }

  function closeCropDialog() {
    const dialog = $('#cropDialog');
    if (dialog.open) dialog.close();
    crop.image = null;
  }

  function confirmCrop() {
    if (!crop.image || !crop.naturalW) return;
    // Make sure the framing maths has a real stage before cutting.
    if (!crop.stage || !crop.scale) resetCropView();
    if (!crop.stage || !crop.scale) return;
    const source = crop.image;
    const scale = crop.scale;
    const sx = -crop.x / scale;
    const sy = -crop.y / scale;
    const side = crop.stage / scale;
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f2eadc';
    context.fillRect(0, 0, 480, 480);
    try {
      context.drawImage(source, sx, sy, side, side, 0, 0, 480, 480);
    } catch (error) {
      showToast('这张图片无法裁剪，请换一张试试');
      return;
    }
    state.pendingAvatar = canvas.toDataURL('image/jpeg', 0.86);
    closeCropDialog();
    renderProfileEditorAvatar();
    showToast('头像已上传');
  }

  function readAvatarFile(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('not-image'));
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        reject(new Error('too-large'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('read-failed'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  function bindCropInteractions() {
    const stage = $('#cropStage');
    const zoom = $('#cropZoom');
    if (!stage) return;

    stage.addEventListener('pointerdown', (event) => {
      if (!crop.image) return;
      stage.setPointerCapture?.(event.pointerId);
      crop.dragging = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: crop.x, originY: crop.y };
      stage.classList.add('is-dragging');
    });

    stage.addEventListener('pointermove', (event) => {
      if (!crop.dragging || crop.dragging.pointerId !== event.pointerId) return;
      crop.x = crop.dragging.originX + (event.clientX - crop.dragging.startX);
      crop.y = crop.dragging.originY + (event.clientY - crop.dragging.startY);
      paintCrop();
    });

    const endDrag = (event) => {
      if (!crop.dragging) return;
      if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      crop.dragging = null;
      stage.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    stage.addEventListener('wheel', (event) => {
      if (!crop.image) return;
      event.preventDefault();
      const current = Number(zoom.value) || 1;
      const next = Math.min(3, Math.max(1, current + (event.deltaY < 0 ? 0.08 : -0.08)));
      zoom.value = String(next);
      setCropZoom(next);
    }, { passive: false });

    zoom.addEventListener('input', () => setCropZoom(Number(zoom.value) || 1));
    $('#cropConfirmBtn').addEventListener('click', confirmCrop);
    $('#cropDialog').addEventListener('close', () => { crop.image = null; });
    window.addEventListener('resize', () => {
      if ($('#cropDialog').open) {
        crop.stage = $('#cropStage').clientWidth || crop.stage;
        const multiplier = crop.scale / crop.baseScale || 1;
        crop.baseScale = Math.max(crop.stage / crop.naturalW, crop.stage / crop.naturalH);
        crop.scale = crop.baseScale * multiplier;
        paintCrop();
      }
    });
  }

/* Roam Travel Atlas — offline-first travel trajectory journal */

  function openProfileDialog() {
    state.pendingAvatar = state.profile.avatar || '';
    $('#profileNickname').value = state.profile.nickname || DEFAULT_PROFILE.nickname;
    $('#profileAvatarInput').value = '';
    renderProfileEditorAvatar();
    renderProfileSummary();
    if (!$('#profileDialog').open) $('#profileDialog').showModal();
  }

  async function hydrateMedia() {
    const jobs = [];
    state.places.forEach((place) => {
      place.media.forEach((item) => {
        if (item.storageKey && !item.src) {
          jobs.push(
            readBlob(item.storageKey)
              .then((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                item.src = url;
                state.objectUrls.add(url);
              })
              .catch(() => {})
          );
        }
        // Thumbnails are cheap to keep around; load them in the same pass.
        if (item.thumbKey && !item.thumbUrl) {
          jobs.push(
            readBlob(item.thumbKey)
              .then((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                item.thumbUrl = url;
                state.objectUrls.add(url);
              })
              .catch(() => {})
          );
        }
      });
    });
    await Promise.all(jobs);
  }

  function revokeUrl(url) {
    if (!url || !url.startsWith('blob:')) return;
    URL.revokeObjectURL(url);
    state.objectUrls.delete(url);
  }

  /* --------------------------------------------------------------- Projection + map */
  const ROBINSON_X = [1, 0.9986, 0.9954, 0.9900, 0.9822, 0.9730, 0.9600, 0.9427, 0.9216, 0.8962, 0.8679, 0.8350, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
  const ROBINSON_Y = [0, 0.0620, 0.1240, 0.1860, 0.2480, 0.3100, 0.3720, 0.4340, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0000];

  function projectChina(lon, lat) {
    const p = (CHINA && CHINA.projection) || null;
    if (!p) return { x: 720, y: 450 };
    const rad = Math.PI / 180;
    const theta = p.n * (Number(lon) - p.lon0) * rad;
    const rho = Math.sqrt(Math.max(0, p.c - 2 * p.n * Math.sin(Number(lat) * rad))) / p.n;
    const x = rho * Math.sin(theta);
    const y = p.rho0 - rho * Math.cos(theta);
    return {
      x: x * p.scale + p.ox,
      y: p.oy - y * p.scale
    };
  }

  function project(lon, lat) {
    if (state.scope === 'china' && CHINA) return projectChina(lon, lat);
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
    const transforms = WORLD.oceaniaTransforms;
    if (transforms) {
      if (Number(lon) >= 110 && Number(lon) <= 156 && Number(lat) <= -9 && Number(lat) >= -48) {
        const { cx, cy, angle } = transforms.australia;
        const radians = (angle * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const dx = screenX - cx;
        const dy = screenY - cy;
        screenX = cx + dx * cos + dy * sin;
        screenY = cy - dx * sin + dy * cos;
      } else if (Number(lon) >= 164 && Number(lon) <= 180 && Number(lat) <= -32 && Number(lat) >= -50) {
        const { cx, cy, angle, longScale, shortScale } = transforms.newZealand;
        const radians = (angle * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const dx = screenX - cx;
        const dy = screenY - cy;
        const along = (dx * cos + dy * sin) * longScale;
        const across = (-dx * sin + dy * cos) * shortScale;
        screenX = cx + along * cos - across * sin;
        screenY = cy + along * sin + across * cos;
      }
    }
    return {
      x: screenX,
      y: screenY
    };
  }

  const mapSvg = $('#travel-map');
  const mapContent = $('#map-content');
  const mapLand = $('#map-land');
  const mapBorders = $('#map-borders');
  const mapRegions = $('#map-regions');
  const mapRoutes = $('#map-routes');
  const BORDERS = window.MAP_BORDERS || {};

  // 国内地图的省界始终显示；国际地图的国界仍要放大到 1.5 倍才出现。
  const BORDER_ZOOM_WORLD = 1.5;

  // 每帧都会被调用，所以只在状态真的变化时才碰 DOM（缩放时改 class 会触发重绘）。
  let borderState = '';
  function updateBorderVisibility() {
    if (!mapBorders) return;
    const base = state.baseK || state.map.k;
    const ratio = base > 0 ? state.map.k / base : 1;
    const isChina = state.scope === 'china';
    const showProvince = isChina;
    const showCountry = !isChina && ratio >= BORDER_ZOOM_WORLD;
    const key = `${showProvince ? 1 : 0}${showCountry ? 1 : 0}`;
    if (key === borderState) return;
    borderState = key;
    $('.border-country', mapBorders).classList.toggle('is-visible', showCountry);
    $('.border-province', mapBorders).classList.toggle('is-visible', showProvince);
    mapBorders.dataset.ratio = ratio.toFixed(2);
  }
  const mapMarkers = $('#map-markers');

  const CONTINENT_LABELS = [
    ['NORTH AMERICA', -88, 45],
    ['SOUTH AMERICA', -60, -17],
    ['EUROPE', 24, 48],
    ['ASIA', 92, 46],
    ['AFRICA', 20, 5],
    ['OCEANIA', 137, -24],
    ['ANTARCTICA', 0, -79]
  ];

  const OCEAN_LABELS = [
    ['PACIFIC OCEAN', 156, 2],
    ['ATLANTIC OCEAN', -31, 22],
    ['INDIAN OCEAN', 77, -19],
    ['ARCTIC OCEAN', 76, 80]
  ];

  // Seas around China, shown instead of continents on the domestic map.
  const CHINA_SEA_LABELS = [
    ['渤海', 119.6, 38.6],
    ['黄海', 123.6, 34.6],
    ['东海', 125.4, 28.2],
    ['南海', 114.6, 14.6]
  ];

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function buildMapBase() {
    const landPath = state.scope === 'china' && CHINA ? CHINA.land : WORLD.land;
    const base = svgEl('path', { d: landPath, class: 'land-fill', 'fill-rule': 'evenodd' });
    const coast = svgEl('path', { d: landPath, class: 'land-coast', 'fill-rule': 'evenodd' });
    const dots = svgEl('path', { d: landPath, class: 'land-dots', 'fill-rule': 'evenodd' });
    mapLand.replaceChildren(base, dots, coast);
    landBoxCache = null;
    const clipPath = document.getElementById('landClipPath');
    if (clipPath) clipPath.setAttribute('d', landPath);

    // Administrative borders for the current scope.
    const isChina = state.scope === 'china';
    // The Suez Canal belongs to the world map only; on the China map its stub
    // would sit just off the east coast as a stray short line.
    const canal = document.getElementById('map-canal');
    if (canal) canal.style.display = isChina ? 'none' : '';
    $('.border-country', mapBorders).setAttribute('d', isChina ? '' : (BORDERS.world || ''));
    $('.border-province', mapBorders).setAttribute('d', isChina ? (BORDERS.china?.provinces || '') : '');
    updateBorderVisibility();

    const labelFrag = document.createDocumentFragment();
    if (state.scope === 'china') {
      CHINA_SEA_LABELS.forEach(([label, lon, lat]) => {
        const p = project(lon, lat);
        const text = svgEl('text', {
          x: p.x, y: p.y, class: 'ocean-label china-sea-label', 'text-anchor': 'middle', 'aria-hidden': 'true'
        });
        text.textContent = label;
        labelFrag.append(text);
      });
      mapRegions.replaceChildren(labelFrag);
      return;
    }

    CONTINENT_LABELS.forEach(([label, lon, lat]) => {
      const p = project(lon, lat);
      const text = svgEl('text', {
        x: p.x, y: p.y, class: 'continent-label', 'text-anchor': 'middle', 'aria-hidden': 'true'
      });
      text.textContent = label;
      labelFrag.append(text);
    });
    OCEAN_LABELS.forEach(([label, lon, lat]) => {
      const p = project(lon, lat);
      const text = svgEl('text', {
        x: p.x, y: p.y, class: 'ocean-label', 'text-anchor': 'middle', 'aria-hidden': 'true'
      });
      text.textContent = label;
      labelFrag.append(text);
    });
    mapRegions.replaceChildren(labelFrag);
  }

  // Route curves: every leg may bow up or bow down. The layout is settled with
  // a small local search whose cost is the thing the eye actually notices - how
  // long two legs run side by side. Crossing another route is fine, running
  // along it is not.
  const ROUTE_SAMPLES = 32;
  const ROUTE_TRIM = 3; // samples sitting on the shared endpoints say nothing
  const ROUTE_CLOSE = 14; // legs closer than this start to read as one line
  const ROUTE_NEAR_CHORD = 240; // only legs this close can interfere
  const ROUTE_FACTORS = [1, 0.8, 0.6, 0.4, 0.2, -0.2, -0.4, -0.6, -0.8, -1];

  function routeNormal(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    let nx = -dy / dist;
    let ny = dx / dist;
    if (ny > 0) { nx = -nx; ny = -ny; }
    return { dx, dy, dist, nx, ny };
  }

  function routeGeometry(a, b, factor) {
    const { dx, dy, dist, nx, ny } = routeNormal(a, b);
    // Keep the arc gentle: a journey should read as a flowing line, not a set
    // of loops. Short hops stay almost straight, long ones bow only slightly.
    const bend = clamp(dist * 0.12, 7, 46) * factor;
    const c1x = a.x + dx * 0.34 + nx * bend;
    const c1y = a.y + dy * 0.34 + ny * bend;
    const c2x = a.x + dx * 0.66 + nx * bend;
    const c2y = a.y + dy * 0.66 + ny * bend;
    const samples = [];
    for (let i = 0; i <= ROUTE_SAMPLES; i += 1) {
      const t = i / ROUTE_SAMPLES;
      const mt = 1 - t;
      const x = mt * mt * mt * a.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * b.x;
      const y = mt * mt * mt * a.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * b.y;
      samples.push({ x, y });
    }
    return {
      factor,
      samples,
      interior: samples.slice(ROUTE_TRIM, samples.length - ROUTE_TRIM),
      d: `M${a.x.toFixed(2)} ${a.y.toFixed(2)}C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
    };
  }

  // Distance between two chords, used to prune legs that cannot interfere.
  function chordDistance(a, b) {
    const steps = 6;
    let best = Infinity;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const px = a.a.x + (a.b.x - a.a.x) * t;
      const py = a.a.y + (a.b.y - a.a.y) * t;
      for (let j = 0; j <= steps; j += 1) {
        const s = j / steps;
        const qx = b.a.x + (b.b.x - b.a.x) * s;
        const qy = b.a.y + (b.b.y - b.a.y) * s;
        const d = Math.hypot(px - qx, py - qy);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // The longest unbroken stretch where this leg hugs another one, squared so a
  // long shared run dominates a brief brush past a crossing.
  function routeRunCost(geometry, other) {
    let run = 0;
    let longest = 0;
    let touching = 0;
    for (const p of geometry.interior) {
      let nearest = Infinity;
      for (const q of other.interior) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < nearest) nearest = d;
      }
      if (nearest < ROUTE_CLOSE) {
        run += 1;
        touching += 1;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }
    return longest * longest + touching * 0.5;
  }

// A leg looks best with a light bow, so the search is steered towards that
  // magnitude instead of collapsing every arc into a straight line.
  const ROUTE_PREFERRED_FACTOR = 0.55;

  function routeShapeCost(factor) {
    return Math.abs(Math.abs(factor) - ROUTE_PREFERRED_FACTOR) * 3;
  }

  function routeCost(geometry, peers) {
    let cost = routeShapeCost(geometry.factor);
    for (const peer of peers) cost += routeRunCost(geometry, peer.geometry);
    return cost;
  }

  function totalRouteCost(legs) {
    let total = 0;
    for (const leg of legs) total += routeShapeCost(leg.geometry.factor);
    for (let i = 0; i < legs.length; i += 1) {
      for (let j = i + 1; j < legs.length; j += 1) {
        if (!legs[i].peers.includes(legs[j])) continue;
        total += routeRunCost(legs[i].geometry, legs[j].geometry)
          + routeRunCost(legs[j].geometry, legs[i].geometry);
      }
    }
    return total;
  }

  // A trip is one "段轨迹": the cities the visitor entered together. Legs run
  // home -> first city, then city -> city inside the trip; separate trips never
  // link to each other.
  function routeGroups(places) {
    const groups = new Map();
    for (const place of places) {
      const key = place.tripId || '__legacy';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(place);
    }
    return [...groups.values()].map((list) => list.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))));
  }

  function homePlace() {
    if (!state.home) return null;
    return {
      id: 'home',
      kind: 'home',
      city: state.home.name,
      en: state.home.en,
      country: state.home.country,
      code: state.home.code,
      lat: state.home.lat,
      lon: state.home.lon
    };
  }

  // Where a trip starts from. The domestic map uses the visitor's own city;
  // the world map always leaves from the middle of China.
  const CHINA_ORIGIN = { city: '中国', en: 'China', country: '中国', code: 'CN', lat: 35.2, lon: 103.9 };

  function departurePlace() {
    if (state.scope === 'world') {
      return { id: 'home', kind: 'origin', ...CHINA_ORIGIN };
    }
    return homePlace();
  }

  function makeLeg(from, to) {
    return {
      from,
      to,
      a: project(from.lon, from.lat),
      b: project(to.lon, to.lat),
      geometry: null,
      peers: []
    };
  }

  // Place legs one by one, then keep re-picking each of them until nothing
  // improves. A leg can only be judged against the legs it could crowd, which
  // keeps this fast even for long journeys.
  function buildRoutes(places) {
    const legs = [];
    const home = departurePlace();
    for (const group of routeGroups(places)) {
      if (home) legs.push(makeLeg(home, group[0]));
      for (let i = 1; i < group.length; i += 1) legs.push(makeLeg(group[i - 1], group[i]));
    }
    if (!legs.length) return legs;

    for (let i = 0; i < legs.length; i += 1) {
      for (let j = 0; j < legs.length; j += 1) {
        if (i === j) continue;
        const shares = legs[i].from === legs[j].from || legs[i].to === legs[j].to
          || legs[i].from === legs[j].to || legs[i].to === legs[j].from;
        if (shares || chordDistance(legs[i], legs[j]) < ROUTE_NEAR_CHORD) {
          legs[i].peers.push(legs[j]);
        }
      }
    }

    // Three starting points (all up, alternating, all down) are climbed
    // separately; keeping the cheapest result avoids most local dead ends.
    const settle = (starts) => {
      legs.forEach((leg, i) => {
        leg.geometry = routeGeometry(leg.a, leg.b, starts[i]);
      });
      for (let pass = 0; pass < 8; pass += 1) {
        let changed = false;
        for (const leg of legs) {
          const ready = leg.peers.filter((peer) => peer.geometry);
          let best = leg.geometry;
          let bestCost = routeCost(leg.geometry, ready);
          for (const factor of ROUTE_FACTORS) {
            const candidate = routeGeometry(leg.a, leg.b, factor);
            const cost = routeCost(candidate, ready);
            if (cost < bestCost - 0.01) {
              bestCost = cost;
              best = candidate;
            }
          }
          if (best !== leg.geometry) {
            leg.geometry = best;
            changed = true;
          }
        }
        if (!changed) break;
      }
      return totalRouteCost(legs);
    };

    const starts = [
      legs.map(() => 1.05),
      legs.map((_, i) => (i % 2 ? -1.05 : 1.05)),
      legs.map(() => -1.05)
    ];
    let bestLayout = null;
    let bestCost = Infinity;
    for (const start of starts) {
      settle(start);
      const cost = totalRouteCost(legs);
      if (cost < bestCost) {
        bestCost = cost;
        bestLayout = legs.map((leg) => leg.geometry);
      }
    }
    legs.forEach((leg, i) => { leg.geometry = bestLayout[i]; });
    return legs;
  }

  // Label geometry, in map coordinates. The dot and the name chip stay tiny so
  // a dense itinerary still reads clearly.
  const LABEL_HEIGHT_BASE = 10.1;
  const LABEL_RADIUS_BASE = 5.06;
  const LABEL_FONT_BASE = 4.45;
  const LABEL_CODE_FONT_BASE = 3.15;
  const LABEL_PAD_X_BASE = 3.6;
  const LABEL_GAP_BASE = 3.4;
  const DOT_RADIUS = 3.26;
  const CORE_RADIUS = 1.78;
  const CODE_GAP_BASE = 1.8;
  const MARKER_HIT = 8.44;

  // 国内地图的城市名放大 15%；生成分享图时再额外放大 25%。
  // 手机上地图被压得很小，字号还要再放大一档，否则名字只有 4px 看不见。
  const LABEL_SCALE_CHINA = 1.15;
  const LABEL_SCALE_SHARE = 1.4375;
  const LABEL_SCALE_PHONE = 2.4;
  let labelScale = 1;
  let shareLabelScale = 1;

  function isPhoneMap() {
    return window.innerWidth <= 760;
  }

  const scaled = (base) => base * labelScale;
  const LABEL_HEIGHT = () => scaled(LABEL_HEIGHT_BASE);
  const LABEL_RADIUS = () => scaled(LABEL_RADIUS_BASE);
  const LABEL_PAD_X = () => scaled(LABEL_PAD_X_BASE);
  const LABEL_GAP = () => scaled(LABEL_GAP_BASE);
  const CODE_GAP = () => scaled(CODE_GAP_BASE);

  // The chip is sized from the measured text, so it only ever covers the name.
  let labelMetrics = null;

  function ensureLabelMetrics() {
    if (labelMetrics) return labelMetrics;
    const group = svgEl('g', { class: 'label-metrics', 'aria-hidden': 'true' });
    group.setAttribute('visibility', 'hidden');
    group.style.pointerEvents = 'none';
    const name = svgEl('text', { class: 'metric-name' });
    const code = svgEl('text', { class: 'metric-code' });
    group.append(name, code);
    mapSvg.append(group);
    labelMetrics = { group, name, code };
    return labelMetrics;
  }

  function measureLabel(name, code) {
    const metrics = ensureLabelMetrics();
    metrics.name.textContent = name;
    let width = metrics.name.getComputedTextLength();
    if (code) {
      metrics.code.textContent = code;
      width += CODE_GAP() + metrics.code.getComputedTextLength();
    }
    return width;
  }

  function labelWidth(name, code) {
    const measured = measureLabel(name, code);
    const width = Math.ceil(measured + LABEL_PAD_X() * 2);
    return Math.max(11, width);
  }

  // Candidate positions, tried in order: the usual "right + above" first, then
  // further away in every direction when a cluster is crowded.
  const LABEL_DIRECTIONS = [
    { side: 'right', align: 'above' },
    { side: 'left', align: 'above' },
    { side: 'right', align: 'below' },
    { side: 'left', align: 'below' },
    { side: 'center', align: 'above' },
    { side: 'center', align: 'below' },
    { side: 'right', align: 'middle' },
    { side: 'left', align: 'middle' }
  ];
  const LABEL_REACH = [1, 1.9, 3, 4.4, 6];

  function offsetFor(direction, width, scale = 1) {
    // Never let the chip touch the dot, whatever the zoom or direction is.
    const gap = Math.max(LABEL_GAP() * scale, DOT_RADIUS + 1.4);
    let x;
    if (direction.side === 'right') x = gap;
    else if (direction.side === 'left') x = -(width + gap);
    else x = -width / 2;
    let y;
    if (direction.align === 'above') y = -(LABEL_HEIGHT() + gap);
    else if (direction.align === 'below') y = gap;
    else y = -LABEL_HEIGHT() / 2;
    return { dx: x, dy: y };
  }

  // The dot occupies this box; a chip placed over it would hide the name.
  function dotBox(point) {
    const pad = DOT_RADIUS + 1.2;
    return { x: point.x - pad, y: point.y - pad, w: pad * 2, h: pad * 2 };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function boxFor(point, offset, width) {
    const card = { x: point.x + offset.dx, y: point.y + offset.dy, w: width, h: LABEL_HEIGHT() };
    const textBox = { x: card.x + 2.5, y: card.y + 1.8, w: card.w - 5, h: card.h - 3.6 };
    return { card, textBox };
  }

  // Pick a label position that keeps its text readable: the card itself may
  // overlap another card, but it must never cover another label's text and
  // never sit under another city's dot (dots are drawn on top of labels).
  function pickLabelOffset(point, width, placed, dots) {
    let best = null;
    let bestPenalty = Infinity;
    for (const scale of LABEL_REACH) {
      for (const direction of LABEL_DIRECTIONS) {
        const offset = offsetFor(direction, width, scale);
        const { card, textBox } = boxFor(point, offset, width);
        // A chip must never sit on a dot: neither its own nor a neighbour's,
        // because the dot would punch a hole through the name.
        if (dots.some((dot) => rectsOverlap(card, dot))) continue;
        let penalty = 0;
        for (const other of placed) {
          penalty += overlapArea(card, other.textBox) * 3;
          penalty += overlapArea(textBox, other.card) * 1.5;
          penalty += overlapArea(textBox, other.textBox) * 4;
        }
        if (penalty === 0) return { offset, card, textBox };
        // Remember the least bad option, and prefer the closer one on ties.
        const cost = penalty + scale * 0.5;
        if (cost < bestPenalty) {
          bestPenalty = cost;
          best = { offset, card, textBox };
        }
      }
    }
    return best;
  }

  // Lay every label out in one pass so nearby cities can move their names
  // apart instead of drawing on top of each other.
  function layoutLabels(entries) {
    const placed = [];
    const result = new Map();
    const dots = entries.map((entry) => dotBox(entry.point));
    entries.forEach((entry) => {
      const width = labelWidth(entry.name, entry.code);
      const spot = pickLabelOffset(entry.point, width, placed, dots);
      placed.push({ card: spot.card, textBox: spot.textBox });
      result.set(entry.id, { offset: spot.offset, width });
    });
    return result;
  }

  function leaderFor(offset, width) {
    const anchorX = Math.max(offset.dx, Math.min(0, offset.dx + width));
    const anchorY = Math.max(offset.dy, Math.min(0, offset.dy + LABEL_HEIGHT()));
    const distance = Math.hypot(anchorX, anchorY);
    if (distance < 13) return null;
    return svgEl('line', {
      x1: 0, y1: 0,
      x2: (anchorX * 0.86).toFixed(2), y2: (anchorY * 0.86).toFixed(2),
      class: 'label-leader'
    });
  }

  function makeMarker(place, layout) {
    const p = project(place.lon, place.lat);
    const g = svgEl('g', {
      class: `map-marker${place.kind === 'country' ? ' is-country' : ''}`,
      transform: `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`,
      'data-id': place.id,
      role: 'button',
      tabindex: '0',
      'aria-label': `${place.city || place.country}，${place.country}，${formatDate(place.date)}`
    });

    const hit = svgEl('circle', { cx: 0, cy: 0, r: MARKER_HIT, class: 'marker-hit' });
    const halo = svgEl('circle', { cx: 0, cy: 0, r: 5.06, class: 'marker-halo' });
    const ring = svgEl('circle', { cx: 0, cy: 0, r: DOT_RADIUS, class: 'marker-ring' });
    const core = place.kind === 'country'
      ? svgEl('rect', { x: -1.6, y: -1.6, width: 3.2, height: 3.2, rx: 0.55, class: 'marker-core' })
      : svgEl('circle', { cx: 0, cy: 0, r: CORE_RADIUS, class: 'marker-core' });

    const code = state.scope === 'china' ? '' : (place.code || '');
    const width = layout ? layout.width : labelWidth(place.city || place.country, code);
    const offset = layout ? layout.offset : offsetFor(LABEL_DIRECTIONS[0], width);
    const label = svgEl('g', {
      class: 'marker-label',
      transform: `translate(${offset.dx.toFixed(1)} ${offset.dy.toFixed(1)})`
    });
    const labelBg = svgEl('rect', {
      x: 0, y: 0, width, height: LABEL_HEIGHT(), rx: LABEL_RADIUS(),
      'vector-effect': 'non-scaling-stroke'
    });
    const labelText = svgEl('text', { x: LABEL_PAD_X(), y: 6.6 * labelScale });
    const nameSpan = svgEl('tspan');
    nameSpan.textContent = place.city || place.country;
    labelText.append(nameSpan);
    if (code) {
      const codeSpan = svgEl('tspan', { dx: CODE_GAP(), class: 'label-code' });
      codeSpan.textContent = code;
      labelText.append(codeSpan);
    }
    label.append(labelBg, labelText);

    const leader = leaderFor(offset, width);
    if (leader) g.append(leader);
    g.append(hit, halo, ring, core, label);
    return g;
  }

  function makeHomeMarker(home, layout) {
    const name = home.city || home.name || '家';
    const code = state.scope === 'china' ? '' : (home.code || '');
    const p = project(home.lon, home.lat);
    const g = svgEl('g', {
      class: 'map-marker is-home',
      transform: `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`,
      'data-id': 'home',
      role: 'button',
      tabindex: '0',
      'aria-label': `居住城市 ${name}`
    });
    const hit = svgEl('circle', { cx: 0, cy: 0, r: MARKER_HIT, class: 'marker-hit' });
    const ring = svgEl('circle', { cx: 0, cy: 0, r: DOT_RADIUS, class: 'marker-ring' });
    const core = svgEl('circle', { cx: 0, cy: 0, r: 1.35, class: 'marker-core' });
    // Same label treatment as every other city; only the dot keeps its own style.
    const width = layout ? layout.width : labelWidth(name, code);
    const offset = layout ? layout.offset : offsetFor(LABEL_DIRECTIONS[0], width);
    const label = svgEl('g', { class: 'marker-label is-home-label', transform: `translate(${offset.dx.toFixed(1)} ${offset.dy.toFixed(1)})` });
    const labelBg = svgEl('rect', { x: 0, y: 0, width, height: LABEL_HEIGHT(), rx: LABEL_RADIUS(), 'vector-effect': 'non-scaling-stroke' });
    const labelText = svgEl('text', { x: LABEL_PAD_X(), y: 6.6 * labelScale });
    const nameSpan = svgEl('tspan');
    nameSpan.textContent = name;
    labelText.append(nameSpan);
    if (code) {
      const codeSpan = svgEl('tspan', { dx: CODE_GAP(), class: 'label-code' });
      codeSpan.textContent = code;
      labelText.append(codeSpan);
    }
    label.append(labelBg, labelText);
    const leader = leaderFor(offset, width);
    if (leader) g.append(leader);
    g.append(hit, ring, core, label);
    return g;
  }

  function renderMap() {
    invalidateMapViewport();
    const places = sortedPlaces();
    // 国内地图的城市名整体放大 15%；分享图再额外放大 25%；
    // 手机屏幕小，再乘一档专属比例（分享图不受影响，它有自己的排版尺寸）
    const phoneBoost = shareLabelScale === 1 && isPhoneMap() ? LABEL_SCALE_PHONE : 1;
    labelScale = (state.scope === 'china' ? LABEL_SCALE_CHINA : 1) * shareLabelScale * phoneBoost;
    mapSvg.style.setProperty('--label-font', `${(LABEL_FONT_BASE * labelScale).toFixed(3)}px`);
    mapSvg.style.setProperty('--label-code-font', `${(LABEL_CODE_FONT_BASE * labelScale).toFixed(3)}px`);
    const routeFrag = document.createDocumentFragment();
    buildRoutes(places).forEach((leg) => {
      const from = leg.from;
      const to = leg.to;
      const d = leg.geometry.d;
      const tripId = to.tripId || '__legacy';
      const isActive = state.activeTripId ? state.activeTripId === tripId : Boolean(to.id === state.selectedId || from.id === state.selectedId);
      const group = svgEl('g', {
        class: `route-segment${from.kind === 'home' ? ' is-home-leg' : ''}${isActive ? ' is-active' : ''}`,
        'data-from': from.id,
        'data-to': to.id,
        'data-trip': tripId
      });
      const glow = svgEl('path', { d, class: 'route-glow' });
      const line = svgEl('path', { d, class: 'route-line' });
      group.append(glow, line);
      routeFrag.append(group);
    });
    mapRoutes.replaceChildren(routeFrag);

    const markerFrag = document.createDocumentFragment();
    const departure = departurePlace();
    const entries = places.map((place) => ({
      id: place.id,
      name: place.city || place.country,
      code: state.scope === 'china' ? '' : (place.code || ''),
      point: project(place.lon, place.lat)
    }));
    if (departure) {
      entries.push({
        id: 'home',
        name: departure.city || '家',
        code: state.scope === 'china' ? '' : (departure.code || ''),
        point: project(departure.lon, departure.lat)
      });
    }
    const layout = layoutLabels(entries);
    places.forEach((place) => markerFrag.append(makeMarker(place, layout.get(place.id))));
    if (departure) markerFrag.append(makeHomeMarker(departure, layout.get('home')));
    mapMarkers.replaceChildren(markerFrag);
    updateMapSelection();
  }

  function updateMapSelection() {
    const selected = state.selectedId;
    $$('.map-marker', mapMarkers).forEach((marker) => {
      marker.classList.toggle('is-selected', marker.dataset.id === selected);
    });
    const segments = $$('.route-segment', mapRoutes);
    const hasSelection = Boolean(selected || state.activeTripId);
    mapRoutes.classList.toggle('has-selection', hasSelection);
    segments.forEach((segment) => {
      const sameTrip = state.activeTripId && segment.dataset.trip === state.activeTripId;
      const touchesSelection = segment.dataset.from === selected || segment.dataset.to === selected;
      segment.classList.toggle('is-active', Boolean(hasSelection && (sameTrip || touchesSelection)));
      // Every leg of the picked city's trip turns mint, including the one that
      // leaves home. Picking the home dot itself leaves all legs alone.
      const hot = Boolean(selected && selected !== 'home' && sameTrip);
      segment.classList.toggle('is-hot', hot);
    });
  }

  // 手势期间每帧最多重绘一次，并且用缓动追上手指的目标位置：
  // 即使 pointermove 有快有慢，画面也是一条平滑的轨迹。
  let easingFrame = 0;
  let mapTarget = null;

  function setMapTarget(tx, ty, k) {
    mapTarget = { tx, ty, k };
    if (!easingFrame) easingFrame = requestAnimationFrame(stepMapEasing);
  }

  function cancelMapEasing() {
    mapTarget = null;
    if (easingFrame) {
      cancelAnimationFrame(easingFrame);
      easingFrame = 0;
    }
  }

  function stepMapEasing() {
    easingFrame = 0;
    if (!mapTarget) return;
    const ease = 0.42;
    const { tx, ty, k } = state.map;
    const nextK = k + (mapTarget.k - k) * ease;
    const nextTx = tx + (mapTarget.tx - tx) * ease;
    const nextTy = ty + (mapTarget.ty - ty) * ease;
    const settledK = Math.abs(mapTarget.k - nextK) < 0.0004;
    const settled = settledK
      && Math.abs(mapTarget.tx - nextTx) < 0.35
      && Math.abs(mapTarget.ty - nextTy) < 0.35;
    if (settled) {
      state.map = { k: mapTarget.k, tx: mapTarget.tx, ty: mapTarget.ty };
    } else {
      state.map = { k: nextK, tx: nextTx, ty: nextTy };
    }
    clampMap();
    applyMapTransform();
    if (settled) {
      mapTarget = null;
      return;
    }
    easingFrame = requestAnimationFrame(stepMapEasing);
  }

  function flushMapTransform() {
    cancelMapEasing();
    applyMapTransform();
  }

  // 380–430px 宽的手机上，初次取景时 s×k 约 0.71，城市名就是按那个屏幕尺寸定的；
  // 记住这个基准，让名字在任何取景比例下都保持同样大小。
  const LABEL_PHONE_SCREEN_REF = 0.713;

  function applyMapTransform() {
    const { k, tx, ty } = state.map;
    // 用 CSS transform 而不是 SVG 的 transform 属性：属性变换没法过渡，CSS 变换可以，
    // 而且和 getScreenCTM() 的换算结果逐像素一致（transform-box: view-box + origin 0 0）。
    mapContent.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${k.toFixed(4)})`;
    // 城市名不随放大无限变大：默认视角完全不变，放得越大标签越接近原本的屏幕尺寸；
    // 手机上再按当前取景比例归一，免得行程铺得开、地图缩得小时名字被压得太小。
    const fitK = state.baseK || k;
    let counter = k > fitK ? fitK / k : 1;
    if (isPhoneMap()) {
      const vp = mapViewport();
      const viewScale = vp ? vp.s : 1;
      counter = Math.min(counter, LABEL_PHONE_SCREEN_REF / (viewScale * k));
    }
    counter = Math.max(0.3, Math.min(1, counter));
    // 这个变量一变，所有城市名都要重新算样式；只在数值真的变了才写。
    const counterText = counter.toFixed(3);
    if (counterText !== labelCounterWritten) {
      labelCounterWritten = counterText;
      mapContent.style.setProperty('--label-counter', counterText);
    }
    updateBorderVisibility();
  }

  let labelCounterWritten = '';

  // Bounding box of the land currently drawn, in map coordinates. Anything
  // outside the 1440x900 viewBox is clipped, so it is trimmed here too.
  // 陆地包围盒只在地图重建时才会变，缓存起来避免每次缩放都跑 getBBox
  // （世界地图的陆地路径很大，getBBox 在缩放时是主要卡顿来源之一）
  let landBoxCache = null;

  function currentLandBox() {
    if (landBoxCache) return landBoxCache;
    const node = mapLand.querySelector('.land-coast');
    if (!node) return { minX: 0, minY: 0, maxX: 1440, maxY: 900 };
    const box = node.getBBox();
    landBoxCache = {
      minX: Math.max(0, box.x),
      minY: Math.max(0, box.y),
      maxX: Math.min(1440, box.x + box.width),
      maxY: Math.min(900, box.y + box.height)
    };
    return landBoxCache;
  }

  // The map uses preserveAspectRatio="slice", so the viewBox is scaled to cover
  // the element and the overflow is cropped. Derive that transform straight
  // from the element box: it is always in sync with the current layout.
  // 视口尺寸只在窗口大小变化时才变，缓存下来可以省掉每帧的强制布局。
  let viewportCache = null;

  function invalidateMapViewport() { viewportCache = null; }

  function mapViewport() {
    if (viewportCache) return viewportCache;
    // 用布局尺寸（clientWidth/Height），旋转 90° 后 getBoundingClientRect 会把宽高对调
    const width = mapSvg.clientWidth || mapSvg.getBoundingClientRect().width;
    const height = mapSvg.clientHeight || mapSvg.getBoundingClientRect().height;
    if (!width || !height) return null;
    const s = Math.max(width / 1440, height / 900);
    viewportCache = {
      rect: { left: 0, top: 0, width, height, right: width, bottom: height },
      s,
      e: (width - 1440 * s) / 2,
      f: (height - 900 * s) / 2
    };
    return viewportCache;
  }

  // Which part of the 1440x900 viewBox is actually on screen.
  function visibleViewBox() {
    const vp = mapViewport();
    if (!vp) return { x0: 0, y0: 0, x1: 1440, y1: 900 };
    return {
      x0: (vp.rect.left - vp.e) / vp.s,
      y0: (vp.rect.top - vp.f) / vp.s,
      x1: (vp.rect.right - vp.e) / vp.s,
      y1: (vp.rect.bottom - vp.f) / vp.s
    };
  }

  // Zoom out until the whole map of the current scope fits, and centre it in
  // the area that is not covered by the sidebar or the detail panel.
  // 当前布局里真正会遮挡地图的 UI：抽屉式侧栏、右侧记录卡片。
  function mapSafeArea() {
    const vp = mapViewport();
    if (!vp) return null;
    const { rect } = vp;
    const drawer = window.matchMedia('(max-width: 980px)').matches;
    const sidebar = document.getElementById('sidebar');
    const panel = document.getElementById('memoryPanel');
    const sidebarOpen = Boolean(sidebar && sidebar.classList.contains('is-open'));
    const panelVisible = Boolean(panel && !panel.classList.contains('is-hidden'));

    const gap = 14;
    let left = rect.left + gap;
    let right = rect.right - gap;
    const top = rect.top + (drawer ? 66 : 100);
    const bottom = rect.bottom - (drawer ? 20 : 74);

    if (!drawer) left = rect.left + 344;
    else if (sidebarOpen) left = rect.left + (sidebar?.offsetWidth || 268) + 16;

    if (panelVisible && !drawer) {
      const panelWidth = panel.offsetWidth || 374;
      right = rect.right - panelWidth - 40;
    }
    return { left, right, top, bottom };
  }

  function wholeMapFrame() {
    const box = currentLandBox();
    const vp = mapViewport();
    if (!vp) return { k: 0.8, tx: 0, ty: 0 };
    const { rect, s, e, f } = vp;
    const safe = mapSafeArea() || {
      left: rect.left + 14, right: rect.right - 14, top: rect.top + 72, bottom: rect.bottom - 74
    };
    const usableW = Math.max(180, safe.right - safe.left);
    const usableH = Math.max(160, safe.bottom - safe.top);
    const k = clamp(Math.min(usableW / (box.maxX - box.minX), usableH / (box.maxY - box.minY)) / s, 0.24, 1.6);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const tx = ((safe.left + safe.right) / 2 - e) / s - cx * k;
    const ty = ((safe.top + safe.bottom) / 2 - f) / s - cy * k;
    return { k, tx, ty };
  }

  function frameWholeMap(animate = false) {
    const frame = wholeMapFrame();
    state.baseK = frame.k;
    state.map = { k: frame.k, tx: frame.tx, ty: frame.ty };
    if (animate) {
      mapContent.style.transition = 'transform 0.6s cubic-bezier(.2,.75,.25,1)';
      applyMapTransform();
      setTimeout(() => { mapContent.style.transition = ''; }, 650);
    } else {
      applyMapTransform();
    }
  }

  // Keep at least a slice of the map on screen while panning and zooming.
  function clampMap() {
    const { k } = state.map;
    const box = currentLandBox();
    const view = visibleViewBox();
    const margin = 200;
    const minTx = view.x0 + margin - box.maxX * k;
    const maxTx = view.x1 - margin - box.minX * k;
    const minTy = view.y0 + margin - box.maxY * k;
    const maxTy = view.y1 - margin - box.minY * k;
    if (minTx <= maxTx) state.map.tx = clamp(state.map.tx, minTx, maxTx);
    if (minTy <= maxTy) state.map.ty = clamp(state.map.ty, minTy, maxTy);
  }

  function fitRoute(animate = false) {
    cancelMapEasing();
    const places = sortedPlaces();
    if (!places.length) {
      // Nothing recorded yet: show the whole base map of the current scope.
      frameWholeMap();
      return;
    }
    const points = places.map((p) => project(p.lon, p.lat));
    const home = departurePlace();
    if (home) points.push(project(home.lon, home.lat));
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const spanX = Math.max(50, maxX - minX);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const vp = mapViewport();
    const safe = mapSafeArea();
    let k;
    let tx;
    let ty;
    if (vp && safe) {
      const { s, e, f } = vp;
      const usableW = Math.max(200, safe.right - safe.left);
      const usableH = Math.max(150, safe.bottom - safe.top);
      const spanY = Math.max(40, maxY - minY);
      k = clamp(Math.min(usableW / (spanX + 70), usableH / (spanY + 60)) / s, 0.42, 1.6);
      // 让轨迹中心落在安全区中心
      tx = ((safe.left + safe.right) / 2 - e) / s - cx * k;
      ty = ((safe.top + safe.bottom) / 2 - f) / s - cy * k;
      if (window.innerWidth > 760) {
        // 桌面上保持原来略微偏上的取景习惯
        ty = 460 - cy * k;
      }
    } else {
      k = clamp(360 / (spanX + 35), 0.42, 0.78);
      tx = 720 - cx * k;
      ty = 430 - cy * k;
    }
    state.map = { k, tx, ty };
    // 省界出现的比例以「默认取景」为基准，而不是整幅地图
    state.baseK = k;
    clampMap();
    applyMapTransform();
    if (animate) {
      mapContent.style.transition = 'transform 0.65s cubic-bezier(.2,.75,.25,1)';
      setTimeout(() => { mapContent.style.transition = ''; }, 700);
    }
  }

  // 缩放期间临时降级渲染：去掉滤镜、点阵、城市名，停止 220ms 后恢复
  let zoomBoostTimer = 0;

  function beginZoomBoost() {
    mapSvg.classList.add('is-zooming');
    clearTimeout(zoomBoostTimer);
    zoomBoostTimer = setTimeout(() => {
      mapSvg.classList.remove('is-zooming');
    }, 420);
  }

  function zoomMapAt(screenX, screenY, factor, defer = false) {
    const old = state.map;
    const newK = clamp(old.k * factor, 0.72, 3.2);
    const wx = (screenX - old.tx) / old.k;
    const wy = (screenY - old.ty) / old.k;
    state.map = {
      k: newK,
      tx: screenX - wx * newK,
      ty: screenY - wy * newK
    };
    clampMap();
    if (defer) cancelMapEasing();
    beginZoomBoost();
    applyMapTransform();
    state.mapMoved = true;
  }

  let suppressMapClick = false;
  let drag = null;
  let pinch = null;

  function eventToViewBox(event) {
    const point = mapSvg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = mapSvg.getScreenCTM();
    return ctm ? point.matrixTransform(ctm.inverse()) : { x: 720, y: 450 };
  }

  // 正在按下的手指/指针，双指时用来算缩放比例
  const activePointers = new Map();
  // 拖动增益：1 = 完全跟手；小于 1 会让地图移动得更慢、更稳
  const DRAG_GAIN = 0.7;

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

  // 屏幕位移 → 地图坐标位移。
  // 界面被旋转 90° 时，屏幕方向与地图方向不同：先反解旋转，再换算成地图单位。
  function dragDelta(fromX, fromY, toX, toY) {
    let dx = toX - fromX;
    let dy = toY - fromY;
    const app = document.getElementById('app');
    const transform = app ? getComputedStyle(app).transform : 'none';
    if (transform && transform !== 'none') {
      try {
        const matrix = new DOMMatrixReadOnly(transform).inverse();
        // w=0 表示只做方向/缩放变换，忽略平移
        const point = matrix.transformPoint(new DOMPoint(dx, dy, 0, 0));
        dx = point.x;
        dy = point.y;
      } catch (error) { /* 保持原值 */ }
    }
    const viewBox = mapSvg.viewBox.baseVal;
    const scaleX = viewBox.width / (mapSvg.clientWidth || 1);
    const scaleY = viewBox.height / (mapSvg.clientHeight || 1);
    const factor = Math.max(scaleX, scaleY);
    return { x: dx * factor, y: dy * factor };
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
    // 滚轮：把一帧内的多次滚动合并成一次缩放，避免高频重绘
    let wheelFactor = 1;
    let wheelRaf = 0;
    let wheelPoint = null;

    mapSvg.addEventListener('wheel', (event) => {
      event.preventDefault();
      wheelFactor *= event.deltaY < 0 ? 1.09 : 0.917;
      wheelPoint = eventToViewBox(event);
      beginZoomBoost();
      if (wheelRaf) return;
      wheelRaf = requestAnimationFrame(() => {
        wheelRaf = 0;
        const factor = wheelFactor;
        wheelFactor = 1;
        if (wheelPoint) zoomMapAt(wheelPoint.x, wheelPoint.y, factor);
      });
    }, { passive: false });

    mapSvg.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // 第二根手指按下：进入双指缩放，取消拖动
      if (activePointers.size === 2) {
        drag = null;
        mapSvg.classList.remove('is-dragging');
        pinch = { distance: pointerDistance(), centre: pointerCentre() };
        mapSvg.classList.add('is-pinching', 'is-gesturing');
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
      mapSvg.classList.add('is-gesturing');
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
          const base = mapTarget || state.map;
          const nextK = clamp(base.k * ratio, 0.72, 3.2);
          const scaleRatio = nextK / base.k;
          const anchorX = base.tx + local.x * base.k;
          const anchorY = base.ty + local.y * base.k;
          setMapTarget(anchorX - local.x * nextK, anchorY - local.y * nextK, nextK);
          pinch.distance = distance;
          state.mapMoved = true;
        }
        // 两指整体移动时拖动地图（同样按地图坐标系换算）
        if (pinch.centre) {
          const delta = dragDelta(pinch.centre.x, pinch.centre.y, centre.x, centre.y);
          if (Math.abs(delta.x) > 0.2 || Math.abs(delta.y) > 0.2) {
            const base = mapTarget || state.map;
            setMapTarget(base.tx + delta.x * DRAG_GAIN, base.ty + delta.y * DRAG_GAIN, base.k);
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
      // 把「起点 → 当前点」的屏幕位移映射回地图坐标，旋转后方向依然跟手
      const delta = dragDelta(drag.startX, drag.startY, event.clientX, event.clientY);
      // DRAG_GAIN < 1：地图移动得比手指慢一点，拖起来更稳更从容
      setMapTarget(
        drag.tx + delta.x * DRAG_GAIN,
        drag.ty + delta.y * DRAG_GAIN,
        state.map.k
      );
    });

    const endPointer = (event) => {
      activePointers.delete(event.pointerId);
      if (activePointers.size === 0) {
        mapSvg.classList.remove('is-gesturing', 'is-pinching', 'is-dragging');
        flushMapTransform();
      }
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
    });

    mapSvg.addEventListener('click', (event) => {
      if (suppressMapClick) return;
      const marker = event.target.closest('.map-marker');
      if (marker) selectPlace(marker.dataset.id, { openPanel: true, closeSidebar: true });
    });

    mapSvg.addEventListener('keydown', (event) => {
      const marker = event.target.closest?.('.map-marker');
      if (marker) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectPlace(marker.dataset.id, { openPanel: true, closeSidebar: true });
        }
        return;
      }
    });

    mapSvg.addEventListener('dblclick', (event) => {
      if (event.target.closest('.map-marker')) return;
      const point = eventToViewBox(event);
      zoomMapAt(point.x, point.y, 1.35);
    });
  }

  /* --------------------------------------------------------------- Sidebar */
  /* ------------------------------------------------------- Trip edit / delete */
  function setTripEditing(on) {
    const next = Boolean(on);
    if (next && !routeGroups(sortedPlaces()).length) return;
    state.tripEditing = next;
    state.tripSelection.clear();
    const button = $('#tripEditBtn');
    if (button) button.setAttribute('aria-pressed', next ? 'true' : 'false');
    renderSidebar();
  }

  function toggleTripSelection(tripId) {
    if (!state.tripEditing) return;
    if (state.tripSelection.has(tripId)) state.tripSelection.delete(tripId);
    else state.tripSelection.add(tripId);
    renderSidebar();
  }

  function renderTripEditBar(tripCount) {
    const bar = $('#tripEditBar');
    if (!bar) return;
    bar.hidden = !state.tripEditing;
    const count = state.tripSelection.size;
    $('#tripEditCount').textContent = count ? `已选 ${count} 段` : '选择要删除的轨迹';
    $('#tripDeleteSelected').disabled = count === 0;
    $('#tripSelectAll').textContent = count === tripCount && tripCount > 0 ? '取消全选' : '全选';
    const editButton = $('#tripEditBtn');
    if (editButton) editButton.hidden = tripCount === 0 && !state.tripEditing;
  }

  async function deleteSelectedTrips() {
    if (!state.tripSelection.size) return;
    const chosen = new Set(state.tripSelection);
    const victims = state.places.filter((place) => chosen.has(place.tripId || '__legacy'));
    if (!victims.length) return;
    const cityNames = victims.map((place) => place.city || place.country);
    const preview = cityNames.slice(0, 4).join('、') + (cityNames.length > 4 ? ' 等' : '');
    const confirmed = await askConfirm({
      title: `删除这 ${chosen.size} 段轨迹？`,
      text: `${preview}共 ${victims.length} 座城市，连同影像与手记一起从本机移除，此操作无法撤销。`,
      okText: '确认删除'
    });
    if (!confirmed) return;

    for (const place of victims) {
      for (const item of place.media || []) {
        revokeUrl(item.src);
        if (item.poster?.startsWith('blob:')) revokeUrl(item.poster);
        await removeBlob(item.storageKey);
        if (item.thumbKey) await removeBlob(item.thumbKey);
      }
    }
    const removedIds = new Set(victims.map((place) => place.id));
    state.places = state.places.filter((place) => !removedIds.has(place.id));
    if (removedIds.has(state.selectedId)) {
      const remaining = sortedPlaces();
      state.selectedId = remaining[0]?.id || null;
    }
    if (!state.places.some((place) => (place.tripId || '__legacy') === state.activeTripId)) {
      state.activeTripId = null;
    }
    state.tripSelection.clear();
    state.tripEditing = false;
    const button = $('#tripEditBtn');
    if (button) button.setAttribute('aria-pressed', 'false');
    savePlaces();
    try {
      if (state.selectedId) localStorage.setItem(SELECT_KEY, state.selectedId);
      else localStorage.removeItem(SELECT_KEY);
    } catch (error) { /* ignore */ }
    renderAll({ rebuildMap: true, fit: true });
    showToast(`已删除 ${chosen.size} 段轨迹`);
  }

  function renderSidebar() {
    const list = $('#placeList');

    const places = sortedPlaces();
    const meta = scopeMeta();
    const frag = document.createDocumentFragment();
    if (!places.length) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="journey-empty">
          <span class="empty-orbit"><svg><use href="#i-compass"></use></svg></span>
          <strong>${meta.cn ? '国内地图等你落下第一笔' : '世界地图等你落下第一笔'}</strong>
          <p>从下方「添加一段新足迹」开始，<br>这里只会记录${meta.cn ? '中国' : '中国以外'}的城市。</p>
        </div>`;
      frag.append(li);
    }
    // One card per trip: everything the visitor saved in a single go stays
    // boxed together, so separate journeys never blur into one long list.
    const trips = routeGroups(places);
    trips.forEach((group, index) => {
      const tripId = group[0].tripId || '__legacy';
      const isActiveTrip = state.activeTripId === tripId;
      const starts = group.map(placeStart).filter(Boolean).sort();
      const ends = group.map(placeEnd).filter(Boolean).sort();
      // The card header only needs the year and month of the trip.
      const stamp = starts.length ? formatMonthSpan(starts[0], ends[ends.length - 1] || starts[0]) : '未标日期';
      const span = '';
      const rangeLabel = starts.length ? formatRange(starts[0], ends[ends.length - 1] || starts[0]) : '';
      const cities = group.map((place) => escapeHtml(place.city || place.country));

      const editing = state.tripEditing;
      const checked = editing && state.tripSelection.has(tripId);

      const li = document.createElement('li');
      li.className = `trip-card${isActiveTrip && !editing ? ' is-active' : ''}${editing ? ' is-selectable' : ''}${checked ? ' is-checked' : ''}`;
      li.dataset.trip = tripId;

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'trip-card-head';
      head.setAttribute('aria-label', editing
        ? `第 ${index + 1} 段轨迹，${group.length} 座城市，${checked ? '已选中，点击取消' : '点击选中以便删除'}`
        : `第 ${index + 1} 段轨迹，${group.length} 座城市，点击高亮这段轨迹`);
      if (editing) head.setAttribute('aria-pressed', checked ? 'true' : 'false');
      const check = editing
        ? '<span class="trip-check"><svg><use href="#i-check"></use></svg></span>'
        : '';
      head.innerHTML = `
        ${check}
        <span class="trip-card-label"><b>第 ${pad2(index + 1)} 段</b><i>${escapeHtml(stamp)}${escapeHtml(span)}</i></span>
        <span class="trip-card-count">${group.length} 座</span>
      `;
      head.addEventListener('click', () => {
        if (state.tripEditing) { toggleTripSelection(tripId); return; }
        selectTrip(tripId, { focusFirst: true, openPanel: true });
      });

      const list = document.createElement('ol');
      list.className = 'trip-card-list';
      group.forEach((place) => {
        const item = document.createElement('li');
        const active = place.id === state.selectedId;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `place-item${active ? ' is-active' : ''}`;
        button.dataset.id = place.id;
        button.setAttribute('aria-current', active ? 'true' : 'false');
        const periods = placePeriods(place);
        const rangeText = placeRangeText(place);
        const shortOf = (iso) => {
          const parts = String(iso).split('-');
          return parts.length === 3 ? `${parts[1]}.${parts[2]}` : String(iso);
        };
        const dateLines = periods.map((item) => (item.end && item.end !== item.start
          ? `${shortOf(item.start)}–${shortOf(item.end)}`
          : shortOf(item.start)));
        button.setAttribute('aria-label', state.scope === 'china'
          ? `${place.city || place.country}，${rangeText}`
          : `${place.city || place.country}，${place.country}，${rangeText}`);
        // Domestic entries skip the CN tag and the redundant 「中国 ·」 prefix.
        const showCode = state.scope !== 'china' && place.code;
        const kindText = place.kind === 'country' ? '国家足迹' : (state.scope === 'china' ? '' : place.country);
        const subline = kindText ? escapeHtml(kindText) : '';
        button.innerHTML = `
          <span class="place-date">${dateLines.map((line) => `<span class="date-line">${escapeHtml(line)}</span>`).join('')}</span>
          <span class="place-main">
            <strong>${escapeHtml(place.city || place.country)}${showCode ? `<b>${escapeHtml(place.code)}</b>` : ''}</strong>
            ${subline ? `<small>${subline}</small>` : ''}
          </span>
          <span class="place-thumb"><img src="${escapeHtml(coverFor(place))}" alt="" loading="lazy"></span>
        `;
        button.addEventListener('click', () => {
          if (state.tripEditing) { toggleTripSelection(tripId); return; }
          selectPlace(place.id, { openPanel: true, closeSidebar: true });
        });
        item.append(button);
        list.append(item);
      });

      li.append(head, list);
      li.title = `${rangeLabel} · ${cities.join(' · ')}`;
      frag.append(li);
    });
    list.replaceChildren(frag);


    const tripCount = routeGroups(places).length;
    const countryCount = new Set(places.map((p) => p.country)).size;
    const cityCount = new Set(places.map((p) => `${p.code}|${p.city || p.country}`)).size;
    $('#statTrips').textContent = pad2(tripCount);
    // The domestic map has no countries, so that slot is hidden there.
    const countrySlot = $('#statCountrySlot');
    if (countrySlot) countrySlot.hidden = meta.cn;
    $('#statCountries').textContent = pad2(countryCount);
    $('#statCities').textContent = pad2(cityCount);
    $('#introScope').textContent = meta.place;
    renderHomeBlock();

    const years = places.map((p) => String(p.date).slice(0, 4)).filter(Boolean).sort();
    const range = years.length ? (years[0] === years[years.length - 1] ? years[0] : `${years[0]} — ${years[years.length - 1]}`) : '尚未出发';
    $('#yearRange').textContent = range;
    $('#profileMeta').textContent = years.length ? `自 ${years[0]} 年 · 一直在路上` : '本机保存 · 随时继续';

    renderTripEditBar(trips.length);

    const selectedItem = list.querySelector('.is-active');
    if (selectedItem && !state.tripEditing) selectedItem.scrollIntoView({ block: 'nearest' });
  }

  /* --------------------------------------------------------------- Detail panel */
  // The card keeps the city's own landmark image; uploaded photos and videos
  // live in the 影像记忆 grid and never take the cover over.
  function coverFor(place) {
    if (place.cover) {
      const own = resolveAsset(place.cover);
      if (own && own !== resolveAsset(DEFAULT_COVER)) return own;
      if (own && !landmarkFor(place)) return own;
    }
    return landmarkFor(place) || resolveAsset(DEFAULT_COVER);
  }

  function homePlaceForDetail() {
    const departure = departurePlace();
    if (!departure) return null;
    const isOrigin = departure.kind === 'origin';
    return {
      id: 'home',
      kind: departure.kind,
      city: departure.city,
      en: departure.en,
      country: departure.country,
      countryEn: countryEnglish(departure.country),
      code: departure.code,
      lat: departure.lat,
      lon: departure.lon,
      date: '',
      note: isOrigin ? '国际旅行的默认出发点。' : '居住城市。每一段旅行都从这里出发。',
      cover: '',
      media: []
    };
  }

  function renderDetail() {
    const place = selectedPlace();
    if (!place) {
      $('#memoryPanel').classList.add('is-hidden');
      $('#reopenMemory').hidden = true;
      $('#mapCoordinate').textContent = scopeMeta().cn ? '等待第一段国内足迹' : '等待第一段国际足迹';
      return;
    }
    const isHome = place.kind === 'home' || place.kind === 'origin';
    $('#memoryPanel').classList.remove('is-hidden');
    $('#reopenMemory').hidden = true;
    $('#detailCover').src = coverFor(place);
    $('#detailCover').alt = `${place.city || place.country} 旅行封面`;
    $('#detailDate').textContent = isHome ? '居住城市' : placeRangeText(place);
    $('#detailCode').textContent = place.code || '—';
    $('#detailCountry').textContent = place.country;
    const placeEn = (place.en || place.city || place.country).toUpperCase();
    const countryEn = (place.countryEn || place.country).toUpperCase();
    $('#detailCity').textContent = place.city || place.country;
    $('#detailCityEn').textContent = isHome ? 'HOME' : (place.kind === 'country' ? 'COUNTRY' : placeEn);
    $('#detailEn').textContent = isHome ? countryEn : (place.kind === 'country' ? countryEn : `${placeEn}, ${countryEn}`);

    const places = sortedPlaces();
    const index = places.findIndex((p) => p.id === place.id);
    if (isHome) {
      $('#detailStation').textContent = '轨迹起点';
      $('#detailDistance').textContent = '—';
      $('#detailDistanceLabel').textContent = 'HOME';
      $('#stationIndicator').textContent = `${pad2(places.length)} 站`;
      $('#prevPlace').disabled = true;
      $('#nextPlace').disabled = true;
    } else {
      $('#detailStation').textContent = place.kind === 'country' ? '国家足迹' : `第 ${pad2(index + 1)} 站`;
      if (index > 0) {
        const previous = places[index - 1];
        const sameTrip = (previous.tripId || '__legacy') === (place.tripId || '__legacy');
        const home = departurePlace();
        if (!sameTrip && home) {
          // A new trip starts from the departure point, so that is the leg drawn.
          $('#detailDistance').textContent = formatNumber(haversine(home, place));
          $('#detailDistanceLabel').textContent = `KM 从${home.city}出发`;
        } else {
          $('#detailDistance').textContent = formatNumber(haversine(previous, place));
          $('#detailDistanceLabel').textContent = 'KM 距上一站';
        }
      } else {
        const home = departurePlace();
        if (home) {
          $('#detailDistance').textContent = formatNumber(haversine(home, place));
          $('#detailDistanceLabel').textContent = `KM 从${home.city}出发`;
        } else {
          $('#detailDistance').textContent = '起点';
          $('#detailDistanceLabel').textContent = 'ORIGIN';
        }
      }
      $('#stationIndicator').textContent = `${pad2(index + 1)} / ${pad2(places.length)}`;
      $('#prevPlace').disabled = index <= 0;
      $('#nextPlace').disabled = index >= places.length - 1;
    }
    $('#detailMediaCount').textContent = pad2(place.media.length);
    $('#noteDisplay').textContent = place.note || '这一天的风，还没有被写下来。';
    $('#noteEditor').value = place.note || '';
    stopNoteEditing(false);
    renderMediaGrid(place);
    updateCoordinate(place);
    $('#reopenText').textContent = isHome ? `打开${place.city}（居住城市）` : `打开${place.city || place.country}的记忆`;
    $('#albumCity').textContent = place.city || place.country;
    $('#albumDate').textContent = isHome ? `${place.city} · 居住城市` : `${formatDate(place.date)} · ${englishPlace(place)}`;
    $('#detailMediaCount').setAttribute('aria-label', `${place.media.length} 段记忆`);
    if (place.media.length) $('#detailMediaCount').textContent = place.media.length < 10 ? `0${place.media.length}` : place.media.length;
    $('#memoryPanel').classList.toggle('is-home', isHome);
  }

  function updateCoordinate(place) {
    $('#mapCoordinate').textContent = formatCoord(place.lat, place.lon);
  }

  function mediaSubtitle(place) {
    const images = place.media.filter((m) => m.type === 'image').length;
    const videos = place.media.filter((m) => m.type === 'video').length;
    const parts = [];
    if (images) parts.push(`${images} 张照片`);
    if (videos) parts.push(`${videos} 段视频`);
    return parts.join(' · ');
  }

  function mediaSource(item) {
    return item.thumbUrl || item.src || '';
  }

  function createMediaVisual(item) {
    if (item.type === 'video') {
      if (item.poster) {
        const img = document.createElement('img');
        img.src = item.poster;
        img.alt = item.caption || '旅行视频';
        img.loading = 'lazy';
        img.decoding = 'async';
        return img;
      }
      const vid = document.createElement('video');
      vid.src = item.src;
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      return vid;
    }
    const img = document.createElement('img');
    img.src = mediaSource(item);
    img.alt = item.caption || '旅行照片';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  function renderMediaGrid(place) {
    const grid = $('#mediaGrid');
    const frag = document.createDocumentFragment();
    $('#mediaSub').textContent = mediaSubtitle(place);
    const editBtn = $('#editMediaBtn');
    if (editBtn) editBtn.hidden = !place.media.length;

    if (!place.media.length) {
      const empty = document.createElement('div');
      empty.className = 'media-empty';
      empty.innerHTML = '<svg><use href="#i-image"></use></svg><span>还没有影像，留住这一刻吧</span>';
      frag.append(empty);
      grid.className = 'media-grid count-0';
      grid.replaceChildren(frag);
      return;
    }

    const visible = place.media.slice(0, 4);
    grid.className = `media-grid count-${visible.length}`;
    visible.forEach((item, index) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'media-tile';
      tile.setAttribute('aria-label', `${item.caption || '旅行影像'}，打开`);
      tile.append(createMediaVisual(item));
      if (item.type === 'video') {
        const play = document.createElement('span');
        play.className = 'media-play';
        play.innerHTML = '<svg><use href="#i-play"></use></svg>';
        tile.append(play);
      }
      const caption = document.createElement('span');
      caption.className = 'media-tile-caption';
      caption.textContent = item.caption || '';
      tile.append(caption);

      if (index === 3 && place.media.length > 4) {
        const more = document.createElement('span');
        more.className = 'media-more';
        more.textContent = `+${place.media.length - 3}`;
        tile.append(more);
        tile.addEventListener('click', () => openAlbum());
      } else {
        tile.addEventListener('click', () => openLightbox(index));
      }
      frag.append(tile);
    });
    grid.replaceChildren(frag);
  }

  // Highlight one trip from its sidebar card: the card lights up and the map
  // dims the other journeys.
  function selectTrip(tripId, options = {}) {
    if (!tripId) return;
    const places = sortedPlaces().filter((place) => (place.tripId || '__legacy') === tripId);
    if (!places.length) return;
    const focus = options.focusFirst ? places[0] : null;
    state.activeTripId = tripId;
    if (focus) {
      state.selectedId = focus.id;
      try { localStorage.setItem(SELECT_KEY, focus.id); } catch (error) { /* storage may be blocked */ }
      renderDetail();
      if (options.openPanel === true) {
        $('#memoryPanel').classList.remove('is-hidden');
        $('#reopenMemory').hidden = true;
      }
    }
    renderSidebar();
    renderMap();
    updateMapSelection();
    const card = document.querySelector(`.trip-card[data-trip="${tripId}"]`);
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function selectPlace(id, options = {}) {
    if (id === 'home') {
      if (!departurePlace()) return;
      if (state.noteEditing) stopNoteEditing(true);
      state.selectedId = 'home';
      renderSidebar();
      renderDetail();
      updateMapSelection();
      if (options.openPanel !== false) {
        $('#memoryPanel').classList.remove('is-hidden');
        $('#reopenMemory').hidden = true;
      }
      if (options.closeSidebar && window.innerWidth <= 980) closeSidebar();
      return;
    }
    const place = state.places.find((p) => p.id === id);
    if (!place || !inScope(place)) return;
    if (state.noteEditing) stopNoteEditing(true);
    state.selectedId = id;
    state.activeTripId = place.tripId || '__legacy';
    try { localStorage.setItem(SELECT_KEY, id); } catch (error) { /* storage may be blocked */ }
    renderSidebar();
    renderDetail();
    updateMapSelection();
    if (options.openPanel !== false) {
      $('#memoryPanel').classList.remove('is-hidden');
      $('#reopenMemory').hidden = true;
    }
    if (options.closeSidebar && window.innerWidth <= 980) closeSidebar();
  }

  function stopNoteEditing(save) {
    if (!state.noteEditing) {
      $('#noteEditor').hidden = true;
      $('#noteDisplay').hidden = false;
      $('#editNoteBtn').textContent = '编辑';
      return;
    }
    const place = selectedPlace();
    if (place && save) {
      place.note = $('#noteEditor').value.trim() || '这一段旅程还没有留下文字。';
      savePlaces();
    }
    state.noteEditing = false;
    $('#noteEditor').hidden = true;
    $('#noteDisplay').hidden = false;
    $('#noteDisplay').textContent = place?.note || '这一天的风，还没有被写下来。';
    $('#editNoteBtn').textContent = '编辑';
  }

  function startNoteEditing() {
    const place = selectedPlace();
    if (!place) return;
    state.noteEditing = true;
    $('#noteEditor').value = place.note || '';
    $('#noteDisplay').hidden = true;
    $('#noteEditor').hidden = false;
    $('#editNoteBtn').textContent = '完成';
    $('#noteEditor').focus();
    $('#noteEditor').setSelectionRange($('#noteEditor').value.length, $('#noteEditor').value.length);
  }

  /* --------------------------------------------------------------- Lightbox + album */
  function renderAlbumGrid(place) {
    const grid = $('#albumGrid');
    const frag = document.createDocumentFragment();
    const editing = state.albumEditing;
    place.media.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.index = String(index);
      const selected = editing && state.albumSelection.has(index);
      button.className = `album-item${selected ? ' is-selected' : ''}`;
      button.setAttribute('aria-label', editing
        ? `${item.caption || '旅行影像'}，${selected ? '已选中' : '未选中'}`
        : `${item.caption || '旅行影像'}，打开`);
      const frame = document.createElement('span');
      frame.className = 'album-media';
      frame.append(createMediaVisual(item));
      if (item.type === 'video') {
        const play = document.createElement('span');
        play.className = 'album-play';
        play.innerHTML = '<svg><use href="#i-play"></use></svg>';
        frame.append(play);
      }
      button.append(frame);
      const caption = document.createElement('span');
      caption.className = 'album-caption';
      caption.textContent = item.caption || '旅行影像';
      button.append(caption);
      if (editing) {
        const mark = document.createElement('span');
        mark.className = 'media-check';
        mark.innerHTML = '<svg><use href="#i-check"></use></svg>';
        frame.append(mark);
        button.addEventListener('click', () => toggleAlbumSelection(index));
      } else {
        button.addEventListener('click', () => {
          state.lightboxAlbumOpen = true;
          openLightbox(index);
        });
      }
      frag.append(button);
    });
    grid.replaceChildren(frag);
    renderAlbumToolbar(place);
  }

  function renderAlbumToolbar(place) {
    const toolbar = $('#albumToolbar');
    if (!toolbar) return;
    const editing = state.albumEditing && place && place.media.length > 0;
    toolbar.hidden = !editing;
    const editBtn = $('#albumEditBtn');
    if (editBtn) {
      editBtn.hidden = !place || !place.media.length;
      editBtn.textContent = editing ? '完成' : '删除';
    }
    $('#albumDialog').classList.toggle('is-editing', Boolean(editing));
    if (!editing) {
      state.albumSelection.clear();
      const grid = $('#albumGrid');
      if (grid) grid.classList.remove('is-editing');
      return;
    }
    const total = state.albumSelection.size;
    $('#albumSelectedCount').textContent = total ? `已选 ${total} 张` : '选择要删除的影像';
    const del = $('#albumDeleteBtn');
    del.disabled = total === 0;
    del.textContent = total ? `删除 ${total} 张` : '删除';
    $('#albumSelectAll').textContent = total === place.media.length ? '取消全选' : '全选';
    const grid = $('#albumGrid');
    if (grid) grid.classList.add('is-editing');
  }

  function toggleAlbumSelection(index) {
    if (state.albumSelection.has(index)) state.albumSelection.delete(index);
    else state.albumSelection.add(index);
    const place = selectedPlace();
    if (place) renderAlbumGrid(place);
  }

  function toggleAlbumSelectAll() {
    const place = selectedPlace();
    if (!place) return;
    if (state.albumSelection.size === place.media.length) state.albumSelection.clear();
    else place.media.forEach((_, index) => state.albumSelection.add(index));
    renderAlbumGrid(place);
  }

  function exitAlbumEditing() {
    state.albumEditing = false;
    state.albumSelection.clear();
    const place = selectedPlace();
    if (place) renderAlbumGrid(place);
  }

  async function deleteAlbumSelection() {
    const place = selectedPlace();
    if (!place || !state.albumSelection.size) return;
    const total = state.albumSelection.size;
    const confirmed = await askConfirm({
      title: total > 1 ? `删除这 ${total} 段影像？` : '删除这段影像？',
      text: '影像会从这座城市的手记中移除，删除后无法恢复。',
      okText: '确认删除'
    });
    if (!confirmed) return;
    const indexes = [...state.albumSelection].sort((a, b) => b - a);
    for (const index of indexes) {
      const [item] = place.media.splice(index, 1);
      if (!item) continue;
      revokeUrl(item.src);
      if (item.poster?.startsWith('blob:')) revokeUrl(item.poster);
      await removeBlob(item.storageKey);
    }
    state.albumSelection.clear();
    if (!place.media.length) {
      state.albumEditing = false;
      $('#albumDialog').close();
    } else {
      renderAlbumGrid(place);
    }
    savePlaces();
    renderSidebar();
    renderDetail();
    showToast(total > 1 ? `已删除 ${total} 段影像` : '已删除 1 段影像');
  }

  function openAlbum(options = {}) {
    const place = selectedPlace();
    if (!place || !place.media.length) {
      showToast('先添加一张照片或一段视频吧');
      return;
    }
    state.albumEditing = Boolean(options.editing);
    state.albumSelection.clear();
    renderAlbumGrid(place);
    upgradeAlbumThumbs(place);
    $('#albumCity').textContent = place.city || place.country;
    $('#albumCount').textContent = mediaSubtitle(place);
    $('#albumDate').textContent = `${formatDate(place.date)} · ${englishPlace(place)}`;
    if (!$('#albumDialog').open) $('#albumDialog').showModal();
  }

  // Older albums only kept full-size photos. Build their thumbnails quietly and
  // swap them in, so scrolling stays smooth without a visible reload.
  let thumbUpgradeRunning = false;

  async function upgradeAlbumThumbs(place) {
    if (thumbUpgradeRunning) return;
    const pending = place.media.filter((item) => item.type === 'image' && item.storageKey && !item.thumbKey).slice(0, 60);
    if (!pending.length) return;
    thumbUpgradeRunning = true;
    for (const item of pending) {
      try {
        const blob = await readBlob(item.storageKey);
        if (!blob) continue;
        const thumbBlob = await makeThumbBlob(blob);
        if (!thumbBlob) continue;
        const thumbKey = `${item.storageKey}-thumb`;
        await storeBlob(thumbKey, thumbBlob);
        const thumbUrl = URL.createObjectURL(thumbBlob);
        state.objectUrls.add(thumbUrl);
        item.thumbKey = thumbKey;
        item.thumbUrl = thumbUrl;
        const index = place.media.indexOf(item);
        const tile = document.querySelector(`.album-item[data-index="${index}"] img`);
        if (tile) tile.src = thumbUrl;
      } catch (error) {
        /* a single failure must not stop the rest */
      }
    }
    thumbUpgradeRunning = false;
    savePlaces();
  }

  function updateLightbox() {
    const place = selectedPlace();
    if (!place) return;
    const items = place.media;
    if (!items.length) {
      closeLightbox();
      return;
    }
    state.lightboxIndex = clamp(state.lightboxIndex, 0, items.length - 1);
    const item = items[state.lightboxIndex];
    const image = $('#lightboxImage');
    const vid = $('#lightboxVideo');
    vid.pause();
    if (item.type === 'video') {
      image.hidden = true;
      image.removeAttribute('src');
      vid.hidden = false;
      vid.src = item.src;
      if (item.poster) vid.poster = item.poster;
      vid.load();
    } else {
      vid.hidden = true;
      vid.removeAttribute('src');
      vid.load();
      image.hidden = false;
      image.src = item.src || '';
      image.alt = item.caption || '旅行照片';
    }
    $('#lightboxCaption').textContent = item.caption || '旅行影像';
    $('#lightboxCounter').textContent = `${pad2(state.lightboxIndex + 1)} / ${pad2(items.length)}`;
    $('#lightboxPrev').disabled = state.lightboxIndex === 0;
    $('#lightboxNext').disabled = state.lightboxIndex === items.length - 1;
  }

  function openLightbox(index) {
    const place = selectedPlace();
    if (!place || !place.media.length) return;
    state.lightboxIndex = index;
    if (!$('#lightbox').open) $('#lightbox').showModal();
    updateLightbox();
  }

  function closeLightbox() {
    const vid = $('#lightboxVideo');
    vid.pause();
    if ($('#lightbox').open) $('#lightbox').close();
  }

  async function deleteCurrentMedia() {
    const place = selectedPlace();
    if (!place) return;
    const item = place.media[state.lightboxIndex];
    if (!item) return;
    const confirmed = await askConfirm({
      title: '删除这段影像？',
      text: '影像会从这座城市的手记中移除，删除后无法恢复。',
      okText: '确认删除'
    });
    if (!confirmed) return;
    place.media.splice(state.lightboxIndex, 1);
    revokeUrl(item.src);
    if (item.poster && item.poster.startsWith('blob:')) revokeUrl(item.poster);
    await removeBlob(item.storageKey);
    savePlaces();
    renderSidebar();
    renderDetail();
    if ($('#albumDialog').open) {
      if (place.media.length) openAlbumRefresh();
      else $('#albumDialog').close();
    }
    if (place.media.length) {
      state.lightboxIndex = clamp(state.lightboxIndex, 0, place.media.length - 1);
      updateLightbox();
    } else {
      closeLightbox();
    }
    showToast('影像已删除');
  }

  function openAlbumRefresh() {
    if (!$('#albumDialog').open) return;
    const place = selectedPlace();
    if (!place) return;
    renderAlbumGrid(place);
    $('#albumCount').textContent = mediaSubtitle(place);
  }

  /* --------------------------------------------------------------- Add destination */
  function scopeCities() {
    return CITIES.filter((city) => (state.scope === 'china' ? city.country === '中国' : city.country !== '中国'));
  }

  function countryGroups() {
    const groups = new Map();
    scopeCities().forEach((city) => {
      if (!groups.has(city.country)) {
        const country = COUNTRIES.find((item) => item.name === city.country);
        groups.set(city.country, {
          name: city.country,
          en: country?.en || COUNTRY_EN_FALLBACK[city.country] || city.country,
          code: country?.code || city.code,
          cities: []
        });
      }
      groups.get(city.country).cities.push(city);
    });
    return [...groups.values()]
      .map((group) => ({
        ...group,
        cities: group.cities.slice().sort((a, b) => {
          const left = a.pinyin || a.en || a.name;
          const right = b.pinyin || b.en || b.name;
          return String(left).localeCompare(String(right), 'en');
        })
      }))
      .sort((a, b) => a.en.localeCompare(b.en, 'en'));
  }

  // 国内城市按省级行政区分组，顺序沿用行政区划顺序。
  function provinceGroups() {
    const groups = new Map();
    scopeCities().forEach((city) => {
      const province = city.province || '其他';
      if (!groups.has(province)) {
        groups.set(province, { name: province, order: city.provinceOrder ?? 99, cities: [] });
      }
      groups.get(province).cities.push(city);
    });
    return [...groups.values()]
      .map((group) => ({
        ...group,
        cities: group.cities.slice().sort((a, b) => {
          const left = a.pinyin || a.en || a.name;
          const right = b.pinyin || b.en || b.name;
          return String(left).localeCompare(String(right), 'en');
        })
      }))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh'));
  }

  function searchCities(query) {
    const q = normalize(query);
    return scopeCities()
      .map((item) => {
        const haystack = normalize(`${item.name} ${item.en} ${item.country || ''} ${item.code} ${item.pinyin || ''} ${item.search || ''}`);
        let score = 0;
        if (normalize(item.name) === q || normalize(item.en) === q) score = 100;
        else if (normalize(item.name).startsWith(q) || normalize(item.en).startsWith(q)) score = 60;
        else if (normalize(item.pinyin || '').startsWith(q)) score = 45;
        else if (haystack.includes(q)) score = 20;
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map(({ item }) => item);
  }

  function countryFlag(code) {
    const normalized = String(code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) return `<span class="country-flag"><span>${escapeHtml(normalized || '—')}</span></span>`;
    const src = resolveAsset(`assets/flags/${normalized.toLowerCase()}.svg`);
    return `<span class="country-flag"><span>${escapeHtml(normalized)}</span><img src="${src}" alt="" loading="lazy" onerror="this.remove()"></span>`;
  }

  function cityKey(item) {
    return `${item.code || ''}|${item.name}`;
  }

  function makeCityResult(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-item';
    button.dataset.cityKey = cityKey(item);
    button.setAttribute('role', 'option');
    const selected = Boolean(state.addPreview && cityKey(state.addPreview) === cityKey(item));
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (selected) button.classList.add('is-selected');
    button.innerHTML = `
      <span class="result-code">${escapeHtml(item.code)}</span>
      <span class="result-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.country)} · ${escapeHtml(item.en)}</small></span>
      <span class="result-coord">${formatCoord(item.lat, item.lon, true)}</span>
    `;
    button.addEventListener('click', () => chooseDestination(item));
    return button;
  }

  function renderDestinationResults() {
    const list = $('#destinationResults');
    const query = $('#destinationSearch').value.trim();
    const frag = document.createDocumentFragment();

    if (query) {
      const results = searchCities(query);
      $('#resultLabel').textContent = '搜索结果';
      $('#resultCount').textContent = results.length ? `${results.length} 座城市` : '';
      if (!results.length) {
        const empty = document.createElement('div');
        empty.className = 'result-empty';
        const hint = state.scope === 'china'
          ? '国内地图只收录中国城市，试试换一座城市'
          : '国际地图不收录中国城市，试试其他国家';
        empty.innerHTML = `没有找到“${escapeHtml(query)}”<br>${hint}`;
        list.replaceChildren(empty);
        return;
      }
      results.forEach((item) => frag.append(makeCityResult(item)));
      list.replaceChildren(frag);
      return;
    }

    // Domestic map: group the Chinese cities by province, like countries below.
    if (state.scope === 'china') {
      const groups = provinceGroups();
      const total = groups.reduce((sum, group) => sum + group.cities.length, 0);
      $('#resultLabel').textContent = '按省份浏览';
      $('#resultCount').textContent = `${groups.length} 个省份 · ${total} 座城市`;

      groups.forEach((group) => {
        const expanded = state.addProvince === group.name;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'result-item country-row province-row';
        row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        row.innerHTML = `
          <span class="result-code province-code">${escapeHtml(group.name.replace(/(省|市|自治区|维吾尔|壮族|回族|特别行政区)/g, '').slice(0, 2))}</span>
          <span class="result-copy"><strong>${escapeHtml(group.name)}</strong><small>${group.cities.length} 座城市</small></span>
          <span class="country-arrow" aria-hidden="true">›</span>
        `;
        row.addEventListener('click', () => {
          state.addProvince = expanded ? null : group.name;
          renderDestinationResults();
        });
        frag.append(row);

        if (expanded) {
          const cityWrap = document.createElement('div');
          cityWrap.className = 'country-cities';
          group.cities.forEach((city) => cityWrap.append(makeCityResult(city)));
          frag.append(cityWrap);
        }
      });

      list.replaceChildren(frag);
      return;
    }

    const groups = countryGroups();
    $('#resultLabel').textContent = '按国家浏览';
    $('#resultCount').textContent = `${groups.length} 个国家`;
    let lastLetter = '';
    groups.forEach((group) => {
      const letter = (group.en || '#').charAt(0).toUpperCase();
      if (letter !== lastLetter) {
        const heading = document.createElement('div');
        heading.className = 'country-letter';
        heading.textContent = /[A-Z]/.test(letter) ? letter : '#';
        frag.append(heading);
        lastLetter = letter;
      }

      const expanded = state.addCountry === group.name;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'result-item country-row';
      row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      row.innerHTML = `
        ${countryFlag(group.code)}
        <span class="result-copy"><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.en)} · ${group.cities.length} 座城市</small></span>
        <span class="country-arrow" aria-hidden="true">›</span>
      `;
      row.addEventListener('click', () => {
        state.addCountry = expanded ? null : group.name;
        renderDestinationResults();
      });
      frag.append(row);

      if (expanded) {
        const cityWrap = document.createElement('div');
        cityWrap.className = 'country-cities';
        group.cities.forEach((city) => cityWrap.append(makeCityResult(city)));
        frag.append(cityWrap);
      }
    });
    list.replaceChildren(frag);
  }

  function renderTripSlots() {
    const list = $('#slotList');
    if (!list) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const item = state.tripSlots[i] || null;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `trip-slot${item ? ' is-filled' : ''}${i === state.activeSlot ? ' is-active' : ''}`;
      btn.dataset.slot = String(i);
      const dateState = item ? slotDateState(item) : null;
      const dateLabel = slotBadgeText(dateState)
        || (dateState && (dateState.state === 'partial' || dateState.state === 'reversed') ? '待填日期' : '');
      btn.setAttribute('aria-label', item
        ? `第 ${i + 1} 站 ${item.name}${dateLabel ? `，${dateLabel}` : '，还没填日期'}，点击编辑日期`
        : `第 ${i + 1} 站，空`);
      btn.title = item ? `${item.name}${dateLabel ? ` · ${dateLabel}` : ''}` : '';
      btn.innerHTML = `
        <span class="slot-index">${String(i + 1).padStart(2, '0')}</span>
        <span class="slot-name">${item ? escapeHtml(item.name) : '选择城市'}</span>
        ${item && dateLabel ? `<span class="slot-date${dateState.state === 'ok' ? '' : ' is-waiting'}">${dateLabel}</span>` : ''}
        ${item ? '<span class="slot-remove" role="button" tabindex="-1" aria-label="移除这座城市的行程"><svg><use href="#i-close"></use></svg></span>' : ''}
      `;
      btn.addEventListener('click', (event) => {
        // 只有右侧 × 才移除城市
        if (event.target.closest('.slot-remove') && state.tripSlots[i]) {
          event.stopPropagation();
          event.preventDefault();
          state.tripSlots.splice(i, 1);
          state.activeSlot = Math.min(state.activeSlot, Math.max(0, state.tripSlots.length - 1));
          renderTripSlots();
          loadSlotDates(state.activeSlot);
          updateAddState();
          return;
        }
        // 点击格子只切换选中，同步显示该城市的日期
        if (state.tripSlots[i]) {
          state.activeSlot = i;
          renderTripSlots();
          loadSlotDates(i);
          updateAddState();
          $('#visitDateStart')?.focus();
          return;
        }
        // 点到空格子：不动输入框里已经填好的日期，直接把光标送回搜索框挑下一座城市
        state.activeSlot = Math.max(0, state.tripSlots.length - 1);
        renderTripSlots();
        loadSlotDates(state.activeSlot);
        updateAddState();
        $('#destinationSearch')?.focus();
      });
      li.append(btn);
      frag.append(li);
    }
    list.replaceChildren(frag);

    const filled = state.tripSlots.length;
    const hint = $('#tripHint');
    if (hint) hint.textContent = filled ? `已选 ${filled} / ${SLOT_COUNT} 座` : `最多 ${SLOT_COUNT} 座`;
    const footHint = $('#addFootHint');
    if (footHint) footHint.textContent = filled ? '这一段轨迹会从居住城市出发' : '至少选择 1 座城市才能加入轨迹';
  }

  // Push a city into the first free slot (or the active one), keeping order.
  function showAddNotice(message) {
    const notice = $('#addNotice');
    if (!notice) return;
    notice.textContent = message;
    // Let the element paint once before animating it in.
    requestAnimationFrame(() => notice.classList.add('is-visible'));
    clearTimeout(state.addNoticeTimer);
    state.addNoticeTimer = setTimeout(() => {
      notice.classList.remove('is-visible');
    }, 2600);
  }

  function hideAddNotice() {
    const notice = $('#addNotice');
    if (!notice) return;
    clearTimeout(state.addNoticeTimer);
    notice.classList.remove('is-visible');
  }

  function addCityToSlots(item) {
    const key = cityKey(item);
    if (state.tripSlots.length >= SLOT_COUNT) {
      showAddNotice(`一段轨迹最多 ${SLOT_COUNT} 座城市`);
      return false;
    }
    if (state.tripSlots.some((slot) => cityKey(slot) === key)) {
      showToast(`${item.name}已经在本次轨迹里了`);
      return false;
    }
    // 先把上一座城市已经填好的日期存起来，再新建格子
    storeActiveDates();
    const carried = !state.tripSlots.length && state.pendingDates ? state.pendingDates : BLANK_ROWS;
    state.pendingDates = null;
    state.tripSlots.push({
      ...item,
      dateRows: carried.map((row) => [...row])
    });
    state.activeSlot = state.tripSlots.length - 1;
    hideAddNotice();
    renderTripSlots();
    // 新城市默认没有日期：清空输入框，等用户为它填写
    loadSlotDates(state.activeSlot);
    updateAddState();
    return true;
  }

  // Native date inputs print their own y/m/d hints, so an empty field shows a
  // plain underscore placeholder instead.
  function syncDatePlaceholders() {
    $$('.date-input input[type="date"]').forEach((input) => {
      input.classList.toggle('is-empty', !input.value);
    });
  }

  const DATE_ROWS = [
    ['#visitDateStart', '#visitDateEnd'],
    ['#visitDate2Start', '#visitDate2End']
  ];

  function readDateRows(rows) {
    const filled = [];
    for (const [startSel, endSel] of rows) {
      const start = $(startSel)?.value || '';
      const end = $(endSel)?.value || '';
      if (!start && !end) continue;
      if (!start || !end) return { state: 'partial', filled };
      if (end < start) return { state: 'reversed', filled };
      filled.push({ start, end });
    }
    if (!filled.length) return { state: 'empty', filled };
    return { state: 'ok', filled };
  }

  function addDateState() {
    return readDateRows(DATE_ROWS);
  }

  /* --------------------------------------------- 每座城市各自保存日期 */
  const BLANK_ROWS = [['', ''], ['', '']];

  function rowsFromSlot(slot) {
    const rows = (slot && slot.dateRows) || [];
    return [
      [rows[0]?.[0] || '', rows[0]?.[1] || ''],
      [rows[1]?.[0] || '', rows[1]?.[1] || '']
    ];
  }

  function evaluateRows(rows) {
    const filled = [];
    for (const [start, end] of rows) {
      if (!start && !end) continue;
      if (!start || !end) return { state: 'partial', filled };
      if (end < start) return { state: 'reversed', filled };
      filled.push({ start, end });
    }
    if (!filled.length) return { state: 'empty', filled };
    return { state: 'ok', filled };
  }

  function slotDateState(slot) {
    return evaluateRows(rowsFromSlot(slot));
  }

  function readInputRows() {
    return DATE_ROWS.map(([startSel, endSel]) => [$(startSel)?.value || '', $(endSel)?.value || '']);
  }

  function writeInputRows(rows) {
    DATE_ROWS.forEach(([startSel, endSel], index) => {
      const start = $(startSel);
      const end = $(endSel);
      if (start) start.value = rows[index]?.[0] || '';
      if (end) end.value = rows[index]?.[1] || '';
    });
    syncDatePlaceholders();
  }

  function currentSlot() {
    return state.tripSlots[state.activeSlot] || null;
  }

  // 输入框内容随时写回当前选中的城市，切换城市不会丢
  function storeActiveDates() {
    const rows = readInputRows();
    const slot = currentSlot();
    if (!slot) {
      state.pendingDates = rows;
      return;
    }
    slot.dateRows = rows;
  }

  function loadSlotDates(index) {
    const slot = state.tripSlots[index] || null;
    writeInputRows(slot ? rowsFromSlot(slot) : BLANK_ROWS);
  }

  // 日期输入框永远只属于「当前这座城市」，标题里写明白是哪一座，
  // 免得以为整段轨迹共用一组日期。
  function syncDateTarget() {
    const target = $('#dateTarget');
    if (!target) return;
    const slot = currentSlot();
    const index = slot ? state.tripSlots.indexOf(slot) : -1;
    const hint = $('#dateHint');
    if (slot && index >= 0) {
      target.textContent = `第 ${String(index + 1).padStart(2, '0')} 站 · ${slot.name} 的日期`;
      target.classList.add('is-city');
      if (hint) hint.textContent = '至多两段，至少一段';
    } else {
      target.textContent = '旅行日期';
      target.classList.remove('is-city');
      if (hint) hint.textContent = '选好城市后为它填写';
    }
  }

  function shortPeriod(period) {
    if (!period) return '';
    const month = Number(period.start.slice(5, 7));
    const day = Number(period.start.slice(8, 10));
    if (!month || !day) return '';
    return `${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
  }

  // 格子右侧的日期徽标：单日就写 MM.DD，跨天写 MM.DD–MM.DD
  function slotBadgeText(info) {
    if (!info || info.state !== 'ok' || !info.filled.length) return '';
    const [first, ...rest] = info.filled;
    const start = shortPeriod(first);
    const end = shortPeriod({ start: first.end });
    const span = start === end ? start : `${start}–${end}`;
    return rest.length ? `${span} +${rest.length}` : span;
  }

  // 输入日期时实时更新格子上的日期徽标，不用等列表重建
  function refreshSlotBadges() {
    const list = $('#slotList');
    if (!list) return;
    $$('.trip-slot.is-filled', list).forEach((btn) => {
      const index = Number(btn.dataset.slot);
      const slot = state.tripSlots[index];
      if (!slot) return;
      const info = slotDateState(slot);
      const label = slotBadgeText(info)
        || (info.state === 'partial' || info.state === 'reversed' ? '待填日期' : '');
      let badge = btn.querySelector('.slot-date');
      if (!label) {
        badge?.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'slot-date';
        btn.insertBefore(badge, btn.querySelector('.slot-remove'));
      }
      badge.textContent = label;
      badge.classList.toggle('is-waiting', info.state !== 'ok');
    });
  }

  function updateAddState() {
    storeActiveDates();
    refreshSlotBadges();
    syncDateTarget();
    const slots = state.tripSlots;
    const count = slots.length;
    const states = slots.map(slotDateState);
    const pending = states.findIndex((info) => info.state !== 'ok');
    const ready = count > 0 && pending === -1;
    $('#savePlaceBtn').disabled = !ready;
    $('#savePlaceBtn').innerHTML = count > 0
      ? `加入轨迹 · ${count} 座 <svg><use href="#i-arrow"></use></svg>`
      : '加入轨迹 <svg><use href="#i-arrow"></use></svg>';
    const hint = $('#addFootHint');
    if (!hint) return;
    if (!count) { hint.textContent = '至少选择 1 座城市才能加入轨迹'; return; }
    if (pending !== -1) {
      const info = states[pending];
      const name = slots[pending].name;
      const order = pending + 1;
      if (info.state === 'empty') hint.textContent = `第 ${order} 站「${name}」还没填日期`;
      else if (info.state === 'partial') hint.textContent = `第 ${order} 站「${name}」请把开始和结束日期都填上`;
      else hint.textContent = `第 ${order} 站「${name}」结束日期不能早于开始日期`;
      return;
    }
    hint.textContent = `${count} 座城市已就绪 · 每座城市的日期都已填好`;
  }

  function chooseDestination(item) {
    state.addPreview = { ...item, kind: 'city' };
    const landmark = landmarkFor(item);
    $('#previewImage').src = landmark || resolveAsset(DEFAULT_COVER);
    $('#previewImage').alt = `${item.name} 地标`;
    $('#previewCode').textContent = item.code || '—';
    $('#previewCoord').textContent = formatCoord(item.lat, item.lon);
    $('#previewName').textContent = item.name;
    addCityToSlots(item);
    $$('.result-item[data-city-key]', $('#destinationResults')).forEach((button) => {
      const selected = button.dataset.cityKey === cityKey(item);
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function resetAddDialog() {
    state.addPreview = null;
    state.addCountry = null;
    state.addProvince = null;
    state.addQuery = '';
    state.tripSlots = [];
    state.activeSlot = 0;
    state.pendingDates = null;
    $('#destinationSearch').value = '';
    $('#previewImage').src = resolveAsset(DEFAULT_COVER);
    $('#previewCode').textContent = '—';
    $('#previewCoord').textContent = 'SELECT A PLACE';
    $('#previewName').textContent = '下一站，去哪里？';
    $('#previewMeta').textContent = state.scope === 'china'
      ? '从上方挑选中国城市，依次填进下方格子'
      : '从上方选择国家与城市，依次填进下方格子';
    $('#visitDateStart').value = '';
    $('#visitDateEnd').value = '';
    $('#visitDate2Start').value = '';
    $('#visitDate2End').value = '';
    syncDatePlaceholders();
    $('#visitNote').value = '';
    hideAddNotice();
    renderTripSlots();
    updateAddState();
    renderDestinationResults();
  }

  function openAddDialog() {
    resetAddDialog();
    if (!$('#addDialog').open) $('#addDialog').showModal();
    setTimeout(() => $('#destinationSearch').focus(), 90);
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog?.open) dialog.close();
  }

  /* --------------------------------------------------------------- Home city */
  function renderHomeBlock() {
    const block = $('#homeBlock');
    const name = $('#homeName');
    if (!block || !name) return;
    // The world map always leaves from the middle of China, so the home picker
    // only belongs to the domestic map.
    const isWorld = state.scope === 'world';
    block.classList.toggle('is-scope-hidden', isWorld);
    const home = state.home;
    block.classList.toggle('is-empty', !home);
    name.textContent = home ? home.name : '未设置';
    $('#homeBtn').setAttribute('aria-label', home ? `居住城市 ${home.name}，点击修改` : '设置居住城市');
  }

  function homeSearchPool() {
    return CITIES.concat(EXTRA_CHINA_CITIES);
  }

  function homeSearchResults(query) {
    const q = normalize(query);
    const pool = homeSearchPool();
    if (!q) {
      const saved = state.home;
      const suggestions = ['北京', '上海', '广州', '成都', '深圳', '杭州'];
      const rows = [];
      for (const city of pool) {
        if (suggestions.includes(city.name)) rows.push(city);
      }
      if (saved) {
        const current = pool.find((c) => c.name === saved.name);
        if (current && !rows.some((r) => r.name === current.name)) rows.unshift(current);
      }
      return rows.slice(0, 12);
    }
    return pool
      .map((item) => {
        const haystack = normalize(`${item.name} ${item.en} ${item.country} ${item.pinyin || ''} ${item.search || ''}`);
        let score = 0;
        if (normalize(item.name) === q || normalize(item.en) === q) score = 100;
        else if (normalize(item.name).startsWith(q) || normalize(item.en).startsWith(q)) score = 60;
        else if (normalize(item.pinyin || '').startsWith(q)) score = 45;
        else if (haystack.includes(q)) score = 20;
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ item }) => item);
  }

  function renderHomeResults() {
    const list = $('#homeResults');
    if (!list) return;
    const query = $('#homeSearch').value.trim();
    const results = homeSearchResults(query);
    const frag = document.createDocumentFragment();
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'home-empty';
      empty.innerHTML = `没有找到“${escapeHtml(query)}”<br>试试城市的中文名、英文名或拼音`;
      list.replaceChildren(empty);
      return;
    }
    results.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result-item';
      button.setAttribute('role', 'option');
      const current = state.home && state.home.name === item.name;
      if (current) button.classList.add('is-selected');
      button.innerHTML = `
        <span class="result-code">${escapeHtml(item.code)}</span>
        <span class="result-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.country)} · ${escapeHtml(item.en)}</small></span>
        ${current ? '<span class="result-coord">当前</span>' : `<span class="result-coord">${formatCoord(item.lat, item.lon, true)}</span>`}
      `;
      button.addEventListener('click', () => {
        state.home = {
          name: item.name,
          en: item.en,
          country: item.country,
          code: item.code,
          lat: Number(item.lat),
          lon: Number(item.lon)
        };
        saveHome();
        renderHomeBlock();
        closeDialog('homeDialog');
        renderAll({ rebuildMap: true, fit: true });
        showToast(`居住城市已设为 ${item.name}`);
      });
      frag.append(button);
    });
    list.replaceChildren(frag);
  }

  function openHomeDialog() {
    const dialog = $('#homeDialog');
    if (!dialog) return;
    $('#homeSearch').value = '';
    renderHomeResults();
    if (!dialog.open) dialog.showModal();
    setTimeout(() => $('#homeSearch').focus(), 90);
  }

  async function saveNewPlace() {
    const slots = state.tripSlots.filter(Boolean);
    if (!slots.length) {
      showToast('至少选择 1 座城市才能加入轨迹');
      return;
    }
    const wrongScope = slots.find((item) => (state.scope === 'china' ? item.country !== '中国' : item.country === '中国'));
    if (wrongScope) {
      showToast(state.scope === 'china' ? '国内地图只能记录中国城市' : '国际地图只能记录中国以外的城市');
      return;
    }

    storeActiveDates();
    const perSlot = slots.map(slotDateState);
    const missing = perSlot.findIndex((info) => info.state !== 'ok');
    if (missing !== -1) {
      const info = perSlot[missing];
      const name = slots[missing].name;
      const order = missing + 1;
      state.activeSlot = missing;
      renderTripSlots();
      loadSlotDates(missing);
      updateAddState();
      if (info.state === 'empty') showAddNotice(`请先给第 ${order} 站「${name}」填写日期`);
      else if (info.state === 'partial') showAddNotice(`第 ${order} 站「${name}」的开始和结束日期都要填`);
      else showAddNotice(`第 ${order} 站「${name}」结束日期不能早于开始日期`);
      $('#visitDateStart')?.focus();
      return;
    }
    const firstNote = $('#visitNote').value.trim();
    const tripId = uid('trip');
    const created = [];

    slots.forEach((item, index) => {
      const existing = state.places.find((p) => p.kind !== 'country' && p.city === item.name && p.code === item.code);
      if (existing) {
        created.push(existing);
        return;
      }
      const place = {
        id: uid('place'),
        kind: 'city',
        tripId,
        city: item.name,
        en: item.en || item.name,
        country: item.country,
        countryEn: countryEnglish(item.country),
        code: item.code,
        lat: Number(item.lat),
        lon: Number(item.lon),
        date: perSlot[index].filled[0].start,
        dateEnd: perSlot[index].filled[0].end,
        periods: perSlot[index].filled.slice(0, 2).map((item) => ({ ...item })),
        note: index === 0
          ? (firstNote || `第一次抵达${item.name}，把这一天的风和光都收进地图里。`)
          : `第 ${index + 1} 站，${item.name}。`,
        cover: DEFAULT_COVER,
        media: []
      };
      state.places.push(place);
      created.push(place);
    });

    const last = created[created.length - 1] || null;
    state.selectedId = last?.id || null;
    savePlaces();
    try {
      if (state.selectedId) localStorage.setItem(SELECT_KEY, state.selectedId);
    } catch (error) { /* ignore */ }
    closeDialog('addDialog');
    renderAll({ rebuildMap: true, fit: true });
    $('#memoryPanel').classList.remove('is-hidden');
    $('#reopenMemory').hidden = true;
    const added = created.length;
    showToast(added > 1 ? `${added} 座城市已连成一段新轨迹` : `${slots[0].name}已加入你的旅行轨迹`);
  }

  /* --------------------------------------------------------------- Add media */
  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function videoPoster(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.muted = true;
      videoEl.playsInline = true;
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        videoEl.removeAttribute('src');
        videoEl.load();
        resolve(value);
      };
      videoEl.addEventListener('loadeddata', () => {
        try {
          videoEl.currentTime = Math.min(0.18, (videoEl.duration || 1) / 3);
        } catch (error) {
          finish(null);
        }
      });
      videoEl.addEventListener('seeked', () => {
        try {
          const canvas = document.createElement('canvas');
          const ratio = videoEl.videoWidth && videoEl.videoHeight ? videoEl.videoHeight / videoEl.videoWidth : 0.66;
          canvas.width = 720;
          canvas.height = Math.round(720 * ratio);
          canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.74));
        } catch (error) {
          finish(null);
        }
      });
      videoEl.addEventListener('error', () => finish(null));
      setTimeout(() => finish(null), 5000);
      videoEl.src = url;
      videoEl.load();
    });
  }

  // Full-resolution photos are heavy to paint in a grid, so each upload also
  // gets a small JPEG thumbnail that the album and the card use.
  async function decodeBitmap(file) {
    try {
      return await createImageBitmap(file);
    } catch (error) {
      // Fall back to an <img> when ImageBitmap is unavailable.
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    }
  }

  async function makeThumbBlob(file, maxSide = 720) {
    const source = await decodeBitmap(file);
    const width0 = source.width || source.naturalWidth || 0;
    const height0 = source.height || source.naturalHeight || 0;
    if (!width0 || !height0) return null;
    const scale = Math.min(1, maxSide / Math.max(width0, height0));
    const width = Math.max(1, Math.round(width0 * scale));
    const height = Math.max(1, Math.round(height0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, width, height);
    if (source.close) source.close();
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.76);
    });
  }

  // Videos straight from a phone are often 200-500MB. Re-encode them in the
  // browser (canvas + MediaRecorder) so they fit our storage budget.
  const VIDEO_COMPRESS_ABOVE = 100 * 1024 * 1024;
  const MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024;
  const COMPRESS_MAX_SIDE = 1280;
  const COMPRESS_FPS = 24;
  const COMPRESS_BITRATE = 2200000;

  function pickVideoMime() {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const type of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  function compressThreshold() {
    const override = Number(window.__ATLAS_COMPRESS_ABOVE);
    return Number.isFinite(override) && override > 0 ? override : VIDEO_COMPRESS_ABOVE;
  }

  function mediaLimit() {
    const override = Number(window.__ATLAS_MEDIA_LIMIT);
    return Number.isFinite(override) && override > 0 ? override : MEDIA_MAX_BYTES;
  }

  function formatMB(bytes) {
    return `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)}MB`;
  }

  // Returns a smaller Blob, or null when the browser cannot do it.
  async function compressVideo(file, onProgress) {
    const mime = pickVideoMime();
    if (!mime || !window.MediaRecorder) return null;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const ready = await new Promise((resolve) => {
      const done = (value) => resolve(value);
      video.onloadeddata = () => done(true);
      video.onerror = () => done(false);
      setTimeout(() => done(false), 12000);
    });
    if (!ready) {
      URL.revokeObjectURL(url);
      return null;
    }

    const ratio = Math.min(1, COMPRESS_MAX_SIDE / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    const width = Math.max(2, Math.round(((video.videoWidth || 640) * ratio) / 2) * 2);
    const height = Math.max(2, Math.round(((video.videoHeight || 360) * ratio) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(COMPRESS_FPS);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: COMPRESS_BITRATE });
    } catch (error) {
      URL.revokeObjectURL(url);
      return null;
    }

    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
    const finished = new Promise((resolve) => { recorder.onstop = () => resolve(); });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

    recorder.start(1000);
    try {
      await video.play();
    } catch (error) {
      recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      URL.revokeObjectURL(url);
      return null;
    }

    await new Promise((resolve) => {
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        resolve();
      };
      const loop = () => {
        if (video.ended) { stop(); return; }
        ctx.drawImage(video, 0, 0, width, height);
        if (onProgress) {
          const pct = duration ? Math.min(99, Math.round((video.currentTime / duration) * 100)) : 0;
          onProgress(pct);
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      video.onended = stop;
      setTimeout(stop, 10 * 60 * 1000);
    });

    video.pause();
    recorder.stop();
    await finished;
    stream.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(url);

    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    return blob.size && blob.size < file.size ? blob : null;
  }

  async function addMediaFiles(fileList) {
    const place = selectedPlace();
    if (!place) {
      showToast('请先选择一个地点');
      return;
    }
    const files = [...fileList].filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (!files.length) {
      showToast('请选择照片或视频文件');
      return;
    }
    const uploadButton = $('#uploadBtn');
    uploadButton.classList.add('is-uploading');
    const originalHtml = uploadButton.innerHTML;
    uploadButton.innerHTML = '<span class="upload-plus"><svg><use href="#i-image"></use></svg></span><span class="upload-copy"><strong>正在保存影像…</strong><small>请稍候</small></span>';
    let added = 0;
    const limit = mediaLimit();
    const compressAbove = compressThreshold();
    const copy = uploadButton.querySelector('.upload-copy');
    const setStatus = (title, hint) => {
      if (!copy) return;
      const strong = copy.querySelector('strong');
      const small = copy.querySelector('small');
      if (strong) strong.textContent = title;
      if (small) small.textContent = hint;
    };

    for (const originalFile of files) {
      let file = originalFile;
      let isVideo = file.type.startsWith('video/');
      if (file.size > limit) {
        showToast(`${file.name} 超过 ${formatMB(limit)}，已跳过`);
        continue;
      }
      // Big clips are re-encoded first; the original is kept only if that fails.
      if (isVideo && file.size > compressAbove) {
        setStatus('正在压缩视频…', `${formatMB(file.size)}，可能需要几分钟`);
        const compressed = await compressVideo(file, (pct) => {
          setStatus('正在压缩视频…', `${pct}% · 原文件 ${formatMB(originalFile.size)}`);
        }).catch(() => null);
        if (compressed) {
          file = new File([compressed], originalFile.name.replace(/\.[^.]+$/, '') + '.webm', { type: compressed.type });
          isVideo = true;
        }
        setStatus('正在保存影像…', '请稍候');
      }
      if (file.size > limit) {
        showToast(`${originalFile.name} 压缩后仍有 ${formatMB(file.size)}，已跳过`);
        continue;
      }
      const id = uid('media');
      const key = `blob-${id}`;
      let objectUrl = URL.createObjectURL(file);
      let poster = null;
      let storageKey = key;
      try {
        await storeBlob(key, file);
      } catch (error) {
        storageKey = '';
        try {
          if (file.size <= 1.8 * 1024 * 1024) objectUrl = await fileToDataUrl(file);
          else {
            showToast(`${file.name} 过大且浏览器存储不可用，已跳过`);
            revokeUrl(objectUrl);
            continue;
          }
        } catch (readError) {
          showToast(`${file.name} 无法读取，已跳过`);
          revokeUrl(objectUrl);
          continue;
        }
      }
      if (isVideo) {
        poster = await videoPoster(file);
        if (poster) {
          // Posters are small data URLs; keep them with the record.
          objectUrl = objectUrl || URL.createObjectURL(file);
        }
      }
      // A small copy keeps scrolling smooth with dozens of photos.
      let thumbKey = '';
      let thumbUrl = '';
      if (!isVideo) {
        try {
          const thumbBlob = await makeThumbBlob(file);
          if (thumbBlob && storageKey) {
            thumbKey = `${key}-thumb`;
            await storeBlob(thumbKey, thumbBlob);
            thumbUrl = URL.createObjectURL(thumbBlob);
            state.objectUrls.add(thumbUrl);
          }
        } catch (error) {
          thumbKey = '';
        }
      }
      if (objectUrl.startsWith('blob:')) state.objectUrls.add(objectUrl);
      const item = {
        id,
        type: isVideo ? 'video' : 'image',
        src: objectUrl,
        caption: originalFile.name.replace(/\.[^.]+$/, '').slice(0, 48) || (isVideo ? '旅行片段' : '旅行照片'),
        ...(storageKey ? { storageKey } : {}),
        ...(thumbKey ? { thumbKey } : {}),
        ...(poster ? { poster } : {})
      };
      if (thumbUrl) item.thumbUrl = thumbUrl;
      place.media.push(item);
      added += 1;
    }
    if (added) {
      savePlaces();
      renderSidebar();
      renderDetail();
      showToast(`已添加 ${added} 段影像`);
    }
    uploadButton.classList.remove('is-uploading');
    uploadButton.innerHTML = originalHtml;
  }

  /* --------------------------------------------------------------- Confirm dialog */
  function askConfirm(options = {}) {
    if (state.confirmResolver) {
      state.confirmResolver(false);
      state.confirmResolver = null;
    }
    $('#confirmTitle').textContent = options.title || '确认操作？';
    $('#confirmText').textContent = options.text || '此操作无法撤销。';
    $('#confirmOk').textContent = options.okText || '确认';
    const dialog = $('#confirmDialog');
    if (!dialog.open) dialog.showModal();
    return new Promise((resolve) => {
      state.confirmResolver = resolve;
    });
  }

  function settleConfirm(value) {
    const resolver = state.confirmResolver;
    state.confirmResolver = null;
    if ($('#confirmDialog').open) $('#confirmDialog').close();
    if (resolver) resolver(value);
  }

  /* ------------------------------------------------------------- Edit date */
  function openDateDialog() {
    $('#placeMenu').hidden = true;
    const place = selectedPlace();
    if (!place || place.id === 'home') return;
    const periods = placePeriods(place);
    $('#dateDialogStart').value = (periods[0]?.start || '').slice(0, 10);
    $('#dateDialogEnd').value = (periods[0]?.end || '').slice(0, 10);
    $('#dateDialog2Start').value = (periods[1]?.start || '').slice(0, 10);
    $('#dateDialog2End').value = (periods[1]?.end || '').slice(0, 10);
    syncDatePlaceholders();
    $('#dateDialogHint').textContent = '这段轨迹会按日期顺序重新排列。';
    const dialog = $('#dateDialog');
    if (!dialog.open) dialog.showModal();
    setTimeout(() => $('#dateDialogStart').focus(), 60);
  }

  function closeDateDialog() {
    if ($('#dateDialog').open) $('#dateDialog').close();
  }

  function saveDateDialog() {
    const place = selectedPlace();
    if (!place || place.id === 'home') { closeDateDialog(); return; }
    const info = readDateRows([
      ['#dateDialogStart', '#dateDialogEnd'],
      ['#dateDialog2Start', '#dateDialog2End']
    ]);
    if (info.state === 'empty') {
      $('#dateDialogHint').textContent = '请至少填写一段旅行日期。';
      return;
    }
    if (info.state === 'partial') {
      $('#dateDialogHint').textContent = '请把这一段的开始和结束日期都填上。';
      return;
    }
    if (info.state === 'reversed') {
      $('#dateDialogHint').textContent = '结束日期不能早于开始日期。';
      return;
    }
    const periods = info.filled.slice(0, 2);
    const before = placeRangeText(place);
    place.date = periods[0].start;
    place.dateEnd = periods[0].end;
    place.periods = periods.map((item) => ({ ...item }));
    const after = placeRangeText(place);
    savePlaces();
    closeDateDialog();
    if (before !== after) {
      renderAll({ rebuildMap: true, fit: false });
      showToast(`旅行日期已改为 ${after}`);
    }
  }

  /* --------------------------------------------------------------- Remove place */
  async function removeSelectedPlace() {
    $('#placeMenu').hidden = true;
    const place = selectedPlace();
    if (!place) return;
    const confirmed = await askConfirm({
      title: '从轨迹中移除？',
      text: `${place.city || place.country}的 ${place.media.length} 段影像与手记会一起从本机移除，此操作无法撤销。`,
      okText: '确认移除'
    });
    if (!confirmed) return;
    const places = sortedPlaces();
    const index = places.findIndex((p) => p.id === place.id);
    for (const item of place.media) {
      revokeUrl(item.src);
      if (item.poster?.startsWith('blob:')) revokeUrl(item.poster);
      await removeBlob(item.storageKey);
    }
    state.places = state.places.filter((p) => p.id !== place.id);
    const remaining = sortedPlaces();
    const next = remaining[Math.min(index, remaining.length - 1)] || null;
    state.selectedId = next?.id || null;
    if (!remaining.some((p) => (p.tripId || '__legacy') === state.activeTripId)) state.activeTripId = null;
    savePlaces();
    try {
      if (state.selectedId) localStorage.setItem(SELECT_KEY, state.selectedId);
      else localStorage.removeItem(SELECT_KEY);
    } catch (error) { /* ignore */ }
    renderAll({ rebuildMap: true, fit: true });
    showToast('已从旅行轨迹中移除');
  }

  /* --------------------------------------------------------------- Render all + init */
  function renderAll(options = {}) {
    const places = sortedPlaces();
    const homeSelected = state.selectedId === 'home' && Boolean(departurePlace());
    if (!homeSelected && !places.some((p) => p.id === state.selectedId)) {
      state.selectedId = places[0]?.id || null;
    }
    renderSidebar();
    renderDetail();
    if (options.rebuildMap !== false) renderMap();
    updateMapSelection();
    if (options.fit) fitRoute();
    if (options.rebuildMap === false) applyMapTransform();
  }

  /* --------------------------------------------------------------- 国际 / 国内 */
  function refreshScopeSwitch() {
    $$('.scope-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.scope === state.scope ? 'true' : 'false');
    });
    const group = $('.scope-switch');
    if (group) group.dataset.active = state.scope;
  }

  function setScope(next) {
    const target = next === 'china' ? 'china' : 'world';
    if (target === state.scope) return;
    // 切换地图范围时退出多选，避免把上一张地图的选择带过来
    state.tripEditing = false;
    state.tripSelection.clear();
    const editBtn = $('#tripEditBtn');
    if (editBtn) editBtn.setAttribute('aria-pressed', 'false');
    state.scope = target;
    saveScope();
    state.addPreview = null;
    state.addCountry = null;
    state.addProvince = null;
    state.selectedId = null;
    state.activeTripId = null;
    // The base map, the projection and the label set all change with the scope.
    buildMapBase();
    const places = sortedPlaces();
    state.selectedId = places[0]?.id || null;
    try {
      if (state.selectedId) localStorage.setItem(SELECT_KEY, state.selectedId);
      else localStorage.removeItem(SELECT_KEY);
    } catch (error) { /* ignore */ }
    refreshScopeSwitch();
    // Always come back to the whole map, centred, after a switch.
    renderAll({ rebuildMap: true });
    $('#memoryPanel').classList.add('is-hidden');
    $('#reopenMemory').hidden = !state.selectedId;
    frameWholeMap(true);
    showToast(target === 'china' ? '已切换到中国地图' : '已切换到世界地图');
  }

  function closeSidebar() {
    $('#sidebar').classList.remove('is-open');
    $('#sidebarScrim').classList.remove('is-visible');
  }

  function openSidebar() {
    $('#sidebar').classList.add('is-open');
    $('#sidebarScrim').classList.add('is-visible');
  }

  function bindEvents() {
    $('#addPlaceBtn').addEventListener('click', openAddDialog);
    $('#searchOpenBtn').addEventListener('click', openAddDialog);
    $('#homeBtn').addEventListener('click', openHomeDialog);
    $('#homeSearch').addEventListener('input', renderHomeResults);
    $('#clearHomeBtn').addEventListener('click', () => {
      state.home = null;
      saveHome();
      renderHomeBlock();
      closeDialog('homeDialog');
      renderAll({ rebuildMap: true, fit: true });
      showToast('已清除居住城市');
    });
    $$('.scope-btn').forEach((btn) => {
      btn.addEventListener('click', () => setScope(btn.dataset.scope));
    });
    $('#closeSidebar').addEventListener('click', closeSidebar);
    $('#openSidebar').addEventListener('click', openSidebar);
    $('#sidebarScrim').addEventListener('click', closeSidebar);
    $('#brandHome').addEventListener('click', (event) => {
      event.preventDefault();
      closeSidebar();
      fitRoute(true);
      showToast(sortedPlaces().length ? '已回到完整的旅行轨迹' : '地图正等你落下第一笔');
    });

  /* ------------------------------------------------------------- Share cards */
  // 生成分享图：左侧列城市，右侧是加了轨迹的地图。
  const SHARE_W = 1600;
  const SHARE_H = 1000;
  // 右侧地图区域：尽量占满，只给左侧文字留出约 1/3 的空间
  const SHARE_MAP = { x: 356, y: 30, w: 1206, h: 940 };

  const SHARE_STYLE = `
    .land-fill { fill: #8FA88D; }
    .land-coast { fill: none; stroke: #3F5C4C; stroke-width: 1.05; stroke-linejoin: round; }
    .land-dots { fill: url(#landDots); }
    .border-line { fill: none; stroke: #4E6A58; stroke-width: 1.15; stroke-linejoin: round; stroke-linecap: round; vector-effect: none; }
    .border-line.is-visible { opacity: 0.82; }
    .border-province.is-visible { opacity: 0.72; }
    .suez-canal { fill: none; stroke: #3F5C4C; stroke-width: 1.05; }
    .continent-label { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 10.5px; font-weight: 500; letter-spacing: 2.4px; fill: #2A453A; opacity: 0.78; paint-order: stroke; stroke: rgba(255,255,255,0.9); stroke-width: 2.3px; }
    .ocean-label { font-family: Consolas, monospace; font-size: 8.5px; letter-spacing: 3.8px; fill: #3D5A4A; opacity: 0.68; font-style: italic; paint-order: stroke; stroke: rgba(255,255,255,0.9); stroke-width: 2px; }
    .route-glow { fill: none; stroke: #25443B; stroke-width: 11; stroke-linecap: round; opacity: 0.11; vector-effect: none; }
    .route-line { fill: none; stroke: #25443B; stroke-width: 2.4; stroke-linecap: round; vector-effect: none; }
    .marker-halo { display: none; }
    .marker-ring { fill: #F4F1E6; stroke: #25443B; stroke-width: 1.5; }
    .marker-core { fill: #25443B; }
    .marker-index { display: none; }
    .marker-label rect { fill: rgba(246,243,232,0.94); stroke: rgba(37,68,59,0.2); stroke-width: 0.8; }
    .marker-label text { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: var(--label-font, 4.45px); font-weight: 600; fill: #25443B; letter-spacing: 0.11px; }
    .marker-label .label-code { font-family: Consolas, monospace; font-size: var(--label-code-font, 3.15px); font-weight: 400; letter-spacing: 0.4px; fill: #6E8574; }
    .label-metrics { display: none; }
    .label-leader { stroke: rgba(37,68,59,0.28); stroke-width: 0.55; stroke-dasharray: 1.4 1.6; }
    .marker-hit { display: none; }
    .home-marker .marker-ring, .map-marker.is-home .marker-ring { stroke-dasharray: 2 1.6; }
  `;

  function svgElShare(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  // 临时把地图切到指定范围，取一份干净的 SVG，再切回来。
  function withScopeSnapshot(scope, produce) {
    const prevScope = state.scope;
    const prevMap = { ...state.map };
    const prevSelected = state.selectedId;
    const prevTrip = state.activeTripId;
    const switched = scope !== prevScope;
    // 分享图里的城市名要再放大 25%，所以无论如何都按分享比例重建一次
    shareLabelScale = LABEL_SCALE_SHARE;
    state.scope = scope;
    state.selectedId = null;
    state.activeTripId = null;
    buildMapBase();
    renderMap();
    updateBorderVisibility();
    try {
      return produce();
    } finally {
      shareLabelScale = 1;
      state.scope = prevScope;
      state.selectedId = prevSelected;
      state.activeTripId = prevTrip;
      state.map = prevMap;
      buildMapBase();
      renderMap();
      applyMapTransform();
    }
  }

  // 陆地取景框：忽略撑大画面数百像素的小碎岛，只按主要陆块计算。
  function shareLandBox(cloneRoot) {
    const coast = cloneRoot.querySelector('#map-land .land-coast');
    if (!coast) return null;
    const d = coast.getAttribute('d') || '';
    const parts = d.split(/(?=M)/).filter((part) => part.trim());
    if (!parts.length) return null;

    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:0;height:0;overflow:visible');
    document.body.append(host);
    const boxes = [];
    try {
      const probePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      host.append(probePath);
      for (const part of parts) {
        probePath.setAttribute('d', part);
        const b = probePath.getBBox();
        if (b.width > 0 && b.height > 0) {
          boxes.push({ x: b.x, y: b.y, width: b.width, height: b.height, area: b.width * b.height });
        }
      }
    } catch (error) {
      boxes.length = 0;
    } finally {
      host.remove();
    }
    if (!boxes.length) {
      try { return coast.getBBox(); } catch (error) { return null; }
    }
    const largest = Math.max(...boxes.map((b) => b.area));
    // 0.2%：海南岛、台湾岛这种大岛参与取景，南海的像素级小岛不参与。
    const keep = boxes.filter((b) => b.area >= largest * 0.002);
    const box = {
      x: Math.min(...keep.map((b) => b.x)),
      y: Math.min(...keep.map((b) => b.y)),
      width: Math.max(...keep.map((b) => b.x + b.width)) - Math.min(...keep.map((b) => b.x)),
      height: Math.max(...keep.map((b) => b.y + b.height)) - Math.min(...keep.map((b) => b.y))
    };
    // 记下每段子路径，方便把被取景框切到一半的小岛整段剔除
    shareLandParts.parts = parts;
    shareLandParts.boxes = boxes;
    shareLandParts.largest = largest;
    return box;
  }

  const shareLandParts = { parts: [], boxes: [], largest: 0 };

  // 把地图层序列化成独立 SVG，并按轨迹范围取景。
  // ratio = 目标绘制区的宽高比，取景框按同一比例裁切，这样画面不会被拉伸或留黑边。
  function buildShareSvg(ratio) {
    const source = document.getElementById('travel-map');
    const clone = source.cloneNode(true);
    const content = clone.querySelector('#map-content');
    if (content) {
      // 视图变换现在写在 CSS（style.transform）里，属性里已经没有，两边都要清掉，
      // 否则分享图会带着屏幕上的缩放/位移。
      content.removeAttribute('transform');
      content.style.transform = '';
      content.style.transition = '';
    }

    // 分享图里所有轨迹一视同仁：去掉选中态与淡化。
    const routes = clone.querySelector('#map-routes');
    if (routes) {
      routes.classList.remove('has-selection');
      routes.querySelectorAll('.route-segment').forEach((seg) => {
        seg.classList.remove('is-active', 'is-hot');
      });
    }
    clone.querySelectorAll('.map-marker').forEach((marker) => {
      marker.classList.remove('is-selected');
      marker.querySelectorAll('.marker-halo').forEach((halo) => halo.remove());
    });

    // 取景：轨迹点 + 标记的包围盒
    const probe = document.createElement('div');
    probe.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:1200px;height:750px;opacity:0;pointer-events:none');
    probe.append(clone);
    document.body.append(probe);
    let box = null;
    try {
      const markers = clone.querySelector('#map-markers');
      const routeLayer = clone.querySelector('#map-routes');

      // 陆地用一个「按主体筛选」的包围盒：地图路径里散落着许多几像素的小岛，
      // 若把它们算进去（例如南海诸岛），整幅地图会被撑大、画面大量留白。
      // 只保留面积不小于最大块 10% 的陆地（大陆/大岛），小碎岛仍然会画出来，
      // 只是不再撑大取景框。
      const landBox = shareLandBox(clone);
      const boxes = [landBox, markers, routeLayer]
        .filter((b) => b && b.width > 0 && b.height > 0);
      if (boxes.length) {
        const minX = Math.min(...boxes.map((b) => b.x));
        const minY = Math.min(...boxes.map((b) => b.y));
        const maxX = Math.max(...boxes.map((b) => b.x + b.width));
        const maxY = Math.max(...boxes.map((b) => b.y + b.height));
        box = {
          minX: Math.max(0, minX),
          minY: Math.max(0, minY),
          maxX: Math.min(1440, maxX),
          maxY: Math.min(900, maxY)
        };
        if (box.maxX - box.minX < 20 || box.maxY - box.minY < 20) {
          box = { minX: 0, minY: 0, maxX: 1440, maxY: 900 };
        }
      }
    } catch (error) { /* ignore */ } finally {
      probe.remove();
    }
    if (!box) box = { minX: 0, minY: 0, maxX: 1440, maxY: 900 };

    // 只留一点点呼吸边距，让地图尽量占满
    const spanX = Math.max(1, box.maxX - box.minX);
    const spanY = Math.max(1, box.maxY - box.minY);
    const padX = Math.max(8, spanX * 0.018);
    const padY = Math.max(8, spanY * 0.018);
    let x0 = box.minX - padX;
    let y0 = box.minY - padY;
    let w = spanX + padX * 2;
    let h = spanY + padY * 2;

    // 取景框与绘制区同比例，画出来才不会被拉伸
    const targetRatio = ratio || 4 / 3;
    if (w / h < targetRatio) {
      const nextW = h * targetRatio;
      x0 -= (nextW - w) / 2;
      w = nextW;
    } else {
      const nextH = w / targetRatio;
      y0 -= (nextH - h) / 2;
      h = nextH;
    }

    // 碎岛若被取景框切到一半，会在画面边缘留下半个色块；整段丢掉更干净。
    const frame = { x0, y0, x1: x0 + w, y1: y0 + h };
    const keptParts = [];
    let dropped = 0;
    for (let i = 0; i < shareLandParts.parts.length; i += 1) {
      const part = shareLandParts.parts[i];
      const b = shareLandParts.boxes[i];
      if (!b) continue;
      const minor = b.area < shareLandParts.largest * 0.002;
      const inside = b.x >= frame.x0 - 0.5 && b.y >= frame.y0 - 0.5
        && b.x + b.width <= frame.x1 + 0.5 && b.y + b.height <= frame.y1 + 0.5;
      if (minor && !inside) { dropped += 1; continue; }
      keptParts.push(part);
    }
    if (dropped) {
      const kept = keptParts.join('');
      clone.querySelectorAll('#map-land .land-fill, #map-land .land-coast, #map-land .land-dots').forEach((node) => {
        node.setAttribute('d', kept);
      });
    }

    clone.setAttribute('viewBox', `${x0.toFixed(2)} ${y0.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
    clone.setAttribute('width', String(SHARE_MAP.w));
    clone.setAttribute('height', String(SHARE_MAP.h));
    clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    clone.removeAttribute('aria-label');
    clone.removeAttribute('role');

    const style = svgElShare('style', {});
    style.textContent = SHARE_STYLE;
    clone.insertBefore(style, clone.firstChild);

    return new XMLSerializer().serializeToString(clone);
  }

  function loadSvgImage(svgText) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('svg load failed'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    });
  }

  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const ch of String(text)) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 加载头像图片；没有头像或加载失败时返回 null，由调用方画首字母。
  function loadShareAvatar(src) {
    if (!src) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // 左上角：圆形头像 + 昵称，让分享图带点个人标记。
  function drawShareIdentity(ctx, avatarImage) {
    const size = 58;
    const x = 50;
    const y = 44;
    const centreX = x + size / 2;
    const centreY = y + size / 2;
    const nickname = (state.profile?.nickname || DEFAULT_PROFILE.nickname).slice(0, 12);
    const initial = avatarInitial(nickname);

    ctx.save();
    ctx.beginPath();
    ctx.arc(centreX, centreY, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (avatarImage) {
      const scale = Math.max(size / avatarImage.width, size / avatarImage.height);
      const w = avatarImage.width * scale;
      const h = avatarImage.height * scale;
      ctx.drawImage(avatarImage, centreX - w / 2, centreY - h / 2, w, h);
    } else {
      const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
      gradient.addColorStop(0, '#39D6C2');
      gradient.addColorStop(1, '#17A99A');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = '#F6F3EA';
      ctx.font = '600 24px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, centreX, centreY + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(centreX, centreY, size / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(37, 68, 59, 0.24)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 昵称
    const nameX = x + size + 14;
    ctx.fillStyle = '#25443B';
    ctx.font = '600 24px "Microsoft YaHei", "PingFang SC", sans-serif';
    let name = nickname;
    // 不要越过地图左边缘（x=356）
    const maxWidth = 196;
    if (ctx.measureText(name).width > maxWidth) {
      while (name.length > 1 && ctx.measureText(`${name}…`).width > maxWidth) name = name.slice(0, -1);
      name = `${name}…`;
    }
    ctx.fillText(name, nameX, y + 30);

    ctx.fillStyle = 'rgba(37, 68, 59, 0.5)';
    ctx.font = '400 14px Consolas, monospace';
    ctx.letterSpacing = '2px';
    ctx.fillText('TRAVEL ATLAS', nameX, y + 51);
    ctx.letterSpacing = '0px';

    return y + size + 26;
  }

  async function drawShareCard(scope, places, mapImage) {
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_W;
    canvas.height = SHARE_H;
    const ctx = canvas.getContext('2d');
    const cn = scope === 'china';

    ctx.fillStyle = '#ECE8DC';
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);

    // 地图放在中间偏右，圆角裁切
    const { x: mapX, y: mapY, w: mapW, h: mapH } = SHARE_MAP;
    ctx.save();
    roundedRect(ctx, mapX, mapY, mapW, mapH, 26);
    ctx.clip();
    ctx.fillStyle = '#DCE6D6';
    ctx.fillRect(mapX, mapY, mapW, mapH);
    // 等比铺满：SVG 取景比例与绘制区一致时这里正好严丝合缝
    const scale = Math.max(mapW / mapImage.width, mapH / mapImage.height);
    const drawW = mapImage.width * scale;
    const drawH = mapImage.height * scale;
    ctx.drawImage(mapImage, mapX + (mapW - drawW) / 2, mapY + (mapH - drawH) / 2, drawW, drawH);
    ctx.restore();
    ctx.save();
    roundedRect(ctx, mapX, mapY, mapW, mapH, 26);
    ctx.strokeStyle = 'rgba(37, 68, 59, 0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 左侧：头像 + 昵称，然后是标题与轨迹清单
    const left = 50;
    const avatarImage = await loadShareAvatar(state.profile?.avatar || '');
    let y = drawShareIdentity(ctx, avatarImage);
    ctx.fillStyle = 'rgba(37, 68, 59, 0.55)';
    ctx.font = '500 15px Consolas, monospace';
    ctx.letterSpacing = '4px';
    ctx.fillText('MY TRAVEL ATLAS', left, y);
    ctx.letterSpacing = '0px';

    y += 56;
    ctx.fillStyle = '#25443B';
    ctx.font = '600 42px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(cn ? '国内旅行轨迹' : '国际旅行轨迹', left, y);

    const trips = routeGroups(places);
    const cityCount = new Set(places.map((p) => p.city || p.country)).size;
    y += 40;
    ctx.fillStyle = 'rgba(37, 68, 59, 0.62)';
    ctx.font = '400 19px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(`${trips.length} 段旅程 · ${cityCount} 座城市`, left, y);

    y += 26;
    ctx.strokeStyle = 'rgba(37, 68, 59, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + 266, y);
    ctx.stroke();

    // 每段轨迹的城市列表
    y += 46;
    const limitBottom = SHARE_H - 120;
    let shownTrips = 0;
    for (let i = 0; i < trips.length; i += 1) {
      const group = trips[i];
      const cities = group.map((p) => p.city || p.country);
      const starts = group.map(placeStart).filter(Boolean).sort();
      const ends = group.map(placeEnd).filter(Boolean).sort();
      const stamp = starts.length ? formatMonthSpan(starts[0], ends[ends.length - 1] || starts[0]) : '未标日期';

      ctx.font = '600 16px Consolas, monospace';
      const headH = 22;
      ctx.font = '400 19px "Microsoft YaHei", "PingFang SC", sans-serif';
      const cityLines = wrapText(ctx, cities.join(' · '), 258);
      const blockH = headH + cityLines.length * 26 + 22;

      if (y + blockH > limitBottom && shownTrips > 0) {
        ctx.fillStyle = 'rgba(37, 68, 59, 0.55)';
        ctx.font = '400 17px "Microsoft YaHei", "PingFang SC", sans-serif';
        ctx.fillText(`…另有 ${trips.length - shownTrips} 段旅程`, left, y + 12);
        break;
      }

      ctx.fillStyle = '#0B6B62';
      ctx.font = '600 15px Consolas, monospace';
      ctx.fillText(`第 ${pad2(i + 1)} 段`, left, y + 6);
      ctx.fillStyle = 'rgba(37, 68, 59, 0.55)';
      ctx.font = '400 15px Consolas, monospace';
      ctx.fillText(stamp, left + 76, y + 6);

      y += headH + 8;
      ctx.fillStyle = '#25443B';
      ctx.font = '400 19px "Microsoft YaHei", "PingFang SC", sans-serif';
      for (const line of cityLines) {
        ctx.fillText(line, left, y + 10);
        y += 26;
      }
      y += 22;
      shownTrips += 1;
    }

    // 页脚
    ctx.fillStyle = 'rgba(37, 68, 59, 0.5)';
    ctx.font = '400 15px Consolas, monospace';
    ctx.fillText('赴迹 · TRAVEL ATLAS', left, SHARE_H - 56);

    return canvas;
  }

  async function buildShareCards() {
    const all = state.places.slice();
    const scopes = ['china', 'world'].filter((scope) => all.some((place) => (scope === 'china' ? place.code === 'CN' : place.code !== 'CN')));
    const cards = [];
    for (const scope of scopes) {
      const places = all
        .filter((place) => (scope === 'china' ? place.code === 'CN' : place.code !== 'CN'))
        .sort((a, b) => placeStart(a).localeCompare(placeStart(b)) || String(a.id).localeCompare(String(b.id)));
      const svgText = withScopeSnapshot(scope, () => buildShareSvg(SHARE_MAP.w / SHARE_MAP.h));
      const img = await loadSvgImage(svgText);
      const canvas = await drawShareCard(scope, places, img);
      cards.push({ scope, canvas, url: canvas.toDataURL('image/png') });
    }
    return cards;
  }

  function downloadCanvas(canvas, filename) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  async function openShareDialog() {
    if (!state.places.length) {
      showToast('先添加一段足迹，再分享你的地图');
      return;
    }
    const dialog = $('#shareDialog');
    const body = $('#sharePreview');
    const status = $('#shareStatus');
    body.replaceChildren();
    status.textContent = '正在生成分享图…';
    if (!dialog.open) dialog.showModal();

    let cards = [];
    try {
      cards = await buildShareCards();
    } catch (error) {
      status.textContent = '生成失败，请重试';
      return;
    }
    status.textContent = cards.length ? `已生成 ${cards.length} 张分享图` : '还没有可分享的轨迹';

    cards.forEach((card) => {
      const item = document.createElement('figure');
      item.className = 'share-card';
      const label = document.createElement('figcaption');
      label.textContent = card.scope === 'china' ? '国内轨迹' : '国际轨迹';
      const img = document.createElement('img');
      img.src = card.url;
      img.alt = card.scope === 'china' ? '国内旅行轨迹分享图' : '国际旅行轨迹分享图';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn-primary';
      save.textContent = '保存这张';
      save.addEventListener('click', () => {
        downloadCanvas(card.canvas, `赴迹-${card.scope === 'china' ? '国内' : '国际'}-轨迹.png`);
        showToast('分享图已保存');
      });
      item.append(img, label, save);
      body.append(item);
    });

    const saveAll = $('#shareSaveAll');
    saveAll.disabled = !cards.length;
    saveAll.onclick = () => {
      cards.forEach((card, index) => {
        setTimeout(() => downloadCanvas(card.canvas, `赴迹-${card.scope === 'china' ? '国内' : '国际'}-轨迹.png`), index * 350);
      });
      showToast(`已保存 ${cards.length} 张分享图`);
    };
  }

    $('#shareBtn').addEventListener('click', () => { openShareDialog(); });
    $('#shareClose').addEventListener('click', () => $('#shareDialog').close());
    $('#shareCancel').addEventListener('click', () => $('#shareDialog').close());

    $('#profileAvatarBtn').addEventListener('click', openProfileDialog);
    $('#avatarPickBtn').addEventListener('click', () => $('#profileAvatarInput').click());
    $('#profileAvatarInput').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const src = await readAvatarFile(file);
        openCropDialog(src);
      } catch (error) {
        const message = error.message === 'too-large' ? '图片超过 20MB，请换一张' : '无法读取这张图片，请换一张试试';
        showToast(message);
      }
    });
    bindCropInteractions();
    $('#removeAvatarBtn').addEventListener('click', () => {
      state.pendingAvatar = '';
      renderProfileEditorAvatar();
    });
    $('#profileNickname').addEventListener('input', renderProfileEditorAvatar);
    $('#saveProfileBtn').addEventListener('click', () => {
      const nickname = $('#profileNickname').value.trim().slice(0, 20) || DEFAULT_PROFILE.nickname;
      state.profile = { nickname, avatar: state.pendingAvatar || '' };
      const stored = saveProfile();
      applyProfile();
      closeDialog('profileDialog');
      showToast(stored ? '个人资料已更新' : '资料已更新，但未能写入本机存储');
    });

    $('#zoomIn').addEventListener('click', () => zoomMapAt(690, 440, 1.18));
    $('#zoomOut').addEventListener('click', () => zoomMapAt(690, 440, 0.85));
    $('#fitMap').addEventListener('click', () => fitRoute(true));

    $('#closeMemory').addEventListener('click', () => {
      $('#memoryPanel').classList.add('is-hidden');
      $('#reopenMemory').hidden = false;
      $('#placeMenu').hidden = true;
    });
    $('#reopenMemory').addEventListener('click', () => {
      $('#memoryPanel').classList.remove('is-hidden');
      $('#reopenMemory').hidden = true;
    });

    $('#prevPlace').addEventListener('click', () => {
      const places = sortedPlaces();
      const index = places.findIndex((p) => p.id === state.selectedId);
      if (index > 0) selectPlace(places[index - 1].id, { openPanel: true });
    });
    $('#nextPlace').addEventListener('click', () => {
      const places = sortedPlaces();
      const index = places.findIndex((p) => p.id === state.selectedId);
      if (index >= 0 && index < places.length - 1) selectPlace(places[index + 1].id, { openPanel: true });
    });

    $('#editNoteBtn').addEventListener('mousedown', (event) => {
      if (state.noteEditing) event.preventDefault();
    });
    $('#editNoteBtn').addEventListener('click', () => {
      if (state.noteEditing) stopNoteEditing(true);
      else startNoteEditing();
    });
    let noteSaveTimer = null;
    $('#noteEditor').addEventListener('input', () => {
      clearTimeout(noteSaveTimer);
      const place = selectedPlace();
      if (!place) return;
      const value = $('#noteEditor').value.trim();
      noteSaveTimer = setTimeout(() => {
        place.note = value;
        savePlaces();
      }, 450);
    });
    $('#noteEditor').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        const place = selectedPlace();
        if (place) $('#noteEditor').value = place.note || '';
        stopNoteEditing(false);
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        stopNoteEditing(true);
      }
    });

    $('#uploadBtn').addEventListener('click', () => $('#mediaInput').click());
    $('#mediaInput').addEventListener('change', async (event) => {
      const files = event.target.files;
      if (files?.length) await addMediaFiles(files);
      event.target.value = '';
    });
    $('#openAlbumBtn').addEventListener('click', openAlbum);
    // Deleting always happens in the full album view.
    $('#editMediaBtn').addEventListener('click', () => openAlbum({ editing: true }));
    $('#albumEditBtn').addEventListener('click', () => {
      if (state.albumEditing) exitAlbumEditing();
      else openAlbum({ editing: true });
    });
    $('#albumSelectAll').addEventListener('click', toggleAlbumSelectAll);
    $('#albumEditCancel').addEventListener('click', exitAlbumEditing);
    $('#albumDeleteBtn').addEventListener('click', deleteAlbumSelection);
    $('#albumDialog').addEventListener('close', () => {
      state.albumEditing = false;
      state.albumSelection.clear();
    });

    $('#lightboxClose').addEventListener('click', closeLightbox);
    $('#lightboxPrev').addEventListener('click', () => {
      if (state.lightboxIndex > 0) {
        state.lightboxIndex -= 1;
        updateLightbox();
      }
    });
    $('#lightboxNext').addEventListener('click', () => {
      const place = selectedPlace();
      if (place && state.lightboxIndex < place.media.length - 1) {
        state.lightboxIndex += 1;
        updateLightbox();
      }
    });
    $('#lightboxDelete').addEventListener('click', deleteCurrentMedia);

    $('#placeMenuBtn').addEventListener('click', (event) => {
      event.stopPropagation();
      $('#placeMenu').hidden = !$('#placeMenu').hidden;
    });
    $('#editDateBtn').addEventListener('click', openDateDialog);
    $('#dateDialogCancel').addEventListener('click', closeDateDialog);
    $('#dateDialogOk').addEventListener('click', saveDateDialog);
    $('#dateDialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDateDialog();
    });
    $('#tripEditBtn').addEventListener('click', () => setTripEditing(!state.tripEditing));
    $('#tripEditDone').addEventListener('click', () => setTripEditing(false));
    $('#tripDeleteSelected').addEventListener('click', () => { deleteSelectedTrips(); });
    $('#tripSelectAll').addEventListener('click', () => {
      const ids = routeGroups(sortedPlaces()).map((group) => group[0].tripId || '__legacy');
      const allChosen = ids.length && ids.every((id) => state.tripSelection.has(id));
      state.tripSelection.clear();
      if (!allChosen) ids.forEach((id) => state.tripSelection.add(id));
      renderSidebar();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.tripEditing) setTripEditing(false);
    });
    $('#removePlaceBtn').addEventListener('click', removeSelectedPlace);
    $('#closeMenuBtn').addEventListener('click', () => { $('#placeMenu').hidden = true; });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#placeMenu') && !event.target.closest('#placeMenuBtn')) {
        $('#placeMenu').hidden = true;
      }
    });

    $('#destinationSearch').addEventListener('input', renderDestinationResults);
    $('#savePlaceBtn').addEventListener('click', saveNewPlace);
    // The travel dates gate the save button, so refresh it as they change.
    ['#visitDateStart', '#visitDateEnd', '#visitDate2Start', '#visitDate2End'].forEach((selector) => {
      const input = $(selector);
      if (!input) return;
      input.addEventListener('input', () => { syncDatePlaceholders(); updateAddState(); });
      input.addEventListener('change', () => { syncDatePlaceholders(); updateAddState(); });
      input.addEventListener('blur', syncDatePlaceholders);
      input.addEventListener('focus', syncDatePlaceholders);
    });
    ['#dateDialogStart', '#dateDialogEnd', '#dateDialog2Start', '#dateDialog2End'].forEach((selector) => {
      const input = $(selector);
      if (!input) return;
      ['input', 'change', 'blur', 'focus'].forEach((type) => input.addEventListener(type, syncDatePlaceholders));
    });
    syncDatePlaceholders();

    $$('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => closeDialog(button.dataset.closeDialog));
    });
    ['addDialog', 'albumDialog', 'profileDialog', 'homeDialog'].forEach((id) => {
      const dialog = document.getElementById(id);
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    });
    $('#albumDialog').addEventListener('close', () => {
      state.lightboxAlbumOpen = false;
    });

    $('#confirmOk').addEventListener('click', () => settleConfirm(true));
    $('#confirmCancel').addEventListener('click', () => settleConfirm(false));
    $('#confirmDialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      settleConfirm(false);
    });

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openAddDialog();
      }
      if (event.key === 'Escape') {
        if ($('#lightbox').open) closeLightbox();
        else if ($('#sidebar').classList.contains('is-open')) closeSidebar();
      }
      if ($('#lightbox').open && event.key === 'ArrowLeft') $('#lightboxPrev').click();
      if ($('#lightbox').open && event.key === 'ArrowRight') $('#lightboxNext').click();
    });

    window.addEventListener('resize', () => {
      invalidateMapViewport();
      if (window.innerWidth > 980) closeSidebar();
      const isMobile = window.innerWidth <= 760;
      if (isMobile !== wasMobileViewport) {
        wasMobileViewport = isMobile;
        renderMap();
        state.baseK = wholeMapFrame().k;
        fitRoute();
        applyMapTransform();
      }
    });
  }

  async function init() {
    state.places = loadPlaces();
    state.scope = loadScope();
    state.home = loadHome();
    loadProfile();
    refreshScopeSwitch();
    let storedSelection = null;
    try { storedSelection = localStorage.getItem(SELECT_KEY); } catch (error) { /* ignore */ }
    const selectable = state.places.filter(inScope);
    const homeSelection = storedSelection === 'home' && Boolean(loadHome());
    state.selectedId = homeSelection || selectable.some((p) => p.id === storedSelection)
      ? storedSelection
      : (sortedPlaces()[0]?.id || null);
    // Keep the sidebar card of the restored city highlighted too.
    const restored = state.places.find((place) => place.id === state.selectedId);
    state.activeTripId = restored ? (restored.tripId || '__legacy') : null;

    await hydrateMedia();
    buildMapBase();
    state.baseK = wholeMapFrame().k;
    applyMapTransform();
    initMapInteraction();
    bindEvents();
    applyProfile();
    renderAll({ rebuildMap: true, fit: true });
    if (window.innerWidth <= 760) {
      // On a phone, let the map breathe until the visitor asks for details.
      $('#memoryPanel').classList.add('is-hidden');
      $('#reopenMemory').hidden = !state.selectedId;
    }
    requestAnimationFrame(() => fitRoute(false));

    // Warm up IndexedDB quietly so the first upload is instant.
    openMediaDB().catch(() => {});

    registerServiceWorker();
    window.__atlasReady = true;

    // "添加到主屏幕"快捷方式：?action=add 直接打开记录弹窗。
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('action') === 'add') setTimeout(openAddDialog, 600);
    } catch (error) { /* ignore */ }
  }

  // Offline shell for the installed app. Skipped on file:// where it cannot work.
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  init();
})();
