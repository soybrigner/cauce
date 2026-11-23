/* Cauce: guarda la app en el celular para que abra sin internet. Tus datos viven en el navegador del dispositivo. */
const V = 'cauce-7f3f6459';
const SRI = { 'app': 'sha384-ZaR6mWzmJtrRibZ1Vm7SoHFr8OXjyAuGAXalGDKqbxFT18oi/z+oZLIRFkpeNor1', 'auth': 'sha384-I1LYojsZ5RM1cOda44Z2h42Qa6YfsQ1XkXxREnhp4ueYBR/4d1pG1K+NZM537Vsj', 'firestore': 'sha384-Ke0FJhH7LyRqDxZ0wt+/OXV38yfQVu7g9VPEEGjYmB4RVOY/ta04uecRhsMwT7V3' };
const SDK = Object.keys(SRI).map(n => ['https://www.gstatic.com/firebasejs/10.14.1/firebase-' + n + '-compat.js', SRI[n]]);
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'firebase-config.js', 'cauce-firebase.js', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const ASSET_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(SDK.map(x => c.add(new Request(x[0], { mode: 'cors', credentials: 'omit', integrity: x[1] })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V && k.indexOf('cauce-') === 0) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  // la página: primero internet (así llegan las versiones nuevas); si tarda o no hay, la guardada
  if (r.mode === 'navigate') {
    e.respondWith((async () => {
      const net = fetch(r).then(res => { if (res && res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put('index.html', cp)); } return res; });
      const first = await Promise.race([net.catch(() => null), new Promise(ok => setTimeout(() => ok(null), 3500))]);
      if (first) return first;
      const cached = await caches.match('index.html') || await caches.match('./');
      return cached || net.catch(() => new Response('Sin internet y todavía no se ha guardado la app. Ábrela una vez con internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    })());
    return;
  }

  // archivos de la app y letras: lo guardado al instante y se actualiza por detrás
  if (u.origin === location.origin || ASSET_HOSTS.indexOf(u.hostname) >= 0) {
    e.respondWith((async () => {
      const c = await caches.open(V), hit = await c.match(r, { ignoreSearch: u.origin === location.origin });
      const upd = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(upd); return hit; }
      return (await upd) || new Response('', { status: 504 });
    })());
  }
});
