/*
  최소한의 서비스워커: 앱 셸(정적 파일)만 캐싱해서
  오프라인에서도 앱 화면 자체는 뜨게 해준다.
  (지도 데이터 자체는 인터넷 연결이 필요하다.)
*/

const CACHE_NAME = "jeonunbocho-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // 카카오맵 API 등 외부 요청은 캐싱하지 않고 그대로 네트워크로 보낸다.
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
