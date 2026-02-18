/**
 * sw.js — Sniff Service Worker
 * Handles push notifications from the server.
 * 🐕 Sniff barks even when the tab is closed!
 */

self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  self.registration.showNotification(data.title || '🐕 Sniff Alert', {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.type || 'sniff-alert',
    renotify: true,
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
