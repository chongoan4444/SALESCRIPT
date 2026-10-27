# Cài BOTFAKE LITE (Chrome extension)

**Load unpacked đúng thư mục `extension`** (thư mục có `manifest.json` + `background.js` + `overlay.js` + `pancake-send-lite.user.js` **cùng cấp**).

Không dùng `manifest.json` ở gốc repo nếu bạn chỉ copy 4 file ra folder khác — file gốc đang trỏ `scripts/...` và `extension/...` nên Chrome báo thiếu file.

## Cài

1. `chrome://extensions` → bật Developer mode.
2. **Load unpacked** → chọn folder **`extension`** (không chọn file, không chọn cả repo trừ khi dùng manifest gốc).
3. Tắt Tampermonkey LITE trên Pancake.
4. Reload extension mỗi lần cập nhật.

Trong folder phải thấy:

```
extension/
  manifest.json
  background.js
  overlay.js
  pancake-send-lite.user.js
```
