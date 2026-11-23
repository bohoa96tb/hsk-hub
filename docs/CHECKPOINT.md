# CHECKPOINT — HSK Hub

Cập nhật: 2026-11-24 (Asia/Tokyo) — **V3**

## Trạng thái hiện tại

- ✅ **V3 đã hoàn thành (2026-11-24)**: tab **Lịch tháng SRS** (`js/calendar.js`: lưới T2–CN, heatmap theo `reviewHistory`/`learnedDate` không đếm trùng, huy hiệu 🔵 đến hạn, công tắc Dự báo SRS 🟣 mô phỏng thuần không sửa dữ liệu, ngăn chi tiết ngày), **Dàn đều bài quá hạn** (`spreadOverdueLessons` — chỉ đổi `nextReviewDate`, giữ `stage`/`reviewHistory`, tôn trọng `settings.dailyReviewLimit` mặc định 4) + **Dời ngày nhanh** (`deferLessonDate`, +1/+3/ngày tùy ý), **thanh tiến độ 3 tầng** (`computeTierProgress`, mẫu số `max(catalog, số bài của người dùng)`, an toàn chia 0). Test mới nhóm 21a/21b/22a/22b, tổng **24/24 đạt**; subpath 10/10 đường dẫn 200; dry-run nhắc ôn đọc đúng dữ liệu thật (1 bài, quá hạn 1 ngày).
- 🔒 **Dữ liệu thật của Bui được bảo vệ tuyệt đối trong đợt V3**: trước khi sửa đã `git fetch origin` và lấy `data/progress.json` mới nhất từ `origin/main` (Bui đã xóa 3 bài mẫu, thêm 1 bài thật HSK 2 · Bài 3, streak 2, 18 lượt ôn — qua các commit "chore: sync progress from HSK Hub" từ điện thoại, tức PAT đồng bộ đã hoạt động). File này **không nằm trong commit V3 và không được tải lên**; mã băm bản làm việc khớp 100% với `origin/main` sau khi xong việc. (Không dùng `git pull --rebase` vì lịch sử local và remote đã phân kỳ do cơ chế tải file qua Contents API — rebase sẽ xung đột gần như mọi file; fetch + lấy nguyên vẹn file dữ liệu đạt đúng mục đích bảo vệ.) Test 15 đã chuyển sang chỉ kiểm schema của `progress.json` vì dữ liệu mẫu không còn là dữ liệu thật nữa.
- ✅ V1 + V2 đã hoàn thành, commit local `main` HEAD `af874dc`.
- ✅ **Đã đẩy lên GitHub** (2026-11-23 ~17:05 JST): `git push`/`push_files` bị chặn (gh chưa đăng nhập; App bị 403 ở git trees), nhưng API tạo/cập nhật file của GitHub App có quyền ghi — đã tải **14/16 file** lên `main` và đối chiếu mã băm blob: **khớp 100% với bản local**. Lưu ý: lịch sử commit trên GitHub là các commit theo từng file (qua Contents API), khác SHA với lịch sử local; nội dung file giống hệt.
  - Sự cố đã sửa: lần tải đầu lưu nhầm chuỗi base64 thay vì nội dung thật (công cụ yêu cầu nội dung thô); đã tải lại toàn bộ và kiểm chứng lại từng file.
- ✅ **`.github/workflows/remind.yml` đã có trên GitHub** (2026-11-23 17:41 JST, commit `53be9f0`): tạo qua giao diện web sau khi Bui tự đăng nhập GitHub bằng Google + xác minh 2 bước Authenticator (mật khẩu GitHub đã lưu trong Secure Vault đã cũ, bị từ chối). Đã đối chiếu: mã băm file trên GitHub khớp bản local.
- ✅ **GitHub Pages đã bật và live**: Source Deploy from a branch `main` / `/`, Enforce HTTPS. Kiểm chứng độc lập 2026-11-23: run "pages build and deployment" **success**, và cả 8 đường dẫn live (`/`, css, js, data/progress.json, data/catalog.json, manifest, icon) đều trả **200**; nội dung live đúng (tiêu đề HSK Hub, 3 bài mẫu, reminderMode `morning`, catalog 124 bài). 👉 https://bohoa96tb.github.io/hsk-hub/
- ⏳ Secrets: chưa xác minh được từ ngoài (API công khai không liệt kê secrets). Workflow chỉ gửi thông báo thật khi có secret `NTFY_TOPIC` (hoặc Telegram) — nếu chưa thêm, lần chạy Actions vẫn success nhưng chỉ in nội dung dự kiến ra log. Mốc chạy kế tiếp: 19:00 JST (cron) và 07:00 JST hằng ngày; test ngay bằng Actions → Daily HSK Reminder → Run workflow.
- ⏳ PAT đồng bộ 2 chiều: Bui tự tạo Fine-grained PAT (Contents: Read and write, chỉ repo `hsk-hub`) và dán vào ⚙️ Cài đặt trên web khi muốn sửa dữ liệu trực tiếp từ điện thoại.
- 🐛➡️✅ **Sửa lỗi xung đột 409 khi thao tác liên tiếp (2026-11-23, commit local `506d668`)**: nguyên nhân là nhiều lệnh PUT chạy song song dùng sha cũ + GET lấy sha có thể trúng cache. Đã sửa: GET sha luôn kèm `&_=<timestamp>` + `cache:'no-store'` (không dùng header Cache-Control/Pragma để tránh CORS); hàng đợi đồng bộ tuần tự `createSyncQueue` (debounce 700ms, in-flight lock, gom thay đổi thành 1 PUT với trạng thái mới nhất, `lastKnownSha` cập nhật từ response PUT — app dùng 1 instance GitHubSync duy nhất); gặp 409 thì chờ 400ms, GET lại sha và retry tối đa 2 lần. Test mới nhóm 20a/20b/20c, tổng **20/20 nhóm đạt**. Đã đẩy lên GitHub qua Contents API (mã băm khớp), Pages build **success**, live đã phục vụ bản mới.
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
2. ~~Tạo PAT dán vào web~~ ✅ Đã xong (bằng chứng: các commit "chore: sync progress from HSK Hub" từ điện thoại ngày 23–24/11 — Bui đã xóa bài mẫu, thêm bài thật và đồng bộ thành công).
3. (Không bắt buộc) Cập nhật lại mật khẩu GitHub đã lưu trong Secure Vault — bản đã lưu bị GitHub từ chối; lần đăng nhập web vừa rồi dùng Google + Authenticator.

## Tiếp tục công việc

Đọc README.md và file này. Chạy lại test: `node tests/run-tests.mjs`. Cập nhật danh mục: `node scripts/sync-catalog.mjs`.
