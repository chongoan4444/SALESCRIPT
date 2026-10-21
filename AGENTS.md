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

- `html.txt`, `html2.txt`, `html3.txt`: HTML thật của dashboard / khi mở chat.
- `_app-9331d46f21a84eb1.v6.js`: bundle chính (`ev`/`ey` xếp thứ tự, `eg`/`eb`
  upsert hội thoại sau khi gửi).
- `dashboard-fa168c408c705d9e.v6.js`: bundle phụ.
- `pancake.vn2.har`: HAR từ Network (đối chiếu `snippet`/`seen`/`unread_count`).

Các file trên là nguồn tham khảo chính để phân tích website. (File
`_app-62a04783e7706d46.v6.js` đã bị xoá khỏi repo — đừng tìm lại.)

Chi tiết vì sao danh sách hội thoại bị xếp lại sau mỗi tin gửi: xem `README.md`
mục "Vì sao danh sách bị đẩy".
