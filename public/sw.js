// Service worker MoggTrack : l'appli s'ouvre même hors connexion,
// avec les dernières données consultées.
const SHELL_CACHE = 'moggtrack-shell-v6';
const API_CACHE = 'moggtrack-api';
const FONT_CACHE = 'moggtrack-fonts';
const SHELL = [
  '/',
  '/js/logic.js',
  '/js/core.js',
  '/js/outbox.js',
  '/js/suggestions.js',
  '/js/auth.js',
  '/js/rest-timer.js',
  '/js/sound.js',
  '/js/calendar.js',
  '/js/session-form.js',
  '/js/duplicate.js',
  '/js/workout.js',
  '/js/templates.js',
  '/js/perfs.js',
  '/js/settings.js',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Le son choisi par l'utilisateur est gardé d'une version à l'autre
  const keep = [SHELL_CACHE, API_CACHE, FONT_CACHE, 'moggtrack-sound'];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// --- FIN DE REPOS ---
// Envoyée par le serveur. On affiche toujours la notification : Safari retire
// l'abonnement aux applis qui reçoivent des push sans rien montrer.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(self.registration.showNotification(data.title || 'Repos terminé', {
    body: data.body || 'C\'est reparti !',
    tag: 'rest-timer',
    icon: '/icons/icon-192.png',
    vibrate: [200, 100, 200]
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length) return windows[0].focus();
    return self.clients.openWindow('/');
  })());
});

// Réseau d'abord (pour avoir les données à jour), cache en secours
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Seules les données utiles hors connexion sont gardées ; export, appareils et état restent en direct
    if (/^\/api\/(sessions|templates|top-perfs)/.test(url.pathname)) event.respondWith(networkFirst(request, API_CACHE));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(new Request('/'), SHELL_CACHE));
  } else {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});
