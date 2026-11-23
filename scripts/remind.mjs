// remind.mjs — Nhắc ôn tập hằng ngày. Node 20+, chỉ dùng built-in fs + fetch.
// Dùng: node scripts/remind.mjs [--dry-run]
// Env: NTFY_TOPIC, NTFY_SERVER (mặc định https://ntfy.sh), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, FORCE_SEND
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { todayJST, dueLessons, overdueDays, APPS } from '../js/srs.js';

export const HUB_URL = 'https://bohoa96tb.github.io/hsk-hub/';

/** Giờ hiện tại (0-23) theo Asia/Tokyo. */
export function currentHourJST(now = new Date()) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(now);
  return Number(s);
}

export const REMINDER_TARGETS = { morning: 7, evening: 19 };
export const REMINDER_WINDOW_HOURS = 2; // cửa sổ ±2 giờ chống trễ cron GitHub Actions

/**
 * Có nên gửi ở thời điểm này theo settings.reminderMode không.
 * - morning: giờ JST trong [5, 9]; evening: [17, 21]; both: một trong hai; off: không bao giờ.
 * - forceSend=true (FORCE_SEND hoặc --dry-run do main truyền vào) luôn bỏ qua khung giờ.
 */
export function shouldSendNow(mode, now = new Date(), forceSend = false) {
  if (forceSend) return true;
  const m = ['morning', 'evening', 'both', 'off'].includes(mode) ? mode : 'morning';
  if (m === 'off') return false;
  const hour = typeof now === 'number' ? now : currentHourJST(now);
  const inWindow = (target) => Math.abs(hour - target) <= REMINDER_WINDOW_HOURS;
  if (m === 'morning') return inWindow(REMINDER_TARGETS.morning);
  if (m === 'evening') return inWindow(REMINDER_TARGETS.evening);
  return inWindow(REMINDER_TARGETS.morning) || inWindow(REMINDER_TARGETS.evening);
}

export function scheduleSkipReason(mode, now = new Date()) {
  return `Bỏ qua gửi: giờ hiện tại ${currentHourJST(now)}:xx JST không khớp khung giờ đã chọn (reminderMode="${mode || 'morning'}"). Đặt FORCE_SEND=true hoặc chạy --dry-run để test.`;
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Dựng nội dung thông báo (text thuần) từ dữ liệu + ngày hôm nay. */
export function buildMessage(data, today = todayJST()) {
  const due = dueLessons(data, today);
  const title = `📚 HSK Hub: ${due.length} bài cần ôn hôm nay`;
  const lines = [title, ''];
  for (const lesson of due) {
    const od = overdueDays(lesson, today);
    const label = APPS[lesson.app]?.label || lesson.app;
    lines.push(`• ${lesson.title} [${label}]${od > 0 ? ` (Quá hạn ${od} ngày)` : ''}`);
  }
  if (due.length === 0) lines.push('Hôm nay không có bài nào đến hạn — vẫn gửi vì FORCE_SEND đang bật.');
  lines.push('', `👉 Mở HSK Hub: ${HUB_URL}`);
  return { title, body: lines.join('\n'), dueCount: due.length };
}

export async function sendNtfy({ topic, server = 'https://ntfy.sh' }, body, fetchFn = fetch) {
  const res = await fetchFn(`${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      // Header HTTP chỉ nên ASCII: Title không dấu, body giữ tiếng Việt UTF-8 đầy đủ.
      Title: 'HSK Hub - Lich on tap hom nay',
      Click: HUB_URL,
      Tags: 'books,bell',
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body,
  });
  if (!res.ok) throw new Error(`ntfy trả lỗi HTTP ${res.status}`);
  return res;
}

export async function sendTelegram({ token, chatId }, { title, body }, fetchFn = fetch) {
  const text = `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(body.split('\n').slice(2).join('\n'))}`;
  const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
  });
  if (!res.ok) throw new Error(`Telegram trả lỗi HTTP ${res.status}`);
  return res;
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchFn = fetch) {
  const dryRun = argv.includes('--dry-run');
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = await readFile(join(here, '..', 'data', 'progress.json'), 'utf8');
  const data = JSON.parse(raw);
  const today = todayJST();
  const mode = data.settings?.reminderMode || 'morning';
  const bypassSchedule = dryRun || env.FORCE_SEND === 'true';
  if (!shouldSendNow(mode, new Date(), bypassSchedule)) {
    console.log(scheduleSkipReason(mode));
    return { sent: false, dueCount: 0, skippedBySchedule: true };
  }
  const { title, body, dueCount } = buildMessage(data, today);

  if (dueCount === 0 && env.FORCE_SEND !== 'true') {
    console.log('Không có bài cần ôn hôm nay');
    return { sent: false, dueCount };
  }

  if (dryRun) {
    console.log('--- DRY RUN (không gửi thật) ---');
    console.log(body);
    console.log('--- HẾT DRY RUN ---');
    return { sent: false, dryRun: true, dueCount };
  }

  const jobs = [];
  if (env.NTFY_TOPIC) jobs.push(['ntfy', sendNtfy({ topic: env.NTFY_TOPIC, server: env.NTFY_SERVER || 'https://ntfy.sh' }, body, fetchFn)]);
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    jobs.push(['telegram', sendTelegram({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }, { title, body }, fetchFn)]);
  }
  if (jobs.length === 0) {
    console.log('Chưa cấu hình kênh gửi (NTFY_TOPIC hoặc TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID). Nội dung dự kiến:');
    console.log(body);
    return { sent: false, dueCount, noChannel: true };
  }
  let anyOk = false;
  for (const [name, job] of jobs) {
    try {
      await job;
      console.log(`✅ Đã gửi qua ${name}`);
      anyOk = true;
    } catch (err) {
      console.error(`❌ Gửi qua ${name} thất bại: ${err.message}`);
    }
  }
  if (!anyOk) throw new Error('Tất cả kênh gửi đều thất bại');
  return { sent: true, dueCount };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Lỗi: ${err.message}`);
    process.exit(1);
  });
}
