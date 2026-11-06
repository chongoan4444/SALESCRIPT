# Cài BOTFAKE LITE (Chrome extension)

Repo này chỉ có **1 file `manifest.json` duy nhất**: `extension/manifest.json`.
(Không còn `manifest.json` ở gốc repo — bản cũ trỏ `scripts/...` nên ai Load unpacked nhầm thư mục
gốc sẽ tạo ra một extension thứ 2 với ID khác, chạy song song bản CRX → 2 panel, gửi trùng tin.)

**Load unpacked đúng thư mục `extension`** — thư mục có `manifest.json` + `background.js` +
`overlay.js` + `bridge.js` + `pancake-send-lite.user.js` **cùng cấp**.

## Cài

1. `chrome://extensions` → bật Developer mode.
2. **Load unpacked** → chọn folder **`extension`** (không chọn file, không chọn gốc repo).
3. Tắt Tampermonkey LITE trên Pancake (nếu còn) để không chạy 2 bản.
4. Reload extension mỗi lần cập nhật code.

Trong folder phải thấy:

```
extension/
  manifest.json
  background.js
  bridge.js
  overlay.js
  pancake-send-lite.user.js
  popup.html
  popup.js
  icons/
```

## Cấu trúc & luồng chạy

- `pancake-send-lite.user.js` — toàn bộ panel + logic gửi, chạy ở world `MAIN` (cùng ngữ cảnh với
  app Pancake để đọc Redux store / `__MqttHelper__` / `__ExtensionAdapter__`).
- `bridge.js` — world isolated, cầu `window.postMessage` ↔ `chrome.runtime.sendMessage`
  (script MAIN dùng cầu này khi `chrome.runtime` không truy cập được).
- `background.js` — service worker: gửi bằng API trong background (không bị bóp khi đổi tab),
  đọc cookie jar, gắn Cookie qua `declarativeNetRequest`, giữ trạng thái job để overlay phát lại.
- `overlay.js` — thanh tiến độgóc phải trên **mọi tab** (Pancake #1/#2 theo thứ tự tab).
- `popup.js` — nút "Hiện panel" / kiểm tra tab hiện tại có phải Pancake.

## Version — 3 nơi phải khớp nhau

| Nơi | Ý nghĩa |
|---|---|
| `extension/manifest.json` → `version` | Chrome so sánh để biết có bản mới (chỉ nhận 1–4 cụm số, vd `1.91.43`; **không** nhận `1.91.43-beta`) |
| `pancake-send-lite.user.js` → `// @version` | để đối chiếu khi đọc file |
| `pancake-send-lite.user.js` → `const APP_VERSION` | hiện trên tiêu đề panel — nhìn là biết máy đang chạy bản nào |

## Phát hành (do người giữ khóa ký làm)

1. Sửa code trong `extension/`, tăng version ở **cả 3 nơi** ở trên.
2. `python installer/build-crx.py` (máy phải có `installer/extension-signing-key.pem`).
3. Commit `docs/` (crx + update.xml) → máy đã cài tự cập nhật.

Khóa ký quyết định extension ID `jjdjmbjejaajhkocjniccgpmipgajmhg` — mất khóa là mất ID.
