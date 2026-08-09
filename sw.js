// ═══════════════════════════════════════════════════════════════════════════
// SERVICE WORKER — IranCourtsMap
// Strategy:
//   • Static assets (HTML, CSS, JS, fonts) → cache-first, update in background
//   • GeoJSON boundaries                   → cache-first, never expire
//   • Court JSON data files                → cache-first, never expire
//   • Map tiles (OpenStreetMap)            → cache-first, max 500 tiles
//   • Nominatim / Photon geocoding API     → network-only (always fresh)
// ═══════════════════════════════════════════════════════════════════════════

const STATIC_CACHE  = "irancourts-static-v1";
const TILES_CACHE   = "irancourts-tiles-v1";
const DATA_CACHE    = "irancourts-data-v1";

const MAX_TILES = 500; // ~5 MB at ~10 KB/tile

// Files to precache on install — these load before the user does anything
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/app.js",
  "/style.css",
  "/data/boundaries/irn_admin1_simplified.geojson",
  "/data/boundaries/irn_admin2_simplified.geojson",
  "/data/tehran-districts.json",
  // All 31 province court files
  "/data/courts/alborz.json",
  "/data/courts/ardabil.json",
  "/data/courts/bushehr.json",
  "/data/courts/chaharmahal-and-bakhtiari.json",
  "/data/courts/east-azerbaijan.json",
  "/data/courts/fars.json",
  "/data/courts/Gilan.json",
  "/data/courts/golestan.json",
  "/data/courts/hamadan.json",
  "/data/courts/hormozgan.json",
  "/data/courts/ilam.json",
  "/data/courts/isfahan.json",
  "/data/courts/kerman.json",
  "/data/courts/kermanshah.json",
  "/data/courts/khuzestan.json",
  "/data/courts/kohgiluyeh-and-boyer-ahmad.json",
  "/data/courts/kurdistan.json",
  "/data/courts/lorestan.json",
  "/data/courts/markazi.json",
  "/data/courts/mazandaran.json",
  "/data/courts/north-khorasan.json",
  "/data/courts/qazvin.json",
  "/data/courts/qom.json",
  "/data/courts/razavi-khorasan.json",
  "/data/courts/semnan.json",
  "/data/courts/sistan-and-baluchestan.json",
  "/data/courts/south-khorasan.json",
  "/data/courts/tehran.json",
  "/data/courts/west-azerbaijan.json",
  "/data/courts/yazd.json",
  "/data/courts/zanjan.json",
];

// ── Install: precache all static + data assets ───────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // addAll fetches and caches everything; if any file 404s it throws,
      // so missing optional files should be removed from PRECACHE_URLS.
      cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn("[SW] Precache partial failure:", err);
        // Cache what we can, one by one, ignoring 404s
        return Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => {
              console.warn("[SW] Skipping:", url);
            }),
          ),
        );
      }),
    ),
  );
  // Take over immediately — don't wait for old SW to be released
  self.skipWaiting();
});

// ── Activate: delete old caches from previous versions ───────────────────────

self.addEventListener("activate", (event) => {
  const KNOWN_CACHES = [STATIC_CACHE, TILES_CACHE, DATA_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !KNOWN_CACHES.includes(key))
          .map((key) => {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          }),
      ),
    ),
  );
  // Claim all clients so the SW is active for the current page immediately
  self.clients.claim();
});

// ── Fetch: route each request to the right strategy ──────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and same-origin POSTs
  if (request.method !== "GET") return;

  // ── Geocoding APIs → network only (never cache search results) ────────────
  if (
    url.hostname === "nominatim.openstreetmap.org" ||
    url.hostname === "photon.komoot.io"
  ) {
    return; // let browser handle it
  }

  // ── OSM map tiles → cache-first, then trim if over limit ─────────────────
  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(tilesCacheFirst(request));
    return;
  }

  // ── GeoJSON boundaries + court JSON → cache-first (data never changes) ───
  if (
    url.pathname.startsWith("/data/boundaries/") ||
    url.pathname.startsWith("/data/courts/") ||
    url.pathname.startsWith("/data/tehran")
  ) {
    event.respondWith(dataCacheFirst(request));
    return;
  }

  // ── Static assets (HTML, CSS, JS, fonts) → stale-while-revalidate ────────
  if (
    url.origin === self.location.origin ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com")
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});

// ── Strategy: cache-first, fall back to network, then cache the response ─────

async function dataCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Network error", { status: 503 });
  }
}

// ── Strategy: tiles cache-first with LRU-ish trimming ────────────────────────

async function tilesCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(TILES_CACHE);
      cache.put(request, response.clone());
      trimCache(TILES_CACHE, MAX_TILES);
    }
    return response;
  } catch {
    return new Response("Tile unavailable offline", { status: 503 });
  }
}

// ── Strategy: stale-while-revalidate ─────────────────────────────────────────
// Serve from cache immediately, then fetch a fresh copy in the background
// so next visit gets the update.

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

// ── Trim tile cache to MAX_TILES entries ─────────────────────────────────────

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // Delete oldest entries (keys are ordered by insertion time)
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}