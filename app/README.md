# 전운보초 — app (Phase 0~1 뼈대)

전체 실행 계획은 상위 폴더의 [`전운보초_실행계획_Phase0-1.md`](../전운보초_실행계획_Phase0-1.md) 참고.

## 지금 상태

- [x] 프로젝트 뼈대 (index.html / css / js / manifest / service worker)
- [x] 지도 초기화 + 현재 위치 표시
- [x] 순환 코스 경유지 좌표 계산 (하버사인 공식)
- [x] 왕복 경로 API 연동 (`../server/` 프록시 서버 + `requestRoute()`) — 실제 REST API 키로 curl 테스트까지 확인 완료 (`routes[0].result_msg: "길찾기 성공"`)
- [x] 지도에 실제 경로 그리기 (`drawRoute()`)
- [x] 주행 중 주의 안내 (`startDriveMonitoring()` + `showCaution()`) — 비보호/회전교차로/유턴 구간 150m 앞에서 배너+음성 안내. 아직 실제로 차 타고 테스트는 못해봄.
- [x] 도착 판정 (`startDriveMonitoring()` 안, 출발지 100m 이상 벗어났다가 50m 이내로 복귀 시 완주 처리)
- [x] 리포트 카드 - 단순 버전 (`buildReport()`)
- [x] PWA 마무리 — 아이콘(핸들 모양, 브랜드 옐로우) 교체 완료, 오프라인 캐싱 실제 브라우저 콘솔로 검증 완료

## 실행 방법

1. `index.html`에서 `KAKAO_APP_KEY`에 발급받은 카카오맵 JavaScript 키를 넣는다.
2. `../server/`에서 경로 프록시 서버를 켠다 (`../server/README.md` 참고, 기본 `http://localhost:3000`).
3. VS Code의 "Live Server" 확장으로 `index.html`을 연다 (더블클릭으로 파일 직접 열면 지도 API가 동작하지 않는다).
4. 브라우저에서 위치 권한 허용 → "현재 위치에서 시작" 클릭.

두 서버(Live Server 5500번, 프록시 서버 3000번)가 **동시에** 켜져 있어야 경로까지 정상적으로 받아온다.

## 왜 지도가 안 뜨나요?

- `KAKAO_APP_KEY`를 안 채웠거나
- `file://`로 직접 열어서 (Live Server 같은 실제 서버로 열어야 함)
- **"카카오맵" 제품이 앱에서 비활성화되어 있는 경우** — Kakao Developers 콘솔 → 앱 선택 → "제품 설정" → "카카오맵" → 사용 설정 ON. 꺼져 있으면 `NotAuthorizedError: App disabled OPEN_MAP_AND_LOCAL service.` 에러가 난다.
- **도메인을 엉뚱한 곳에 등록한 경우** — "제품 링크 관리"의 "웹 도메인"(카카오톡 공유 링크용)과 지도 SDK가 검사하는 도메인은 **다른 설정**이다. 지도 SDK용 도메인은 반드시 **"앱 설정" → "플랫폼" → "JavaScript 키" 카드 안의 "JavaScript SDK 도메인"**에 등록해야 한다. 잘못된 곳에 등록하면 브라우저 개발자도구 Network 탭에 `sdk.js` 요청이 `(failed) net::ERR_BLOCKED_BY_ORB`로 표시된다 (HTTP 상태 코드가 안 보여서 원인 파악이 헷갈리기 쉬움 — `sdk.js` URL을 새 탭 주소창에 직접 열어보면 카카오가 내려주는 실제 에러 메시지(JSON)를 볼 수 있다).

위 세 가지를 다 확인했는데도 안 되면, 새로고침 전에 개발자도구 Network 탭에서 "Disable cache" 체크 후 강제 새로고침(Ctrl+Shift+R)해서 캐시된 실패 응답이 아닌지 먼저 배제할 것.

## 코드를 분명히 고쳤는데 반영이 하나도 안 될 때

**서비스워커가 예전 버전을 캐싱해두고 계속 그것만 보여주는 경우**일 가능성이 높다. 서비스워커는 캐시해둔 뒤로는 자기 자신의 코드(`service-worker.js`)가 바뀌지 않는 한 새 파일을 다시 받아오지 않기 때문에, `index.html`/`app.js`/`style.css`를 아무리 고쳐도 브라우저는 예전 버전만 계속 보여준다.

- 지금은 `app.js`에서 `location.hostname !== "localhost"`일 때만 서비스워커를 등록하도록 막아뒀다 (로컬 개발 중엔 아예 안 켜짐).
- 다만 **이 조치는 앞으로의 등록만 막을 뿐, 이미 등록되어버린 서비스워커는 남아있다.** 한 번은 직접 지워야 한다: 개발자도구 → **Application 탭** → 왼쪽 **"Storage"** → **"Clear site data"** 버튼 클릭 → 새로고침.

## 모바일에서 테스트하려면

Geolocation(위치 정보)은 HTTPS가 아니면 대부분의 모바일 브라우저가 막습니다. `localhost`는 예외지만, 폰으로 직접 테스트하려면 GitHub Pages, Vercel, Netlify 같은 무료 HTTPS 호스팅에 배포해야 합니다.
