# CHECKPOINT — HSK Hub

Cập nhật: 2026-11-23 (Asia/Tokyo) — **V2**

## Trạng thái hiện tại

- ✅ V1 + V2 đã hoàn thành, commit local `main` HEAD `af874dc`.
- ✅ **Đã đẩy lên GitHub** (2026-11-23 ~17:05 JST): `git push`/`push_files` bị chặn (gh chưa đăng nhập; App bị 403 ở git trees), nhưng API tạo/cập nhật file của GitHub App có quyền ghi — đã tải **14/16 file** lên `main` và đối chiếu mã băm blob: **khớp 100% với bản local**. Lưu ý: lịch sử commit trên GitHub là các commit theo từng file (qua Contents API), khác SHA với lịch sử local; nội dung file giống hệt.
  - Sự cố đã sửa: lần tải đầu lưu nhầm chuỗi base64 thay vì nội dung thật (công cụ yêu cầu nội dung thô); đã tải lại toàn bộ và kiểm chứng lại từng file.
- ✅ **`.github/workflows/remind.yml` đã có trên GitHub** (2026-11-23 17:41 JST, commit `53be9f0`): tạo qua giao diện web sau khi Bui tự đăng nhập GitHub bằng Google + xác minh 2 bước Authenticator (mật khẩu GitHub đã lưu trong Secure Vault đã cũ, bị từ chối). Đã đối chiếu: mã băm file trên GitHub khớp bản local.
- ✅ **GitHub Pages đã bật và live**: Source Deploy from a branch `main` / `/`, Enforce HTTPS. Kiểm chứng độc lập 2026-11-23: run "pages build and deployment" **success**, và cả 8 đường dẫn live (`/`, css, js, data/progress.json, data/catalog.json, manifest, icon) đều trả **200**; nội dung live đúng (tiêu đề HSK Hub, 3 bài mẫu, reminderMode `morning`, catalog 124 bài). 👉 https://bohoa96tb.github.io/hsk-hub/
- ⏳ Secrets: chưa xác minh được từ ngoài (API công khai không liệt kê secrets). Workflow chỉ gửi thông báo thật khi có secret `NTFY_TOPIC` (hoặc Telegram) — nếu chưa thêm, lần chạy Actions vẫn success nhưng chỉ in nội dung dự kiến ra log. Mốc chạy kế tiếp: 19:00 JST (cron) và 07:00 JST hằng ngày; test ngay bằng Actions → Daily HSK Reminder → Run workflow.
- ⏳ PAT đồng bộ 2 chiều: Bui tự tạo Fine-grained PAT (Contents: Read and write, chỉ repo `hsk-hub`) và dán vào ⚙️ Cài đặt trên web khi muốn sửa dữ liệu trực tiếp từ điện thoại.
- 🐛➡️✅ **Sửa lỗi modal không đóng được (2026-11-23, commit local `eb3e5a6`)**: nguyên nhân là `.modal-backdrop{display:flex}` ghi đè thuộc tính `hidden` nên cả 2 modal luôn hiện và nút Đóng vô hiệu. Đã thêm `[hidden]{display:none !important}`, nút ✕ ở cả 2 modal, đóng bằng backdrop/Escape, mở modal mới tự đóng modal cũ (hàm `closeAllModals`), test tự động nhóm 19 (tổng **17/17 nhóm đạt**). Đã đẩy 4 file sửa lên GitHub qua Contents API (mã băm khớp), Pages build **success**, kiểm chứng live: CSS/JS bản mới đã phục vụ. Lưu ý cho Bui: nếu điện thoại vẫn thấy lỗi, hãy tải lại trang 1 lần để xoá cache bản cũ.

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

1. Thêm secret `NTFY_TOPIC` (và/hoặc Telegram) trong Settings → Secrets → Actions, rồi chạy thử workflow một lần (Actions → Daily HSK Reminder → Run workflow) và cài app ntfy đăng ký đúng topic.
2. Tạo PAT (Contents: Read and write, chỉ repo `hsk-hub`) dán vào ⚙️ Cài đặt trên web để đồng bộ 2 chiều từ điện thoại.
3. (Không bắt buộc) Cập nhật lại mật khẩu GitHub đã lưu trong Secure Vault — bản đã lưu bị GitHub từ chối; lần đăng nhập web vừa rồi dùng Google + Authenticator.

## Tiếp tục công việc

Đọc README.md và file này. Chạy lại test: `node tests/run-tests.mjs`. Cập nhật danh mục: `node scripts/sync-catalog.mjs`.
