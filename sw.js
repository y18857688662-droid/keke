self.addEventListener('push', (e) => {
  let data = { title: '克', body: '发来了一条消息' };
  try { data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/static/icon.svg',
      badge: '/static/icon.svg',
      tag: 'ke-msg',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        if (c.url.includes('/chat') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/chat');
    })
  );
});
