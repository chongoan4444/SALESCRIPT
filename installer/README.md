# BOTFAKE LITE — Bộ cài 1-click cho Windows

## Cơ chế (đọc 30 giây là hiểu)

- Extension được đóng gói thành file `.crx` có chữ ký số, ID cố định:
  `jjdjmbjejaajhkocjniccgpmipgajmhg`
- File `docs/botfake.crx` + `docs/update.xml` được host miễn phí trên GitHub Pages
  của repo này: `https://chongoan4444.github.io/SALESCRIPT/`
- File `Cai-BOTFAKE.bat` ghi 1 dòng cấu hình (policy) vào Windows. Chrome đọc cấu
  hình đó rồi **tự tải, tự cài extension** và **tự cập nhật** mỗi khi có bản mới.
  Người dùng không cần biết Developer mode / Load unpacked là gì.
- Vì cài bằng policy nên extension hiện là "được quản lý bởi tổ chức của bạn" và
  người dùng **không tự tắt/gỡ bằng tay được** — muốn gỡ phải chạy `Go-BOTFAKE.bat`.
  (Đây cũng là ưu điểm: không ai lỡ tay tắt mất extension.)

## Việc cần làm 1 lần duy nhất (theo thứ tự)

1. **Merge PR** chứa thư mục `docs/` + `installer/` vào nhánh `main`.
2. **Bật GitHub Pages**: vào repo → Settings → Pages → Source: Deploy from a
   branch → Branch: `main`, thư mục `/docs` → Save. Chờ ~1 phút, mở thử
   `https://chongoan4444.github.io/SALESCRIPT/update.xml` thấy nội dung XML là OK.
3. **Test trên máy mình trước**: gỡ/tắt bản unpacked cũ trong
   `chrome://extensions` (tránh chạy 2 bản cùng lúc), chạy `Cai-BOTFAKE.bat`
   (chuột phải → Run as administrator, hoặc double-click rồi bấm Yes khi Windows
   hỏi quyền), mở lại Chrome, chờ ~1 phút — biểu tượng BOTFAKE tự xuất hiện.
4. Ổn rồi thì **chỉ gửi file `Cai-BOTFAKE.bat` cho mọi người**. Việc của họ:
   double-click → bấm Yes → xong. Gửi kèm `Go-BOTFAKE.bat` để họ có đường gỡ.

## Ra bản mới về sau

1. Sửa code như bình thường, tăng version trong `extension/manifest.json`.
2. Chạy: `pip install cryptography` (1 lần) rồi `python installer/build-crx.py`
   — script tự đóng gói lại `docs/botfake.crx` + `docs/update.xml`.
3. Commit `docs/` lên `main` (qua PR như thường lệ) — **không cần gửi lại file
   cài**, mọi máy đã cài sẽ tự cập nhật trong vài giờ (Chrome tự kiểm tra định kỳ).

## ⚠️ File khóa ký — QUAN TRỌNG NHẤT

`installer/extension-signing-key.pem` là khóa quyết định extension ID.

- File này **không được commit lên GitHub** (repo này công khai — đã chặn bằng
  `.gitignore`). Chỉ giữ trên máy của bạn + 1 bản sao dự phòng (USB/Drive riêng).
- **Mất khóa này = mất ID**: không đóng gói được bản cập nhật cho các máy đã
  cài, muốn ra bản mới phải tạo ID mới và mọi người cài lại từ đầu.
- Khi cần đóng gói ở máy khác, copy file khóa này vào đúng thư mục `installer/`
  trước khi chạy `build-crx.py` (nếu không có khóa, script sẽ tự tạo khóa mới —
  ID sẽ khác ngay).

## Gỡ cài đặt

Chạy `Go-BOTFAKE.bat` (tự xin quyền Admin) → tắt hết Chrome mở lại → extension
tự biến mất. Không cần xóa thêm gì.
