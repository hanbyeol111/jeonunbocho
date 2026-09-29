/*
  앱 껍데기(로그인 / 면책 동의 / 홈 / 내 리포트 / 프로필) 화면 전환.

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
    reports: $("reports-screen"),
    profile: $("profile-screen"),
  };

  function show(name) {
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle("hidden", key !== name);
    }
  }

  function getNickname() {
    return store.get(KEYS.nickname) || DEFAULT_NICKNAME;
  }

  function renderInitials() {
    const initial = Array.from(getNickname())[0] || "게";
    $("home-profile-initial").textContent = initial;
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

  $("home-profile-btn").addEventListener("click", openProfile);
  $("profile-back-btn").addEventListener("click", () => show("home"));
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
  $("reports-back-btn").addEventListener("click", () => show("home"));
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
