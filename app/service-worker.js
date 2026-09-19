/*
  최소한의 서비스워커: 앱 셸(정적 파일)만 캐싱해서
  오프라인에서도 앱 화면 자체는 뜨게 해준다.
  (지도 데이터 자체는 인터넷 연결이 필요하다.)

  캐싱 전략은 "네트워크 우선, 실패하면 캐시" (network-first)다.
  예전에는 "캐시 우선"이라 한 번 캐싱된 뒤로는 배포를 아무리 새로 해도
  브라우저가 계속 옛날 파일을 보여주는 문제가 있었다 (서비스워커 자체
  파일이 안 바뀌는 한 캐시가 다시 채워지지 않기 때문). 네트워크 우선으로
  바꾸면 온라인일 땐 항상 최신 파일을 받아오고, 오프라인일 때만 캐시로
  대체된다 - PWA 오프라인 지원은 유지하면서 이 문제를 근본적으로 없앤다.
*/

const CACHE_NAME = "jeonunbocho-shell-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache.addAll()은 내부적으로 그냥 fetch()라 이것도 브라우저 HTTP 캐시(10분)에
      // 걸릴 수 있다. no-store로 직접 받아와서 캐시에 넣는다.
      Promise.all(
        APP_SHELL.map((url) =>
          fetch(url, { cache: "no-store" }).then((res) => cache.put(url, res))
        )
      )
    )
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
    // GitHub Pages가 정적 파일에 Cache-Control: max-age=600을 붙여서 내려주기
    // 때문에, 그냥 fetch()만 하면 "네트워크 우선"이라 해도 브라우저 자체
    // HTTP 캐시가 그 10분 동안은 여전히 옛날 응답을 돌려준다. cache: "no-store"로
    // 그 캐시까지 완전히 건너뛰고 항상 서버에서 새로 받아오게 한다.
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        // 성공하면 서비스워커 캐시도 최신 버전으로 함께 갱신해둔다 (다음 오프라인 대비).
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => caches.match(event.request)) // 네트워크 실패(오프라인) 시에만 캐시로 대체
  );
});
