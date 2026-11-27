const CACHE = "layers-shell-v3";
const WORKSPACES = ["/", "/demo"];
const SHELL = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
async function rememberPage(cache, path, page) {
  const html = await page.clone().text();
  const assets = [
    ...new Set(
      Array.from(
        html.matchAll(/\/(?:_next\/static)\/[^"'<>\s\\]+\.(?:js|css)/g),
        (m) => m[0],
      ),
    ),
  ];
  if (!assets.length) return;
  await Promise.all(
    assets.map(async (asset) => {
      if (!(await cache.match(asset))) await cache.add(asset);
    }),
  );
  await cache.put(path, page);
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      const page = await fetch("/", { cache: "reload" });
      if (page.ok) await rememberPage(cache, "/", page);
      try {
        const demo = await fetch("/demo", { cache: "reload" });
        if (demo.ok) await rememberPage(cache, "/demo", demo);
      } catch {}
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("layers-shell-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/")
  )
    return;
  if (event.request.mode === "navigate" && WORKSPACES.includes(url.pathname)) {
    const network = fetch(event.request);
    event.waitUntil(
      network
        .then(async (result) => {
          if (result.ok)
            await rememberPage(
              await caches.open(CACHE),
              url.pathname,
              result.clone(),
            );
        })
        .catch(() => {}),
    );
    event.respondWith(network.catch(() => caches.match(url.pathname)));
  } else if (
    url.pathname.startsWith("/_next/static/") ||
    SHELL.includes(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const saved = await cache.match(event.request);
        if (saved) return saved;
        const result = await fetch(event.request);
        if (result.ok) await cache.put(event.request, result.clone());
        return result;
      })(),
    );
  }
});
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch {}
  event.waitUntil(
    self.registration.showNotification("Layers Pro", {
      body: data.message || "You have a farm reminder",
      icon: "/icon-192.png",
      tag: data.id,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/?tab=Schedules"));
});
