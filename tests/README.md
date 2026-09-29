# Kiểm thử

```bash
npm install     # cài jsdom (chỉ dùng cho test)
npm test        # chạy toàn bộ
```

`lendon.test.js` kiểm tra `Pancake-LenDon-13.1.user.js` theo 3 nhóm:

1. **Đọc tiền / nhãn / size** — `320.000đ`, `260k`, `1tr2`, `320 nghìn`, `160k + 160k`,
   `160k = 320k`, `Tổng Đơn Hàng : … 199k miễn ship`; loại giờ/ngày, SĐT, `cấp`≠`ấp`,
   `Giảm giá theo combo` ≠ `Giảm giá`…
2. **Bộ điều khiển giảm giá** (app giả) — đủ hàng, có phí ship, số lẻ, chưa đủ hàng,
   ô giảm giá vô tác dụng, app kẹp giá trị, người dùng sửa tay, tổng đơn cũ,
   thêm sản phẩm sau khi giảm, chênh lệch quá lớn.
3. **DOM thật (jsdom)** — dựng theo `html.txt` / `html2.txt` / `html3.txt`:
   pane "Tạo đơn" đang mở vs pane "Thông tin", không có `#customerCol`,
   dòng tổng không có `.text-final-price`, nhãn tổng là chữ lạ,
   pane bị đẩy ra ngoài màn hình, và chỉ định thủ công (① / ②).
