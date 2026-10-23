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

  // 레벨 카드와 배지 칸. 경험치/배지 계산은 js/progress.js가 한다.
  function renderProgress() {
    const p = window.Progress.get();
    $("profile-level-title").textContent = `LV.${p.level.lv} ${p.level.name} 운전자`;
    $("profile-xp-text").textContent = p.next ? `${p.xp} / ${p.next.min} XP` : `${p.xp} XP · 최고 레벨`;
    $("profile-xp-bar").style.width = `${p.pct}%`;
    $("profile-level-hint").textContent = p.next
      ? `LV.${p.next.lv} ${p.next.name}까지 ${p.next.min - p.xp} XP 남았어요`
      : "가장 높은 레벨이에요. 계속 안전하게 연습해요!";

    const grid = $("profile-badges");
    grid.innerHTML = "";
    for (const b of p.badges) {
      const item = document.createElement("div");
      item.className = `badge-item${b.on ? " on" : ""}`;
      item.innerHTML =
        '<span class="badge-ic"><svg viewBox="0 0 24 24" stroke-width="1.6" stroke-linejoin="round">' +
        '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/></svg></span>';
      const label = document.createElement("span");
      label.className = "badge-label";
      label.textContent = b.label;
      item.appendChild(label);
      grid.appendChild(item);
    }
    $("profile-badge-count").textContent = `${p.badges.filter((b) => b.on).length} / ${p.badges.length}`;
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
    renderProgress();

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
  // 코스 / 내 리포트 / 프로필 화면 왼쪽 위의 뒤로가기 화살표는 홈으로 돌아간다.
  for (const id of ["courses-back-btn", "reports-back-btn", "profile-back-btn"]) {
    $(id).addEventListener("click", () => show("home"));
  }
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

  // ---------- 휴대폰 뒤로가기 ----------
  //
  // 웹앱에서 뒤로가기를 누르면 브라우저가 "이전 페이지"로 가 버려서 앱이 꺼진다. 그래서 화면 전환을
  // 따로 기록하는 대신, 항상 "한 칸 앞 기록"을 하나 만들어 두고 뒤로가기가 오면 그 칸을 소비한 걸로
  // 취급해서 앱 안에서 한 단계 뒤로 간 다음 다시 한 칸을 채운다.
  //
  // 주의: 사용자가 화면을 한 번이라도 눌러야 브라우저가 이 기록을 인정한다(크롬 정책). 그래서 첫 터치 때 만든다.
  //
  // 앱 종료: 웹페이지는 스스로 앱을 끌 수 없다. "종료"를 누르면 window.close()와 한 번 더 뒤로가기를
  // 시도하고, 그래도 안 꺼지면 "뒤로가기를 한 번 더 누르세요"라고 알려 준다. 이때는 한 칸 앞 기록을
  // 다시 채우지 않아서 그 뒤로가기가 그대로 앱을 나간다.

  let backArmed = false;
  let exiting = false;
  const exitDialog = $("exit-dialog");
  const confirmDialog = $("confirm-dialog");

  function pushBuffer() {
    try {
      history.pushState({ jbc: "buffer" }, "");
    } catch {
      /* 기록을 못 만드는 환경이면 뒤로가기는 브라우저 기본 동작대로 간다 */
    }
  }

  function armBackButton() {
    if (backArmed) return;
    backArmed = true;
    try {
      history.replaceState({ jbc: "base" }, "");
    } catch {
      /* 위와 같다 */
    }
    pushBuffer();
  }
  document.addEventListener("pointerup", armBackButton, { once: true, capture: true });
  document.addEventListener("keydown", armBackButton, { once: true, capture: true });

  /** 껍데기 화면에서 한 단계 뒤로. 처리했으면 true, 맨 처음 화면이라 더 갈 곳이 없으면 false. */
  function shellBack() {
    if (current === "disclaimer") {
      if ($("disclaimer-confirm-btn").dataset.mode === "review") openProfile();
      else show("login");
      return true;
    }
    if (["courses", "reports", "profile"].includes(current)) {
      show("home");
      return true;
    }
    return false;
  }

  /** 앱 종료 확인 창. 열려 있는 동안에는 한 칸 앞 기록이 없어서, 뒤로가기를 한 번 더 누르면 그대로 나간다. */
  function openExitDialog() {
    if (exitDialog.open) return;
    $("exit-dialog-text").textContent = '종료하려면 "종료"를 눌러주세요.';
    exitDialog.showModal();
  }

  function closeExitDialog() {
    if (exitDialog.open) exitDialog.close();
    pushBuffer(); // 취소했으니 다음 뒤로가기도 다시 가로챌 수 있게 한 칸을 채운다
  }

  $("exit-cancel-btn").addEventListener("click", closeExitDialog);
  exitDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeExitDialog();
  });
  $("exit-ok-btn").addEventListener("click", () => {
    exiting = true;
    try {
      window.close(); // 설치형 앱에서는 이것만으로 꺼지기도 한다
    } catch {
      /* 닫을 수 없는 창이면 무시 */
    }
    history.back(); // 이전 페이지가 있으면(브라우저 탭) 그쪽으로 나간다
    setTimeout(() => {
      // 아직 살아 있으면 웹페이지가 스스로 끌 수 없는 환경이다.
      $("exit-dialog-text").textContent = "화면 밖으로 나가려면 휴대폰 뒤로가기를 한 번 더 눌러주세요.";
    }, 500);
  });

  /** 확인 창을 띄우고 눌린 답(true/false)을 돌려준다. 주행 중단 확인에 쓴다. */
  function askConfirm({ title, text, ok }) {
    return new Promise((resolve) => {
      $("confirm-title").textContent = title;
      $("confirm-text").textContent = text;
      $("confirm-ok-btn").textContent = ok;
      const done = (answer) => {
        confirmDialog.close();
        $("confirm-ok-btn").onclick = null;
        $("confirm-cancel-btn").onclick = null;
        resolve(answer);
      };
      $("confirm-ok-btn").onclick = () => done(true);
      $("confirm-cancel-btn").onclick = () => done(false);
      confirmDialog.showModal();
    });
  }
  window.Shell.askConfirm = askConfirm;

  window.addEventListener("popstate", () => {
    if (!backArmed || exiting) return; // 종료 중이면 막지 않는다

    // 열려 있는 창이 있으면 그것부터 닫는다
    if (confirmDialog.open) {
      confirmDialog.querySelector("#confirm-cancel-btn").click();
      pushBuffer();
      return;
    }
    // 지도 화면 쪽(app.js)이 먼저 처리할 기회를 준다
    if (typeof window.Shell.onBack === "function" && window.Shell.onBack()) {
      pushBuffer();
      return;
    }
    if (shellBack()) {
      pushBuffer();
      return;
    }
    // 더 갈 곳이 없는 맨 처음 화면(홈/로그인): 종료할지 묻는다
    openExitDialog();
  });

  // ---------- 시작 ----------

  renderInitials();
  show(store.get(KEYS.onboarded) ? "home" : "login");
})();
