/*
  전운보초 - Phase 1 MVP 기본 뼈대

  실행 순서 (실행계획 문서의 Phase 1 번호와 맞춰뒀습니다):
  2. 지도 띄우기 + 현재 위치 가져오기      -> initMap(), getCurrentLocation()
  3. 순환 코스 좌표 계산 (하버사인 공식)    -> calculateWaypoint()
  4. 왕복 경로 요청                        -> requestRoute()  (server/ 프록시 서버 필요, README 참고)
  5. 지도에 경로 그리기                    -> drawRoute()
  6. 코스 브리핑 문구 생성                 -> buildBriefing()
  7. 주행 중 주의 안내                    -> startDriveMonitoring(), showCaution()
  8. 도착 판정                            -> startDriveMonitoring() 안의 도착 거리 체크, finishCourse()
  9. 리포트 카드 (단순 버전)               -> buildReport()
*/

let map = null;
let currentPosition = null; // { lat, lng }
let currentMarker = null; // 현재 위치 마커 (재사용)

// ---------- 1. 지도 초기화 ----------

/**
 * 앱을 켜자마자 한 번 호출되고(초기 위치 or 기본 위치), 이후 "코스 시작"을
 * 누를 때마다 다시 호출된다. 지도 인스턴스는 한 번만 만들고 그 다음부터는
 * 중심 이동 + 마커 위치만 갱신한다 (매번 새로 만들면 이전 경로/마커가 날아간다).
 */
function initMap(lat, lng) {
  const center = new kakao.maps.LatLng(lat, lng);

  if (!map) {
    const container = document.getElementById("map");
    map = new kakao.maps.Map(container, { center, level: 5 });
  } else {
    map.setCenter(center);
  }

  if (currentMarker) {
    currentMarker.setPosition(center);
  } else {
    currentMarker = new kakao.maps.Marker({ map, position: center });
  }
}

// ---------- 2. 현재 위치 가져오기 ----------

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 브라우저는 위치 정보를 지원하지 않습니다."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ---------- 3. 순환 코스 경유지 좌표 계산 (하버사인 공식) ----------

/**
 * 현재 위치에서 임의의 방위각(bearing)과 거리(distanceKm)만큼 떨어진
 * 지점의 좌표를 계산한다. 이 지점을 "경유지"로 삼아 왕복 경로를 요청하면
 * 순환 코스가 만들어진다.
 *
 * @param {number} lat 현재 위도
 * @param {number} lng 현재 경도
 * @param {number} distanceKm 목표 거리(km) - 왕복 전체 거리가 아니라 편도 대략치
 * @param {number} bearingDeg 방위각(0~360, 0=북쪽). 생략 시 랜덤 방향.
 */
function calculateWaypoint(lat, lng, distanceKm, bearingDeg = Math.random() * 360) {
  const R = 6371; // 지구 반지름 (km)
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const d = distanceKm / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

// ---------- 4. 왕복 경로 요청 ----------

// server/ 프록시 서버 주소. 배포할 땐 실제 서버 주소로 바꿔야 한다.
const ROUTE_PROXY_URL = "http://localhost:3000/api/route";

/**
 * origin(출발지)에서 waypoint(경유지)를 거쳐 다시 origin으로 돌아오는
 * 순환 경로를 프록시 서버에 요청한다. (server/README.md 참고)
 */
async function requestRoute(origin, waypoint) {
  const res = await fetch(ROUTE_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, waypoint }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "경로 요청에 실패했습니다.");
  }
  return data;
}

// ---------- 5. 지도에 경로 그리기 ----------

let currentPolyline = null; // 이전 경로 (재시작 시 지우고 새로 그리기 위해 보관)

/**
 * requestRoute()가 돌려준 카카오모빌리티 응답에서 좌표를 뽑아
 * 지도에 선으로 그린다. 그린 뒤 경로 전체가 화면에 들어오게 범위를 맞춘다.
 *
 * @returns 첫 번째 경로(routes[0]) 객체 - 브리핑 문구 생성에 재사용
 */
function drawRoute(routeData) {
  const route = routeData.routes?.[0];
  if (!route || route.result_code !== 0) {
    throw new Error(route?.result_msg || "경로를 찾을 수 없습니다.");
  }

  const path = [];
  for (const section of route.sections ?? []) {
    for (const road of section.roads ?? []) {
      const vertexes = road.vertexes ?? []; // [lng, lat, lng, lat, ...] 형태로 평탄화되어 있음
      for (let i = 0; i < vertexes.length; i += 2) {
        path.push(new kakao.maps.LatLng(vertexes[i + 1], vertexes[i]));
      }
    }
  }

  if (currentPolyline) {
    currentPolyline.setMap(null); // 코스를 다시 시작할 때 이전 경로가 겹쳐 남지 않도록 지운다
  }
  currentPolyline = new kakao.maps.Polyline({
    map,
    path,
    strokeWeight: 5,
    strokeColor: "#2d6cdf",
    strokeOpacity: 0.9,
    strokeStyle: "solid",
  });

  if (path.length > 0) {
    const bounds = new kakao.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.setBounds(bounds);
  }

  return route;
}

// ---------- 6. 코스 브리핑 문구 생성 ----------

/**
 * 안내 지시사항(guides) 배열에서 특정 키워드가 포함된 개수를 센다.
 * 브리핑 문구와 주행 리포트가 둘 다 이 함수를 재사용한다.
 */
function countGuidesByKeyword(guides, keyword) {
  return guides.filter((g) => g.guidance?.includes(keyword)).length;
}

/**
 * 카카오 길찾기 API 응답(routes[0].sections[].guides[])을 넣으면
 * "총 5km, 좌회전 2회, 유턴 1회" 같은 문구를 만든다.
 * 아직 실제 API 연동 전이라 guides는 빈 배열이 들어와도 동작하게 해둔다.
 */
function buildBriefing(totalDistanceKm, guides = []) {
  const left = countGuidesByKeyword(guides, "좌회전");
  const uturn = countGuidesByKeyword(guides, "유턴");

  return `이번 코스는 총 ${totalDistanceKm}km, 좌회전 ${left}회 · 유턴 ${uturn}회가 포함되어 있습니다.`;
}

// ---------- 두 좌표 사이의 실제 거리 (하버사인, 미터 단위) ----------

/**
 * calculateWaypoint()는 "한 점 + 방향 + 거리"로 새 좌표를 계산하는 반면,
 * 이 함수는 반대로 "두 좌표 사이의 거리"를 구한다. 주의 안내/도착 판정에 쓰인다.
 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 지구 반지름 (m)
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- 7. 주행 중 주의 안내 ----------

// 안내 문구에 이 단어들이 포함되면 "주의가 필요한 구간"으로 본다.
const CAUTION_KEYWORDS = ["비보호", "회전교차로", "유턴"];
const CAUTION_TRIGGER_RADIUS_M = 150; // 이 거리 안에 들어오면 미리 알림

function findCautionGuides(guides) {
  return guides.filter((g) => CAUTION_KEYWORDS.some((kw) => g.guidance?.includes(kw)));
}

const cautionBanner = document.getElementById("caution-banner");
let cautionHideTimer = null;

function showCaution(text) {
  cautionBanner.textContent = `⚠️ ${text}`;
  cautionBanner.classList.remove("hidden");

  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch (err) {
      console.warn("음성 안내 실패:", err);
    }
  }

  clearTimeout(cautionHideTimer);
  cautionHideTimer = setTimeout(() => cautionBanner.classList.add("hidden"), 6000);
}

// ---------- 8. 도착 판정 + 9. 리포트 카드 ----------

const ARRIVE_RADIUS_M = 50; // 출발지 이 거리 안으로 들어오면 도착 처리
const DEPART_RADIUS_M = 100; // 이 거리 이상 멀어진 적이 있어야 "출발했다"고 인정한다
// (막 시작하자마자 출발지 반경 안이라는 이유로 바로 도착 처리되는 걸 막기 위함)

let watchId = null;

/**
 * Phase 1의 "아주 단순한 버전" 리포트: 코스에 포함된 지시사항 개수만 요약한다.
 * 실제로 그 지점을 지났는지는 확인하지 않는다 (Phase 2 이후 개선 대상).
 */
function buildReport(guides = []) {
  const left = countGuidesByKeyword(guides, "좌회전");
  const right = countGuidesByKeyword(guides, "우회전");
  const uturn = countGuidesByKeyword(guides, "유턴");

  return `오늘 좌회전 ${left}회, 우회전 ${right}회, 유턴 ${uturn}회를 완료했습니다 🏆`;
}

/**
 * 실시간 위치를 지켜보며:
 *  - 주의가 필요한 구간(비보호좌회전·회전교차로·유턴)에 가까워지면 배너/음성으로 미리 알린다.
 *  - 출발지에서 충분히 멀어졌다가 다시 돌아오면 코스 완주로 판정하고 리포트 카드를 띄운다.
 */
function startDriveMonitoring(origin, guides) {
  if (!("geolocation" in navigator)) return;

  const cautionGuides = findCautionGuides(guides);
  const triggered = new Set();
  let hasDeparted = false;

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };

      cautionGuides.forEach((guide, idx) => {
        if (triggered.has(idx)) return;
        const d = distanceMeters(here.lat, here.lng, guide.y, guide.x);
        if (d <= CAUTION_TRIGGER_RADIUS_M) {
          triggered.add(idx);
          showCaution(`잠시 후 ${guide.guidance}, 주변 상황을 확인하세요.`);
        }
      });

      const distFromOrigin = distanceMeters(here.lat, here.lng, origin.lat, origin.lng);
      if (distFromOrigin > DEPART_RADIUS_M) hasDeparted = true;

      if (hasDeparted && distFromOrigin <= ARRIVE_RADIUS_M) {
        finishCourse(guides);
      }
    },
    (err) => console.warn("위치 추적 오류:", err),
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function finishCourse(guides) {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  cautionBanner.classList.add("hidden");

  reportPanel.classList.remove("hidden");
  reportText.textContent = buildReport(guides);
  statusMsg.textContent = "코스 완주! 리포트를 확인하세요.";
}

// ---------- 화면 흐름 연결 ----------

const statusMsg = document.getElementById("status-msg");
const briefingPanel = document.getElementById("briefing-panel");
const briefingText = document.getElementById("briefing-text");
const reportPanel = document.getElementById("report-panel");
const reportText = document.getElementById("report-text");

const courseDialog = document.getElementById("course-dialog");
const openDialogBtn = document.getElementById("open-dialog-btn");
const dialogStartBtn = document.getElementById("dialog-start-btn");
const dialogCancelBtn = document.getElementById("dialog-cancel-btn");
const directionGrid = document.getElementById("direction-grid");

// 다이얼로그에서 고른 방향. "random"이면 매번 무작위 방향으로 코스를 만든다.
let selectedBearing = "random";

// ---------- 거리 휠 피커 (알람 시간 맞추듯 스크롤로 소수점 단위까지 고르기) ----------

const DISTANCE_MIN_KM = 1.0;
const DISTANCE_MAX_KM = 20.0;
const DISTANCE_STEP_KM = 0.1;
const WHEEL_ITEM_HEIGHT = 44; // css의 .wheel-item height와 반드시 같아야 한다

const distancePicker = document.getElementById("distance-picker");
let selectedDistanceKm = 5.0;

/** 1.0km ~ 20.0km, 0.1km 단위로 휠에 들어갈 항목들을 만들어둔다. */
function buildDistancePicker() {
  const steps = Math.round((DISTANCE_MAX_KM - DISTANCE_MIN_KM) / DISTANCE_STEP_KM);
  const fragment = document.createDocumentFragment();

  for (let i = 0; i <= steps; i++) {
    // 부동소수점 오차 방지를 위해 정수 스텝으로 계산한 뒤 마지막에 나눈다.
    const km = Math.round((DISTANCE_MIN_KM + i * DISTANCE_STEP_KM) * 10) / 10;
    const item = document.createElement("div");
    item.className = "wheel-item";
    item.dataset.km = km;
    item.textContent = `${km.toFixed(1)} km`;
    fragment.appendChild(item);
  }
  distancePicker.appendChild(fragment);
}

/** 현재 스크롤 위치에서 가운데 있는 항목을 찾아 선택값으로 반영하고, 굵게 표시한다. */
function syncDistancePickerActiveItem() {
  const items = distancePicker.children;
  const index = Math.max(
    0,
    Math.min(items.length - 1, Math.round(distancePicker.scrollTop / WHEEL_ITEM_HEIGHT))
  );

  for (const item of items) item.classList.remove("active");
  items[index].classList.add("active");
  selectedDistanceKm = Number(items[index].dataset.km);
}

/** 다이얼로그를 열 때, 마지막으로 고른 값(또는 기본값)에 휠을 맞춰둔다. */
function scrollDistancePickerTo(km) {
  const index = Math.round((km - DISTANCE_MIN_KM) / DISTANCE_STEP_KM);
  distancePicker.scrollTop = index * WHEEL_ITEM_HEIGHT;
  syncDistancePickerActiveItem();
}

buildDistancePicker();
distancePicker.addEventListener("scroll", syncDistancePickerActiveItem);

openDialogBtn.addEventListener("click", () => {
  courseDialog.showModal();
  // <dialog>가 열리기 전에는 레이아웃이 없어 scrollTop을 못 옮기므로, 열린 다음 프레임에 맞춘다.
  requestAnimationFrame(() => scrollDistancePickerTo(selectedDistanceKm));
});

dialogCancelBtn.addEventListener("click", () => {
  courseDialog.close();
});

// 방향 버튼 9개 중 하나를 고르면 선택 표시를 옮긴다.
directionGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".dir-btn");
  if (!btn) return;

  directionGrid.querySelectorAll(".dir-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedBearing = btn.dataset.bearing;
});

dialogStartBtn.addEventListener("click", () => {
  courseDialog.close();
  const bearingDeg = selectedBearing === "random" ? undefined : Number(selectedBearing);
  startCourse(selectedDistanceKm, bearingDeg);
});

/**
 * 순환 코스를 실제로 만들고 화면에 반영한다.
 * @param {number} distanceKm 코스 거리
 * @param {number|undefined} bearingDeg 방향(0~360). undefined면 calculateWaypoint()가 무작위로 고른다.
 */
async function startCourse(distanceKm, bearingDeg) {
  openDialogBtn.disabled = true;
  statusMsg.textContent = "현재 위치를 확인하는 중...";

  // 다시 시작하는 경우, 이전 주행의 감시/배너/리포트를 정리한다.
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  cautionBanner.classList.add("hidden");
  reportPanel.classList.add("hidden");

  try {
    currentPosition = await getCurrentLocation();
    initMap(currentPosition.lat, currentPosition.lng);

    // 왕복 코스이므로 편도(원점->경유지) 거리는 목표 거리의 절반 정도로 잡는다.
    const waypoint = calculateWaypoint(
      currentPosition.lat,
      currentPosition.lng,
      distanceKm / 2,
      bearingDeg
    );

    statusMsg.textContent = "경로를 요청하는 중... (server/ 프록시가 켜져 있어야 합니다)";
    const routeData = await requestRoute(currentPosition, waypoint);
    const route = drawRoute(routeData);

    const totalDistanceKm = route.summary?.distance
      ? Number((route.summary.distance / 1000).toFixed(1))
      : distanceKm;
    const guides = (route.sections ?? []).flatMap((s) => s.guides ?? []);

    statusMsg.textContent = "경로 준비 완료! 주행을 시작하면 자동으로 안내와 리포트가 뜹니다.";
    briefingPanel.classList.remove("hidden");
    briefingText.textContent = buildBriefing(totalDistanceKm, guides);

    startDriveMonitoring(currentPosition, guides);
  } catch (err) {
    statusMsg.textContent = `오류: ${err.message}`;
  } finally {
    openDialogBtn.disabled = false;
  }
}

// ---------- 카카오맵 SDK 로드: 앱을 켜자마자 지도부터 띄운다 ----------

const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 위치 확인 전/실패 시 쓰는 기본 위치 (서울시청)

kakao.maps.load(() => {
  // 위치 권한 팝업 응답을 기다리지 않고, 기본 위치로 지도를 일단 바로 띄운다.
  initMap(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
  statusMsg.textContent = "지도를 불러왔습니다. 내 위치를 확인하는 중...";

  getCurrentLocation()
    .then((pos) => {
      currentPosition = pos;
      initMap(pos.lat, pos.lng); // 이미 만들어진 지도이므로 중심/마커만 옮겨간다
      statusMsg.textContent = "내 위치를 확인했습니다. '순환 코스 설정'을 눌러 시작해보세요.";
    })
    .catch(() => {
      statusMsg.textContent = "위치 권한이 없어 기본 위치를 표시 중입니다. 코스를 시작하려면 위치 권한을 허용해주세요.";
    });
});

// 서비스워커 등록 (PWA 오프라인 지원)
//
// localhost에서는 등록하지 않는다. 서비스워커는 한 번 캐싱해두면 파일을
// 고쳐도 캐시된 옛날 버전을 계속 보여주기 때문에(서비스워커 자체 코드가
// 안 바뀌면 캐시가 안 갱신됨), 한창 코드를 고치는 개발 중에는 "고쳤는데
// 반영이 안 된다"는 혼란만 만든다. 실제 배포 도메인에서만 켠다.
if ("serviceWorker" in navigator && location.hostname !== "localhost") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("서비스워커 등록 실패:", err);
    });
  });
}
