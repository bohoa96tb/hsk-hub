# HSK Hub 📚

Web tĩnh (PWA) theo dõi tiến độ học tiếng Trung HSK 1–3.0, ôn tập theo SRS `[1, 3, 7, 14, 30, 60]` ngày (múi giờ `Asia/Tokyo`), đồng bộ 2 chiều với GitHub và nhắc ôn tự động mỗi sáng bằng GitHub Actions.

- Trang live: https://bohoa96tb.github.io/hsk-hub/
- Web học liên kết: [Hazi Việt](https://bohoa96tb.github.io/hazi-viet/) · [HSK 3.0](https://bohoa96tb.github.io/HSK3.0/)
- Thuần HTML/CSS/JavaScript (ES Modules), không framework, không build, không package ngoài.

## 1. Bật GitHub Pages

1. Mở repo `bohoa96tb/hsk-hub` → **Settings → Pages**.
2. Mục **Build and deployment → Source**: chọn **Deploy from a branch**.
3. Branch: `main`, thư mục: `/ (root)` → **Save**.
4. Chờ 1–2 phút, mở https://bohoa96tb.github.io/hsk-hub/ để kiểm tra.

## 2. Tạo GitHub Fine-grained PAT để đồng bộ

1. GitHub → ảnh đại diện → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access**: chọn **Only select repositories** → chọn đúng `hsk-hub`.
3. **Permissions → Repository permissions → Contents**: chọn **Read and write**. Không cấp thêm quyền nào khác.
4. Tạo token, sao chép (chỉ hiện 1 lần).
5. Mở HSK Hub → nút ⚙️ **Cài đặt** → dán token vào ô PAT → **Kiểm tra kết nối** → **Đồng bộ ngay**.

⚠️ Token lưu trong `localStorage` của trình duyệt này. Chỉ dùng token giới hạn như trên; nếu nghi ngờ lộ token, vào GitHub xóa token cũ và tạo token mới.

## 3. Cài nhắc nhở qua ntfy (hoặc Telegram)

### Cách A — ntfy (khuyên dùng)

1. Cài app **ntfy** trên Android (Play Store / F-Droid) hoặc iPad.
2. Mở app ntfy → **+** → đăng ký một topic khó đoán, ví dụ `hsk-hub-bui-7f3k9` (ai biết topic cũng đọc/gửi được thông báo, nên đừng dùng tên dễ đoán).
3. Trên GitHub: repo `hsk-hub` → **Settings → Secrets and variables → Actions → New repository secret**:
   - Tên: `NTFY_TOPIC`, giá trị: đúng topic vừa tạo.
   - (Tùy chọn) `NTFY_SERVER` nếu dùng server ntfy riêng; mặc định `https://ntfy.sh`.

### Cách B — Telegram

1. Nhắn `/newbot` cho **@BotFather**, tạo bot và lấy token.
2. Nhắn một tin bất kỳ cho bot của bạn, mở `https://api.telegram.org/bot<TOKEN>/getUpdates` để lấy `chat.id`.
3. Thêm 2 secret: `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`.

Có thể cài cả hai kênh — thông báo sẽ gửi song song.

### Đổi khung giờ nhắc ngay trên web (V2)

Vào ⚙️ **Cài đặt → Khung giờ nhận thông báo**: **Sáng 07:00** / **Tối 19:00** / **Cả sáng & tối** / **Tạm dừng**, rồi bấm **Đồng bộ ngay** để lưu vào `progress.json` trên GitHub. GitHub Actions chạy cả 2 mốc 07:00 và 19:00 (giờ Nhật) mỗi ngày, script tự lọc theo lựa chọn của bạn (chấp nhận trễ cron trong ±2 giờ) — không cần sửa file YAML.

## 4. Test thông báo ngay

Repo `hsk-hub` → tab **Actions** → workflow **Daily HSK Reminder** → **Run workflow** → giữ `force_send = true` → **Run workflow**. Kiểm tra điện thoại/app ntfy hoặc Telegram sau vài chục giây.

Thử tại máy (không gửi thật):

```bash
FORCE_SEND=true node scripts/remind.mjs --dry-run
```

## Tính năng V3 — Lịch tháng SRS, dàn đều bài quá hạn, tiến độ 3 tầng

- **Tab "Lịch tháng"**: lưới lịch T2–CN, nền xanh đậm nhạt (heatmap) theo số bài đã ôn mỗi ngày, huy hiệu 🔵 số bài đến hạn, công tắc **Dự báo SRS** hiện thêm chấm 🟣 mô phỏng các mốc ôn tương lai (chỉ xem trước, không đổi dữ liệu). Chạm vào một ngày để xem chi tiết: bài cần ôn, bài đã hoàn thành, bài dự kiến. Phía trên lưới có thanh cảnh báo số bài quá hạn.
- **Dàn đều bài quá hạn**: khi có từ 2 bài quá hạn, nút **Dàn đều bài** (ở tab "Cần ôn hôm nay" và tab "Lịch tháng") mở hộp chọn hạn mức mỗi ngày (2–10, lưu vào `settings.dailyReviewLimit`, mặc định 4) và ngày bắt đầu (hôm nay/ngày mai), xem trước cách rải rồi mới xác nhận. Chỉ dời `nextReviewDate` — giữ nguyên mốc SRS và lịch sử ôn.
- **Dời ngày nhanh**: nút **📅 Dời** trên mỗi thẻ bài — chọn "Sang mai (+1)", "+3 ngày" hoặc một ngày bất kỳ.
- **Thanh tiến độ tổng thể**: ngay dưới 2 thẻ mở nhanh, mỗi app (Hazi Việt / HSK 3.0) một dòng `X/Y bài (Z%)` với thanh phân đoạn 3 màu theo tầng nhớ: **Mới học** (mốc 1–3 ngày, vàng), **Đang củng cố** (7–14 ngày, xanh dương), **Đã nhớ sâu** (30–60 ngày, xanh lá). Mẫu số Y lấy từ `data/catalog.json`. Có nút thu gọn, trạng thái được nhớ trên máy.

## Chọn nhanh bài học từ danh mục (V2)

Nút **+ Thêm bài mới** có mục **Chọn nhanh từ danh mục**: lọc theo app, gõ tìm (tên bài, chữ Hán…), chạm một bài là tự điền tên/app/link đúng bài thật — Hazi Việt mở thẳng bài qua `vocabulary.html?word=…`, HSK 3.0 qua `#/lesson/…`. Nếu bài đã có trong danh sách của bạn, web hiện cảnh báo nhẹ để tránh thêm trùng. Vẫn nhập tay tự do được như cũ.

Danh mục (`data/catalog.json`, hiện **124 bài**: Hazi Việt 94 + HSK 3.0 30) được tổng hợp từ dữ liệu công khai của 2 repo. Cập nhật lại khi 2 web có bài mới:

```bash
node scripts/sync-catalog.mjs
```

## Sao lưu & khôi phục khi đổi máy / mất điện thoại

- Dữ liệu thật nằm ở `data/progress.json` trên GitHub (khi đã đồng bộ bằng PAT) — đổi máy chỉ cần mở web, dán lại PAT, dữ liệu tự tải về.
- Chưa gắn PAT: dữ liệu chỉ ở trình duyệt của máy đó. Hãy vào ⚙️ → **Xuất JSON** để sao lưu định kỳ.
- Khôi phục: ⚙️ → **Nhập JSON** → chọn file đã xuất. Hệ thống kiểm tra định dạng trước khi nhận, tự sao lưu bản hiện tại trên máy, và **gộp theo ID bài học** (không xóa bài chỉ vì file nhập không có bài đó).
- Nếu đồng bộ báo xung đột/lỗi token: kiểm tra PAT còn hạn và đúng quyền `Contents: Read and write`, rồi bấm **Đồng bộ ngay** lại.

## Kiểm thử tự động

```bash
node --check js/srs.js && node --check js/github-sync.js && node --check js/app.js && node --check scripts/remind.mjs
node tests/run-tests.mjs
```

Bộ test bao phủ: ngày JST, SRS mọi mốc, streak, ID duy nhất, validate import, merge không mất bài, Base64 Unicode (tiếng Việt + chữ Hán), reminder (hôm nay/quá hạn/FORCE_SEND), lỗi HTTP của ntfy/Telegram, lỗi 401/409/timeout của GitHub API.

## Cấu trúc

```
index.html · manifest.json · icon.svg
css/style.css
js/srs.js (logic SRS thuần) · js/github-sync.js (GitHub API) · js/app.js (giao diện)
data/progress.json · data/catalog.json
scripts/remind.mjs · scripts/sync-catalog.mjs
.github/workflows/remind.yml
tests/run-tests.mjs
docs/CHECKPOINT.md
```

Lưu ý kỹ thuật: app **không** dùng Service Worker cache dữ liệu, và luôn tải `data/progress.json` kèm `?t=<timestamp>` (hoặc qua GitHub API khi có PAT) để không bao giờ hiển thị dữ liệu cũ.
