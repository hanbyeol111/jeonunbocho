/*
  앱 껍데기(로그인 / 면책 동의 / 홈 / 프로필) 화면 전환.

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

  function openProfile() {
    const reports = loadReports();
    // 기록 목록은 최근 20개까지만 보관되므로, 완주 횟수는 별도 카운터를 우선 쓴다.
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

    for (const entry of reports.slice(0, 5)) {
      const li = document.createElement("li");
      li.className = "report-history-item";

      const dateEl = document.createElement("span");
      dateEl.className = "report-history-date";
      dateEl.textContent = formatDateTime(entry.date);

      const textEl = document.createElement("p");
      textEl.className = "report-history-text";
      textEl.textContent = entry.text;

      li.appendChild(dateEl);
      li.appendChild(textEl);
      list.appendChild(li);
    }

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

  // ---------- 시작 ----------

  renderInitials();
  show(store.get(KEYS.onboarded) ? "home" : "login");
})();
