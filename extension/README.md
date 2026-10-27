# BOTFAKE LITE — Chrome extension

**v1.91.0 — gửi NỀN:** bấm ▶ Chạy trên tab Pancake, lệnh **POST API chạy trong service worker**. Đổi tab / ẩn cửa sổ **không bị Chrome bóp** tốc độ gửi.

Overlay khi đổi tab: `BOTFAKE đang chạy ở 2 tab` + **Pancake #1** / **#2** + `%`.

Kênh nền = **API**. Bù Socket/Extension (#551 / nick khóa) **không** chạy ở SW. Tampermonkey (không load extension) vẫn gửi trong tab như cũ.

## Cài

1. Chrome → `chrome://extensions` → Bật **Developer mode**.
2. **Load unpacked** → chọn **thư mục gốc repo** `SALESCRIPT` (file `manifest.json` ở gốc).
3. Tắt Tampermonkey cho script LITE trên `pages.fm` (tránh chạy 2 lần).
4. Mở 1–2 tab Pancake, bấm ▶ Chạy, đổi sang Google/Facebook → góc phải dưới có thanh.

Tắt extension thì dùng lại Tampermonkey như cũ.
