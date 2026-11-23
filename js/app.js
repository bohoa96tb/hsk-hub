// app.js — Giao diện HSK Hub. Dữ liệu: GitHub (nếu có PAT) -> file tĩnh -> localStorage.
import {
  APPS, SRS_INTERVALS, todayJST, addDays, dueLessons, upcomingLessons,
  markRemembered, markForgotten, overdueDays, generateId, validateData,
  mergeData, emptyData, clampStage, filterCatalog, findDuplicateLesson,
  normalizeReminderMode, overdueLessons, spreadOverdueLessons, deferLessonDate,
  computeTierProgress, DEFAULT_DAILY_REVIEW_LIMIT,
} from './srs.js';
import {
  monthGrid, buildHeatmap, buildDueCounts, buildForecastCounts,
  forecastLessonsOn, monthStats,
} from './calendar.js';
import {
  GitHubSync, GitHubError, getStoredToken, storeToken, fetchStaticData,
  loadLocalData, saveLocalData, backupLocalData, createSyncQueue,
} from './github-sync.js';

const $ = (sel) => document.querySelector(sel);
const els = {
  streak: $('#statStreak'), longest: $('#statLongest'), due: $('#statDue'), sync: $('#statSync'),
  list: $('#lessonList'), loading: $('#loadingState'), error: $('#errorState'), empty: $('#emptyState'),
  toast: $('#toast'), offline: $('#offlineBanner'),
  lessonModal: $('#lessonModal'), settingsModal: $('#settingsModal'),
  spreadModal: $('#spreadModal'), deferModal: $('#deferModal'),
  syncStatus: $('#syncStatus'),
  calendarView: $('#calendarView'), calGrid: $('#calGrid'), calTitle: $('#calTitle'),
  calDayDetail: $('#calDayDetail'), calMonthStats: $('#calMonthStats'),
  calOverdueBanner: $('#calOverdueBanner'), calOverdueText: $('#calOverdueText'),
  calSpreadBtn: $('#calSpreadBtn'), calForecast: $('#calForecast'),
  dueSpreadBanner: $('#dueSpreadBanner'), dueSpreadText: $('#dueSpreadText'),
  progressBody: $('#progressBody'), progressChevron: $('#progressChevron'),
};

let data = null;
let activeTab = 'due';
// Trạng thái tab Lịch tháng
const _nowParts = todayJST().split('-').map(Number);
let calYear = _nowParts[0];
let calMonth = _nowParts[1];
let selectedDate = todayJST();
let forecastOn = false;
let deferTargetId = null;
let syncState = 'Chưa gắn Token';
let syncClient = null;
let syncClientKey = '';
let syncQueue = null;

function toast(msg, kind = '') {
  els.toast.textContent = msg;
  els.toast.className = `toast ${kind}`;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.hidden = true; }, 3600);
}

function setSync(state) {
  syncState = state;
  els.sync.textContent = state;
}

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem('hsk-hub-theme');
  document.documentElement.dataset.theme = saved || 'auto';
  updateThemeBtn();
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'auto' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('hsk-hub-theme', next);
    updateThemeBtn();
  });
}
function updateThemeBtn() {
  const t = document.documentElement.dataset.theme;
  $('#themeBtn').textContent = t === 'dark' ? '☀️' : t === 'light' ? '🖥️' : '🌙';
}

// ---------- Tải / lưu dữ liệu ----------
// Dùng 1 instance GitHubSync duy nhất cho mỗi cấu hình để giữ lastKnownSha giữa các lần lưu.
function makeSync(settingsSource) {
  const s = settingsSource || (data && data.settings) || {};
  const cfg = {
    owner: s.owner || 'bohoa96tb',
    repo: s.repo || 'hsk-hub',
    branch: s.branch || 'main',
    token: getStoredToken(),
  };
  const key = `${cfg.owner}/${cfg.repo}@${cfg.branch}#${cfg.token ? 'tok' : 'anon'}`;
  if (!syncClient || syncClientKey !== key) {
    syncClient = new GitHubSync(cfg);
    syncClientKey = key;
  }
  return syncClient;
}

async function loadData() {
  els.loading.hidden = false;
  els.error.hidden = true;
  const local = loadLocalData();
  const token = getStoredToken();
  try {
    if (token) {
      setSync('Đang tải…');
      const remote = await makeSyncFor(local).fetchRemote();
      if (remote && remote.data) {
        const v = validateData(remote.data);
        if (v.ok) {
          // Merge với bản local để không mất bài tạo lúc offline
          data = local && validateData(local).ok ? mergeData(validateData(local).data, v.data) : v.data;
          setSync('Đã đồng bộ');
        } else {
          throw new Error(`Dữ liệu trên GitHub không hợp lệ: ${v.error}`);
        }
      } else {
        data = local && validateData(local).ok ? validateData(local).data : emptyData();
        setSync('Đã đồng bộ');
      }
    } else {
      setSync('Chưa gắn Token');
      if (local && validateData(local).ok) {
        data = validateData(local).data;
      } else {
        const remoteStatic = await fetchStaticData();
        const v = validateData(remoteStatic);
        data = v.ok ? v.data : emptyData();
      }
    }
  } catch (err) {
    if (local && validateData(local).ok) {
      data = validateData(local).data;
      setSync('Ngoại tuyến / lỗi mạng');
      showError(`Không tải được dữ liệu mới nhất (${err.message}). Đang dùng bản lưu trên máy.`);
    } else {
      data = emptyData();
      setSync('Lỗi tải dữ liệu');
      showError(`Không tải được dữ liệu: ${err.message}`);
    }
  }
  saveLocalData(data);
  els.loading.hidden = true;
  render();
}

function validateLocal(local) {
  const v = validateData(local);
  return v.ok ? v.data : emptyData();
}
function makeSyncFor(local) {
  return makeSync((local && local.settings) || undefined);
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
}

/**
 * Hàng đợi đồng bộ: mọi thay đổi (xóa/nhớ/thêm liên tiếp) được gom debounce 700ms
 * và gửi TUẦN TỰ — không bao giờ có 2 lệnh PUT song song. Đang PUT mà có thay đổi mới
 * thì chỉ PUT thêm đúng 1 lần với trạng thái mới nhất.
 */
function getSyncQueue() {
  if (!syncQueue) {
    syncQueue = createSyncQueue(async () => {
      setSync('Đang lưu…');
      try {
        await makeSync().save(data);
        setSync('Đã đồng bộ');
        toast('Đã đồng bộ lên GitHub', 'ok');
      } catch (err) {
        setSync('Lỗi đồng bộ');
        toast(err instanceof GitHubError ? err.message : `Lỗi đồng bộ: ${err.message}`, 'error');
      }
    }, { debounceMs: 700 });
  }
  return syncQueue;
}

/** Lưu local ngay; nếu có token thì đưa vào hàng đợi đồng bộ lên GitHub. */
function persist({ immediate = false } = {}) {
  saveLocalData(data);
  render();
  const token = getStoredToken();
  if (!token) { setSync('Chưa gắn Token'); return; }
  if (immediate) getSyncQueue().flush();
  else getSyncQueue().schedule();
}

// ---------- Render ----------
function stageLabel(stage) {
  return `Mốc ${SRS_INTERVALS[clampStage(stage)]} ngày`;
}

function fmtVN(dateStr) {
  const [y, m, d] = String(dateStr).split('-');
  return `${d}/${m}/${y}`;
}

function render() {
  if (!data) return;
  const today = todayJST();
  const due = dueLessons(data, today);
  els.streak.textContent = data.stats.currentStreak;
  els.longest.textContent = data.stats.longestStreak;
  els.due.textContent = due.length;
  els.sync.textContent = syncState;

  renderProgress();

  // Thanh cảnh báo dàn đều ở tab "Cần ôn hôm nay" khi có từ 2 bài quá hạn
  const overdue = overdueLessons(data, today);
  const showDueBanner = activeTab === 'due' && overdue.length >= 2;
  els.dueSpreadBanner.hidden = !showDueBanner;
  if (showDueBanner) els.dueSpreadText.textContent = `⚠️ ${overdue.length} bài quá hạn — dàn đều để đỡ ngợp.`;

  const isCalendar = activeTab === 'calendar';
  els.calendarView.hidden = !isCalendar;
  els.list.hidden = isCalendar;
  if (isCalendar) {
    els.empty.hidden = true;
    renderCalendar();
    return;
  }

  let lessons;
  if (activeTab === 'due') lessons = due;
  else if (activeTab === 'upcoming') lessons = upcomingLessons(data, today);
  else lessons = [...data.lessons].sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate));

  els.list.innerHTML = '';
  if (lessons.length === 0) {
    els.empty.hidden = false;
    els.empty.textContent =
      activeTab === 'due' ? '🎉 Hôm nay không còn bài cần ôn. Thêm bài mới hoặc nghỉ ngơi nhé!'
      : activeTab === 'upcoming' ? 'Chưa có bài nào sắp tới.'
      : 'Chưa có bài học nào. Bấm "+ Thêm bài mới" để bắt đầu.';
  } else {
    els.empty.hidden = true;
  }

  for (const lesson of lessons) {
    const card = document.createElement('article');
    card.className = 'lesson-card';
    const od = overdueDays(lesson, today);
    const isToday = lesson.nextReviewDate === today;
    const badge = od > 0
      ? `<span class="badge overdue">Quá hạn ${od} ngày</span>`
      : isToday ? '<span class="badge today">Hôm nay</span>' : '';
    card.innerHTML = `
      <div class="lesson-head">
        <p class="lesson-title"></p>
      </div>
      <div class="badges">
        <span class="badge app">${APPS[lesson.app]?.label || lesson.app}</span>
        <span class="badge">${stageLabel(lesson.stage)}</span>
        ${badge}
      </div>
      ${lesson.note ? '<p class="lesson-note"></p>' : ''}
      <p class="lesson-date">Ngày ôn: ${lesson.nextReviewDate}</p>
      <div class="lesson-actions">
        <a class="btn" href="" target="_blank" rel="noopener">Mở bài</a>
        <button class="btn ok" type="button" data-act="remember">Đã nhớ</button>
        <button class="btn forgot" type="button" data-act="forget">Quên</button>
        <button class="btn small" type="button" data-act="defer">📅 Dời</button>
        ${activeTab === 'all' ? '<button class="btn small" type="button" data-act="edit">Sửa</button><button class="btn small" type="button" data-act="delete">Xóa</button>' : ''}
      </div>`;
    card.querySelector('.lesson-title').textContent = lesson.title;
    const noteEl = card.querySelector('.lesson-note');
    if (noteEl) noteEl.textContent = lesson.note;
    card.querySelector('a.btn').href = lesson.url;
    card.querySelector('[data-act="remember"]').addEventListener('click', () => {
      data = markRemembered(data, lesson.id, todayJST());
      toast('Tốt lắm! Đã hẹn lịch ôn tiếp theo.', 'ok');
      persist();
    });
    card.querySelector('[data-act="forget"]').addEventListener('click', () => {
      data = markForgotten(data, lesson.id, todayJST());
      toast('Không sao — bài sẽ ôn lại vào ngày mai.');
      persist();
    });
    card.querySelector('[data-act="defer"]').addEventListener('click', () => openDeferModal(lesson));
    const editBtn = card.querySelector('[data-act="edit"]');
    if (editBtn) editBtn.addEventListener('click', () => openLessonModal(lesson));
    const delBtn = card.querySelector('[data-act="delete"]');
    if (delBtn) delBtn.addEventListener('click', () => {
      if (!confirm(`Xóa bài "${lesson.title}"?`)) return;
      backupLocalData();
      data = { ...data, lessons: data.lessons.filter((l) => l.id !== lesson.id) };
      toast('Đã xóa bài (đã sao lưu bản trước khi xóa trên máy).');
      persist();
    });
    els.list.appendChild(card);
  }
}

// ---------- V3: Thanh tiến độ 3 tầng ----------
function catalogCounts() {
  const counts = { 'hazi-viet': 0, 'hsk3.0': 0 };
  for (const e of catalogEntries || []) if (e.app in counts) counts[e.app]++;
  return counts;
}

function renderProgress() {
  if (!data) return;
  const progress = computeTierProgress(data.lessons, catalogCounts());
  for (const appKey of Object.keys(progress)) {
    const row = document.getElementById(`progress-${appKey}`);
    if (!row) continue;
    const p = progress[appKey];
    const pct = (n) => (p.total > 0 ? (n / p.total) * 100 : 0);
    row.innerHTML = `
      <div class="progress-meta"><strong>${APPS[appKey]?.label || appKey}</strong>
      <span class="p-count">${p.tracked}/${p.total} bài (${p.percent}%)</span></div>
      <div class="stacked-bar" role="img" aria-label="Mới học ${p.fresh}, đang củng cố ${p.consolidating}, đã nhớ sâu ${p.deep}">
        <div class="seg seg-fresh" style="width:${pct(p.fresh)}%"></div>
        <div class="seg seg-consol" style="width:${pct(p.consolidating)}%"></div>
        <div class="seg seg-deep" style="width:${pct(p.deep)}%"></div>
      </div>
      <p class="progress-tiers">Mới: ${p.fresh} · Củng cố: ${p.consolidating} · Nhớ sâu: ${p.deep}</p>`;
  }
}

$('#progressToggle').addEventListener('click', () => {
  const collapsed = !els.progressBody.hidden;
  els.progressBody.hidden = collapsed;
  els.progressChevron.textContent = collapsed ? '▸' : '▾';
  $('#progressToggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  localStorage.setItem('hsk-hub-progress-collapsed', collapsed ? '1' : '0');
});
if (localStorage.getItem('hsk-hub-progress-collapsed') === '1') {
  els.progressBody.hidden = true;
  els.progressChevron.textContent = '▸';
  $('#progressToggle').setAttribute('aria-expanded', 'false');
}

// ---------- V3: Tab Lịch tháng SRS ----------
function renderCalendar() {
  if (!data) return;
  const today = todayJST();
  els.calTitle.textContent = `Tháng ${calMonth} / ${calYear}`;
  const heatmap = buildHeatmap(data.lessons);
  const dueCounts = buildDueCounts(data.lessons);
  const forecastCounts = forecastOn ? buildForecastCounts(data.lessons) : new Map();
  const overdue = overdueLessons(data, today);

  els.calOverdueBanner.hidden = overdue.length === 0;
  if (overdue.length) {
    els.calOverdueText.textContent = `⚠️ ${overdue.length} bài quá hạn`;
    els.calSpreadBtn.hidden = overdue.length < 2;
  }

  els.calGrid.innerHTML = '';
  for (const week of monthGrid(calYear, calMonth)) {
    for (const cell of week) {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (!cell.date) {
        btn.className = 'cal-cell empty';
        btn.disabled = true;
        btn.setAttribute('aria-hidden', 'true');
      } else {
        const heat = heatmap.get(cell.date) || 0;
        btn.className = 'cal-cell'
          + (heat >= 3 ? ' heat-3' : heat === 2 ? ' heat-2' : heat === 1 ? ' heat-1' : '')
          + (cell.date === today ? ' today' : '')
          + (cell.date === selectedDate ? ' selected' : '');
        const dueN = cell.date >= today ? (dueCounts.get(cell.date) || 0) : 0;
        const fcN = forecastOn ? (forecastCounts.get(cell.date) || 0) : 0;
        btn.innerHTML = `<span class="cal-daynum">${cell.day}</span>
          <span class="cal-badges">
            ${dueN ? `<span class="dot-badge due">🔵 ${dueN}</span>` : ''}
            ${fcN ? `<span class="dot-badge forecast">🟣 ${fcN}</span>` : ''}
          </span>`;
        btn.setAttribute('aria-label', `Ngày ${fmtVN(cell.date)}`);
        btn.addEventListener('click', () => { selectedDate = cell.date; renderCalendar(); });
      }
      els.calGrid.appendChild(btn);
    }
  }
  const stats = monthStats(heatmap, calYear, calMonth);
  els.calMonthStats.textContent = `Tổng lượt ôn trong tháng: ${stats.totalReviews} · Số ngày có học: ${stats.daysStudied}`;
  renderDayDetail(heatmap);
}

function detailItem(lesson, { showReview }) {
  const today = todayJST();
  const item = document.createElement('div');
  item.className = 'cal-item';
  item.innerHTML = `
    <p class="lesson-title"></p>
    <div class="badges">
      <span class="badge app">${APPS[lesson.app]?.label || lesson.app}</span>
      <span class="badge">${stageLabel(lesson.stage)}</span>
      <span class="badge">Ôn: ${fmtVN(lesson.nextReviewDate)}</span>
    </div>
    <div class="lesson-actions">
      <a class="btn" href="" target="_blank" rel="noopener">Mở bài</a>
      ${showReview ? '<button class="btn ok" type="button" data-act="remember">Đã nhớ</button><button class="btn forgot" type="button" data-act="forget">Quên</button>' : ''}
      <button class="btn small" type="button" data-act="defer">📅 Dời</button>
    </div>`;
  item.querySelector('.lesson-title').textContent = lesson.title;
  item.querySelector('a.btn').href = lesson.url;
  const rememberBtn = item.querySelector('[data-act="remember"]');
  if (rememberBtn) rememberBtn.addEventListener('click', () => {
    data = markRemembered(data, lesson.id, todayJST());
    toast('Tốt lắm! Đã hẹn lịch ôn tiếp theo.', 'ok');
    persist();
  });
  const forgetBtn = item.querySelector('[data-act="forget"]');
  if (forgetBtn) forgetBtn.addEventListener('click', () => {
    data = markForgotten(data, lesson.id, todayJST());
    toast('Không sao — bài sẽ ôn lại vào ngày mai.');
    persist();
  });
  item.querySelector('[data-act="defer"]').addEventListener('click', () => openDeferModal(lesson));
  return item;
}

function renderDayDetail(heatmap) {
  const today = todayJST();
  const wrap = els.calDayDetail;
  wrap.innerHTML = '';
  const dueThatDay = data.lessons
    .filter((l) => l.nextReviewDate === selectedDate)
    .sort((a, b) => a.title.localeCompare(b.title));
  const doneThatDay = data.lessons.filter((l) => {
    const days = new Set([...(l.reviewHistory || []), ...(l.learnedDate ? [l.learnedDate] : [])]);
    return days.has(selectedDate);
  });
  const forecastThatDay = forecastOn ? forecastLessonsOn(data.lessons, selectedDate) : [];

  const h = document.createElement('h3');
  h.textContent = selectedDate === today ? `Hôm nay — ${fmtVN(selectedDate)}` : `Ngày ${fmtVN(selectedDate)}`;
  wrap.appendChild(h);

  if (dueThatDay.length) {
    const gh = document.createElement('h3');
    gh.textContent = `Cần ôn / Lịch ôn ngày ${fmtVN(selectedDate)} (${dueThatDay.length})`;
    wrap.appendChild(gh);
    for (const lesson of dueThatDay) {
      wrap.appendChild(detailItem(lesson, { showReview: selectedDate <= today }));
    }
  }
  if (doneThatDay.length) {
    const gh = document.createElement('h3');
    gh.textContent = `Đã hoàn thành ngày ${fmtVN(selectedDate)} (${doneThatDay.length})`;
    wrap.appendChild(gh);
    for (const lesson of doneThatDay) {
      const p = document.createElement('p');
      p.className = 'cal-item';
      p.textContent = `✅ ${lesson.title} (${APPS[lesson.app]?.label || lesson.app})`;
      wrap.appendChild(p);
    }
  }
  if (forecastOn && forecastThatDay.length) {
    const gh = document.createElement('h3');
    gh.textContent = `Dự kiến ôn (${forecastThatDay.length}) — chỉ để xem trước`;
    wrap.appendChild(gh);
    for (const lesson of forecastThatDay) {
      const p = document.createElement('p');
      p.className = 'cal-item';
      p.textContent = `🟣 ${lesson.title} (${APPS[lesson.app]?.label || lesson.app})`;
      wrap.appendChild(p);
    }
  }
  if (!dueThatDay.length && !doneThatDay.length && !(forecastOn && forecastThatDay.length)) {
    const p = document.createElement('p');
    p.className = 'state-msg';
    p.textContent = 'Ngày này không có bài ôn nào.';
    wrap.appendChild(p);
  }
}

$('#calPrev').addEventListener('click', () => {
  calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; }
  renderCalendar();
});
$('#calNext').addEventListener('click', () => {
  calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; }
  renderCalendar();
});
$('#calTodayBtn').addEventListener('click', () => {
  const [y, m] = todayJST().split('-').map(Number);
  calYear = y; calMonth = m; selectedDate = todayJST();
  renderCalendar();
});
els.calForecast.addEventListener('change', () => { forecastOn = els.calForecast.checked; renderCalendar(); });

// ---------- V3: Dàn đều bài quá hạn ----------
function spreadOptions() {
  const limit = Number($('#spreadLimit').value) || DEFAULT_DAILY_REVIEW_LIMIT;
  const startDate = $('#spreadStart').value === 'tomorrow' ? addDays(todayJST(), 1) : todayJST();
  return { today: todayJST(), startDate, dailyReviewLimit: limit };
}

function updateSpreadPreview() {
  if (!data) return;
  const { assignments, byDate } = spreadOverdueLessons(data.lessons, spreadOptions());
  const el = $('#spreadPreview');
  if (!assignments.length) {
    el.textContent = 'Hiện không có bài quá hạn nào.';
    return;
  }
  const parts = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, n]) => `${fmtVN(date)} (+${n} bài)`);
  el.textContent = `Rải ${assignments.length} bài quá hạn: ${parts.join(', ')}`;
}

function openSpreadModal() {
  if (!data) return;
  closeAllModals();
  $('#spreadLimit').value = String(data.settings.dailyReviewLimit ?? DEFAULT_DAILY_REVIEW_LIMIT);
  $('#spreadStart').value = 'today';
  updateSpreadPreview();
  els.spreadModal.hidden = false;
}
$('#spreadLimit').addEventListener('change', updateSpreadPreview);
$('#spreadStart').addEventListener('change', updateSpreadPreview);
$('#spreadConfirmBtn').addEventListener('click', () => {
  const opts = spreadOptions();
  const { lessons, assignments } = spreadOverdueLessons(data.lessons, opts);
  data = {
    ...data,
    lessons,
    settings: { ...data.settings, dailyReviewLimit: opts.dailyReviewLimit },
  };
  els.spreadModal.hidden = true;
  toast(`Đã dàn đều ${assignments.length} bài quá hạn.`, 'ok');
  persist(); // đúng 1 lần đưa vào hàng đợi đồng bộ
});
$('#dueSpreadBtn').addEventListener('click', openSpreadModal);
els.calSpreadBtn.addEventListener('click', openSpreadModal);

// ---------- V3: Dời ngày nhanh ----------
function openDeferModal(lesson) {
  closeAllModals();
  deferTargetId = lesson.id;
  $('#deferLessonName').textContent = `"${lesson.title}" — đang hẹn ôn ${fmtVN(lesson.nextReviewDate)}.`;
  $('#deferDateInput').value = addDays(lesson.nextReviewDate, 1);
  els.deferModal.hidden = false;
}
function applyDefer(newDate) {
  if (!deferTargetId) return;
  data = { ...data, lessons: deferLessonDate(data.lessons, deferTargetId, newDate) };
  deferTargetId = null;
  els.deferModal.hidden = true;
  toast(`Đã dời ngày ôn sang ${fmtVN(newDate)}.`, 'ok');
  persist(); // đúng 1 lần đưa vào hàng đợi đồng bộ
}
$('#deferPlus1Btn').addEventListener('click', () => {
  const lesson = data.lessons.find((l) => l.id === deferTargetId);
  if (lesson) applyDefer(addDays(lesson.nextReviewDate, 1));
});
$('#deferPlus3Btn').addEventListener('click', () => {
  const lesson = data.lessons.find((l) => l.id === deferTargetId);
  if (lesson) applyDefer(addDays(lesson.nextReviewDate, 3));
});
$('#deferCustomBtn').addEventListener('click', () => {
  const v = $('#deferDateInput').value;
  if (!v) { toast('Hãy chọn một ngày.', 'error'); return; }
  applyDefer(v);
});

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    render();
  });
});

// ---------- Danh mục chọn nhanh ----------
let catalogEntries = null;

async function loadCatalog() {
  if (catalogEntries) return catalogEntries;
  try {
    const res = await fetch(`./data/catalog.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    catalogEntries = Array.isArray(json.entries) ? json.entries : [];
  } catch {
    catalogEntries = [];
    $('#cStatus').textContent = 'Không tải được danh mục — bạn vẫn nhập tay bên dưới như bình thường.';
  }
  renderCatalog();
  return catalogEntries;
}

function renderCatalog() {
  const list = $('#cList');
  const items = filterCatalog(catalogEntries || [], {
    app: $('#cAppFilter').value,
    query: $('#cSearch').value,
  });
  list.innerHTML = '';
  for (const e of items.slice(0, 200)) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = `${e.group} · ${e.title}`;
    list.appendChild(opt);
  }
  $('#cStatus').textContent = catalogEntries && catalogEntries.length
    ? `Có ${items.length} bài khớp. Chạm một bài để tự điền thông tin bên dưới.`
    : $('#cStatus').textContent;
  updateDupWarn();
}

function updateDupWarn() {
  const warn = $('#dupWarn');
  if (!data) { warn.hidden = true; return; }
  const dup = findDuplicateLesson(data.lessons, {
    app: $('#fApp').value,
    url: $('#fUrl').value.trim(),
    title: $('#fTitle').value.trim(),
  });
  const editingId = $('#fId').value;
  if (dup && dup.id !== editingId) {
    warn.textContent = `⚠️ Bài này có vẻ đã có trong danh sách của bạn: "${dup.title}". Kiểm tra lại để tránh thêm trùng.`;
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }
}

$('#cAppFilter').addEventListener('change', renderCatalog);
$('#cSearch').addEventListener('input', renderCatalog);
$('#cList').addEventListener('change', () => {
  const entry = (catalogEntries || []).find((e) => e.id === $('#cList').value);
  if (!entry) return;
  $('#fApp').value = entry.app;
  $('#fTitle').value = entry.title;
  $('#fUrl').value = entry.url;
  updateDupWarn();
});
['fTitle', 'fUrl'].forEach((id) => $('#' + id).addEventListener('input', updateDupWarn));
$('#fApp').addEventListener('change', updateDupWarn);

// ---------- Đóng/mở modal (chỉ tối đa 1 modal tại một thời điểm) ----------
function closeAllModals() {
  els.lessonModal.hidden = true;
  els.settingsModal.hidden = true;
  els.spreadModal.hidden = true;
  els.deferModal.hidden = true;
}

// ---------- Modal bài học ----------
function openLessonModal(lesson = null) {
  closeAllModals();
  $('#lessonModalTitle').textContent = lesson ? 'Sửa bài' : 'Thêm bài mới';
  $('#fId').value = lesson ? lesson.id : '';
  $('#fApp').value = lesson ? lesson.app : 'hazi-viet';
  $('#fTitle').value = lesson ? lesson.title : '';
  $('#fUrl').value = lesson ? lesson.url : APPS['hazi-viet'].baseUrl;
  $('#fNote').value = lesson ? lesson.note : '';
  els.lessonModal.hidden = false;
  loadCatalog();
  updateDupWarn();
}
$('#fApp').addEventListener('change', (e) => {
  const urlEl = $('#fUrl');
  const current = urlEl.value.trim();
  const isBase = Object.values(APPS).some((a) => a.baseUrl === current) || !current;
  if (isBase) urlEl.value = APPS[e.target.value].baseUrl;
});
$('#addBtn').addEventListener('click', () => openLessonModal());
$('#lessonForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#fId').value;
  const app = $('#fApp').value;
  const title = $('#fTitle').value.trim();
  const url = $('#fUrl').value.trim();
  const note = $('#fNote').value.trim();
  if (!title || !url) { toast('Hãy nhập tên bài và link bài.', 'error'); return; }
  const today = todayJST();
  if (id) {
    data = {
      ...data,
      lessons: data.lessons.map((l) => l.id === id ? { ...l, app, title, url, note, updatedAt: new Date().toISOString() } : l),
    };
    toast('Đã sửa bài.', 'ok');
  } else {
    const lesson = {
      id: generateId(), title, app, url, note,
      stage: 0, nextReviewDate: today, reviewHistory: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    if (data.lessons.some((l) => l.id === lesson.id)) { toast('Trùng ID — hãy thử lại.', 'error'); return; }
    data = { ...data, lessons: [...data.lessons, lesson] };
    toast('Đã thêm bài mới — bài nằm trong "Cần ôn hôm nay".', 'ok');
  }
  els.lessonModal.hidden = true;
  persist();
});

// ---------- Modal cài đặt ----------
function openSettings() {
  closeAllModals();
  $('#sToken').value = getStoredToken();
  const s = (data && data.settings) || {};
  $('#sOwner').value = s.owner || 'bohoa96tb';
  $('#sRepo').value = s.repo || 'hsk-hub';
  $('#sBranch').value = s.branch || 'main';
  $('#sReminderMode').value = normalizeReminderMode(s.reminderMode);
  els.settingsModal.hidden = false;
}
$('#settingsBtn').addEventListener('click', openSettings);

function readSettingsForm() {
  storeToken($('#sToken').value.trim());
  data = {
    ...data,
    settings: {
      owner: $('#sOwner').value.trim() || 'bohoa96tb',
      repo: $('#sRepo').value.trim() || 'hsk-hub',
      branch: $('#sBranch').value.trim() || 'main',
      reminderMode: normalizeReminderMode($('#sReminderMode').value),
    },
  };
  saveLocalData(data);
}

$('#testConnBtn').addEventListener('click', async () => {
  readSettingsForm();
  if (!getStoredToken()) { els.syncStatus.textContent = 'Chưa nhập Token.'; toast('Hãy dán PAT trước.', 'error'); return; }
  els.syncStatus.textContent = 'Đang kiểm tra…';
  try {
    const info = await makeSync().testConnection();
    els.syncStatus.textContent = `✅ Kết nối OK: ${info.fullName} (nhánh mặc định: ${info.defaultBranch}).`;
    setSync('Đã đồng bộ');
  } catch (err) {
    els.syncStatus.textContent = `❌ ${err.message}`;
    toast(err.message, 'error');
  }
});

$('#syncNowBtn').addEventListener('click', async () => {
  readSettingsForm();
  if (!getStoredToken()) { toast('Hãy dán PAT trước khi đồng bộ.', 'error'); return; }
  setSync('Đang lưu…');
  try {
    const remote = await makeSync().fetchRemote();
    if (remote && remote.data) {
      const v = validateData(remote.data);
      if (v.ok) data = mergeData(data, v.data);
    }
    await makeSync().save(data);
    saveLocalData(data);
    setSync('Đã đồng bộ');
    els.syncStatus.textContent = '✅ Đã đồng bộ ngay lên GitHub.';
    toast('Đã đồng bộ lên GitHub', 'ok');
    render();
  } catch (err) {
    setSync('Lỗi đồng bộ');
    els.syncStatus.textContent = `❌ ${err.message}`;
    toast(err.message, 'error');
  }
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hsk-hub-backup-${todayJST()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Đã xuất file JSON sao lưu.', 'ok');
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { toast('File không phải JSON hợp lệ — đã hủy nhập.', 'error'); return; }
    const v = validateData(parsed);
    if (!v.ok) { toast(`File không hợp lệ: ${v.error} — dữ liệu hiện tại được giữ nguyên.`, 'error'); return; }
    backupLocalData(); // sao lưu trước khi ghi đè/merge
    data = mergeData(data, v.data); // merge theo ID, không xóa bài vắng mặt
    saveLocalData(data);
    toast('Đã nhập và gộp dữ liệu (đã sao lưu bản cũ trên máy).', 'ok');
    persist();
  } catch (err) {
    toast(`Nhập thất bại: ${err.message}`, 'error');
  }
});

// Đóng modal: nút Đóng/Hủy/✕ (data-close), bấm nền tối bên ngoài, hoặc phím Escape
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeAllModals());
});
[els.lessonModal, els.settingsModal, els.spreadModal, els.deferModal].forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) closeAllModals(); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllModals();
});

// ---------- Offline ----------
function updateOnline() { els.offline.hidden = navigator.onLine; }
window.addEventListener('online', () => { updateOnline(); toast('Đã có mạng trở lại.', 'ok'); });
window.addEventListener('offline', updateOnline);

// ---------- Khởi động ----------
initTheme();
updateOnline();
loadData();
loadCatalog().then(() => { if (data) renderProgress(); });
