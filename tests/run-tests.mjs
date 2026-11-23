// run-tests.mjs — Bộ test tự động, chỉ dùng node:assert (không package ngoài).
// Chạy: node tests/run-tests.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SRS_INTERVALS, todayJST, addDays, diffDays, isValidDateStr,
  markRemembered, markForgotten, applyStudyDay, validateData, mergeData,
  generateId, dueLessons, emptyData, filterCatalog, findDuplicateLesson,
  normalizeReminderMode,
} from '../js/srs.js';
import { encodeBase64Utf8, decodeBase64Utf8, GitHubSync, GitHubError, createSyncQueue } from '../js/github-sync.js';
import { spreadOverdueLessons, deferLessonDate, computeTierProgress, overdueLessons } from '../js/srs.js';
import { monthGrid, buildHeatmap, buildForecastCounts, forecastLessonsOn, monthStats } from '../js/calendar.js';
import { buildMessage, sendNtfy, sendTelegram, shouldSendNow, currentHourJST } from '../scripts/remind.mjs';
import { buildHaziEntries, buildHsk30Entries } from '../scripts/sync-catalog.mjs';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`✅ ${name}`); }
  catch (err) { failures.push(`${name}: ${err.message}`); console.log(`❌ ${name}: ${err.message}`); }
}

function baseData() {
  return {
    version: 1,
    settings: { owner: 'bohoa96tb', repo: 'hsk-hub', branch: 'main' },
    stats: { currentStreak: 0, longestStreak: 0, totalReviews: 0, lastStudyDate: null },
    lessons: [{
      id: 'l1', title: 'Bài 1 你好', app: 'hazi-viet', url: 'https://bohoa96tb.github.io/hazi-viet/',
      note: '', stage: 0, nextReviewDate: '2026-11-23', reviewHistory: [],
      createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z',
    }],
  };
}

// 1. JST
await test('1. Ngày JST: nửa đêm UTC vẫn là ngày hôm trước ở Tokyo khi chưa qua 00:00 JST', () => {
  // 2026-11-22T16:30:00Z = 2026-11-23 01:30 JST
  assert.equal(todayJST(new Date('2026-11-22T16:30:00Z')), '2026-11-23');
  // 2026-11-22T14:30:00Z = 2026-11-22 23:30 JST
  assert.equal(todayJST(new Date('2026-11-22T14:30:00Z')), '2026-11-22');
  assert.equal(addDays('2026-11-23', 1), '2026-11-24');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // năm nhuận
  assert.equal(diffDays('2026-11-22', '2026-11-23'), 1);
  assert.equal(isValidDateStr('2026-02-30'), false);
  assert.equal(isValidDateStr('2026-11-23'), true);
});

// 2+3. SRS mọi stage + không vượt giới hạn
await test('2-3. SRS: mọi stage hẹn đúng khoảng, stage kẹt ở mốc cuối 60 ngày', () => {
  let d = baseData();
  const expected = [3, 7, 14, 30, 60, 60];
  for (let i = 0; i < expected.length; i++) {
    d = markRemembered(d, 'l1', '2026-11-23');
    assert.equal(d.lessons[0].nextReviewDate, addDays('2026-11-23', expected[i]), `lần ${i + 1}`);
    assert.ok(d.lessons[0].stage <= SRS_INTERVALS.length - 1);
  }
  assert.equal(d.lessons[0].stage, SRS_INTERVALS.length - 1);
});

// 4. Nhớ nhiều bài cùng ngày: streak chỉ +1, history không trùng
await test('4. Học nhiều bài cùng ngày: streak tính theo ngày duy nhất, reviewHistory không trùng', () => {
  let d = baseData();
  d.lessons.push({ ...d.lessons[0], id: 'l2', title: 'Bài 2' });
  d = markRemembered(d, 'l1', '2026-11-23');
  d = markRemembered(d, 'l2', '2026-11-23');
  d = markRemembered(d, 'l1', '2026-11-23');
  assert.equal(d.stats.currentStreak, 1);
  assert.equal(d.stats.totalReviews, 3);
  assert.deepEqual(d.lessons[0].reviewHistory, ['2026-11-23']);
});

// 5. Quên
await test('5. Quên: stage về 0, ôn lại ngày mai, vẫn tính ngày học', () => {
  let d = baseData();
  d.lessons[0].stage = 3;
  d = markForgotten(d, 'l1', '2026-11-23');
  assert.equal(d.lessons[0].stage, 0);
  assert.equal(d.lessons[0].nextReviewDate, '2026-11-24');
  assert.equal(d.stats.lastStudyDate, '2026-11-23');
  assert.equal(d.stats.currentStreak, 1);
});

// 6+7. Streak
await test('6-7. Streak: cùng ngày giữ nguyên, liên tiếp +1, bỏ ngày reset 1, longest không giảm', () => {
  let s = { currentStreak: 0, longestStreak: 0, totalReviews: 0, lastStudyDate: null };
  s = applyStudyDay(s, '2026-11-20'); assert.equal(s.currentStreak, 1);
  s = applyStudyDay(s, '2026-11-20'); assert.equal(s.currentStreak, 1);
  s = applyStudyDay(s, '2026-11-21'); assert.equal(s.currentStreak, 2);
  s = applyStudyDay(s, '2026-11-23'); assert.equal(s.currentStreak, 1); // bỏ 22
  assert.equal(s.longestStreak, 2);
  s = applyStudyDay(s, '2026-11-24'); assert.equal(s.currentStreak, 2);
  assert.equal(s.longestStreak, 2);
});

// 8. ID không trùng
await test('8. generateId: 1000 ID không trùng', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
  assert.equal(ids.size, 1000);
});

// 9. Import sai bị từ chối
await test('9. Validate: JSON sai/ngày sai/id trùng bị từ chối, dữ liệu hợp lệ được nhận', () => {
  assert.equal(validateData(null).ok, false);
  assert.equal(validateData({ lessons: 'x' }).ok, false);
  const badDate = baseData(); badDate.lessons[0].nextReviewDate = '23/11/2026';
  assert.equal(validateData(badDate).ok, false);
  const dup = baseData(); dup.lessons.push({ ...dup.lessons[0] });
  assert.equal(validateData(dup).ok, false);
  const dupHist = baseData(); dupHist.lessons[0].reviewHistory = ['2026-11-20', '2026-11-20'];
  assert.equal(validateData(dupHist).ok, false);
  assert.equal(validateData(baseData()).ok, true);
});

// 10. Merge không mất bài
await test('10. Merge theo ID: không mất bài ở cả hai phía, gộp reviewHistory', () => {
  const a = baseData();
  const b = baseData();
  b.lessons = [{ ...b.lessons[0], id: 'l2', title: 'Chỉ có ở B' }];
  a.lessons[0].reviewHistory = ['2026-11-20'];
  const a2 = baseData(); a2.lessons[0].reviewHistory = ['2026-11-21'];
  a2.lessons[0].updatedAt = '2026-11-21T00:00:00.000Z';
  const merged = mergeData(a, b);
  assert.deepEqual(merged.lessons.map((l) => l.id).sort(), ['l1', 'l2']);
  const mergedHist = mergeData(a, a2);
  assert.deepEqual(mergedHist.lessons[0].reviewHistory, ['2026-11-20', '2026-11-21']);
});

// 11. Unicode Base64
await test('11. Base64 UTF-8: tiếng Việt + chữ Hán khứ hồi nguyên vẹn', () => {
  const s = 'Học tiếng Trung - 你好世界';
  assert.equal(decodeBase64Utf8(encodeBase64Utf8(s)), s);
  const long = '汉字 học '.repeat(5000);
  assert.equal(decodeBase64Utf8(encodeBase64Utf8(long)), long);
});

// 12. Reminder
await test('12. Reminder: bài hôm nay + quá hạn lên đầu, không có bài, FORCE_SEND', () => {
  const d = baseData();
  d.lessons.push({ ...d.lessons[0], id: 'l0', title: 'Bài quá hạn', nextReviewDate: '2026-11-20' });
  d.lessons.push({ ...d.lessons[0], id: 'l9', title: 'Bài tương lai', nextReviewDate: '2026-12-01' });
  const due = dueLessons(d, '2026-11-23');
  assert.deepEqual(due.map((l) => l.id), ['l0', 'l1']);
  const msg = buildMessage(d, '2026-11-23');
  assert.equal(msg.dueCount, 2);
  assert.match(msg.body, /Quá hạn 3 ngày/);
  assert.match(msg.body, /bohoa96tb\.github\.io\/hsk-hub/);
  const empty = buildMessage(emptyData(), '2026-11-23');
  assert.equal(empty.dueCount, 0);
});

// 13. ntfy/Telegram lỗi HTTP
await test('13. ntfy/Telegram: HTTP lỗi thì ném lỗi rõ ràng, HTTP 200 thì OK', async () => {
  const failFetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => sendNtfy({ topic: 'x' }, 'nội dung', failFetch), /500/);
  await assert.rejects(() => sendTelegram({ token: 't', chatId: '1' }, { title: 't', body: 'a\n\nb' }, failFetch), /500/);
  let ntfyReq = null;
  const okFetch = async (url, opts) => { ntfyReq = { url, opts }; return { ok: true, status: 200 }; };
  await sendNtfy({ topic: 'my-topic' }, 'Học tiếng Trung 你好', okFetch);
  assert.match(ntfyReq.url, /ntfy\.sh\/my-topic/);
  assert.ok(/^[\x00-\x7F]*$/.test(ntfyReq.opts.headers.Title), 'Header Title phải ASCII');
  assert.equal(ntfyReq.opts.body, 'Học tiếng Trung 你好');
  let tgReq = null;
  const tgFetch = async (url, opts) => { tgReq = { url, opts }; return { ok: true, status: 200 }; };
  await sendTelegram({ token: 'tok', chatId: '42' }, { title: 'T', body: 'T\n\n• Bài_a*b <x>' }, tgFetch);
  const payload = JSON.parse(tgReq.opts.body);
  assert.match(payload.text, /Bài_a\*b &lt;x&gt;/);
});

// 14. GitHub API lỗi
await test('14. GitHub API: 401/409/timeout xử lý đúng, save lấy sha trước PUT', async () => {
  const mkRes = (status, json = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  // 401
  const s401 = new GitHubSync({ token: 'bad', fetchFn: async () => mkRes(401) });
  await assert.rejects(() => s401.fetchRemote(), (e) => e instanceof GitHubError && e.status === 401);
  // 409 ở PUT đầu -> GET lại sha -> PUT lại thành công
  let putCount = 0;
  const s409 = new GitHubSync({
    token: 'ok',
    fetchFn: async (url, opts) => {
      if (opts && opts.method === 'PUT') {
        putCount++;
        if (putCount === 1) return mkRes(409);
        return mkRes(200, { content: { sha: 'newsha' }, commit: { sha: 'c1' } });
      }
      return mkRes(200, { content: encodeBase64Utf8('{"version":1,"lessons":[]}'), sha: 'sha1' });
    },
  });
  const saved = await s409.save(baseData());
  assert.equal(putCount, 2);
  assert.equal(saved.sha, 'newsha');
  // Timeout
  const sTimeout = new GitHubSync({
    token: 'ok', timeoutMs: 30,
    fetchFn: (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    }),
  });
  await assert.rejects(() => sTimeout.testConnection(), /timeout/i);
});

// Dữ liệu mẫu + manifest hợp lệ
await test('15. data/progress.json và manifest.json hợp lệ (dữ liệu thật của người dùng — chỉ kiểm schema)', async () => {
  const root = new URL('..', import.meta.url);
  const data = JSON.parse(await readFile(new URL('data/progress.json', root), 'utf8'));
  const v = validateData(data);
  assert.equal(v.ok, true, v.error);
  assert.ok(Array.isArray(data.lessons), 'lessons phải là mảng');
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.name, 'HSK Hub');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
});

// 16. reminderMode: sáng/tối/cả hai/tắt + cửa sổ ±2 giờ chống trễ cron + FORCE_SEND bỏ qua
await test('16. reminderMode: lọc khung giờ đúng mọi chế độ, trễ cron trong ±2h vẫn gửi', () => {
  // morning (mốc 7): 5,7,9 gửi; 4,10,19 không
  for (const h of [5, 7, 9]) assert.equal(shouldSendNow('morning', h), true, `morning ${h}h`);
  for (const h of [4, 10, 12, 19]) assert.equal(shouldSendNow('morning', h), false, `morning ${h}h`);
  // evening (mốc 19): 17,19,21 gửi; 16,22,7 không
  for (const h of [17, 19, 21]) assert.equal(shouldSendNow('evening', h), true, `evening ${h}h`);
  for (const h of [16, 22, 7]) assert.equal(shouldSendNow('evening', h), false, `evening ${h}h`);
  // both
  assert.equal(shouldSendNow('both', 7), true);
  assert.equal(shouldSendNow('both', 19), true);
  assert.equal(shouldSendNow('both', 12), false);
  // off: không bao giờ, trừ force
  assert.equal(shouldSendNow('off', 7), false);
  assert.equal(shouldSendNow('off', 19), false);
  assert.equal(shouldSendNow('off', 12, true), true);
  assert.equal(shouldSendNow('morning', 19, true), true);
  // mode lạ -> mặc định morning; giờ JST từ Date UTC: 22:30 UTC = 07:30 JST
  assert.equal(currentHourJST(new Date('2026-11-22T22:30:00Z')), 7);
  assert.equal(shouldSendNow('xxx', new Date('2026-11-22T22:30:00Z')), true);
  assert.equal(normalizeReminderMode('evening'), 'evening');
  assert.equal(normalizeReminderMode('xyz'), 'morning');
  // validateData giữ reminderMode hợp lệ và chuẩn hoá mode sai
  const okMode = baseData(); okMode.settings = { reminderMode: 'both' };
  assert.equal(validateData(okMode).data.settings.reminderMode, 'both');
  const badMode = baseData(); badMode.settings = { reminderMode: 'night' };
  assert.equal(validateData(badMode).data.settings.reminderMode, 'morning');
});

// 17. catalog.json thật + hàm dựng danh mục
await test('17. catalog.json: đủ 2 nguồn, schema đúng, ID không trùng, URL deep-link đúng', async () => {
  const root = new URL('..', import.meta.url);
  const catalog = JSON.parse(await readFile(new URL('data/catalog.json', root), 'utf8'));
  assert.ok(catalog.counts['hazi-viet'] >= 90, `hazi-viet chỉ có ${catalog.counts['hazi-viet']}`);
  assert.ok(catalog.counts['hsk3.0'] >= 30, `hsk3.0 chỉ có ${catalog.counts['hsk3.0']}`);
  assert.equal(catalog.entries.length, catalog.counts.total);
  assert.equal(new Set(catalog.entries.map((e) => e.id)).size, catalog.entries.length);
  for (const e of catalog.entries) {
    assert.ok(e.id && e.app && e.group && e.title && e.url, `thiếu trường: ${JSON.stringify(e)}`);
    if (e.app === 'hazi-viet') assert.match(e.url, /^https:\/\/bohoa96tb\.github\.io\/hazi-viet\/vocabulary\.html\?word=/);
    else assert.match(e.url, /^https:\/\/bohoa96tb\.github\.io\/HSK3\.0\/#\/lesson\//);
  }
  // Hàm dựng từ dữ liệu thô mẫu
  const hazi = buildHaziEntries({ lessons: [{ id: 'hanzii-l1-b01', level: 1, number: 1, title: 'Làm quen', wordIds: ['w1'] }] });
  assert.equal(hazi[0].url, 'https://bohoa96tb.github.io/hazi-viet/vocabulary.html?word=w1');
  assert.equal(hazi[0].group, 'HSK 1');
  const hsk = buildHsk30Entries({ lessons: [{ id: 'hsk1-l01', level: 'HSK 1', lessonNumber: 1, titleZh: '你好', titleVi: 'Xin chào' }] });
  assert.equal(hsk[0].url, 'https://bohoa96tb.github.io/HSK3.0/#/lesson/hsk1-l01');
  // Lọc danh mục
  assert.equal(filterCatalog(catalog.entries, { app: 'hsk3.0' }).length, catalog.counts['hsk3.0']);
  assert.ok(filterCatalog(catalog.entries, { query: '你好' }).length >= 1);
  assert.equal(filterCatalog(catalog.entries, { app: 'hazi-viet', query: 'không-có-bài-này-xyz' }).length, 0);
});

// 18. Chống trùng bài
await test('18. findDuplicateLesson: trùng URL hoặc cùng app+tên thì cảnh báo, khác thì không', () => {
  const lessons = baseData().lessons;
  const byUrl = findDuplicateLesson(lessons, { app: 'hsk3.0', url: 'https://bohoa96tb.github.io/hazi-viet/', title: 'Khác hẳn' });
  assert.equal(byUrl.id, 'l1');
  const byTitle = findDuplicateLesson(lessons, { app: 'hazi-viet', url: 'https://example.com/x', title: '  bài 1 你好 ' });
  assert.equal(byTitle.id, 'l1');
  const diffApp = findDuplicateLesson(lessons, { app: 'hsk3.0', url: 'https://example.com/y', title: 'Bài 1 你好' });
  assert.equal(diffApp, null);
  const none = findDuplicateLesson(lessons, { app: 'hazi-viet', url: 'https://example.com/z', title: 'Bài mới tinh' });
  assert.equal(none, null);
});

// 19. Modal: CSS không ghi đè [hidden], nút đóng khớp handler, trạng thái mặc định đóng
await test('19. Modal đóng được: [hidden] thắng display:flex, mọi nút đóng có type=button + handler', async () => {
  const root = new URL('..', import.meta.url);
  const css = await readFile(new URL('css/style.css', root), 'utf8');
  const html = await readFile(new URL('index.html', root), 'utf8');
  const app = await readFile(new URL('js/app.js', root), 'utf8');
  // CSS: bắt buộc có luật [hidden] display:none !important để thắng .modal-backdrop{display:flex}
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/, 'thiếu luật [hidden] display:none !important');
  assert.match(css, /\.modal-backdrop\{[^}]*display:flex/, 'vẫn cần .modal-backdrop display:flex khi mở (để test trên có ý nghĩa)');
  // HTML: mọi modal mặc định hidden khi tải trang
  assert.match(html, /id="lessonModal"[^>]*\shidden(\s|>)/, 'lessonModal phải mặc định hidden');
  assert.match(html, /id="settingsModal"[^>]*\shidden(\s|>)/, 'settingsModal phải mặc định hidden');
  assert.match(html, /id="spreadModal"[^>]*\shidden(\s|>)/, 'spreadModal phải mặc định hidden');
  assert.match(html, /id="deferModal"[^>]*\shidden(\s|>)/, 'deferModal phải mặc định hidden');
  // Mọi nút data-close đều là type="button" (không submit form) và có đủ ở cả 2 modal
  const closeBtns = [...html.matchAll(/<button[^>]*data-close[^>]*>/g)].map((m) => m[0]);
  assert.ok(closeBtns.length >= 4, `chỉ có ${closeBtns.length} nút data-close`);
  for (const b of closeBtns) assert.match(b, /type="button"/, `nút đóng thiếu type=button: ${b}`);
  // Mỗi modal có đúng 1 nút ✕ ở góc (class modal-x + data-close) — số modal đếm động từ HTML
  const xBtns = [...html.matchAll(/<button[^>]*class="modal-x"[^>]*>/g)].map((m) => m[0]);
  const modalCount = [...html.matchAll(/class="modal-backdrop"/g)].length;
  assert.equal(xBtns.length, modalCount, 'mỗi modal phải có đúng 1 nút ✕');
  for (const b of xBtns) assert.match(b, /data-close/);
  // app.js: handler data-close đóng modal, có Escape, có closeAllModals và mở modal thì đóng modal khác
  assert.match(app, /querySelectorAll\('\[data-close\]'\)/);
  assert.match(app, /closeAllModals\(\)/);
  assert.match(app, /e\.key === 'Escape'/);
  assert.match(app, /function openLessonModal[\s\S]*?closeAllModals\(\)/);
  assert.match(app, /function openSettings[\s\S]*?closeAllModals\(\)/);
  // Backdrop: bấm vào chính nền tối (target === modal) thì đóng
  assert.match(app, /e\.target === m/);
});

// 20. Sync queue tuần tự + chống cache khi lấy sha + retry 409
await test('20a. Xóa 3 bài liên tiếp: hàng đợi gom thao tác, không PUT song song, chỉ PUT trạng thái mới nhất', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const queue = createSyncQueue(async (arg) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 30));
    calls.push(arg);
    active--;
  }, { debounceMs: 10 });
  // 3 lần schedule nhanh trước khi chạy -> gom thành 1 lần với arg mới nhất
  queue.schedule('xóa bài 1');
  queue.schedule('xóa bài 2');
  queue.schedule('xóa bài 3');
  await queue.whenIdle();
  assert.deepEqual(calls, ['xóa bài 3']);
  // Đang PUT dở mà bấm tiếp 3 lần -> chỉ thêm đúng 1 PUT với trạng thái cuối
  calls.length = 0;
  queue.schedule('PUT đang chạy');
  await new Promise((r) => setTimeout(r, 15)); // PUT đầu đã bắt đầu (sau debounce 10ms)
  queue.schedule('thay đổi A');
  queue.schedule('thay đổi B');
  queue.schedule('thay đổi C');
  await queue.whenIdle();
  assert.deepEqual(calls, ['PUT đang chạy', 'thay đổi C']);
  assert.equal(maxActive, 1, 'không bao giờ có 2 PUT chạy song song');
});

await test('20b. GET lấy sha chống cache tuyệt đối (query _= + no-store, KHÔNG header Cache-Control/Pragma)', async () => {
  let seen = null;
  const sync = new GitHubSync({
    token: 'ok',
    fetchFn: async (url, opts) => {
      seen = { url, opts };
      return { ok: true, status: 200, json: async () => ({ content: encodeBase64Utf8('{"version":1,"lessons":[]}'), sha: 'shaX' }) };
    },
  });
  const remote = await sync.fetchRemote();
  assert.equal(remote.sha, 'shaX');
  assert.equal(sync.lastKnownSha, 'shaX');
  assert.match(seen.url, /\?ref=main&_=\d+$/, 'URL GET phải có ref + _=<timestamp>');
  assert.equal(seen.opts.cache, 'no-store');
  const headerNames = Object.keys(seen.opts.headers).map((h) => h.toLowerCase());
  assert.ok(!headerNames.includes('cache-control') && !headerNames.includes('pragma'), 'không được gửi header Cache-Control/Pragma (lỗi CORS)');
});

await test('20c. PUT gặp 409 lần đầu: chờ, GET lại sha mới, retry thành công lần 2 và cập nhật lastKnownSha', async () => {
  let putCount = 0;
  let getCount = 0;
  const sync = new GitHubSync({
    token: 'ok',
    sleepFn: async () => {},
    fetchFn: async (url, opts) => {
      if (opts && opts.method === 'PUT') {
        putCount++;
        if (putCount === 1) return { ok: false, status: 409, json: async () => ({}) };
        const body = JSON.parse(opts.body);
        assert.equal(body.sha, 'sha-moi', 'PUT retry phải dùng sha vừa GET lại');
        return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha-sau-put' }, commit: { sha: 'c2' } }) };
      }
      getCount++;
      return { ok: true, status: 200, json: async () => ({ content: encodeBase64Utf8('{"version":1,"lessons":[]}'), sha: getCount === 1 ? 'sha-cu' : 'sha-moi' }) };
    },
  });
  const saved = await sync.save(baseData());
  assert.equal(putCount, 2);
  assert.equal(saved.sha, 'sha-sau-put');
  assert.equal(sync.lastKnownSha, 'sha-sau-put', 'lastKnownSha phải cập nhật từ response PUT');
  // Lần save tiếp theo dùng ngay lastKnownSha, không cần GET lại
  getCount = 0; putCount = 0;
  const sync2Fetch = sync.fetchFn;
  sync.fetchFn = async (url, opts) => {
    if (opts && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      assert.equal(body.sha, 'sha-sau-put', 'PUT lần sau phải dùng lastKnownSha');
      return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha-tiep' }, commit: { sha: 'c3' } }) };
    }
    return sync2Fetch(url, opts);
  };
  await sync.save(baseData());
  assert.equal(getCount, 0, 'đã có lastKnownSha thì không GET lại');
});

// 21. V3 — Lưới lịch tháng T2–CN
await test('21a. monthGrid: tháng 2 năm nhuận 2024 và tháng có ngày 1 rơi vào Chủ nhật', async () => {
  const feb = monthGrid(2024, 2);
  for (const week of feb) assert.equal(week.length, 7, 'mỗi tuần đúng 7 ô');
  const febCells = feb.flat();
  assert.equal(febCells.filter((c) => c.date).length, 29, 'tháng 2/2024 có 29 ngày');
  // 01/02/2024 là Thứ 5 -> 3 ô trống đầu (T2,T3,T4), ngày 1 ở cột Thứ 5 (index 3)
  assert.deepEqual(febCells.slice(0, 3), [{ date: null, day: null }, { date: null, day: null }, { date: null, day: null }]);
  assert.equal(febCells[3].date, '2024-02-01');
  // 01/09/2024 là Chủ nhật -> 6 ô trống, ngày 1 ở cột CN (index 6)
  const sep = monthGrid(2024, 9).flat();
  assert.equal(sep.slice(0, 6).every((c) => c.date === null), true);
  assert.equal(sep[6].date, '2024-09-01');
  assert.equal(sep.filter((c) => c.date).length, 30);
  // Các ngày trong tháng liên tục, không trùng
  const dates = febCells.filter((c) => c.date).map((c) => c.date);
  assert.equal(new Set(dates).size, 29);
  assert.equal(dates[28], '2024-02-29');
});

await test('21b. Heatmap không đếm trùng + Dự báo SRS không sửa dữ liệu gốc', async () => {
  const lessons = [
    { id: 'a', app: 'hazi-viet', stage: 0, nextReviewDate: '2026-11-25', reviewHistory: ['2026-11-20', '2026-11-22'], learnedDate: '2026-11-20' },
    { id: 'b', app: 'hsk3.0', stage: 2, nextReviewDate: '2026-11-25', reviewHistory: ['2026-11-20'] },
  ];
  const snapshot = JSON.stringify(lessons);
  const heat = buildHeatmap(lessons);
  assert.equal(heat.get('2026-11-20'), 2, '2 bài ôn ngày 20/11, bài a không bị đếm trùng vì learnedDate trùng reviewHistory');
  assert.equal(heat.get('2026-11-22'), 1);
  const stats = monthStats(heat, 2026, 11);
  assert.deepEqual(stats, { totalReviews: 3, daysStudied: 2 });
  const fc = buildForecastCounts(lessons);
  // Bài a stage 0, mốc tới 25/11: các mốc dự báo +3 (28/11), +7 (05/12)...
  assert.equal(fc.get('2026-11-28'), 1);
  assert.equal(fc.get('2026-11-25'), undefined, 'mốc sắp tới không tính vào dự báo');
  assert.equal(JSON.stringify(lessons), snapshot, 'dự báo/heatmap không được sửa lessons gốc');
  const onDec5 = forecastLessonsOn(lessons, '2026-12-05');
  assert.ok(onDec5.some((l) => l.id === 'a'));
});

// 22. V3 — Dàn đều / Dời ngày / Tiến độ 3 tầng
await test('22a. spreadOverdueLessons: giữ stage, tôn trọng dailyReviewLimit, cộng dồn lịch sẵn có', async () => {
  const today = '2026-11-24';
  const lessons = [
    { id: 'old1', stage: 3, nextReviewDate: '2026-11-18', reviewHistory: ['2026-11-10'] },
    { id: 'old2', stage: 1, nextReviewDate: '2026-11-20', reviewHistory: [] },
    { id: 'old3', stage: 5, nextReviewDate: '2026-11-23', reviewHistory: ['2026-11-01'] },
    // 3 bài vốn đã có lịch hôm nay (24/11) — limit 4 nên hôm nay chỉ nhận thêm 1
    { id: 's1', stage: 0, nextReviewDate: '2026-11-24', reviewHistory: [] },
    { id: 's2', stage: 0, nextReviewDate: '2026-11-24', reviewHistory: [] },
    { id: 's3', stage: 0, nextReviewDate: '2026-11-24', reviewHistory: [] },
    { id: 'future', stage: 2, nextReviewDate: '2026-11-30', reviewHistory: [] },
  ];
  const before = JSON.stringify(lessons);
  const { lessons: out, assignments, byDate } = spreadOverdueLessons(lessons, { today, startDate: today, dailyReviewLimit: 4 });
  assert.equal(JSON.stringify(lessons), before, 'không sửa dữ liệu gốc');
  assert.equal(assignments.length, 3);
  // Quá hạn lâu nhất (old1, 18/11) được rải trước vào 24/11 (còn 1 chỗ), old2 + old3 sang 25/11
  assert.deepEqual(byDate, { '2026-11-24': 1, '2026-11-25': 2 });
  const byId = Object.fromEntries(out.map((l) => [l.id, l]));
  assert.equal(byId.old1.nextReviewDate, '2026-11-24');
  assert.equal(byId.old1.stage, 3, 'giữ nguyên stage');
  assert.deepEqual(byId.old1.reviewHistory, ['2026-11-10'], 'giữ nguyên reviewHistory');
  assert.equal(byId.old3.stage, 5);
  assert.equal(byId.future.nextReviewDate, '2026-11-30', 'bài không quá hạn không đổi');
  // Không ngày nào vượt limit sau khi rải
  const counts = {};
  for (const l of out) if (l.nextReviewDate >= today) counts[l.nextReviewDate] = (counts[l.nextReviewDate] || 0) + 1;
  for (const [d, n] of Object.entries(counts)) assert.ok(n <= 4, `ngày ${d} vượt limit`);
  // overdueLessons sắp xếp quá hạn lâu nhất trước
  assert.deepEqual(overdueLessons({ lessons }, today).map((l) => l.id), ['old1', 'old2', 'old3']);
});

await test('22b. deferLessonDate (+1 / ngày tùy ý) và computeTierProgress (kể cả catalogCount = 0)', async () => {
  const lessons = [
    { id: 'a', app: 'hazi-viet', stage: 1, nextReviewDate: '2026-11-24', reviewHistory: ['2026-11-20'] },
    { id: 'b', app: 'hazi-viet', stage: 2, nextReviewDate: '2026-11-24', reviewHistory: [] },
    { id: 'c', app: 'hazi-viet', stage: 4, nextReviewDate: '2026-11-24', reviewHistory: [] },
    { id: 'd', app: 'hsk3.0', stage: 3, nextReviewDate: '2026-11-24', reviewHistory: [] },
  ];
  const plus1 = deferLessonDate(lessons, 'a', addDays('2026-11-24', 1));
  assert.equal(plus1[0].nextReviewDate, '2026-11-25');
  assert.equal(plus1[0].stage, 1, 'dời ngày giữ nguyên stage');
  const custom = deferLessonDate(lessons, 'b', '2026-12-24');
  assert.equal(custom[1].nextReviewDate, '2026-12-24');
  assert.throws(() => deferLessonDate(lessons, 'a', '24/11/2026'), /không hợp lệ/);
  const progress = computeTierProgress(lessons, { 'hazi-viet': 94, 'hsk3.0': 30 });
  assert.deepEqual(
    { total: progress['hazi-viet'].total, tracked: progress['hazi-viet'].tracked, fresh: progress['hazi-viet'].fresh, consol: progress['hazi-viet'].consolidating, deep: progress['hazi-viet'].deep, percent: progress['hazi-viet'].percent },
    { total: 94, tracked: 3, fresh: 1, consol: 1, deep: 1, percent: 3 },
  );
  assert.equal(progress['hsk3.0'].consolidating, 1);
  // Biên: catalogCount = 0 -> mẫu số = số bài của người dùng; không có bài nào -> 0% không NaN
  const zero = computeTierProgress([], { 'hazi-viet': 0, 'hsk3.0': 0 });
  assert.equal(zero['hazi-viet'].total, 0);
  assert.equal(zero['hazi-viet'].percent, 0);
  const noCatalog = computeTierProgress(lessons, {});
  assert.equal(noCatalog['hazi-viet'].total, 3, 'không có catalog thì lấy số bài người dùng');
  assert.equal(noCatalog['hazi-viet'].percent, 100);
});

console.log(`\n===== KẾT QUẢ: ${passed} đạt, ${failures.length} lỗi =====`);
if (failures.length) { failures.forEach((f) => console.log(`- ${f}`)); process.exit(1); }
