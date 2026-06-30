self.addEventListener('push', (e) => {
  let data = { title: '克', body: '发来了一条消息' };
  try { data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: 'ke-msg-' + Date.now(),
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        if (c.url.includes('/chat') && 'focus' in c) {
          c.navigate('/chat');
          return c.focus();
        }
      }
      return clients.openWindow('/chat');
    })
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/chat')));
  }
});
