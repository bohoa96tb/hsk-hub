// srs.js — Logic SRS thuần (pure functions), không phụ thuộc UI/DOM.
// Mọi ngày đều là chuỗi "YYYY-MM-DD" theo lịch Asia/Tokyo (JST).

export const SRS_INTERVALS = [1, 3, 7, 14, 30, 60];
export const TIME_ZONE = 'Asia/Tokyo';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ngày hôm nay (YYYY-MM-DD) theo Asia/Tokyo. Có thể truyền Date để kiểm thử. */
export function todayJST(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = parseDateStr(s);
  return d !== null && formatDateStr(d) === s;
}

/** Parse "YYYY-MM-DD" thành Date UTC trưa (tránh lệch múi giờ khi cộng/trừ ngày). */
export function parseDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatDateStr(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Cộng n ngày vào chuỗi ngày YYYY-MM-DD, trả về YYYY-MM-DD. */
export function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  if (!d) throw new Error(`Ngày không hợp lệ: ${dateStr}`);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDateStr(d);
}

/** Số ngày từ a đến b (b - a). Âm nếu b trước a. */
export function diffDays(a, b) {
  const da = parseDateStr(a);
  const db = parseDateStr(b);
  if (!da || !db) throw new Error('Ngày không hợp lệ khi tính hiệu số');
  return Math.round((db - da) / 86400000);
}

export function clampStage(stage) {
  const s = Number.isFinite(stage) ? Math.trunc(stage) : 0;
  return Math.min(Math.max(s, 0), SRS_INTERVALS.length - 1);
}

/** ID ổn định, duy nhất, không phụ thuộc tên bài. */
export function generateId(prefix = 'lesson') {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/**
 * Cập nhật stats khi có hoạt động học vào ngày `today`.
 * - Cùng ngày: giữ nguyên streak.
 * - Hôm qua: streak + 1.
 * - Cũ hơn / chưa học bao giờ: streak = 1.
 * - longestStreak không bao giờ giảm.
 * Trả về stats mới (không sửa object gốc).
 */
export function applyStudyDay(stats, today) {
  const next = { ...stats };
  if (next.lastStudyDate === today) return next;
  if (next.lastStudyDate && diffDays(next.lastStudyDate, today) === 1) {
    next.currentStreak = (next.currentStreak || 0) + 1;
  } else {
    next.currentStreak = 1;
  }
  next.longestStreak = Math.max(next.longestStreak || 0, next.currentStreak);
  next.lastStudyDate = today;
  return next;
}

function withReviewRecord(lesson, today) {
  const history = Array.isArray(lesson.reviewHistory) ? [...lesson.reviewHistory] : [];
  if (!history.includes(today)) history.push(today);
  history.sort();
  return { ...lesson, reviewHistory: history, updatedAt: new Date().toISOString() };
}

/** Bấm "Đã nhớ": tăng stage (tối đa mốc cuối), hẹn ôn theo mốc mới, ghi streak. */
export function markRemembered(data, lessonId, today = todayJST()) {
  const idx = data.lessons.findIndex((l) => l.id === lessonId);
  if (idx === -1) throw new Error(`Không tìm thấy bài: ${lessonId}`);
  const lesson = data.lessons[idx];
  const newStage = clampStage((lesson.stage || 0) + 1);
  const updated = withReviewRecord(
    {
      ...lesson,
      stage: newStage,
      nextReviewDate: addDays(today, SRS_INTERVALS[newStage]),
    },
    today,
  );
  const lessons = [...data.lessons];
  lessons[idx] = updated;
  return {
    ...data,
    lessons,
    stats: {
      ...applyStudyDay(data.stats, today),
      totalReviews: (data.stats.totalReviews || 0) + 1,
    },
  };
}

/** Bấm "Quên": stage về 0, ôn lại ngày mai, vẫn tính là đã học hôm nay. */
export function markForgotten(data, lessonId, today = todayJST()) {
  const idx = data.lessons.findIndex((l) => l.id === lessonId);
  if (idx === -1) throw new Error(`Không tìm thấy bài: ${lessonId}`);
  const lesson = data.lessons[idx];
  const updated = withReviewRecord(
    { ...lesson, stage: 0, nextReviewDate: addDays(today, SRS_INTERVALS[0]) },
    today,
  );
  const lessons = [...data.lessons];
  lessons[idx] = updated;
  return {
    ...data,
    lessons,
    stats: {
      ...applyStudyDay(data.stats, today),
      totalReviews: (data.stats.totalReviews || 0) + 1,
    },
  };
}

export function isDue(lesson, today = todayJST()) {
  return lesson.nextReviewDate <= today;
}

export function overdueDays(lesson, today = todayJST()) {
  return Math.max(0, diffDays(lesson.nextReviewDate, today));
}

/** Danh sách cần ôn: nextReviewDate <= hôm nay, quá hạn lên đầu, rồi theo ngày tăng dần. */
export function dueLessons(data, today = todayJST()) {
  return data.lessons
    .filter((l) => isDue(l, today))
    .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate));
}

/** Danh sách sắp tới: nextReviewDate > hôm nay, gần nhất lên đầu. */
export function upcomingLessons(data, today = todayJST()) {
  return data.lessons
    .filter((l) => l.nextReviewDate > today)
    .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate));
}

// ---------- Validate & Merge ----------

export const APPS = {
  'hazi-viet': { label: 'Hazi Việt', baseUrl: 'https://bohoa96tb.github.io/hazi-viet/' },
  'hsk3.0': { label: 'HSK 3.0', baseUrl: 'https://bohoa96tb.github.io/HSK3.0/' },
};

export const REMINDER_MODES = ['morning', 'evening', 'both', 'off'];

export function normalizeReminderMode(mode) {
  return REMINDER_MODES.includes(mode) ? mode : 'morning';
}

export function emptyData() {
  return {
    version: 1,
    settings: { owner: 'bohoa96tb', repo: 'hsk-hub', branch: 'main', reminderMode: 'morning' },
    stats: { currentStreak: 0, longestStreak: 0, totalReviews: 0, lastStudyDate: null },
    lessons: [],
  };
}

export function validateLesson(raw, seenIds) {
  if (!raw || typeof raw !== 'object') return 'Bài học không phải object';
  if (!raw.id || typeof raw.id !== 'string') return 'Thiếu id bài học';
  if (seenIds && seenIds.has(raw.id)) return `Trùng id bài học: ${raw.id}`;
  if (!raw.title || typeof raw.title !== 'string' || !raw.title.trim()) return `Bài ${raw.id} thiếu tên`;
  if (!APPS[raw.app]) return `Bài ${raw.id} có app không hợp lệ: ${raw.app}`;
  if (!raw.url || typeof raw.url !== 'string') return `Bài ${raw.id} thiếu url`;
  if (!isValidDateStr(raw.nextReviewDate)) return `Bài ${raw.id} có nextReviewDate không hợp lệ`;
  if (raw.reviewHistory !== undefined) {
    if (!Array.isArray(raw.reviewHistory)) return `Bài ${raw.id} reviewHistory phải là mảng`;
    for (const d of raw.reviewHistory) {
      if (!isValidDateStr(d)) return `Bài ${raw.id} có ngày trong reviewHistory không hợp lệ: ${d}`;
    }
    if (new Set(raw.reviewHistory).size !== raw.reviewHistory.length)
      return `Bài ${raw.id} có ngày trùng trong reviewHistory`;
  }
  return null;
}

/** Validate toàn bộ dữ liệu. Trả về { ok, error?, data? } với data đã chuẩn hoá. */
export function validateData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: 'Dữ liệu không phải object JSON hợp lệ' };
  if (!Array.isArray(raw.lessons)) return { ok: false, error: 'Thiếu mảng lessons' };
  const seen = new Set();
  const lessons = [];
  for (const item of raw.lessons) {
    const err = validateLesson(item, seen);
    if (err) return { ok: false, error: err };
    seen.add(item.id);
    lessons.push(normalizeLesson(item));
  }
  const statsIn = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  const stats = {
    currentStreak: Number.isFinite(statsIn.currentStreak) ? statsIn.currentStreak : 0,
    longestStreak: Number.isFinite(statsIn.longestStreak) ? statsIn.longestStreak : 0,
    totalReviews: Number.isFinite(statsIn.totalReviews) ? statsIn.totalReviews : 0,
    lastStudyDate: isValidDateStr(statsIn.lastStudyDate) ? statsIn.lastStudyDate : null,
  };
  stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
  return {
    ok: true,
    data: {
      version: 1,
      settings: {
        owner: 'bohoa96tb',
        repo: 'hsk-hub',
        branch: 'main',
        ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
        reminderMode: normalizeReminderMode(raw.settings?.reminderMode),
      },
      stats,
      lessons,
    },
  };
}

export function normalizeLesson(raw) {
  return {
    id: raw.id,
    title: String(raw.title).trim(),
    app: raw.app,
    url: String(raw.url),
    note: typeof raw.note === 'string' ? raw.note : '',
    stage: clampStage(raw.stage),
    nextReviewDate: raw.nextReviewDate,
    reviewHistory: [...new Set(Array.isArray(raw.reviewHistory) ? raw.reviewHistory : [])].sort(),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

/**
 * Merge theo ID: không xoá bài chỉ vì vắng mặt ở phía còn lại.
 * Bài trùng ID: lấy bản updatedAt mới hơn, nhưng gộp reviewHistory (hợp nhất, không trùng).
 * Stats: lấy totalReviews lớn hơn, lastStudyDate mới hơn, streak suy từ lastStudyDate đó,
 * longestStreak = max hai phía.
 */
export function mergeData(local, remote) {
  const byId = new Map();
  for (const l of local.lessons) byId.set(l.id, { ...l });
  for (const r of remote.lessons) {
    const existing = byId.get(r.id);
    if (!existing) {
      byId.set(r.id, { ...r });
      continue;
    }
    const winner = (r.updatedAt || '') >= (existing.updatedAt || '') ? r : existing;
    const loser = winner === r ? existing : r;
    byId.set(r.id, {
      ...normalizeLesson(winner),
      reviewHistory: [...new Set([...(loser.reviewHistory || []), ...(winner.reviewHistory || [])])].sort(),
    });
  }
  const ls = local.stats || {};
  const rs = remote.stats || {};
  const newerStats = (rs.lastStudyDate || '') >= (ls.lastStudyDate || '') ? rs : ls;
  const stats = {
    currentStreak: newerStats.currentStreak || 0,
    longestStreak: Math.max(ls.longestStreak || 0, rs.longestStreak || 0),
    totalReviews: Math.max(ls.totalReviews || 0, rs.totalReviews || 0),
    lastStudyDate: newerStats.lastStudyDate || null,
  };
  return { version: 1, settings: { ...(remote.settings || {}), ...(local.settings || {}) }, stats, lessons: [...byId.values()] };
}

// ---------- Danh mục bài học (data/catalog.json) ----------

/** Lọc danh mục theo app ('all' = tất cả) và từ khoá tìm trong title/group (không phân biệt hoa thường). */
export function filterCatalog(entries, { app = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(entries) ? entries : []).filter((e) => {
    if (app !== 'all' && e.app !== app) return false;
    if (!q) return true;
    return `${e.title} ${e.group}`.toLowerCase().includes(q);
  });
}

/**
 * Tìm bài đã có trùng với bài sắp thêm: trùng URL tuyệt đối, hoặc cùng app + cùng tên bài.
 * Trả về bài trùng đầu tiên hoặc null. Dùng để cảnh báo nhẹ, không chặn lưu.
 */
export function findDuplicateLesson(lessons, { app, url, title }) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  return (Array.isArray(lessons) ? lessons : []).find((l) =>
    (url && l.url === url) || (l.app === app && norm(l.title) === norm(title)),
  ) || null;
}
