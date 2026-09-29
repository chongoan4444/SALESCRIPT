# Fix 13.4 - Gắn tag xong không gửi tin nhắn

## Triệu chứng
User báo: "nó gắn tag xong gửi tin nhắn không gửi đi luôn"

## Nguyên nhân phân tích toàn bộ logic

### 1. processMess cũ (13.3)
```js
async function processMess(flowId, gen) {
  await executeTaggingOnly(gen);
  await sleep(60);
  await sendComposerCommand('/.', false, flowId, gen);
}
```
- `executeTaggingOnly` mở dropdown tag (nếu cần tìm T.Anh), click tag 24,25,T.Anh, rồi đóng dropdown trong finally.
- Nhưng `closeTagDropdown` chỉ click nút dropdown, nếu React chưa kịp render thì dropdown vẫn mở, che composer.
- Sleep 60ms quá ngắn, dropdown chưa đóng hẳn, composer chưa sẵn sàng.
- `sendComposerCommand('/.')` chỉ set text '/.' và click suggestion. Trong Pancake, chọn suggestion '/.' chỉ **insert template vào composer** chứ không auto-send (tùy cấu hình quick reply). Nếu template không auto-send, composer vẫn còn text, tin nhắn chưa đi.
- Không có fallback click mũi tên gửi.

### 2. triggerElementAction yếu
- Bản cũ chỉ `el.click()`. Pancake dùng React, nhiều button cần gọi `__reactProps$.onClick` hoặc pointer events. Tag button có thể click không ăn, dẫn đến tagging tưởng thành công nhưng thực ra chưa active, hoặc dropdown không đóng.

### 3. Clone flow tương tự
- `processCloneMess` cũng chỉ gửi '/.' mà không đảm bảo click gửi.

## Fix 13.4

### A. Nâng cấp triggerElementAction (từ F4/F7 optimized)
```js
function findReactOnClick(el) { ... __reactProps$ / __reactEventHandlers$ / __reactFiber$ ... }
function triggerElementAction(el) {
  // 1. Thử React onClick trên el và 6 parent
  // 2. pointerdown/mousedown/pointerup/mouseup/click + el.click()
}
```
Đảm bảo click tag, dropdown, suggestion, mũi tên gửi hoạt động với React.

### B. executeTaggingOnly robust
- Tăng sleep giữa các tag từ 30ms lên 50ms, sau tagging sleep 100ms.
- Finally luôn đóng dropdown và sleep 150ms, set flag false.
- Double-check sau finally: nếu #listAllTags vẫn visible, force click dropdown lần nữa.
- Log rõ ràng.

### C. processMess đảm bảo gửi
```js
await executeTaggingOnly
sleep 200
closeTagDropdown + sleep 100
await sendComposerCommand('/.')
sleep 300
composer = getComposer()
text = getEditorText(composer)
if text còn -> clickComposerSendArrow (fallback)
else thử click mũi tên dù composer trống (đề phòng /. đã insert nhưng chưa gửi)
```
- Thêm log chi tiết từng bước.
- Đảm bảo dropdown đóng trước khi gửi.

### D. processCloneMess tương tự
- Tăng sleep sau tagging 60->200, close dropdown, sleep 100.
- Sau '/.' sleep 300 và fallback click send arrow nếu composer còn text.

### E. Giữ nguyên fix workflow 13.2/13.3
- hasRawEligibleTarget, hasOld với top<3 không đánh dấu cũ, bottom>=3 đánh dấu cũ, read->unread cho phép bắt top3 khi vàng.
- Observer và rearm dùng raw check thay vì hasEligible phụ thuộc f1State.

## Kiểm thử logic
- Tagging: với trigger mới, tag 24,25,T.Anh sẽ được active đúng dù React.
- Dropdown: luôn đóng trước khi gửi, tránh che composer.
- Gửi: '/.' insert template, sau đó click mũi tên gửi đảm bảo tin nhắn đi luôn, không phụ thuộc cấu hình auto-send của quick reply.
- Nếu composer trống sau '/.' (trường hợp auto-send), vẫn thử click mũi tên (an toàn).

## File
- Pancake-Auto-13.4-Final.user.js (fix chính)
- Pancake-Auto-Optimized.user.js (sync)
