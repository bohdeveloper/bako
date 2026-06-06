// BAKO Service Worker — Web Push + cache offline básico
const CACHE = 'bako-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Push: mostrar notificación del sistema aunque la app esté cerrada
self.addEventListener('push', event => {
  let data = { text: 'Nueva notificación de BAKO', voiceText: '' };
  try { data = event.data?.json() ?? data; } catch {}

  const title   = 'BAKO';
  const body    = data.text.replace(/\*|_|`/g, '').slice(0, 200);
  const options = {
    body,
    icon:    '/bako-client/icon-192.png',
    badge:   '/bako-client/icon-192.png',
    vibrate: [200, 100, 200],
    tag:     'bako-notif',
    renotify: true,
    data:    { voiceText: data.voiceText, url: '/bako-client/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click en notificación: abrir/enfocar la app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes('/bako-client'));
      if (existing) return existing.focus();
      return self.clients.openWindow(event.notification.data?.url ?? '/bako-client/');
    })
  );
});
