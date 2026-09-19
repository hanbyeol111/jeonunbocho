# 전운보초 — 경로 프록시 서버

`app/`(프론트엔드)이 카카오모빌리티 길찾기 API를 직접 호출하면 CORS에 막히기 때문에,
이 서버가 대신 요청해서 응답을 돌려준다.

## 1. REST API 키 발급 (지도용 JS 키와는 다른 키)

1. [Kakao Developers](https://developers.kakao.com) → 내 애플리케이션 → 전운보초 앱 선택
2. "앱 키" 탭에서 **REST API 키** 복사 (`app/index.html`에 넣은 JavaScript 키와 별개)
3. "카카오맵" 이 아니라 "카카오모빌리티" 서비스 활성화가 필요할 수 있음 — 콘솔에서 카카오모빌리티 API 사용 신청 여부 확인

## 2. 설정

```bash
cp .env.example .env
```

`.env`를 열어 `KAKAO_REST_API_KEY`에 위에서 복사한 키를 붙여넣는다.

## 3. 실행

```bash
npm install
npm start
```

`http://localhost:3000`에서 실행된다. `app/js/app.js`의 `ROUTE_PROXY_URL`이 이 주소를 가리키고 있으므로,
프론트엔드(Live Server, 보통 5500번 포트)와 **동시에** 이 서버를 켜둬야 "현재 위치에서 시작"이 경로까지 받아온다.

## 확인 방법

`/api/route`는 두 가지 모드를 지원한다:

```bash
# 순환 코스: origin -> waypoint -> origin으로 돌아오는 왕복 경로
curl -X POST http://localhost:3000/api/route \
  -H "Content-Type: application/json" \
  -d '{"origin":{"lat":37.5665,"lng":126.9780},"waypoint":{"lat":37.58,"lng":126.98}}'

# 목적지 지정: origin에서 destination까지 편도 경로
curl -X POST http://localhost:3000/api/route \
  -H "Content-Type: application/json" \
  -d '{"origin":{"lat":37.5665,"lng":126.9780},"destination":{"lat":37.58,"lng":126.98}}'
```

카카오모빌리티 응답 JSON(`routes[0].sections[0].guides`, `roads` 등)이 그대로 돌아오면 정상. `waypoint`/`destination` 둘 다 없으면 400 에러.

## 참고

- 이 서버는 로컬 개발용 최소 구현이다. 실제 배포 시에는 Vercel/Netlify 서버리스 함수 등으로 옮기는 걸 권장 (실행계획 문서 Phase 1-4 참고).
- 응답 형태(`routes[].sections[].guides[]`, `roads[].vertexes`)는 실제 REST API 키로 curl 테스트해서 확인 완료했다. `app/js/app.js`의 `drawRoute()`/`buildBriefing()` 파싱 로직과 일치한다.
