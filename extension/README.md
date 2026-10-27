# BOTFAKE LITE — Chrome extension

Thanh tiến trình khi **đổi tab**: `BOTFAKE đang chạy ở 2 tab` + **Pancake #1** / **Pancake #2** + `%`.

Gửi **vẫn trong tab Pancake** (API/Socket như LITE). Background chỉ **gom %** để hiện overlay. Tab ẩn Chrome vẫn có thể bóp JS — overlay thì thấy được.

## Cài

1. Chrome → `chrome://extensions` → Bật **Developer mode**.
2. **Load unpacked** → chọn **thư mục gốc repo** `SALESCRIPT` (file `manifest.json` ở gốc).
3. Tắt Tampermonkey cho script LITE trên `pages.fm` (tránh chạy 2 lần).
4. Mở 1–2 tab Pancake, bấm ▶ Chạy, đổi sang Google/Facebook → góc phải dưới có thanh.

Tắt extension thì dùng lại Tampermonkey như cũ.
