// ============================================================
// Service Worker - الرسائل العملية (PWA)
// ============================================================
// عند تغيير أي ملف من ملفات التطبيق (index.html / app.js / manifest.json
// / الأيقونات)، يجب رفع رقم النسخة هنا (CACHE_VERSION) حتى يحدّث
// المتصفح النسخة المخزّنة عند المستخدمين.
const CACHE_VERSION = 'v10';
const CACHE_NAME = `rasael-amaliyah-${CACHE_VERSION}`;

// ملفات "هيكل" التطبيق - تُخزَّن فوراً عند التثبيت (صغيرة وسريعة)
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/marja/sistani.jpg',
  './icons/marja/khamenei.jpg',
  './icons/marja/khoei.jpg',
  './icons/marja/khomeini.jpg',
  './icons/marja/fayyad.jpg',
  './icons/marja/sadiq_shirazi.jpg',
  './icons/marja/waheed_khorasani.jpg',
  './icons/marja/mohammad_shirazi.jpg',
];

// ---------- INSTALL: تخزين هيكل التطبيق ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ---------- ACTIVATE: حذف الكاش القديم عند تحديث النسخة ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// ---------- FETCH ----------
// استراتيجية عامة: "الكاش أولاً، ثم الشبكة" لكل الملفات.
// قاعدة البيانات books.db وملفات sql.js (من cdnjs) ضخمة/خارجية، فلا
// نخزّنها عند التثبيت، بل نخزّنها أول مرة تُطلب فيها بنجاح من الشبكة،
// وبعد ذلك تُقرأ من الكاش دائماً (= تعمل بدون إنترنت).
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // لا نتدخل في طلبات غير GET
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((networkResponse) => {
          // لا نخزّن الردود الفاشلة
          if (!networkResponse || networkResponse.status >= 400) {
            return networkResponse;
          }
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, cloned));
          return networkResponse;
        })
        .catch(() => {
          // لا يوجد إنترنت ولا يوجد كاش لهذا الطلب
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});
