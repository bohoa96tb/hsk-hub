// sync-catalog.mjs — Tổng hợp danh mục bài học thật từ hazi-viet và HSK3.0.
// Node 20+, chỉ dùng fetch built-in. Chạy: node scripts/sync-catalog.mjs
// Nguồn dữ liệu (file JSON công khai trên nhánh main của 2 repo):
// - hazi-viet: data/vocabulary/hanzii-course.json -> lessons[] (94 bài HSK1-3).
//   Deep-link từng bài: vocabulary.html?word=<id từ đầu tiên của bài>.
// - HSK3.0: data/content.json -> lessons[] (30 bài Textbook HSK1-2).
//   Deep-link từng bài: #/lesson/<id bài> (hash router).
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const SOURCES = {
  hazi: 'https://raw.githubusercontent.com/bohoa96tb/hazi-viet/main/data/vocabulary/hanzii-course.json',
  hsk30: 'https://raw.githubusercontent.com/bohoa96tb/HSK3.0/main/data/content.json',
};
export const HAZI_BASE = 'https://bohoa96tb.github.io/hazi-viet/';
export const HSK30_BASE = 'https://bohoa96tb.github.io/HSK3.0/';

export function buildHaziEntries(course) {
  const lessons = Array.isArray(course?.lessons) ? course.lessons : [];
  return lessons
    .filter((l) => l && l.id && Array.isArray(l.wordIds) && l.wordIds.length > 0)
    .map((l) => {
      const rawTitle = String(l.title || '').trim();
      const title = /^HSK/i.test(rawTitle)
        ? rawTitle
        : `HSK ${l.level} · Bài ${l.number} — ${rawTitle}`;
      return {
        id: `hazi-${l.id}`,
        app: 'hazi-viet',
        group: `HSK ${l.level}`,
        title,
        url: `${HAZI_BASE}vocabulary.html?word=${encodeURIComponent(l.wordIds[0])}`,
      };
    });
}

export function buildHsk30Entries(content) {
  const lessons = Array.isArray(content?.lessons) ? content.lessons : [];
  return lessons
    .filter((l) => l && l.id && l.titleZh)
    .map((l) => ({
      id: `hsk30-${l.id}`,
      app: 'hsk3.0',
      group: String(l.level || 'HSK'),
      title: `${l.level} · Bài ${l.lessonNumber} — ${l.titleZh}${l.titleVi ? ` (${l.titleVi})` : ''}`,
      url: `${HSK30_BASE}#/lesson/${encodeURIComponent(l.id)}`,
    }));
}

export async function buildCatalog(fetchFn = fetch) {
  const [haziRes, hskRes] = await Promise.all([fetchFn(SOURCES.hazi), fetchFn(SOURCES.hsk30)]);
  if (!haziRes.ok) throw new Error(`Không tải được dữ liệu hazi-viet (HTTP ${haziRes.status})`);
  if (!hskRes.ok) throw new Error(`Không tải được dữ liệu HSK3.0 (HTTP ${hskRes.status})`);
  const [course, content] = await Promise.all([haziRes.json(), hskRes.json()]);
  const entries = [...buildHaziEntries(course), ...buildHsk30Entries(content)];
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error('Danh mục có ID trùng — đã hủy ghi file');
  if (entries.length === 0) throw new Error('Danh mục rỗng — đã hủy ghi file');
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: { 'hazi-viet': SOURCES.hazi, 'hsk3.0': SOURCES.hsk30 },
    counts: {
      'hazi-viet': entries.filter((e) => e.app === 'hazi-viet').length,
      'hsk3.0': entries.filter((e) => e.app === 'hsk3.0').length,
      total: entries.length,
    },
    entries,
  };
}

export async function main(fetchFn = fetch) {
  const catalog = await buildCatalog(fetchFn);
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, '..', 'data', 'catalog.json');
  await writeFile(out, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`✅ Đã ghi ${out}`);
  console.log(`   Hazi Việt: ${catalog.counts['hazi-viet']} bài · HSK 3.0: ${catalog.counts['hsk3.0']} bài · Tổng: ${catalog.counts.total} bài`);
  return catalog;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Lỗi: ${err.message}`);
    process.exit(1);
  });
}
