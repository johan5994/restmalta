// v2 — le numéro de version change ici force TOUS les visiteurs déjà
// installés à recevoir ce nouveau Service Worker et à jeter leur ancien
// cache. Sans ça, quelqu'un qui a déjà visité le site continue de
// recevoir indéfiniment les vieilles pages HTML en cache, même après
// un vrai déploiement — c'est exactement le bug qui causait "j'ai
// remplacé le fichier mais rien ne change" à plusieurs reprises.
const CACHE = 'restmalta-v2';
const STATIC = [
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:wght@300;400;500;600&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/supabase.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Jamais de cache pour les appels API — toujours du direct.
  if (e.request.url.includes('supabase.co') || e.request.url.includes('clerk')) {
    return;
  }

  const isNavigation = e.request.mode === 'navigate' || e.request.destination === 'document';
  const isAppScript = e.request.url.endsWith('.html') || e.request.url.endsWith('.js');

  if (isNavigation || isAppScript) {
    // Réseau d'abord pour toute page HTML ou script de l'appli — jamais
    // servir une version en cache tant qu'une vraie tentative réseau n'a
    // pas échoué. C'est ce qui garantit que tout déploiement est visible
    // immédiatement, sans que l'utilisateur ait à vider son cache lui-même.
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Cache d'abord uniquement pour les vrais fichiers statiques qui ne
  // changent presque jamais (polices, librairie Supabase) — la vitesse
  // compte plus que la fraîcheur pour ceux-là.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// Push notifications (future)
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  self.registration.showNotification(data.title || 'RestMalta', {
    body: data.body || 'You have a new notification',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
