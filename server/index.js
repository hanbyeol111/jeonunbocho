/*
  전운보초 - 경로 요청 프록시 서버

  카카오모빌리티 길찾기(Directions) API는 브라우저에서 직접 fetch하면
  CORS 정책에 막힌다. 이 서버가 프론트엔드(app/) 대신 카카오모빌리티에
  요청을 보내고, 응답을 그대로 프론트엔드에 돌려준다.

  실행 방법:
    1) .env.example을 복사해 .env를 만들고 KAKAO_REST_API_KEY를 채운다.
    2) npm install
    3) npm start   (기본 포트 3000)
*/

import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const DIRECTIONS_URL = "https://apis-navi.kakaomobility.com/v1/directions";

function isValidCoord(point) {
  return (
    point &&
    typeof point.lat === "number" &&
    typeof point.lng === "number" &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng)
  );
}

// 두 가지 모드를 지원한다:
//   - 순환 코스: { origin, waypoint } -> origin -> waypoint -> origin으로 돌아오는 왕복 경로
//   - 목적지 지정: { origin, destination } -> origin에서 destination까지 편도 경로
app.post("/api/route", async (req, res) => {
  // 키가 없거나, .env.example의 안내 문구를 그대로 둔 상태(비-ASCII 문자 포함)면
  // 카카오 API까지 가지 않고 여기서 바로 알려준다.
  if (!KAKAO_REST_API_KEY || /[^\x00-\x7F]/.test(KAKAO_REST_API_KEY)) {
    return res.status(500).json({
      error: "KAKAO_REST_API_KEY가 설정되지 않았습니다. server/.env 파일에 실제 REST API 키를 넣어주세요.",
    });
  }

  const { origin, waypoint, destination } = req.body ?? {};

  if (!isValidCoord(origin)) {
    return res.status(400).json({ error: "origin은 { lat: number, lng: number } 형태여야 합니다." });
  }
  if (!waypoint && !destination) {
    return res.status(400).json({ error: "waypoint(순환 코스) 또는 destination(목적지 지정) 중 하나가 필요합니다." });
  }
  if (waypoint && !isValidCoord(waypoint)) {
    return res.status(400).json({ error: "waypoint는 { lat: number, lng: number } 형태여야 합니다." });
  }
  if (destination && !isValidCoord(destination)) {
    return res.status(400).json({ error: "destination은 { lat: number, lng: number } 형태여야 합니다." });
  }

  const params = new URLSearchParams({
    origin: `${origin.lng},${origin.lat}`,
    priority: "RECOMMEND",
    road_details: "true", // guides/roads 상세 정보 포함
  });

  if (destination) {
    // 목적지 지정: 편도로 destination까지만 간다.
    params.set("destination", `${destination.lng},${destination.lat}`);
  } else {
    // 순환 코스: waypoint를 거쳐 다시 origin으로 돌아온다.
    params.set("destination", `${origin.lng},${origin.lat}`);
    params.set("waypoints", `${waypoint.lng},${waypoint.lat}`);
  }

  try {
    const kakaoRes = await fetch(`${DIRECTIONS_URL}?${params.toString()}`, {
      headers: {
        Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`,
      },
    });

    const data = await kakaoRes.json();

    if (!kakaoRes.ok) {
      return res.status(kakaoRes.status).json({
        error: "카카오모빌리티 API 오류",
        detail: data,
      });
    }

    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "카카오모빌리티 API 요청 실패", detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`전운보초 경로 프록시 서버 실행 중: http://localhost:${PORT}`);
});
