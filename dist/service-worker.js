self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }

  const title = payload.title || (payload.channel === 'whatsapp' ? 'WhatsApp message' : 'Messenger message');
  const options = {
    body: payload.body || 'You have a new message.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: payload.tag || `mamepilot-${payload.channel || 'message'}-${payload.contactId || 'inbox'}`,
    renotify: false,
    data: { url: payload.url || '/', channel: payload.channel || '', contactId: payload.contactId || '' },
  };

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const activeConversation = clients.find((client) => {
      if (!client.focused) return false;
      try {
        const url = new URL(client.url);
        const [route, query = ''] = url.hash.slice(1).split('?');
        return route === `/${payload.channel}` && new URLSearchParams(query).get('contactId') === String(payload.contactId || '');
      } catch { return false; }
    });
    if (activeConversation) {
      activeConversation.postMessage({ type: 'MAMEPILOT_CHAT_PUSH', payload });
      return;
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});