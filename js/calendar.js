// calendar.js — Logic lịch tháng SRS thuần (không phụ thuộc DOM).
// Mọi ngày là chuỗi "YYYY-MM-DD" (Asia/Tokyo). Tuần bắt đầu từ Thứ 2 (T2 – CN).

import { SRS_INTERVALS, clampStage, addDays, isValidDateStr } from './srs.js';

/**
 * Lưới tháng: mảng các tuần, mỗi tuần đúng 7 ô.
 * Ô ngoài tháng: { date: null, day: null }. Ô trong tháng: { date: 'YYYY-MM-DD', day: số ngày }.
 * Tuần bắt đầu Thứ 2: ngày đầu tháng rơi vào Chủ nhật -> 6 ô trống đầu tuần.
 */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // getUTCDay: 0 = CN ... 6 = T7 -> số ô trống đầu tuần (Thứ 2 là cột 0)
  const leadBlanks = (first.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < leadBlanks; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    cells.push({ date: `${year}-${mm}-${dd}`, day: d });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Heatmap: số bài đã hoàn thành trong từng ngày, đọc từ reviewHistory + learnedDate (nếu có).
 * Mỗi bài tính tối đa 1 lần cho 1 ngày (kể cả khi learnedDate trùng một ngày trong reviewHistory).
 * Trả về Map<dateStr, count>. Thuần — không sửa lessons.
 */
export function buildHeatmap(lessons) {
  const map = new Map();
  for (const lesson of Array.isArray(lessons) ? lessons : []) {
    const days = new Set(Array.isArray(lesson.reviewHistory) ? lesson.reviewHistory : []);
    if (lesson.learnedDate && isValidDateStr(lesson.learnedDate)) days.add(lesson.learnedDate);
    for (const day of days) {
      if (isValidDateStr(day)) map.set(day, (map.get(day) || 0) + 1);
    }
  }
  return map;
}

/** Số bài đến hạn ôn đúng từng ngày (nextReviewDate). Trả về Map<dateStr, count>. */
export function buildDueCounts(lessons) {
  const map = new Map();
  for (const lesson of Array.isArray(lessons) ? lessons : []) {
    if (isValidDateStr(lesson.nextReviewDate)) {
      map.set(lesson.nextReviewDate, (map.get(lesson.nextReviewDate) || 0) + 1);
    }
  }
  return map;
}

/**
 * Dự báo SRS (chỉ để xem trước, KHÔNG thay đổi dữ liệu thật):
 * Từ mốc ôn sắp tới (nextReviewDate, ở stage hiện tại), mô phỏng các mốc tiếp theo
 * bằng cách cộng dồn SRS_INTERVALS của stage+1, stage+2, ... (kẹp ở mốc cuối 60 ngày).
 * Mốc sắp tới tự nó KHÔNG tính vào dự báo (nó thuộc nhóm "đến hạn").
 * Trả về Map<dateStr, count> — số bài dự kiến ôn ở các mốc tương lai sau mốc sắp tới.
 */
export function buildForecastCounts(lessons, { maxSteps = 6 } = {}) {
  const map = new Map();
  for (const lesson of Array.isArray(lessons) ? lessons : []) {
    if (!isValidDateStr(lesson.nextReviewDate)) continue;
    let date = lesson.nextReviewDate;
    let stage = clampStage(lesson.stage);
    for (let step = 0; step < maxSteps; step++) {
      stage = Math.min(stage + 1, SRS_INTERVALS.length - 1);
      date = addDays(date, SRS_INTERVALS[stage]);
      map.set(date, (map.get(date) || 0) + 1);
    }
  }
  return map;
}

/** Danh sách bài dự kiến ôn vào 1 ngày theo mô phỏng dự báo (chỉ đọc). Trả về mảng lesson. */
export function forecastLessonsOn(lessons, dateStr, { maxSteps = 6 } = {}) {
  const out = [];
  for (const lesson of Array.isArray(lessons) ? lessons : []) {
    if (!isValidDateStr(lesson.nextReviewDate)) continue;
    let date = lesson.nextReviewDate;
    let stage = clampStage(lesson.stage);
    for (let step = 0; step < maxSteps; step++) {
      stage = Math.min(stage + 1, SRS_INTERVALS.length - 1);
      date = addDays(date, SRS_INTERVALS[stage]);
      if (date === dateStr) { out.push(lesson); break; }
      if (date > dateStr) break;
    }
  }
  return out;
}

/** Thống kê tháng đang xem: tổng lượt ôn trong tháng + số ngày có học. */
export function monthStats(heatmap, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  let totalReviews = 0;
  let daysStudied = 0;
  for (const [date, count] of heatmap.entries()) {
    if (date.startsWith(prefix) && count > 0) {
      totalReviews += count;
      daysStudied++;
    }
  }
  return { totalReviews, daysStudied };
}
