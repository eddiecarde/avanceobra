// Service worker de AvanceObra (web instalable). Guarda la "cáscara" de la app para abrirla sin
// señal: páginas visitadas (red primero, si no hay red la última copia) y archivos estáticos
// (copia primero). Los datos (Supabase) no pasan por aquí: los maneja la cola de campo.
const VERSION = "v2";
const PAGES = `avanceobra-paginas-${VERSION}`;
const STATIC = `avanceobra-estaticos-${VERSION}`;
const PRECACHE = ["/campo", "/campo/parte", "/campo/hallazgo", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("avanceobra-") && k !== PAGES && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Archivos estáticos con huella (no cambian): copia primero
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Páginas: red primero; sin red, la última copia de esa página o la de registrar avance
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(PAGES).then((c) => c.put(url.pathname, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(url.pathname, { ignoreSearch: true })) || (await caches.match("/campo")) || Response.error()),
    );
  }
});
