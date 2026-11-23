# CHECKPOINT — HSK Hub

Cập nhật: 2026-11-23 (Asia/Tokyo) — **V2**

## Trạng thái hiện tại

- ✅ V1 + V2 đã hoàn thành, commit local `main` HEAD `af874dc`.
- ✅ **Đã đẩy lên GitHub** (2026-11-23 ~17:05 JST): `git push`/`push_files` bị chặn (gh chưa đăng nhập; App bị 403 ở git trees), nhưng API tạo/cập nhật file của GitHub App có quyền ghi — đã tải **14/16 file** lên `main` và đối chiếu mã băm blob: **khớp 100% với bản local**. Lưu ý: lịch sử commit trên GitHub là các commit theo từng file (qua Contents API), khác SHA với lịch sử local; nội dung file giống hệt.
  - Sự cố đã sửa: lần tải đầu lưu nhầm chuỗi base64 thay vì nội dung thật (công cụ yêu cầu nội dung thô); đã tải lại toàn bộ và kiểm chứng lại từng file.
- ⏳ **Còn thiếu `.github/workflows/remind.yml`**: GitHub không cho App tạo file workflow (cần quyền Workflows). Đã thử tạo qua trình duyệt web GitHub nhưng mật khẩu GitHub đã lưu trong Secure Vault bị từ chối ("Incorrect username or password") — chờ Bui cập nhật lại mật khẩu, hoặc tự tạo file theo nội dung trong bản local.
- ⏳ GitHub Pages: chưa bật (cùng chờ đăng nhập web như trên; hoặc Bui tự bật: Settings → Pages → Deploy from a branch → `main` / `/`).
- ⏳ Secrets: chưa kiểm tra được (cần đăng nhập); workflow chỉ gửi thật khi có `NTFY_TOPIC` hoặc Telegram secrets.

## V2 — đã làm (2026-11-23)

1. **Danh mục chọn nhanh**: `scripts/sync-catalog.mjs` đọc dữ liệu thật:
   - hazi-viet `data/vocabulary/hanzii-course.json` → **94 bài** (HSK1: 21, HSK2: 32, HSK3: 41), deep-link `vocabulary.html?word=<id từ đầu bài>` (đã kiểm tra live 200).
   - HSK3.0 `data/content.json` → **30 bài** Textbook (HSK1: 15, HSK2: 15), deep-link `#/lesson/<id>` (đã xác minh route trong `src/app.js`).
   - Kết quả: `data/catalog.json` **124 bài**, ID duy nhất. Modal Thêm bài có lọc theo app + tìm kiếm + tự điền title/app/url + cảnh báo nhẹ khi trùng (theo URL hoặc cùng app + tên). Vẫn giữ nhập tay.
2. **Khung giờ nhắc trên web**: `settings.reminderMode` (`morning`/`evening`/`both`/`off`) trong `progress.json` + mục chọn trong ⚙️ Cài đặt. Workflow chạy 2 cron cố định `0 22 * * *` (07:00 JST) và `0 10 * * *` (19:00 JST); `scripts/remind.mjs` tự lọc theo giờ JST hiện tại với cửa sổ ±2 giờ, không khớp/off thì log lý do và thoát 0; `FORCE_SEND=true` và `--dry-run` luôn bỏ qua khung giờ. Đã kiểm chứng thật: chạy lúc 16:5x JST với mode `morning` → bỏ qua đúng, exit 0.

## Kết quả test (2026-11-23, V2)

- `node --check`: đạt cho cả 6 file JS/MJS (thêm `scripts/sync-catalog.mjs`).
- `node tests/run-tests.mjs`: **16 nhóm test đạt, 0 lỗi** (V1: 13 nhóm + mới: reminderMode mọi chế độ/cửa sổ trễ cron/FORCE_SEND, catalog.json thật + hàm dựng danh mục + lọc, chống trùng bài).
- `FORCE_SEND=true node scripts/remind.mjs --dry-run`: đạt — 3 bài cần ôn (1 quá hạn 1 ngày).
- Mô phỏng subpath `/hsk-hub/`: 8/8 đường dẫn 200 (gồm `data/catalog.json`); mọi ID giao diện mới (`cAppFilter`, `cSearch`, `cList`, `cStatus`, `dupWarn`, `sReminderMode`) đều khớp giữa `app.js` và `index.html`.
- Chưa kiểm tra trực quan bằng trình duyệt thật ở 360/390/768px (giới hạn môi trường như V1).

## Việc còn lại (cần Bui)

1. Cấp quyền repo `hsk-hub` cho GitHub App của Muse **hoặc** tự `git push -u origin main`.
2. Bật GitHub Pages (`main` / `/`).
3. Thêm secret `NTFY_TOPIC` (và/hoặc Telegram) rồi chạy thử workflow một lần.
4. Tạo PAT (Contents: Read and write, chỉ repo `hsk-hub`) dán vào ⚙️ Cài đặt trên web.

## Tiếp tục công việc

Đọc README.md và file này. Chạy lại test: `node tests/run-tests.mjs`. Cập nhật danh mục: `node scripts/sync-catalog.mjs`.
