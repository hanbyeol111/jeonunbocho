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

  화면 흐름: 다이얼로그(거리/방향 선택) -> previewCourse() 로 경로를 만들고
  브리핑(썸네일+통계) 표시 -> "이 코스로 시작"을 누르면 enterNavMode() 가
  실시간 내비게이션 화면을 띄우고 그제서야 startDriveMonitoring()이 켜진다.
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

// server/ 프록시 서버 주소. 로컬 개발 중(localhost)에는 로컬 프록시를,
// 배포된 상태에서는 Render에 올려둔 프록시를 쓴다.
const ROUTE_PROXY_URL =
  location.hostname === "localhost"
    ? "http://localhost:3000/api/route"
    : "https://jeonunbocho.onrender.com/api/route";

/**
 * 경로를 프록시 서버에 요청한다. (server/README.md 참고)
 * @param {{lat:number,lng:number}} origin 출발지
 * @param {{waypoint:object}|{destination:object}} extra
 *   순환 코스면 { waypoint } - origin에서 waypoint를 거쳐 다시 origin으로 돌아온다.
 *   목적지 지정이면 { destination } - origin에서 destination까지 편도로 간다.
 */
async function requestRoute(origin, extra) {
  const res = await fetch(ROUTE_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, ...extra }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "경로 요청에 실패했습니다.");
  }
  return data;
}

// ---------- 5. 지도에 경로 그리기 ----------

let currentPolylines = []; // 이전 경로 (재시작 시 지우고 새로 그리기 위해 보관) - 도로마다 색이 달라서 배열이다

/**
 * 카카오모빌리티가 도로(road)마다 함께 내려주는 traffic_speed(km/h)를 보고
 * 대략적인 정체 구간을 색으로 구분한다. 실제 제한속도 데이터가 아니라 그
 * 도로의 "현재 평균 통행 속도"이므로, 절대적인 기준이 아니라 상대적인
 * 참고용 색이다. 값이 없으면(고속도로가 아니거나 데이터 미제공) 기본색을 쓴다.
 */
function trafficColor(speedKmh) {
  if (typeof speedKmh !== "number") return "#2d6cdf";
  if (speedKmh < 15) return "#e53935"; // 정체
  if (speedKmh < 30) return "#ff9800"; // 서행
  return "#43a047"; // 원활
}

/**
 * requestRoute()가 돌려준 카카오모빌리티 응답에서 좌표를 뽑아
 * 지도에 선으로 그린다. 도로(road) 구간별로 traffic_speed에 따라 색을 다르게
 * 그려서, 실제 내비게이션처럼 어디가 막히는지 한눈에 보이게 한다.
 * 그린 뒤 경로 전체가 화면에 들어오게 범위를 맞춘다.
 *
 * @returns { route, rawPath } - route는 브리핑 문구용, rawPath({lat,lng}[])는
 *          지도 라이브러리 없이도 쓸 수 있는 좌표 배열 (썸네일 그리기용)
 */
function drawRoute(routeData) {
  const route = routeData.routes?.[0];
  if (!route || route.result_code !== 0) {
    throw new Error(route?.result_msg || "경로를 찾을 수 없습니다.");
  }

  const rawPath = [];
  const segments = []; // { path: kakao.maps.LatLng[], color }

  for (const section of route.sections ?? []) {
    for (const road of section.roads ?? []) {
      const vertexes = road.vertexes ?? []; // [lng, lat, lng, lat, ...] 형태로 평탄화되어 있음
      const segmentPath = [];
      for (let i = 0; i < vertexes.length; i += 2) {
        const point = { lat: vertexes[i + 1], lng: vertexes[i] };
        rawPath.push(point);
        segmentPath.push(new kakao.maps.LatLng(point.lat, point.lng));
      }
      if (segmentPath.length > 1) {
        segments.push({ path: segmentPath, color: trafficColor(road.traffic_speed) });
      }
    }
  }

  currentPolylines.forEach((pl) => pl.setMap(null)); // 코스를 다시 시작할 때 이전 경로가 겹쳐 남지 않도록 지운다
  currentPolylines = segments.map(
    (seg) =>
      new kakao.maps.Polyline({
        map,
        path: seg.path,
        strokeWeight: 6,
        strokeColor: seg.color,
        strokeOpacity: 0.9,
        strokeStyle: "solid",
      })
  );

  if (rawPath.length > 0) {
    const bounds = new kakao.maps.LatLngBounds();
    rawPath.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
    map.setBounds(bounds);
  }

  return { route, rawPath };
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
 * "총 5.2km · 약 20분 · 좌회전 2회 · 유턴 1회" 같은 한 줄 요약을 만든다.
 */
function buildBriefing(totalDistanceKm, durationMin, guides = []) {
  const left = countGuidesByKeyword(guides, "좌회전");
  const uturn = countGuidesByKeyword(guides, "유턴");
  const durationPart = durationMin != null ? ` · 약 ${durationMin}분` : "";

  return `총 ${totalDistanceKm}km${durationPart} · 좌회전 ${left}회 · 유턴 ${uturn}회`;
}

/**
 * 좌회전/우회전/유턴 개수와, "차선변경 약 N회"(기획서 원안: 출발지/경유지/목적지를
 * 뺀 턴바이턴 지시사항 총 개수로 근사)를 화면의 통계 카드에 채운다.
 */
function renderBriefingStats(guides) {
  const left = countGuidesByKeyword(guides, "좌회전");
  const right = countGuidesByKeyword(guides, "우회전");
  const uturn = countGuidesByKeyword(guides, "유턴");
  // type 100=출발지, 1000=경유지, 101=목적지 - 이 셋을 뺀 나머지가 실제 "조작이 필요한 지점" 개수다.
  const laneApprox = guides.filter((g) => ![100, 1000, 101].includes(g.type)).length;

  statLeft.textContent = `${left}회`;
  statRight.textContent = `${right}회`;
  statUturn.textContent = `${uturn}회`;
  statLane.textContent = `약 ${laneApprox}회`;
}

/** 주의가 필요한 구간이 있으면 "⚠ 주의 구간 N개 - 비보호 좌회전 · 유턴" 같은 요약을 보여준다. */
function renderCautionSummary(guides) {
  const cautionGuides = findCautionGuides(guides);
  if (cautionGuides.length === 0) {
    cautionSummary.classList.add("hidden");
    return;
  }

  const labels = new Set();
  cautionGuides.forEach((g) => {
    CAUTION_KEYWORDS.forEach((kw) => {
      if (g.guidance?.includes(kw)) labels.add(kw);
    });
  });

  cautionSummaryTitle.textContent = `⚠ 주의 구간 ${cautionGuides.length}개`;
  cautionSummaryDetail.textContent = Array.from(labels).join(" · ");
  cautionSummary.classList.remove("hidden");
}

/**
 * 실제 경로 좌표(rawPath)를 작은 SVG 썸네일로 그린다.
 * 위도/경도 범위를 썸네일 크기에 맞게 늘려 넣는 방식이라 축척은 실제와 다르다
 * (장식용 미리보기일 뿐, 정밀한 지도가 아니다).
 */
function buildRouteThumbnailSVG(rawPath) {
  if (!rawPath || rawPath.length === 0) return "";

  const W = 300;
  const H = 130;
  const PAD = 14;

  const lats = rawPath.map((p) => p.lat);
  const lngs = rawPath.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLng = Math.max(maxLng - minLng, 1e-6);

  const project = (p) => {
    const x = PAD + ((p.lng - minLng) / spanLng) * (W - PAD * 2);
    const y = H - PAD - ((p.lat - minLat) / spanLat) * (H - PAD * 2); // 위도가 클수록 화면 위쪽
    return [x, y];
  };

  // 점이 너무 많으면(수백~수천개) 적당히 솎아내서 SVG를 가볍게 만든다.
  const step = Math.max(1, Math.floor(rawPath.length / 150));
  const sampled = rawPath.filter((_, i) => i % step === 0);
  const points = sampled.map(project);

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const [sx, sy] = points[0];
  const [ex, ey] = points[points.length - 1];

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <path d="${d}" fill="none" stroke="#e6b800" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${sx}" cy="${sy}" r="5" fill="#4caf50" />
    <circle cx="${ex}" cy="${ey}" r="5" fill="#e53935" />
  </svg>`;
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

// ---------- 실주행 화면 (다음 안내 방향/거리를 실시간으로 보여주는 전용 화면) ----------

/** 안내 문구에서 회전 방향을 읽어, 화살표를 얼마나 돌릴지(deg)와 함께 돌려준다. */
function guideTurnGlyph(guidance = "") {
  if (guidance.includes("유턴")) return { angle: 180 };
  if (guidance.includes("좌회전")) return { angle: -90 };
  if (guidance.includes("우회전")) return { angle: 90 };
  return { angle: 0 }; // 직진 · 경유지 · 목적지 등은 위쪽 화살표 그대로
}

/** 안내 배너에 쓸 짧은 방향 단어. 네이버지도처럼 "104m 우회전" 식으로 짧게 붙인다. */
function guideShortLabel(guide) {
  const g = guide.guidance || "";
  if (guide.type === 1000) return "경유지";
  if (guide.type === 101) return "목적지";
  if (g.includes("유턴")) return "유턴";
  if (g.includes("좌회전")) return "좌회전";
  if (g.includes("우회전")) return "우회전";
  return "직진";
}

/**
 * 배너 아래 작은 글씨용 상세 안내문. 차로 단위 데이터는 없으므로(기획서
 * "조기 차선 안내" 참고), 차선 번호 없이 "미리 어느 쪽으로 붙어라"는 정도로
 * 일반화한 문구를 쓴다.
 */
function guideInstructionText(guide) {
  const g = guide.guidance || "";
  if (guide.type === 1000) return "잠시 후 방향이 바뀝니다.";
  if (guide.type === 101) return "곧 도착합니다.";
  if (g.includes("유턴")) return "유턴을 준비하세요.";
  if (g.includes("좌회전")) return "미리 왼쪽 차선으로 붙어주세요.";
  if (g.includes("우회전")) return "미리 오른쪽 차선으로 붙어주세요.";
  return g;
}

const NAV_ADVANCE_RADIUS_M = 25; // 이 거리 안으로 들어오면 "이 지점은 지났다"고 보고 다음 지점으로 넘어간다
let navGuideIndex = 1; // 0번 = "출발지"라서 건너뛰고 시작한다
let lastKnownPosition = null; // "내 위치로" 버튼이 쓸, 가장 최근 GPS 위치

/** 현재 위치 기준으로 다음 안내 지점을 찾아 화면(화살표/거리/문구)을 갱신한다. */
function updateNavDisplay(here, guides) {
  lastKnownPosition = here;
  if (!guides.length) return;

  let target = guides[Math.min(navGuideIndex, guides.length - 1)];
  let dist = distanceMeters(here.lat, here.lng, target.y, target.x);

  // 도착 반경 안으로 들어왔고 다음 지점이 남아있으면, 그 다음 지점으로 넘어간다.
  while (dist <= NAV_ADVANCE_RADIUS_M && navGuideIndex < guides.length - 1) {
    navGuideIndex++;
    target = guides[navGuideIndex];
    dist = distanceMeters(here.lat, here.lng, target.y, target.x);
  }

  const { angle } = guideTurnGlyph(target.guidance);
  navBigArrow.style.transform = `rotate(${angle}deg)`;
  navDistance.textContent = `${Math.round(dist)}m`;
  navTurnLabel.textContent = guideShortLabel(target);
  navInstruction.textContent = guideInstructionText(target);
}

/**
 * 다이얼로그에서 "경로 만들기"까지 끝난 뒤, 브리핑의 "이 코스로 시작"을 누르면 진짜 주행이 시작된다.
 * 지도는 계속 보여주고(네이버지도 스타일), 대신 상단 타이틀 바와 하단 시트를 숨겨서
 * 안내 오버레이(.nav-overlay)가 그 자리를 대신하게 한다.
 * @param {{lat,lng}} origin 출발지
 * @param {object[]} guides
 * @param {{lat,lng}} [arrivalPoint] 도착 판정 기준 좌표. 순환 코스는 origin(생략 시 기본값),
 *   목적지 지정은 검색으로 고른 destination을 넘겨받는다.
 * @param {{distanceKm:number, durationMin:number|null}} [summary] 브리핑에서 계산해둔 총 거리/시간
 */
function enterNavMode(origin, guides, arrivalPoint = origin, summary = null) {
  navGuideIndex = 1;
  appHeader.classList.add("hidden");
  bottomSheetEl.classList.add("hidden");
  navScreen.classList.remove("hidden");
  updateNavDisplay(origin, guides); // 첫 화면을 바로 채워둔다 (다음 GPS 업데이트를 기다리지 않고)

  if (summary) {
    navSummary.textContent = `${summary.distanceKm}km${summary.durationMin != null ? ` · 약 ${summary.durationMin}분` : ""}`;
    if (summary.durationMin != null) {
      const eta = new Date(Date.now() + summary.durationMin * 60 * 1000);
      const hh = String(eta.getHours()).padStart(2, "0");
      const mm = String(eta.getMinutes()).padStart(2, "0");
      navEta.textContent = `도착 예정 ${hh}:${mm}`;
    } else {
      navEta.textContent = "";
    }
  }

  startDriveMonitoring(origin, guides, arrivalPoint);
}

function exitNavMode() {
  navScreen.classList.add("hidden");
  appHeader.classList.remove("hidden");
  bottomSheetEl.classList.remove("hidden");
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
 *  - 출발지에서 충분히 멀어졌다가 arrivalPoint 근처로 들어오면 완주로 판정하고 리포트 카드를 띄운다.
 *    (순환 코스는 arrivalPoint === origin, 목적지 지정은 검색으로 고른 destination)
 */
function startDriveMonitoring(origin, guides, arrivalPoint = origin) {
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

      updateNavDisplay(here, guides);

      const distFromOrigin = distanceMeters(here.lat, here.lng, origin.lat, origin.lng);
      if (distFromOrigin > DEPART_RADIUS_M) hasDeparted = true;

      const distToArrival = distanceMeters(here.lat, here.lng, arrivalPoint.lat, arrivalPoint.lng);
      if (hasDeparted && distToArrival <= ARRIVE_RADIUS_M) {
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
  exitNavMode();

  setupPanel.classList.remove("hidden"); // 브리핑 때 숨겨뒀던 검색/탭 패널을 다시 보이게 한다
  reportPanel.classList.remove("hidden");
  reportText.textContent = buildReport(guides);
  statusMsg.textContent = "코스 완주! 리포트를 확인하세요.";
  saveReportToHistory(reportText.textContent);
}

// ---------- 시작 화면 탭 (목적지 지정 / 순환코스 / 내 리포트 보기) ----------

const REPORT_HISTORY_KEY = "jeonunbocho_report_history";
const REPORT_HISTORY_MAX = 20;

/** 완주 리포트 기록을 localStorage에서 읽어온다. 저장된 게 없거나 형식이 깨졌으면 빈 배열. */
function loadReportHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(REPORT_HISTORY_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** 완주할 때마다 리포트 문구를 기록에 추가한다. (최신순, 최대 20개까지만 보관) */
function saveReportToHistory(text) {
  const history = loadReportHistory();
  history.unshift({ text, date: new Date().toISOString() });
  localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(history.slice(0, REPORT_HISTORY_MAX)));
}

function formatReportDate(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}`;
}

/** "내 리포트 보기" 탭을 열 때마다 저장된 기록으로 목록을 다시 그린다. */
function renderReportHistory() {
  const history = loadReportHistory();
  reportHistoryList.innerHTML = "";
  reportHistoryEmpty.classList.toggle("hidden", history.length > 0);

  for (const entry of history) {
    const li = document.createElement("li");
    li.className = "report-history-item";

    const dateEl = document.createElement("span");
    dateEl.className = "report-history-date";
    dateEl.textContent = formatReportDate(entry.date);

    const textEl = document.createElement("p");
    textEl.className = "report-history-text";
    textEl.textContent = entry.text;

    li.appendChild(dateEl);
    li.appendChild(textEl);
    reportHistoryList.appendChild(li);
  }
}

const startTabs = document.querySelectorAll(".start-tab");
const startTabPanels = {
  destination: document.getElementById("tab-destination"),
  loop: document.getElementById("tab-loop"),
  reports: document.getElementById("tab-reports"),
};
const reportHistoryList = document.getElementById("report-history-list");
const reportHistoryEmpty = document.getElementById("report-history-empty");

const destinationSearchInput = document.getElementById("destination-search-input");
const destinationSearchBtn = document.getElementById("destination-search-btn");
const destinationResults = document.getElementById("destination-results");
const destinationSearchEmpty = document.getElementById("destination-search-empty");
const myLocationLabel = document.getElementById("my-location-label");

startTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    startTabs.forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");

    Object.values(startTabPanels).forEach((panel) => panel.classList.add("hidden"));
    startTabPanels[tab.dataset.tab].classList.remove("hidden");

    if (tab.dataset.tab === "reports") {
      renderReportHistory();
    }
  });
});

// ---------- 화면 흐름 연결 ----------

const homeScreen = document.getElementById("home-screen");
const mapScreen = document.getElementById("map-screen");
const backToHomeBtn = document.getElementById("back-to-home-btn");
const appHeader = document.getElementById("app-header");
const bottomSheetEl = document.getElementById("bottom-sheet");

const statusMsg = document.getElementById("status-msg");
const setupPanel = document.getElementById("setup-panel");
const briefingPanel = document.getElementById("briefing-panel");
const briefingText = document.getElementById("briefing-text");
const routeThumb = document.getElementById("route-thumb");
const statLeft = document.getElementById("stat-left");
const statRight = document.getElementById("stat-right");
const statUturn = document.getElementById("stat-uturn");
const statLane = document.getElementById("stat-lane");
const cautionSummary = document.getElementById("caution-summary");
const cautionSummaryTitle = document.getElementById("caution-summary-title");
const cautionSummaryDetail = document.getElementById("caution-summary-detail");
const briefingStartBtn = document.getElementById("briefing-start-btn");
const reportPanel = document.getElementById("report-panel");
const reportText = document.getElementById("report-text");

const navScreen = document.getElementById("nav-screen");
const navBigArrow = document.getElementById("nav-big-arrow");
const navDistance = document.getElementById("nav-distance");
const navTurnLabel = document.getElementById("nav-turn-label");
const navInstruction = document.getElementById("nav-instruction");
const navSummary = document.getElementById("nav-summary");
const navEta = document.getElementById("nav-eta");
const navStopBtn = document.getElementById("nav-stop-btn");
const navZoomInBtn = document.getElementById("nav-zoom-in-btn");
const navZoomOutBtn = document.getElementById("nav-zoom-out-btn");
const navRecenterBtn = document.getElementById("nav-recenter-btn");

navZoomInBtn.addEventListener("click", () => {
  if (map) map.setLevel(map.getLevel() - 1); // 레벨이 작을수록 확대된 상태다
});

navZoomOutBtn.addEventListener("click", () => {
  if (map) map.setLevel(map.getLevel() + 1);
});

navRecenterBtn.addEventListener("click", () => {
  if (map && lastKnownPosition) {
    map.setCenter(new kakao.maps.LatLng(lastKnownPosition.lat, lastKnownPosition.lng));
  }
});

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
  previewCourse(selectedDistanceKm, bearingDeg);
});

// 브리핑 화면에서 "이 코스로 시작"을 눌러야 실제로 주의 안내/도착 판정이 켜진다.
let pendingOrigin = null;
let pendingGuides = null;
let pendingArrivalPoint = null; // 순환 코스면 origin과 같고, 목적지 지정이면 검색으로 고른 지점
let pendingSummary = null; // { distanceKm, durationMin } - 주행 화면 하단 바에 그대로 보여준다

briefingStartBtn.addEventListener("click", () => {
  if (!pendingOrigin || !pendingGuides) return;
  briefingPanel.classList.add("hidden");
  enterNavMode(pendingOrigin, pendingGuides, pendingArrivalPoint || pendingOrigin, pendingSummary);
});

// 주행 중 중단하고 싶을 때 (하단 바의 ✕ 버튼)
navStopBtn.addEventListener("click", () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  exitNavMode();
  setupPanel.classList.remove("hidden");
  statusMsg.textContent = "주행을 중단했습니다.";
});

/**
 * 다이얼로그에서 고른 거리/방향으로 순환 코스를 만들고, 출발 전 브리핑 화면을 보여준다.
 * 이 시점에는 아직 실제 주행 감시(주의 안내/도착 판정)는 켜지지 않는다 - briefingStartBtn을
 * 눌러야 enterNavMode()가 호출되며 진짜 주행이 시작된다.
 *
 * @param {number} distanceKm 코스 거리
 * @param {number|undefined} bearingDeg 방향(0~360). undefined면 calculateWaypoint()가 무작위로 고른다.
 */
async function previewCourse(distanceKm, bearingDeg) {
  openDialogBtn.disabled = true;
  statusMsg.textContent = "현재 위치를 확인하는 중...";

  // 다시 만드는 경우, 이전 주행의 감시/배너/화면을 정리한다.
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  cautionBanner.classList.add("hidden");
  reportPanel.classList.add("hidden");
  briefingPanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
  exitNavMode();

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
    const routeData = await requestRoute(currentPosition, { waypoint });
    const { route, rawPath } = drawRoute(routeData);

    pendingOrigin = currentPosition;
    pendingArrivalPoint = currentPosition; // 순환 코스: 출발지로 돌아오면 완주

    statusMsg.textContent = "코스 준비 완료! 아래에서 확인하고 시작해보세요.";
    pendingGuides = applyRouteToBriefing(route, rawPath, distanceKm);
  } catch (err) {
    statusMsg.textContent = `오류: ${err.message}`;
  } finally {
    openDialogBtn.disabled = false;
  }
}

/**
 * requestRoute()+drawRoute()가 돌려준 route를 브리핑 화면(썸네일/통계/주의구간/요약)에 반영한다.
 * previewCourse(순환 코스)와 previewDestinationCourse(목적지 지정)가 공통으로 쓴다.
 * @returns guides - pendingGuides에 저장해둘 안내 지시사항 배열
 */
function applyRouteToBriefing(route, rawPath, fallbackDistanceKm) {
  const totalDistanceKm = route.summary?.distance
    ? Number((route.summary.distance / 1000).toFixed(1))
    : fallbackDistanceKm;
  const durationMin = route.summary?.duration ? Math.round(route.summary.duration / 60) : null;
  const guides = (route.sections ?? []).flatMap((s) => s.guides ?? []);

  routeThumb.innerHTML = buildRouteThumbnailSVG(rawPath);
  briefingText.textContent = buildBriefing(totalDistanceKm, durationMin, guides);
  renderBriefingStats(guides);
  renderCautionSummary(guides);
  setupPanel.classList.add("hidden"); // 탭/검색 결과 패널은 브리핑이 보이는 동안 숨긴다
  briefingPanel.classList.remove("hidden");

  pendingSummary = { distanceKm: totalDistanceKm, durationMin };

  return guides;
}

/**
 * 목적지 지정 탭에서 검색 결과를 고르면 호출된다. previewCourse와 달리
 * waypoint 계산이 없고, 도착 판정 기준(pendingArrivalPoint)이 destination이 된다.
 */
async function previewDestinationCourse(destination) {
  statusMsg.textContent = "현재 위치를 확인하는 중...";

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  cautionBanner.classList.add("hidden");
  reportPanel.classList.add("hidden");
  briefingPanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
  exitNavMode();

  try {
    currentPosition = await getCurrentLocation();
    initMap(currentPosition.lat, currentPosition.lng);

    statusMsg.textContent = "경로를 요청하는 중... (server/ 프록시가 켜져 있어야 합니다)";
    const routeData = await requestRoute(currentPosition, { destination });
    const { route, rawPath } = drawRoute(routeData);

    pendingOrigin = currentPosition;
    pendingArrivalPoint = destination; // 목적지 지정: 검색으로 고른 지점에 도착하면 완주

    const straightLineKm = distanceMeters(
      currentPosition.lat,
      currentPosition.lng,
      destination.lat,
      destination.lng
    ) / 1000;

    statusMsg.textContent = "코스 준비 완료! 아래에서 확인하고 시작해보세요.";
    pendingGuides = applyRouteToBriefing(route, rawPath, Number(straightLineKm.toFixed(1)));
  } catch (err) {
    statusMsg.textContent = `오류: ${err.message}`;
  }
}

// ---------- 목적지 검색 (kakao.maps.services.Places) ----------

let placesService = null;

function getPlacesService() {
  if (!placesService) placesService = new kakao.maps.services.Places();
  return placesService;
}

// ---------- 내 위치 표시 (kakao.maps.services.Geocoder로 좌표 -> 주소 변환) ----------

let geocoderService = null;

function getGeocoderService() {
  if (!geocoderService) geocoderService = new kakao.maps.services.Geocoder();
  return geocoderService;
}

/**
 * "목적지 지정" 탭 위에 "내 위치: OOO"를 보여준다. 지도가 조용히 재중심되는 것만으로는
 * 위치를 확인했는지 눈에 잘 안 띄어서, 실제 주소로 변환해 명시적으로 보여준다.
 * @param {{lat:number,lng:number}|null} pos null이면 "확인 중/실패" 상태를 보여준다.
 * @param {boolean} failed pos가 null인데 이게 true면 "권한 필요" 메시지를, false면 "확인 중"을 보여준다.
 */
function updateMyLocationLabel(pos, failed = false) {
  if (!myLocationLabel) return;

  if (!pos) {
    myLocationLabel.textContent = failed
      ? "내 위치: 확인 안 됨 (위치 권한을 허용해주세요)"
      : "내 위치 확인 중...";
    return;
  }

  getGeocoderService().coord2Address(pos.lng, pos.lat, (result, status) => {
    if (status === kakao.maps.services.Status.OK && result[0]) {
      const addr = result[0].road_address?.address_name || result[0].address?.address_name;
      myLocationLabel.textContent = `내 위치: ${addr || `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`}`;
    } else {
      myLocationLabel.textContent = `내 위치: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
    }
  });
}

/** 검색 결과 장소들을 목록으로 그린다. 하나를 누르면 바로 그 장소로 경로를 만든다. */
function renderDestinationResults(places) {
  destinationResults.innerHTML = "";
  destinationSearchEmpty.classList.toggle("hidden", places.length > 0);

  for (const place of places) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "destination-result-item";

    const nameEl = document.createElement("span");
    nameEl.className = "destination-result-name";
    nameEl.textContent = place.place_name;

    const addrEl = document.createElement("span");
    addrEl.className = "destination-result-address";
    addrEl.textContent = place.road_address_name || place.address_name || "";

    btn.appendChild(nameEl);
    btn.appendChild(addrEl);
    btn.addEventListener("click", () => {
      previewDestinationCourse({ lat: Number(place.y), lng: Number(place.x) });
    });

    li.appendChild(btn);
    destinationResults.appendChild(li);
  }
}

/** kakao.maps.services.Places.keywordSearch()를 프로미스로 감싼다 (상호명·일반 키워드 검색). */
function keywordSearchAsync(query, options) {
  return new Promise((resolve) => {
    getPlacesService().keywordSearch(
      query,
      (results, status) => resolve(status === kakao.maps.services.Status.OK ? results : []),
      options
    );
  });
}

/**
 * kakao.maps.services.Geocoder.addressSearch()를 프로미스로 감싼다.
 * keywordSearch와는 다른 API라, 도로명 주소("세종대로 110" 같은)를 정확히
 * 찾으려면 이걸 같이 돌려야 한다. keywordSearch만으로는 상호명이 없는 순수
 * 주소 검색에서 결과가 안 나오거나 빠지는 경우가 있다.
 */
function addressSearchAsync(query) {
  return new Promise((resolve) => {
    getGeocoderService().addressSearch(query, (results, status) =>
      resolve(status === kakao.maps.services.Status.OK ? results : [])
    );
  });
}

/** Geocoder 결과를 keywordSearch 결과와 같은 모양({place_name, road_address_name, address_name, x, y})으로 맞춘다. */
function normalizeAddressResult(r) {
  return {
    place_name: r.road_address?.address_name || r.address_name, // 상호명이 없으니 주소 자체를 이름으로
    road_address_name: r.road_address?.address_name || "",
    address_name: r.address_name,
    x: r.x,
    y: r.y,
  };
}

async function searchDestination() {
  const query = destinationSearchInput.value.trim();
  if (!query) return;

  // 현재 위치를 알고 있으면 가까운 순으로 정렬해서 찾아준다.
  const options = currentPosition
    ? {
        location: new kakao.maps.LatLng(currentPosition.lat, currentPosition.lng),
        sort: kakao.maps.services.SortBy.DISTANCE,
      }
    : undefined;

  const [addressResults, placeResults] = await Promise.all([
    addressSearchAsync(query),
    keywordSearchAsync(query, options),
  ]);

  // 도로명 주소 검색 결과를 먼저, 상호명 검색 결과를 이어붙인다. 같은 좌표가 두 검색에서
  // 다 나올 수 있어서 좌표 기준으로 중복은 제거한다.
  const seen = new Set();
  const merged = [];
  for (const item of [...addressResults.map(normalizeAddressResult), ...placeResults]) {
    const key = `${item.x},${item.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  renderDestinationResults(merged);
}

destinationSearchBtn.addEventListener("click", searchDestination);
destinationSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchDestination();
});

// ---------- 홈 화면 <-> 지도 화면 전환 ----------
//
// 앱을 켜면 지도 없이 홈 화면(카드 4개 + 추천 코스)부터 보여준다.
// 카드를 눌러야 그제서야 지도 화면으로 넘어가고, 그때 처음으로 지도를 만든다
// (미리 만들어두면 첫 화면부터 지도가 뜨는 것과 다를 게 없어진다).

const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 위치 확인 전/실패 시 쓰는 기본 위치 (서울시청)

let kakaoReady = false;
let mapInitialized = false;

kakao.maps.load(() => {
  kakaoReady = true;
  // 카카오 SDK 로딩이 느려서, 사용자가 이미 지도 화면으로 넘어가 있는 상태로
  // 이 콜백을 맞이할 수도 있다 - 그런 경우 여기서 바로 지도를 만들어준다.
  if (!mapScreen.classList.contains("hidden") && !mapInitialized) {
    mapInitialized = true;
    initMap(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
  }
});

/**
 * 홈 화면의 카드를 누르면 호출된다. 지도는 여기서 딱 한 번만 만들고, 그다음부터는
 * relayout()만 한다. 들어가자마자 내 위치를 확인해서 그쪽으로 지도를 옮긴다
 * (코스를 실제로 만들 때 다시 한번 최신 위치를 가져오긴 하지만, 지도 화면에
 * 들어서는 순간부터 내 위치가 보이는 게 자연스럽다).
 */
function enterMapScreen() {
  homeScreen.classList.add("hidden");
  mapScreen.classList.remove("hidden");

  if (!mapInitialized && kakaoReady) {
    mapInitialized = true;
    initMap(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
  } else if (map) {
    // display:none이었다가 다시 보이는 것이므로, 카카오맵이 크기를 다시 계산하게 해줘야 한다.
    map.relayout();
    if (currentPosition) {
      map.setCenter(new kakao.maps.LatLng(currentPosition.lat, currentPosition.lng));
    }
  }

  updateMyLocationLabel(currentPosition); // 이미 아는 위치가 있으면 바로 보여주고, 없으면 "확인 중..." 상태로

  getCurrentLocation()
    .then((pos) => {
      currentPosition = pos;
      initMap(pos.lat, pos.lng); // 이미 만들어진 지도이므로 중심/마커만 옮겨간다
      updateMyLocationLabel(pos);
    })
    .catch(() => {
      statusMsg.textContent = "위치 권한이 없어 기본 위치를 표시 중입니다. 코스를 시작하려면 위치 권한을 허용해주세요.";
      updateMyLocationLabel(null, true);
    });
}

function enterHomeScreen() {
  mapScreen.classList.add("hidden");
  homeScreen.classList.remove("hidden");
}

backToHomeBtn.addEventListener("click", enterHomeScreen);

document.getElementById("home-card-destination").addEventListener("click", () => {
  enterMapScreen();
  document.querySelector('.start-tab[data-tab="destination"]').click();
});

document.getElementById("home-card-loop").addEventListener("click", () => {
  enterMapScreen();
  document.querySelector('.start-tab[data-tab="loop"]').click();
});

document.getElementById("home-card-reports").addEventListener("click", () => {
  enterMapScreen();
  document.querySelector('.start-tab[data-tab="reports"]').click();
});

// "특정 요소" 카드는 아직 기능이 없어서(기획서 Phase 3, 자체 라우팅 필요) 비활성 상태로만 둔다.

document.getElementById("recommend-start-btn").addEventListener("click", () => {
  enterMapScreen();
  document.querySelector('.start-tab[data-tab="loop"]').click();
  previewCourse(5.0, undefined); // 추천 코스: 5km, 무작위 방향
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
