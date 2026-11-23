// app.js — Giao diện HSK Hub. Dữ liệu: GitHub (nếu có PAT) -> file tĩnh -> localStorage.
import {
  APPS, SRS_INTERVALS, todayJST, addDays, dueLessons, upcomingLessons,
  markRemembered, markForgotten, overdueDays, generateId, validateData,
  mergeData, emptyData, clampStage, filterCatalog, findDuplicateLesson,
  normalizeReminderMode,
} from './srs.js';
import {
  GitHubSync, GitHubError, getStoredToken, storeToken, fetchStaticData,
  loadLocalData, saveLocalData, backupLocalData, TOKEN_KEY,
} from './github-sync.js';

const $ = (sel) => document.querySelector(sel);
const els = {
  streak: $('#statStreak'), longest: $('#statLongest'), due: $('#statDue'), sync: $('#statSync'),
  list: $('#lessonList'), loading: $('#loadingState'), error: $('#errorState'), empty: $('#emptyState'),
  toast: $('#toast'), offline: $('#offlineBanner'),
  lessonModal: $('#lessonModal'), settingsModal: $('#settingsModal'),
  syncStatus: $('#syncStatus'),
};

let data = null;
let activeTab = 'due';
let syncState = 'Chưa gắn Token';
let saveTimer = null;

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
function makeSync() {
  const s = (data && data.settings) || {};
  return new GitHubSync({
    owner: s.owner || 'bohoa96tb',
    repo: s.repo || 'hsk-hub',
    branch: s.branch || 'main',
    token: getStoredToken(),
  });
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
  const s = (local && local.settings) || (data && data.settings) || {};
  return new GitHubSync({
    owner: s.owner || 'bohoa96tb', repo: s.repo || 'hsk-hub', branch: s.branch || 'main',
    token: getStoredToken(),
  });
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
}

/** Lưu local ngay; nếu có token thì debounce đẩy lên GitHub. */
function persist({ immediate = false } = {}) {
  saveLocalData(data);
  render();
  const token = getStoredToken();
  if (!token) { setSync('Chưa gắn Token'); return; }
  clearTimeout(saveTimer);
  const doSave = async () => {
    setSync('Đang lưu…');
    try {
      await makeSync().save(data);
      setSync('Đã đồng bộ');
      toast('Đã đồng bộ lên GitHub', 'ok');
    } catch (err) {
      setSync('Lỗi đồng bộ');
      toast(err instanceof GitHubError ? err.message : `Lỗi đồng bộ: ${err.message}`, 'error');
    }
  };
  if (immediate) doSave();
  else saveTimer = setTimeout(doSave, 800);
}

// ---------- Render ----------
function stageLabel(stage) {
  return `Mốc ${SRS_INTERVALS[clampStage(stage)]} ngày`;
}

function render() {
  if (!data) return;
  const today = todayJST();
  const due = dueLessons(data, today);
  els.streak.textContent = data.stats.currentStreak;
  els.longest.textContent = data.stats.longestStreak;
  els.due.textContent = due.length;
  els.sync.textContent = syncState;

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

// ---------- Modal bài học ----------
function openLessonModal(lesson = null) {
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

// Đóng modal
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.lessonModal.hidden = true;
    els.settingsModal.hidden = true;
  });
});
[els.lessonModal, els.settingsModal].forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
});

// ---------- Offline ----------
function updateOnline() { els.offline.hidden = navigator.onLine; }
window.addEventListener('online', () => { updateOnline(); toast('Đã có mạng trở lại.', 'ok'); });
window.addEventListener('offline', updateOnline);

// ---------- Khởi động ----------
initTheme();
updateOnline();
loadData();
