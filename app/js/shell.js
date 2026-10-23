/*
  앱 껍데기(로그인 / 면책 동의 / 홈 / 코스 / 내 리포트 / 프로필) 화면 전환과 하단 탭바.

  카카오 SDK와 상관없이 바로 돌아야 해서 app.js와 분리했다. app.js와 전역 이름이 겹치지
  않도록 전체를 함수로 감쌌고, localStorage 키 이름만 app.js와 같은 값을 맞춰 쓴다.

  흐름: (처음) 로그인 -> 면책 동의 -> 홈   /   (그 뒤) 곧바로 홈
  로그인은 아직 껍데기라서 "로그인 없이 둘러보기"만 동작한다.
*/
(function () {
  const KEYS = {
    onboarded: "jeonunbocho_onboarded",
    nickname: "jeonunbocho_nickname",
    firstUsed: "jeonunbocho_first_used",
    reports: "jeonunbocho_report_history", // app.js의 REPORT_HISTORY_KEY와 같아야 한다
    completed: "jeonunbocho_completed_count", // app.js의 COMPLETED_COUNT_KEY와 같아야 한다
  };
  const DEFAULT_NICKNAME = "게스트";

  // 사생활 보호 모드 등에서 localStorage가 막혀 있어도 앱이 죽지 않게 감싼다.
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* 저장이 안 되는 환경이면 이번 실행에서만 유지된다 */
      }
    },
  };

  const $ = (id) => document.getElementById(id);
  const screens = {
    login: $("login-screen"),
    disclaimer: $("disclaimer-screen"),
    home: $("home-screen"),
    courses: $("courses-screen"),
    reports: $("reports-screen"),
    profile: $("profile-screen"),
  };

  // 하단 탭바가 보이는 화면들. 지도 화면(app.js가 따로 관리)에 들어가 있는 동안은 숨긴다.
  const TAB_SCREENS = ["home", "courses", "reports", "profile"];
  let current = null; // 지금 보이는 껍데기 화면 이름
  let inMap = false; // 지도 화면 안에 있는지
  let beforeMap = "home"; // 지도 화면에서 "뒤로"를 누르면 돌아갈 화면

  function syncTabs() {
    $("tab-bar").classList.toggle("hidden", inMap || !TAB_SCREENS.includes(current));
    document.querySelectorAll(".tab-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === current);
    });
  }

  function show(name) {
    current = name;
    inMap = false;
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle("hidden", key !== name);
    }
    syncTabs();
  }

  // app.js(지도 화면)가 쓰는 연결 지점. 카카오 SDK와 상관없이 shell.js가 먼저 로드된다.
  window.Shell = {
    show,
    enterMap() {
      if (TAB_SCREENS.includes(current)) beforeMap = current;
      inMap = true;
      for (const el of Object.values(screens)) el.classList.add("hidden");
      syncTabs();
    },
    leaveMap() {
      show(beforeMap);
    },
    setReturn(name) {
      beforeMap = name;
    },
    openReports() {
      openReports();
    },
  };

  function getNickname() {
    return store.get(KEYS.nickname) || DEFAULT_NICKNAME;
  }

  function renderInitials() {
    const initial = Array.from(getNickname())[0] || "게";
    $("home-nickname").textContent = getNickname();
    $("profile-avatar").textContent = initial;
  }

  // ---------- 면책 동의 ----------

  // "onboarding": 처음 한 번 동의해야 넘어간다 / "review": 프로필에서 다시 읽기만 한다
  function openDisclaimer(mode) {
    const isOnboarding = mode === "onboarding";
    $("disclaimer-check-row").classList.toggle("hidden", !isOnboarding);
    $("disclaimer-check").checked = false;

    const confirmBtn = $("disclaimer-confirm-btn");
    confirmBtn.textContent = isOnboarding ? "동의하고 시작하기" : "돌아가기";
    confirmBtn.disabled = isOnboarding;
    confirmBtn.dataset.mode = mode;

    show("disclaimer");
  }

  $("guest-start-btn").addEventListener("click", () => openDisclaimer("onboarding"));

  $("disclaimer-check").addEventListener("change", (e) => {
    $("disclaimer-confirm-btn").disabled = !e.target.checked;
  });

  $("disclaimer-confirm-btn").addEventListener("click", () => {
    if ($("disclaimer-confirm-btn").dataset.mode === "onboarding") {
      store.set(KEYS.onboarded, "1");
      if (!store.get(KEYS.firstUsed)) store.set(KEYS.firstUsed, new Date().toISOString());
      renderInitials();
      show("home");
    } else {
      openProfile();
    }
  });

  // ---------- 프로필 ----------

  function loadReports() {
    try {
      const raw = JSON.parse(store.get(KEYS.reports));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}`;
  }

  // 기록 한 줄. 새 기록은 코스 이름/거리/시간, 예전 기록(text만 있음)은 리포트 문구를 보여준다.
  function buildRecord(entry) {
    const li = document.createElement("li");
    li.className = "record";

    const main = document.createElement("div");
    main.className = "record-main";
    const title = document.createElement("strong");
    title.textContent = entry.title || "완주 기록";
    const date = document.createElement("span");
    date.className = "record-date";
    date.textContent = formatDateTime(entry.date);
    main.appendChild(title);
    main.appendChild(date);
    li.appendChild(main);

    const stats = [];
    if (typeof entry.distanceKm === "number") stats.push(`${entry.distanceKm}km`);
    if (typeof entry.durationMin === "number") stats.push(`${entry.durationMin}분`);
    const sub = document.createElement("p");
    sub.className = "record-sub";
    sub.textContent = stats.length ? stats.join(" · ") : entry.text || "";
    li.appendChild(sub);
    return li;
  }

  function openProfile() {
    const reports = loadReports();
    // 기록 목록은 최근 100개까지만 보관되므로, 완주 횟수는 별도 카운터를 우선 쓴다.
    const completed = Number(store.get(KEYS.completed)) || reports.length;

    $("profile-nickname").value = getNickname();
    $("profile-completed").textContent = `${completed}회`;
    $("profile-first-used").textContent = store.get(KEYS.firstUsed)
      ? formatDate(store.get(KEYS.firstUsed))
      : "-";
    renderInitials();

    const list = $("profile-report-list");
    list.innerHTML = "";
    $("profile-report-empty").classList.toggle("hidden", reports.length > 0);
    for (const entry of reports.slice(0, 5)) list.appendChild(buildRecord(entry));

    show("profile");
  }

  function saveNickname() {
    const value = $("profile-nickname").value.trim().slice(0, 12);
    if (value && value !== DEFAULT_NICKNAME) {
      store.set(KEYS.nickname, value);
    } else {
      store.set(KEYS.nickname, "");
    }
    $("profile-nickname").value = getNickname();
    renderInitials();
  }

  $("profile-save-btn").addEventListener("click", saveNickname);
  $("profile-nickname").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveNickname();
  });
  $("profile-disclaimer-btn").addEventListener("click", () => openDisclaimer("review"));

  // ---------- 내 리포트 ----------

  let reportsFilter = "all";

  // 필터에 맞는 기록만 남긴다. 이번 주는 월요일 0시부터, 이번 달은 1일 0시부터.
  function filterReports(reports, filter) {
    if (filter === "all") return reports;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (filter === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    else start.setDate(1);
    return reports.filter((r) => new Date(r.date) >= start);
  }

  function formatTotalTime(min) {
    if (min < 60) return `${min}분`;
    return `${Math.floor(min / 60)}시간 ${min % 60}분`;
  }

  function renderReports() {
    const list = filterReports(loadReports(), reportsFilter);
    // 총 주행 시간은 걸린 시간이 기록된 것만 합친다. (예전 기록에는 시간이 없다)
    const totalMin = list.reduce((sum, r) => sum + (typeof r.durationMin === "number" ? r.durationMin : 0), 0);
    $("reports-total-time").textContent = formatTotalTime(totalMin);
    $("reports-total-count").textContent = `(${list.length}회)`;

    const ul = $("reports-list");
    ul.innerHTML = "";
    $("reports-empty").classList.toggle("hidden", list.length > 0);
    for (const entry of list) ul.appendChild(buildRecord(entry));
  }

  function openReports() {
    reportsFilter = "all";
    for (const tab of $("reports-filters").querySelectorAll(".filter-tab")) {
      tab.classList.toggle("active", tab.dataset.filter === "all");
    }
    renderReports();
    show("reports");
  }

  $("home-card-reports").addEventListener("click", openReports);
  $("home-to-courses").addEventListener("click", () => show("courses"));
  document.querySelectorAll(".tab-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.tab;
      if (name === "reports") openReports();
      else if (name === "profile") openProfile();
      else show(name);
    });
  });
  $("reports-filters").addEventListener("click", (e) => {
    const tab = e.target.closest(".filter-tab");
    if (!tab) return;
    reportsFilter = tab.dataset.filter;
    for (const t of $("reports-filters").querySelectorAll(".filter-tab")) {
      t.classList.toggle("active", t === tab);
    }
    renderReports();
  });

  // ---------- 시작 ----------

  renderInitials();
  show(store.get(KEYS.onboarded) ? "home" : "login");
})();
