/* 赴迹 · 离线缓存
   只缓存程序本体（HTML/CSS/JS/地图数据/地标图），用户的照片与手记在 IndexedDB 里，
   完全不经过这里，所以升级缓存不会碰到个人数据。 */

const VERSION = 'atlas-v2';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './data/world-map.js',
  './data/china-map.js',
  './data/borders.js',
  './data/china-cities-extra.js',
  './data/cities.js',
  './data/landmarks.js',
  './assets/brand/logo.png',
  './assets/brand/icon-192.png',
  './assets/brand/icon-512.png',
  './assets/brand/icon-maskable-512.png',
  './assets/brand/apple-touch-icon.png',
  './assets/cities/generic.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：先走网络，断网时回退到缓存的首页。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true })
        .then((hit) => hit || caches.match('./', { ignoreSearch: true })))
    );
    return;
  }

  // 其余静态资源：命中缓存就直接用，顺便在后台补一份新版本。
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        fetch(request)
          .then((response) => {
            if (response && response.ok) cachePut(request, response);
          })
          .catch(() => {});
        return hit;
      }
      return fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') cachePut(request, response);
          return response;
        })
        .catch(() => hit);
    })
  );
});

function cachePut(request, response) {
  // Store one entry per file, without the cache-busting query string.
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  caches.open(VERSION).then((cache) => cache.put(key, response.clone())).catch(() => {});
}