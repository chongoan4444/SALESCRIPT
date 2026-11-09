# Cài BOTFAKE LITE (Chrome extension)

**Load unpacked đúng thư mục `extension`** (thư mục có `manifest.json` + `background.js` + `overlay.js` + `pancake-send-lite.user.js` **cùng cấp**).

Không dùng `manifest.json` ở gốc repo nếu bạn chỉ copy 4 file ra folder khác — file gốc đang trỏ `scripts/...` và `extension/...` nên Chrome báo thiếu file.

## Cài

1. `chrome://extensions` → bật Developer mode.
2. **Load unpacked** → chọn folder **`extension`** (không chọn file, không chọn cả repo trừ khi dùng manifest gốc).
3. Tắt Tampermonkey LITE trên Pancake.
4. Reload extension mỗi lần cập nhật.

**Lưu ý trạng thái:** `pancake-send-lite.user.js` là bản nền Tab + Clipboard v1.91.72 được giữ riêng. Manifest trong thư mục này hiện trỏ tới đúng **một test clone**: `pancake-send-lite-wave200.user.js` (W200.13). Tab giao diện chuyển lượt đã xác nhận sang một tab Pancake sender riêng; service worker mở/quản lý tab và chuyển tiến độ/dừng, còn pipeline gửi, Socket và ACK vẫn chạy trong MAIN world của sender tab. Đây là bản thử nghiệm, **chưa live-test và chưa xác nhận dùng gửi thật**; nếu cần dùng bản nền đã khôi phục, hãy đổi manifest về `pancake-send-lite.user.js` trước khi load.

Không bật đồng thời clone này với Tampermonkey/bản gửi khác trên Pancake. Backup trước tái cấu trúc nằm ở `../backups/pre-extension-restructure-w200.13/`.

Trong folder:

```
extension/
  manifest.json                 # hiện chọn duy nhất clone kiểm thử W200
  background.js                 # service-worker coordinator
  bridge.js                     # bridge tới MAIN Pancake
  overlay.js
  pancake-send-lite.user.js     # bản nền Tab + Clipboard v1.91.72
  pancake-send-lite-wave200.user.js  # test clone duy nhất
```
