/*
 * Genesis Vault — Service Worker
 *
 * 設計方針（ADR-0019）:
 * - 静かな日記にふさわしく、キャッシュは読者に見えないところでだけ働く
 * - ペイウォールの境界（INV-009 / INV-010）を壊さない:
 *   `/api/*` は一切加工しない。署名 Cookie の検証はサーバー側のみで行われ、
 *   ゲート記事の本文はこのキャッシュに一度も載らない（静的ビルドに本文が無い）
 * - 戦略:
 *     ナビゲーション   → network-first（4秒で諦めてキャッシュ → /offline/）
 *     /_astro/*        → cache-first（内容ハッシュ付きの不変アセット）
 *     /pagefind/*      → stale-while-revalidate
 *     同一オリジン他    → stale-while-revalidate
 *     Google Fonts     → stale-while-revalidate
 *     上記以外         → SW から手を付けない（既定のブラウザ挙動に任せる）
 * - 更新はユーザー主導。waiting がいるときだけ静かなトーストを出し、
 *   「更新する」が押されたときだけ skipWaiting → reload する
 */

const VERSION = 'v1';
const STATIC_CACHE = `gv-static-${VERSION}`;
const RUNTIME_CACHE = `gv-runtime-${VERSION}`;
const FONT_CACHE = `gv-fonts-${VERSION}`;
const KNOWN_CACHES = [STATIC_CACHE, RUNTIME_CACHE, FONT_CACHE];

// インストール時に先読みするアプリシェル。1件でも失敗したら
// インストールごと落とすより、入った分だけ受け入れる（allSettled）。
const PRECACHE_URLS = [
  '/',
  '/about/',
  '/agents/',
  '/status/',
  '/offline/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/mina-profile.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const NAV_TIMEOUT_MS = 4000;
const RUNTIME_MAX_ENTRIES = 60;

/** Cache Storage API への書き込みはすべて失敗を握りつぶす（背景更新は best-effort）。 */
async function putQuietly(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (_err) {
    /* no-op */
  }
}

/** 古いエントリを末尾から刈り込む。刻限までは作らない。 */
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    for (const key of keys.slice(0, keys.length - maxEntries)) {
      await cache.delete(key);
    }
  } catch (_err) {
    /* no-op */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok) await cache.put(url, res);
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('gv-') && !KNOWN_CACHES.includes(name)).map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (_err) {
          /* no-op */
        }
      }
      await self.clients.claim();
    })(),
  );
});

/** ナビゲーション: network-first。タイムアウトしたらキャッシュ、最後に /offline/。 */
async function navigate(request, preloadResponse) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(undefined), NAV_TIMEOUT_MS));
  try {
    const preloaded = await preloadResponse;
    if (preloaded) {
      await putQuietly(RUNTIME_CACHE, request, preloaded.clone());
      await trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES);
      return preloaded;
    }
  } catch (_err) {
    /* preload 失敗時は通常の fetch にフォールバック */
  }
  try {
    const fresh = await Promise.race([fetch(request), timeout]);
    if (fresh && fresh.ok) {
      await putQuietly(RUNTIME_CACHE, request, fresh.clone());
      await trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES);
      return fresh;
    }
    if (fresh) return fresh;
  } catch (_err) {
    /* オフライン → キャッシュへ */
  }
  const cached =
    (await caches.match(request)) ||
    (await caches.match(`${request.url}/`)) ||
    (await caches.match(`${request.url}/index.html`)) ||
    (await caches.match('/', { ignoreSearch: true }));
  return cached || (await caches.match('/offline/')) || Response.error();
}

/** cache-first: 主に /_astro/*（内容ハッシュ付き）。 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) {
    await putQuietly(RUNTIME_CACHE, request, fresh.clone());
    await trimCache(RUNTIME_CACHE, 100);
  }
  return fresh;
}

/** stale-while-revalidate: 即時にキャッシュを返し、裏で更新。 */
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const update = fetch(request)
    .then((fresh) => {
      if (fresh.ok) {
        putQuietly(cacheName, request, fresh.clone());
        trimCache(cacheName, 100);
      }
      return fresh;
    })
    .catch(() => undefined);
  return cached || (await update) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // ペイウォール境界（INV-009 / INV-010）: API には一切介入しない
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // 同じ sw.js を再取得させない（新しい SW の取得はブラウザの HTTP キャッシュ戦略に任せる）
  if (url.pathname === '/sw.js') return;

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(navigate(request, event.preloadResponse));
      return;
    }
    if (url.pathname.startsWith('/_astro/')) {
      event.respondWith(cacheFirst(request));
      return;
    }
    if (url.pathname.startsWith('/pagefind/')) {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
      return;
    }
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  if (FONT_ORIGINS.includes(url.origin)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
  }
  // それ以外のオリジン（アナリティクス等）には手を付けない
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
