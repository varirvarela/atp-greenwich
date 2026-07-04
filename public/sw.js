// ATP Greenwich — Service Worker
// Handles: push notifications, notification click routing

const APP_SCOPE = '/atp-greenwich/';

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'ATP Greenwich', body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(data.title || 'ATP Greenwich', {
      body:     data.body  || '',
      icon:     APP_SCOPE + 'icons/icon-192.png',
      badge:    APP_SCOPE + 'icons/icon-96.png',
      data:     { url: data.url || APP_SCOPE },
      tag:      data.tag  || 'atp',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || APP_SCOPE;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin + APP_SCOPE) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
