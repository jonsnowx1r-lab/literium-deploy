/**
 * Service Worker بسيط ومقصود: يخزّن فقط ملفات الواجهة الثابتة (JS/CSS/
 * خطوط/صور من /assets و/icon.png) لتسريع التحميلات المتكررة وتحسين
 * موثوقية فتح التطبيق — لا يتدخل إطلاقاً في طلبات API أو Firebase/
 * Firestore أو أي طلب POST، حتى لا تصل بيانات قديمة (أرصدة، رسائل،
 * إشعارات) من ذاكرة تخزين مؤقت بدل الخادم الحي.
 */
const CACHE_NAME = 'literium-static-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname === '/icon.png' ||
      url.pathname === '/manifest.json' ||
      /\.(js|css|woff2?|png|jpg|jpeg|svg)$/i.test(url.pathname))
  );
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!isStaticAsset(url)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
