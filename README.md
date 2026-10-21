# SALESCRIPT - Website Source Reference

## Mục đích

Repository này chứa các file source được lấy từ website mà người dùng đang sử dụng.
Mục đích chính là để AI phân tích cấu trúc website và tạo các JavaScript/Tampermonkey
script hoạt động phù hợp với website thực tế.

## Quy tắc quan trọng

- Khi người dùng yêu cầu viết script cho website, trước tiên phải kiểm tra các file
  source trong repository có liên quan đến yêu cầu.
- Ưu tiên sử dụng thông tin thực tế từ source thay vì đoán selector, class, id,
  attribute hoặc cấu trúc DOM.
- Khi cần tìm một phần tử HTML, hãy xác định chính xác id, class, data-* attribute,
  cấu trúc cha/con và các đặc điểm liên quan từ source.
- Có thể tham khảo các file JavaScript trong repository để hiểu logic của website.
- Không tự ý giả định rằng một API, selector hoặc biến tồn tại nếu source không cho thấy điều đó.
- Nếu source hiện tại không đủ thông tin để xác định chính xác cách hoạt động,
  phải nói rõ phần nào chưa xác định được thay vì bịa ra.
- Khi viết JavaScript/Tampermonkey, ưu tiên script ổn định trước những thay đổi nhỏ
  của giao diện.
- Không sửa hoặc xóa source reference hiện có trừ khi người dùng yêu cầu.
- Khi trả về script, giải thích ngắn gọn script đang dựa vào phần nào của source.

## Source hiện có

- `html.txt`: HTML dashboard (chưa mở hội thoại) — 9 row `__0`..`__8`.
- `html2.txt`: HTML khi mở một đoạn chat — 10 row, có 1 row `.selected`.
- `html3.txt`: HTML danh sách 12 row (11 row `unread`) + cột tin nhắn.
- `_app-9331d46f21a84eb1.v6.js`: bundle chính — chứa `ev()`/`ey()` (thứ tự
  danh sách), `eg()`/`eb()` (upsert hội thoại sau khi gửi), `truncateText`.
- `dashboard-fa168c408c705d9e.v6.js`: bundle phụ (không chứa CSS row hội thoại).
- `pancake.vn2.har`: HAR từ Network — nguồn đối chiếu `snippet`, `seen`,
  `unread_count`, `is_pinned`, thứ tự hội thoại.
- `POST.txt/POST2.txt`: URL request lúc tải trang (không có body).
Các file trên là nguồn tham khảo chính để phân tích website.

## Vì sao danh sách bị "đẩy" sau mỗi tin gửi (đã đối chiếu source)

`_app-9331d46f21a84eb1.v6.js`:

- `ev(e, t)`: ghim (`pinned_timestamp` giảm dần) → chưa đọc → đã đọc; trong
  mỗi nhóm sắp theo `updated_at` GIẢM DẦN (`ey`).
- `eg(e, t, n)`: sau khi gửi, hội thoại bị rút khỏi mảng (`eb`) rồi `splice` vào
  `findIndex(e => e.seen && r.updated_at >= e.updated_at)` — tức ĐẦU NHÓM của nó.

Danh sách là virtual list, giữ nguyên offset pixel
(`transform: translateY(Npx)` của `.rc-virtual-list-holder-inner`), nên hội thoại
vừa gửi biến khỏi chỗ đang xem và hiện lại phía TRÊN khung nhìn ⇒ mọi row phía
trên bị đẩy xuống đúng 1 dòng, còn dấu đỏ (toạ độ màn hình cố định) trỏ sang
hội thoại ở trên. Đây là lý do script cũ trông như "chạy bừa" và hay dừng oan.

## Các bản script

- `pancake-auto-upsale-v5.25.user.js`: nền V5.24.1 + **📌 Ghim khung** (cuộn bù
  để khách kế luôn nằm đúng dấu đỏ) + dấu đỏ/viền đỏ vẽ lên row sắp gửi; chọn
  khách có kiểm tra snippet nên không dừng oan khi dấu đỏ trỏ sang row ở trên.
- `pancake-auto-upsale-v6.user.js`: bản hai chế độ (Dãy cùng snippet · Gửi hết
  khách bên dưới) — giữ lại để tham khảo, không phải bản V5.25.
- `verify-boot-v525.js`: jsdom, mô phỏng đúng việc Pancake xếp lại danh sách sau
  mỗi tin gửi; kiểm chứng ghim khung + trường hợp danh sách không cuộn được.
