# 14.0 FINAL - Bắt khi vàng nhưng không lọt tin cũ trước khi vào chế độ

## Yêu cầu user
> "nhưng tôi vẫn muốn cơ chế bắt khi vàng nhưng phải làm cách nào đảm bảo không lọt những tin nhắn cmt unread trước khi vào chế độ"

=> Vẫn muốn F1 khi VÀNG (blocked) vẫn bắt tin mới nhất nhảy vào top, nhưng phải đảm bảo không bỏ sót / bắt nhầm tin cũ đã tồn tại trước khi bật F1.

## Thiết kế 14.0

### 1. Snapshot lúc bật F1
```js
f1Snapshot = Map<id, {wasUnread, wasEligible, snippet}>
oldEligibleIds = Set<id eligible lúc bật>
```
- Lưu TẤT CẢ ID đang có trong list, kèm wasUnread và wasEligible
- oldEligibleIds = những ID raw eligible (không tag, envelope-selected, unread) lúc bật
- Log: "Snapshot 12 total, oldEligible 1" với html3.txt (chỉ Oanh Bui)

Đảm bảo không lọt: mọi tin cũ trước khi vào chế độ đều có trong snapshot, dù lúc đó có tag hay không.

### 2. isOldConversation
```js
if id not in snapshot and not in oldEligibleIds => mới hoàn toàn (false)
if id in oldEligibleIds => cũ (true)
if id in snapshot:
  if !wasUnread && curUnread => mới (read->unread nhảy lên)
  else cũ
```
- Tin cũ read thành unread được coi là mới (để bắt khi nó nhảy lên top)
- Tin hoàn toàn mới chưa từng thấy là mới
- Còn lại là cũ

### 3. hasOldEligibleTarget
Đếm số tin cũ còn eligible:
```js
for each item:
  if !isOld => skip
  if raw eligible => count++
```
Giữ VÀNG nếu count>0. Đảm bảo không lọt: chỉ khi hết cũ mới chuyển XANH.

### 4. markBottomNewAsOld (tách riêng, không side-effect trong hasOld cũ)
```js
for idx, item:
  if id in snapshot or oldEligibleIds => skip
  if raw eligible && idx>=3 => add oldEligibleIds
```
- Tin mới hoàn toàn xuất hiện ở đáy (idx>=3) trong lúc VÀNG sẽ bị đánh dấu là cũ ngay
- Tránh trường hợp: new có tag ở top (raw null) + new eligible đáy 11 → nếu không đánh dấu đáy là cũ, findNew quét top3 không thấy gì, giữ vàng, nhưng sau đó khi top tag biến mất, nó sẽ quét xuống và bắt nhầm đáy (đáy là tin cũ xuất hiện trong lúc vàng, không phải tin mới nhất top)

### 5. findNewEligibleTargetNotInSnapshot (khi VÀNG chỉ quét top3)
```js
if blocked: markBottomNewAsOld()
maxScan = blocked ? min(3, len) : len
for i in 0..maxScan-1:
  if oldEligibleIds.has(id) => skip
  if snapshot.has(id) && isOld => skip
  if raw eligible => FOUND (bắt ngay dù vàng)
```
- Khi VÀNG chỉ quét top3, đảm bảo bắt tin mới nhất từ trên xuống
- Skip oldEligible (cũ lúc bật + đáy mới đánh dấu)
- Skip old snapshot (cũ)
- Cho phép read->unread mới và completely new

### 6. Rearm và Observer
- **Rearm sau flow**: `markBottomNewAsOld()` → `hasOld()` → nếu còn cũ → VÀNG, else `takeSnapshot()` → `hasRaw()` → nếu còn raw → VÀNG, else XANH
- **Observer khi VÀNG**: `findNew()` → nếu có mới → XANH + bắt, else `hasOld()` → nếu hết cũ → snapshot + hasRaw check → VÀNG/XANH

Đảm bảo không lọt: sau khi bắt tin mới khi VÀNG, rearm vẫn check hasOld, nếu còn Oanh Bui cũ thì lại VÀNG, không bỏ sót.

## Test với html3.txt

html3.txt: 12 items, 1 pinned read, 11 unread, chỉ Oanh Bui (id1) không tag eligible.

- Bật F1: snapshot 12, oldEligible {id1}, hasOld true, hasRaw true → VÀNG (đảm bảo không lọt Oanh Bui)
- Trong lúc VÀNG, newTag có tag top0 + Oanh Bui top1 + newBottom eligible đáy 11:
  - markBottom: newBottom idx11 -> old, oldEligible {id1, newBottom}
  - findNew top3: newTag raw null skip, id1 oldEligible skip, id2 old skip → None → giữ VÀNG, không bắt nhầm đáy
- newEligibleTop không tag top0 trong lúc VÀNG: findNew FOUND top0 → bắt ngay dù VÀNG, sau đó rearm hasOld true (còn id1) → lại VÀNG, không lọt id1
- pinned read id0 thành unread không tag nhảy top0: read->unread => isOld false => findNew FOUND → bắt
- Sau khi Oanh Bui được xử lý thủ công thành read: hasOld false, hasRaw false → VÀNG→XANH, chờ mới

## Giữ nguyên gửi tin như 11.1 gốc

- `sendComposerCommand` giữ nguyên logic gốc: đợi composer có text != command rồi click mũi tên gửi → đảm bảo gắn tag xong gửi luôn
- `triggerElementAction` giữ click đơn giản như gốc (đã test ổn định)
- `waitFor` tối ưu MutationObserver, `isConversationUnread` fix từ HTML thật (border-fake, envelope-selected, badge, fontWeight)

File: `Pancake-Auto-14.0-Final.user.js` (sync `Pancake-Auto-Optimized.user.js`)
