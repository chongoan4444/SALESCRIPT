# Fix Quy Trình Hoạt Động 13.2

## Vấn đề phát hiện khi review lại workflow

### 1. Bug rearm sau flow (nghiêm trọng)
**Code cũ 13.0/13.1:**
```js
function rearmF1AfterFlow(flowId) {
  if (hasOldEligibleTarget()) {
    f1State = 'blocked';
  } else {
    takeF1Snapshot();
    if (hasEligibleF1Target()) { // hasEligible dùng classifyConversation
      f1State = 'blocked';
    } else {
      f1State = 'armed';
    }
  }
}
```
`hasEligibleF1Target()` -> `findTarget()` -> `classifyConversation()`:
```js
function classifyConversation(item) {
  raw = classifyRaw(item);
  if (f1State === 'armed' && isOldConversation(item)) return null;
  return raw;
}
```
Tại thời điểm rearm, `f1State` vẫn là `armed` từ flow trước. Sau `takeF1Snapshot()`, tất cả item trong snapshot có `isOldConversation = true`, nên `classifyConversation` trả về `null` hết → `hasEligibleF1Target()` luôn `false` → luôn nhảy xanh dù snapshot mới vẫn còn raw eligible cũ cần giữ vàng.

**Fix 13.2:**
- Thêm `hasRawEligibleTarget()` chỉ check `classifyRaw` không phụ thuộc `f1State`.
- Rearm dùng `hasRawEligibleTarget()` sau snapshot:
```js
takeF1Snapshot();
if (hasRawEligibleTarget()) blocked else armed
```

### 2. Bug observer khi vàng
**Cũ:**
```js
if (!hasOldEligibleTarget()) {
  f1State = 'armed'; takeF1Snapshot();
}
```
Nếu `hasOld` false (hết cũ), lấy snapshot mới và nhảy xanh luôn, không check xem snapshot mới có raw eligible mới xuất hiện không. Nếu vừa có tin cũ mới xuất hiện ở đáy ngay sau khi hasOld false, sẽ xanh nhầm 1 nhịp.

**Fix 13.2:**
```js
if (!hasOldEligibleTarget()) {
  takeF1Snapshot();
  if (hasRawEligibleTarget()) blocked else armed
}
```

### 3. Bug toggleWaitingMode
Dùng `findEligibleF1Target` phụ thuộc `f1State`. Khi bật, `f1State` là `off` nên vẫn trả raw, nhưng không rõ ràng và dễ vỡ nếu sau này đổi logic. Fix dùng `hasRawEligibleTarget()` rõ ràng.

### 4. hasOld side-effect và phân biệt top vs bottom
Cũ: `hasOld` đánh dấu `idx>=5` là cũ, còn `idx 3-4` không đánh dấu → khi có tin mới có tag ở top, tin cũ đáy index 3-4 bị bắt nhầm.

13.0 fix: đánh dấu `idx>=3` là cũ. 13.2 làm rõ:
- Nếu ID hoàn toàn mới ở `idx>=3` và raw eligible → add `oldEligibleIds` + count cũ (giữ vàng).
- Nếu ID hoàn toàn mới ở `idx<3` và raw eligible → KHÔNG add, KHÔNG count, để `findNew` bắt (tin mới top).
- Nếu `!isOldConversation` (read->unread) → không count.

### 5. read->unread nhảy lên top khi vàng
13.0 skip vì `f1Snapshot.has(id)` → không bắt. 13.1/13.2 fix: khi vàng, `findNew` check `isOldConversation` thay vì chỉ check snapshot presence, cho phép read->unread bắt ngay.

## Kiểm thử logic với html3.txt

html3.txt: 12 items, 1 pinned read, 11 unread, chỉ Oanh Bui không tag eligible.

- Bật F1: snapshot 12, oldEligible 1 (Oanh Bui), `hasRaw true` → vàng.
- Trong lúc vàng:
  - newTag có tag top0 + Oanh Bui top1 + newBottom eligible đáy 11: `hasOld` đánh dấu newBottom là cũ (count 2), `findNew` top3 skip newTag raw null, skip Oanh Bui oldEligible, skip id2 old → None → giữ vàng, không bắt đáy → **đúng**.
  - newEligibleTop không tag top0: `findNew` top3 thấy completely new raw true → bắt ngay dù vàng → **đúng**.
  - pinned read (id0) có tin mới nhảy top thành unread no tag: `isOld false` → `findNew` cho phép bắt, `hasOld` không đếm → **đúng**.
- Khi Oanh Bui được xử lý thủ công thành read, `hasOld` false, snapshot mới không có raw eligible → xanh → **đúng**.
- Khi snapshot mới vẫn có raw eligible (ví dụ Oanh Bui vẫn còn), `hasRaw true` → giữ vàng → **đúng** (bug cũ sẽ xanh nhầm).

## File
- `Pancake-Auto-13.2-Final.user.js` – bản fix đầy đủ.
- `Pancake-Auto-Optimized.user.js` – sync 13.2.
