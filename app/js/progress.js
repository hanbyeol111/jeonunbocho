/*
  경험치(XP) · 레벨 · 배지. 전부 이 기기의 localStorage에만 저장한다 (계정 없음).

  카카오 SDK와 상관없이 shell.js(프로필 화면)와 app.js(완주 처리)가 같이 쓰므로 따로 뒀다.
  숫자(레벨 기준, XP 계산식)는 정해진 규칙이 아니라 이 앱에서 임의로 정한 값이라, 쓰다가 너무 빠르거나
  느리면 아래 상수만 고치면 된다. 이미 쌓인 XP는 그대로 두고 레벨 표시만 바뀐다.
*/
window.Progress = (() => {
  const KEY = "jeonunbocho_progress";

  const LEVELS = [
    { lv: 1, name: "입문", min: 0 },
    { lv: 2, name: "초급", min: 150 },
    { lv: 3, name: "중급", min: 500 },
  ];

  const BADGES = [
    { id: "first", label: "첫 완주" },
    { id: "streak3", label: "3일 연속" },
    { id: "uturn", label: "첫 유턴" },
    { id: "unprotected", label: "비보호 좌회전" },
    { id: "roundabout", label: "회전교차로" },
    { id: "ten", label: "10회 완주" },
  ];

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && typeof raw === "object") {
        return {
          xp: Number(raw.xp) || 0,
          courses: Number(raw.courses) || 0,
          badges: raw.badges && typeof raw.badges === "object" ? raw.badges : {},
          days: Array.isArray(raw.days) ? raw.days : [],
        };
      }
    } catch {
      /* 저장이 안 되거나 깨져 있으면 처음 상태로 시작한다 */
    }
    return { xp: 0, courses: 0, badges: {}, days: [] };
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* 저장이 막힌 환경이면 이번 실행에서만 유지된다 */
    }
  }

  /** 코스 하나를 완주했을 때 받는 XP. 기본 50 + 회전 1회당 5 + 주의 구간 1곳당 15, 최대 200. */
  function xpFor({ turns = 0, cautions = 0 }) {
    return Math.min(200, 50 + 5 * turns + 15 * cautions);
  }

  function levelFor(xp) {
    let found = LEVELS[0];
    for (const l of LEVELS) if (xp >= l.min) found = l;
    return found;
  }

  /** 화면에 그릴 현재 상태: 레벨, 다음 레벨까지, 진행률, 배지 목록. */
  function get() {
    const state = load();
    const level = levelFor(state.xp);
    const next = LEVELS.find((l) => l.min > state.xp) || null;
    return {
      xp: state.xp,
      courses: state.courses,
      level,
      next,
      pct: next ? Math.min(100, Math.round((state.xp / next.min) * 100)) : 100,
      badges: BADGES.map((b) => ({ ...b, on: Boolean(state.badges[b.id]) })),
    };
  }

  // "2026-10-23" 같은 로컬 날짜 문자열
  function dayKey(date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  // 마지막 날부터 거꾸로 이어진 날짜가 3일 이상이면 true
  function hasStreak(days, need) {
    const set = new Set(days);
    let d = new Date();
    let count = 0;
    // 오늘부터 하루씩 거슬러 올라가며 연속된 날을 센다
    while (set.has(dayKey(d))) {
      count += 1;
      d.setDate(d.getDate() - 1);
    }
    return count >= need;
  }

  /**
   * 완주를 기록한다. 코스에 나온 요소 개수로 XP를 주고, 새로 얻은 배지를 알려 준다.
   * @param {{turns:number,cautions:number,uturn:number,unprotected:number,roundabout:number}} stats
   * @returns {{gained:number, leveledUp:boolean, level:object, newBadges:object[], state:object}}
   */
  function record(stats) {
    const state = load();
    const before = levelFor(state.xp);

    const gained = xpFor(stats);
    state.xp += gained;
    state.courses += 1;
    const today = dayKey(new Date());
    if (!state.days.includes(today)) state.days.push(today);
    state.days = state.days.slice(-60); // 연속 판정에는 최근 날짜만 있으면 된다

    const earned = {
      first: state.courses >= 1,
      streak3: hasStreak(state.days, 3),
      uturn: stats.uturn > 0,
      unprotected: stats.unprotected > 0,
      roundabout: stats.roundabout > 0,
      ten: state.courses >= 10,
    };
    const newBadges = [];
    for (const b of BADGES) {
      if (earned[b.id] && !state.badges[b.id]) {
        state.badges[b.id] = new Date().toISOString();
        newBadges.push(b);
      }
    }

    save(state);
    const after = levelFor(state.xp);
    return { gained, leveledUp: after.lv > before.lv, level: after, newBadges, state };
  }

  return { LEVELS, BADGES, xpFor, levelFor, get, record };
})();
